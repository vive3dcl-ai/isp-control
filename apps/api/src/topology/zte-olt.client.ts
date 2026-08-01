import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import { Client as SshClient } from 'ssh2';
import { detectPonTypeFromCards } from './olt.constants';
import { sshHostVerification } from './olt-ssh-host-key.util';
import {
  buildZteC6xxVportIf,
  detectZteFwFamily,
  toZteCanonicalOnuIf,
  toZteCliOltIf,
  toZteCliOnuIf,
  type ZteFwFamily,
} from './zte-olt-firmware.util';
import {
  formatOnuStatusReport,
  oltIfFromOnuIf,
  onuIfFromOltIf,
  parseOnuAttenuation,
  parseOnuBaseInfo,
  parseOnuDetailInfo,
  parseOnuInterfaceConfig,
  parseOnuInterfaceRates,
  parseOnuInterfacesFromRunningConfig,
  parseOnuMacTable,
  parseOnuOpticalTable,
  parseOnuRxByIf,
  parseOnuStateRows,
  countUncfgDataLines,
  parseOnuUncfg,
  parseRemoteOnuEquip,
  parseRemoteOnuLanPorts,
  suggestNextOnuId,
  type ZteOnuStateRow,
  type ZteRemoteOnuEquip,
  type ZteUncfgOnu,
} from './zte-olt-onu.util';
import {
  expandVlanList,
  extractAllInterfaceBlocks,
  extractInterfaceBlock,
  extractUplinkIfNames,
  formatVlanList,
  inferMediaType,
  parseUplinkConfigBlock,
  type ZteUplinkRaw,
} from './zte-olt-uplink.util';
import {
  buildOltIfName,
  defaultMaxOnus,
  extractPonOltIfNames,
  isPonLineCard,
  looksCompleteRunningConfig,
  normalizePonOltIfName,
  parseAdminShutdown,
  parseAvgOnuRx,
  parseDescription,
  parseOnuIdsFromState,
  parseOnuStateCounts,
  parseOpticalTxPower,
  parsePonOltIfName,
  parseRangeFromConfig,
  type ZtePonPortRaw,
} from './zte-olt-pon.util';
import {
  interpretNoVlanOutput,
  mergeVlanCatalogs,
  parseVlansFromRunningConfig,
  parseVlansFromShowVlan,
  type ZteVlanRaw,
} from './zte-olt-vlan.util';
import {
  mbpsToKbps,
  pairOltSpeedProfiles,
  parseTcontProfiles,
  parseTrafficProfiles,
  sanitizeSpeedProfileName,
} from './zte-olt-speed.util';
import {
  defaultDescription,
  ethIfList,
  parseOnuTypeList,
  potsIfList,
  wifiIfList,
  type OltOnuTypeSummary,
  type OnuTypeProfileSpec,
} from './zte-olt-onu-type.util';

export interface ZteConnectedOnu {
  onuIf: string;
  ponType: 'gpon' | 'epon';
  board: string;
  port: string;
  onuId: string;
  status: string;
  online: boolean;
  phaseState: string;
  adminState: string;
  sn: string | null;
  onuType: string | null;
  name: string | null;
  description: string | null;
  signalDbm: number | null;
  mode: 'bridge' | 'router' | null;
  vlan: number | null;
  vlans: number[];
}

export interface ZteConnectedOnuDetail extends ZteConnectedOnu {
  oltRxDbm: number | null;
  distanceM: number | null;
  onlineDuration: string | null;
  /** Customer download (bajada) — OLT output rate, bytes/s */
  downloadBps: number | null;
  /** Customer upload (subida) — OLT input rate, bytes/s */
  uploadBps: number | null;
  runningConfig: string;
  detailInfoRaw: string;
  ethernetPorts: Array<{
    port: string;
    adminState: string;
    mode: string;
    dhcp: string;
  }>;
  wifiPorts: Array<{
    port: string;
    band: string;
    adminState: string;
    mode: string;
    ssid: string;
    dhcp: string;
  }>;
  voipSupported: boolean | null;
  catvSupported: boolean | null;
}
export interface ZteOltCard {
  rack: string;
  shelf: string;
  slot: string;
  cfgType: string;
  realType: string;
  /** Port count from show card */
  ports?: number;
  softVer?: string;
  status: string;
  /** Main / Standby for control cards; Main for line cards */
  role?: string | null;
}

export interface ZteOltCardsResult {
  ok: boolean;
  error?: string;
  cards: ZteOltCard[];
  probedAt: string;
  summary: string | null;
}

export interface ZteOltProbeResult {
  ok: boolean;
  error?: string;
  /** Product hint from banner, e.g. C320 */
  product?: string;
  hostname?: string;
  /** SoftVer from show card / show version, e.g. V2.1.0 */
  softVer?: string;
  /** Huawei SmartAX dialect tag (ma5600t / ma5800), when known */
  firmwareFamily?: string;
  /** Detected PON family from line cards */
  ponType?: 'gpon' | 'epon' | 'gpon_epon';
  cards?: ZteOltCard[];
  rawCardSummary?: string;
  /** Control-card CPU(1m) % */
  cpuLoad?: number;
  /** Free RAM bytes (derived from PhyMem + Memory%) */
  freeMemory?: number;
  /** Total RAM bytes */
  totalMemory?: number;
  /** Prefer control-card temp °C */
  temperature?: number;
  /** Human-readable uptime from show system-group */
  uptime?: string;
}

/**
 * Read-only probe for ZTE C3xx family (C220/C300/C320/C350).
 * Uses Telnet or SSH CLI — same style as SmartOLT (no native REST API).
 */
@Injectable()
export class ZteOltClient {
  private readonly logger = new Logger(ZteOltClient.name);
  /**
   * Serialize CLI per OLT — public/NAT VTY often allows only one session.
   * Interactive UI ops jump ahead of background poll work.
   */
  private readonly cliQueues = new Map<
    string,
    {
      interactive: Array<{ run: () => Promise<void> }>;
      background: Array<{ run: () => Promise<void> }>;
      pumping: boolean;
    }
  >();
  /** Dialecto C3xx / C6xx cacheado tras probe (5 min). */
  private readonly fwCache = new Map<
    string,
    { family: ZteFwFamily; atMs: number }
  >();

  private cliKey(host: string, port: number) {
    return `${host}:${port}`;
  }

  /** Dos OLTs distintas pueden compartir host:port detrás de NAT/VPN. */
  private fwKey(host: string, port: number, subtypeHint?: string | null) {
    return `${this.cliKey(host, port)}|${subtypeHint ?? ''}`;
  }

  private rememberFwFamily(
    host: string,
    port: number,
    family: ZteFwFamily,
    subtypeHint?: string | null,
  ) {
    if (family === 'unknown') return;
    this.fwCache.set(this.fwKey(host, port, subtypeHint), {
      family,
      atMs: Date.now(),
    });
  }

  private resolveFwFamily(params: {
    host: string;
    port: number;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
    productHint?: string | null;
    cardTypes?: string[];
  }): ZteFwFamily {
    // Un subtype declarado es más confiable que la caché: solo se usa la caché
    // cuando la detección no puede resolver por sí sola.
    const detected = detectZteFwFamily({
      subtype: params.subtypeHint,
      product: params.productHint ?? params.firmwareHint,
      softVer: params.firmwareHint,
      versionText: params.firmwareHint,
      cardTypes: params.cardTypes,
    });
    if (detected !== 'unknown') {
      this.rememberFwFamily(
        params.host,
        params.port,
        detected,
        params.subtypeHint,
      );
      return detected;
    }
    const cached = this.fwCache.get(
      this.fwKey(params.host, params.port, params.subtypeHint),
    );
    if (cached && Date.now() - cached.atMs < 5 * 60_000) {
      return cached.family;
    }
    return 'unknown';
  }

  private cliOnuIf(onuIf: string, family: ZteFwFamily): string {
    return toZteCliOnuIf(onuIf, family === 'unknown' ? 'c3xx' : family);
  }

  private cliOltIf(oltIf: string, family: ZteFwFamily): string {
    return toZteCliOltIf(oltIf, family === 'unknown' ? 'c3xx' : family);
  }

  /** Resolve dialect + CLI ifNames for an ONU operation. */
  private dialectOnuContext(
    params: {
      host: string;
      port: number;
      subtypeHint?: string | null;
      firmwareHint?: string | null;
    },
    onuIfRaw: string,
  ): {
    fw: ZteFwFamily;
    onuIfCanon: string;
    onuIf: string;
    oltIfCanon: string;
    oltIf: string;
    onuId: string;
    ponFamily: 'gpon' | 'epon';
  } | null {
    const onuIfCanon = toZteCanonicalOnuIf(onuIfRaw);
    const oltIfCanon = oltIfFromOnuIf(onuIfCanon);
    const onuId = onuIfCanon.match(/:(\d+)$/)?.[1];
    if (!oltIfCanon || !onuId) return null;
    const fw = this.resolveFwFamily({
      host: params.host,
      port: params.port,
      subtypeHint: params.subtypeHint,
      firmwareHint: params.firmwareHint,
    });
    return {
      fw,
      onuIfCanon,
      onuIf: this.cliOnuIf(onuIfCanon, fw),
      oltIfCanon,
      oltIf: this.cliOltIf(oltIfCanon, fw),
      onuId,
      ponFamily: oltIfCanon.startsWith('epon') ? 'epon' : 'gpon',
    };
  }

  private async withCliLock<T>(
    host: string,
    port: number,
    fn: () => Promise<T>,
    priority: 'interactive' | 'background' = 'interactive',
  ): Promise<T> {
    const key = this.cliKey(host, port);
    let q = this.cliQueues.get(key);
    if (!q) {
      q = { interactive: [], background: [], pumping: false };
      this.cliQueues.set(key, q);
    }
    return new Promise<T>((resolve, reject) => {
      const entry = {
        run: async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        },
      };
      if (priority === 'background') q.background.push(entry);
      else q.interactive.push(entry);
      void this.pumpCliQueue(key);
    });
  }

  private async pumpCliQueue(key: string) {
    const q = this.cliQueues.get(key);
    if (!q || q.pumping) return;
    q.pumping = true;
    try {
      for (;;) {
        const next = q.interactive.shift() ?? q.background.shift();
        if (!next) break;
        await next.run();
      }
    } finally {
      q.pumping = false;
      if (q.interactive.length || q.background.length) {
        void this.pumpCliQueue(key);
      }
    }
  }

  async probe(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    subtypeHint?: string | null;
  }): Promise<ZteOltProbeResult> {
    try {
      const result =
        params.protocol === 'ssh'
          ? await this.probeSsh(params)
          : await this.probeTelnet(params);
      if (result.ok) {
        const family = detectZteFwFamily({
          subtype: params.subtypeHint,
          product: result.product,
          softVer: result.softVer,
          cardTypes: (result.cards || []).flatMap((c) => [
            c.cfgType,
            c.realType,
          ]),
        });
        this.rememberFwFamily(params.host, params.port, family);
        return {
          ...result,
          firmwareFamily: family !== 'unknown' ? family : result.firmwareFamily,
        };
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `ZTE OLT probe failed ${params.host}:${params.port}: ${message}`,
      );
      return { ok: false, error: message };
    }
  }

  /** Lightweight: login + show card only (for Tarjetas tab). */
  async listCards(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
  }): Promise<ZteOltCardsResult> {
    const probedAt = new Date().toISOString();
    try {
      const cards =
        params.protocol === 'ssh'
          ? await this.runCardsSsh(params)
          : await this.runCardsTelnet(params);
      return {
        ok: true,
        cards,
        probedAt,
        summary: this.summarizeCards(cards),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `ZTE OLT listCards failed ${params.host}:${params.port}: ${message}`,
      );
      return {
        ok: false,
        error: message,
        cards: [],
        probedAt,
        summary: null,
      };
    }
  }

  /** Reload a single card slot (write). Expects ZTE `reload slot r/s/sl`. */
  async rebootCard(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    rack: string;
    shelf: string;
    slot: string;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    try {
      if (params.protocol === 'ssh') {
        return await this.rebootCardSsh(params);
      }
      return await this.rebootCardTelnet(params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  async listPonPorts(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    priority?: 'interactive' | 'background';
    /**
     * Light sync: card + per-port running-config only.
     * ONU counts / optical / Up-Down come from SNMP+DB later.
     */
    light?: boolean;
  }): Promise<{
    ok: boolean;
    error?: string;
    ports: ZtePonPortRaw[];
    probedAt: string;
    summary: string | null;
  }> {
    const probedAt = new Date().toISOString();
    try {
      // Same CLI lock as everything else — never open a second VTY to the OLT.
      const ports = await this.runConfigWrite(params, (send, read) =>
        this.collectPonPortsFromSession(send, read, {
          light: params.light !== false,
        }),
      );
      const up = ports.filter((p) => p.status === 'Up').length;
      const onuOnline = ports.reduce((s, p) => s + p.onuOnline, 0);
      return {
        ok: true,
        ports,
        probedAt,
        summary: `${up}/${ports.length} puertos Up · ${onuOnline} ONUs en línea`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`listPonPorts failed: ${message}`);
      return {
        ok: false,
        error: message,
        ports: [],
        probedAt,
        summary: null,
      };
    }
  }

  /** Live inventory of authorized ONUs (read-only CLI). */
  async listConnectedOnus(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    /** Pull interface names/vlans from running-config (slower). Default true. */
    includeRunningConfig?: boolean;
    /**
     * Only scan these PON OLT interfaces (e.g. ports that already have
     * imported ONUs). Background pollers should pass this to avoid walking
     * every empty port every minute.
     */
    onlyOltIfs?: string[];
    priority?: 'interactive' | 'background';
  }): Promise<{
    ok: boolean;
    error?: string;
    onus: ZteConnectedOnu[];
    probedAt: string;
    summary: string | null;
  }> {
    const probedAt = new Date().toISOString();
    try {
      const onus = await this.runConfigWrite(params, (send, read) =>
        this.collectConnectedOnusFromSession(
          send,
          read,
          params.includeRunningConfig !== false,
          params.onlyOltIfs,
        ),
      );
      const online = onus.filter((o) => o.online).length;
      return {
        ok: true,
        onus,
        probedAt,
        summary: `${online}/${onus.length} ONUs en línea`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`listConnectedOnus failed: ${message}`);
      return {
        ok: false,
        error: message,
        onus: [],
        probedAt,
        summary: null,
      };
    }
  }

  async getConnectedOnuDetail(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    priority?: 'interactive' | 'background';
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    onu?: ZteConnectedOnuDetail;
    probedAt: string;
  }> {
    const probedAt = new Date().toISOString();
    try {
      const onu = await this.runConfigWrite(params, (send, read) =>
        this.collectOnuDetailFromSession(send, read, params),
      );
      return { ok: true, onu, probedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`getConnectedOnuDetail failed: ${message}`);
      return { ok: false, error: message, probedAt };
    }
  }

  /**
   * Live SmartOLT-style status for one ONU (read-only CLI; no persist).
   */
  async getOnuStatusReport(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    report?: string;
    runningConfig?: string;
    swInfo?: ZteRemoteOnuEquip;
    probedAt: string;
  }> {
    const probedAt = new Date().toISOString();
    try {
      const data = await this.runConfigWrite(params, (send, read) =>
        this.collectOnuStatusReportFromSession(send, read, params),
      );
      return { ok: true, ...data, probedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`getOnuStatusReport failed: ${message}`);
      return { ok: false, error: message, probedAt };
    }
  }

  /**
   * Remote ONU equipment / software info (read-only).
   */
  async getOnuSwInfo(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    equip?: ZteRemoteOnuEquip;
    probedAt: string;
  }> {
    const probedAt = new Date().toISOString();
    try {
      const equip = await this.runConfigWrite(params, async (send, read) => {
        const ctx = this.dialectOnuContext(params, params.onuIf);
        if (!ctx) throw new Error(`onuIf inválido: ${params.onuIf}`);
        await send(`show ${ctx.ponFamily} remote-onu equip ${ctx.onuIf}`);
        const out = await read(20_000);
        return parseRemoteOnuEquip(this.cleanCliNoise(out));
      });
      return { ok: true, equip, probedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`getOnuSwInfo failed: ${message}`);
      return { ok: false, error: message, probedAt };
    }
  }

  /**
   * Sample live Input/Output Bps for a batch of ONUs in one CLI session.
   * Rates: uploadBps = OLT input, downloadBps = OLT output.
   */
  async sampleOnuTrafficRates(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIfs: string[];
    priority?: 'interactive' | 'background';
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    rates: Array<{
      onuIf: string;
      downloadBps: number | null;
      uploadBps: number | null;
      downloadPps?: number | null;
      uploadPps?: number | null;
    }>;
    probedAt: string;
  }> {
    const probedAt = new Date().toISOString();
    const onuIfs = [
      ...new Set(params.onuIfs.map((s) => s.trim()).filter(Boolean)),
    ];
    if (onuIfs.length === 0) {
      return { ok: true, rates: [], probedAt };
    }
    try {
      const rates = await this.runConfigWrite(params, async (send, read) => {
        const fw = this.resolveFwFamily(params);
        const out: Array<{
          onuIf: string;
          downloadBps: number | null;
          uploadBps: number | null;
          downloadPps: number | null;
          uploadPps: number | null;
        }> = [];
        for (const onuIf of onuIfs) {
          try {
            const onuIfCli = this.cliOnuIf(onuIf, fw);
            await send(`show interface ${onuIfCli}`);
            const text = await read(12_000);
            const parsed = parseOnuInterfaceRates(text);
            out.push({
              onuIf,
              downloadBps: parsed.downloadBps,
              uploadBps: parsed.uploadBps,
              downloadPps: parsed.downloadPps,
              uploadPps: parsed.uploadPps,
            });
          } catch {
            out.push({
              onuIf,
              downloadBps: null,
              uploadBps: null,
              downloadPps: null,
              uploadPps: null,
            });
          }
        }
        return out;
      });
      return { ok: true, rates, probedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`sampleOnuTrafficRates failed: ${message}`);
      return { ok: false, error: message, rates: [], probedAt };
    }
  }

  /** Single-ONU traffic snapshot for LIVE view (fast; no persist). */
  async getOnuLiveTraffic(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    priority?: 'interactive' | 'background';
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    downloadBps: number | null;
    uploadBps: number | null;
    downloadPps: number | null;
    uploadPps: number | null;
    probedAt: string;
  }> {
    const probedAt = new Date().toISOString();
    try {
      const rates = await this.runConfigWrite(params, async (send, read) => {
        const ctx = this.dialectOnuContext(params, params.onuIf);
        if (!ctx) throw new Error(`onuIf inválido: ${params.onuIf}`);
        await send(`show interface ${ctx.onuIf}`);
        const text = await read(10_000);
        return parseOnuInterfaceRates(text);
      });
      return {
        ok: true,
        downloadBps: rates.downloadBps,
        uploadBps: rates.uploadBps,
        downloadPps: rates.downloadPps,
        uploadPps: rates.uploadPps,
        probedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`getOnuLiveTraffic failed: ${message}`);
      return {
        ok: false,
        error: message,
        downloadBps: null,
        uploadBps: null,
        downloadPps: null,
        uploadPps: null,
        probedAt,
      };
    }
  }

  async rebootOnu(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const ctx = this.dialectOnuContext(params, params.onuIf);
    if (!ctx) return { ok: false, error: `onuIf inválido: ${params.onuIf}` };
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        await read(12_000);
        await send(`pon-onu-mng ${ctx.onuIf}`);
        await read(8_000);
        await send('reboot');
        await read(10_000);
        await send('exit');
        await read(8_000);
        await send('exit');
        await read(8_000);
        return {
          ok: true,
          message: `Reinicio enviado a ${ctx.onuIfCanon}`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Push / clear TR-069 ACS via OMCI (`pon-onu-mng` → `tr069-mgmt`).
   * Without this the ONU never Informs the ACS.
   */
  async applyOnuTr069Mgmt(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    enable: boolean;
    /** host:port without scheme, e.g. 10.69.69.2:14501 */
    acsEndpoint?: string;
    acsUsername?: string;
    acsPassword?: string;
    mgmtIp?: string | null;
    mgmtMask?: string | null;
    mgmtGateway?: string | null;
    mgmtVlan?: number | null;
    /** Unused on ZTE; accepted for Huawei/ZTE oltCli union parity */
    firmwareHint?: string | null;
    subtypeHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    message?: string;
    cliLog?: string;
  }> {
    const logs: string[] = [];
    const t0 = Date.now();
    const family = this.resolveFwFamily(params);
    const onuIf = this.cliOnuIf(params.onuIf, family);
    this.logger.log(
      `OMCI TR069 ${params.enable ? 'enable' : 'disable'} ${onuIf} (${family}) → ${params.host}:${params.port} (mgmtVlan=${params.mgmtVlan ?? '-'} acs=${params.acsEndpoint ?? '-'})`,
    );
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        const step = async (line: string, waitMs = 10_000) => {
          const s0 = Date.now();
          await send(line);
          const out = await read(waitMs);
          const cleaned = this.cleanCliNoise(out)
            .replace(/\s+/g, ' ')
            .slice(0, 180);
          logs.push(`${line} (${Date.now() - s0}ms) → ${cleaned}`);
          this.logger.log(
            `OMCI step ${line.slice(0, 60)} (${Date.now() - s0}ms)`,
          );
          return out;
        };

        await step('configure terminal', 12_000);

        // Best-effort L2 path for mgmt VLAN (gemport + service-port on vport 2).
        if (params.enable && params.mgmtVlan != null) {
          let outIf = await step(`interface ${onuIf}`, 10_000);
          if (!/%Error|Invalid|Unknown/i.test(outIf)) {
            await step('tcont 2 profile SMARTOLT-1000MB-UP', 8_000);
            await step('gemport 2 tcont 2', 8_000);
            outIf = await step(
              `service-port 2 vport 2 user-vlan ${params.mgmtVlan} vlan ${params.mgmtVlan}`,
              10_000,
            );
            if (/already existed|already exist/i.test(outIf)) {
              await step('no service-port 2', 8_000);
              await step(
                `service-port 2 vport 2 user-vlan ${params.mgmtVlan} vlan ${params.mgmtVlan}`,
                10_000,
              );
            }
            await step('exit', 5_000);
          }
          // C6xx Titan fallback: vport interface. Con `unknown` el resto del
          // cliente asume c3xx, así que acá tampoco se manda un ifName Titan.
          if (family === 'c6xx') {
            const vportIf = buildZteC6xxVportIf(
              toZteCanonicalOnuIf(params.onuIf),
              2,
            );
            if (vportIf) {
              const outV = await step(`interface ${vportIf}`, 10_000);
              if (!/%Error|Invalid|Unknown/i.test(outV)) {
                await step('no service-port 2', 8_000);
                await step(
                  `service-port 2 user-vlan ${params.mgmtVlan} vlan ${params.mgmtVlan}`,
                  10_000,
                );
                await step('exit', 5_000);
              }
            }
          }
        }

        let out = await step(`pon-onu-mng ${onuIf}`, 10_000);
        if (/%Error|Invalid|Unknown/i.test(out)) {
          throw new Error(`No se pudo entrar a pon-onu-mng ${onuIf}`);
        }

        if (params.enable && params.mgmtVlan != null) {
          // Map gemport 2 to a flow toward the switch/VEIP when the OLT allows it.
          await step(`flow 2 pri 2 vlan ${params.mgmtVlan}`, 8_000);
          await step('gemport 2 flow 2', 8_000);
        }

        if (!params.enable) {
          await step('tr069-mgmt 1 state lock');
        } else {
          if (!params.acsEndpoint?.trim()) {
            throw new Error('acsEndpoint es requerido para activar TR069');
          }
          // Perfiles ACS sin credenciales son válidos (auth por SN/OUI): el
          // usuario/clave son placeholders, no un motivo para no aprovisionar.
          const user = (params.acsUsername?.trim() || 'acs').replace(/"/g, '');
          const pass = (params.acsPassword?.trim() || 'acs').replace(/"/g, '');
          const ep = params.acsEndpoint.trim().replace(/^https?:\/\//i, '');
          // Huawei HG / ZTE: ACS URL with http:// is what actually triggers Inform.
          out = await step(
            `tr069-mgmt 1 acs http://${ep} validate basic username ${user} password ${pass}`,
            15_000,
          );
          if (/%Error|Invalid/i.test(out)) {
            out = await step(
              `tr069-mgmt 1 acs ${ep} validate basic username ${user} password ${pass}`,
              15_000,
            );
          }
          if (/%Error|Invalid/i.test(out)) {
            throw new Error(
              `OLT rechazó tr069-mgmt acs: ${this.cleanCliNoise(out).slice(0, 200)}`,
            );
          }
          if (params.mgmtVlan != null) {
            out = await step(
              `tr069-mgmt 1 tag pri 2 vlan ${params.mgmtVlan}`,
              12_000,
            );
            if (/%Error|Invalid/i.test(out)) {
              logs.push(
                `tr069 tag vlan skip: ${this.cleanCliNoise(out).slice(0, 120)}`,
              );
            }
            out = await step(
              `vlan-filter-mode veip 1 tag-filter vlan-filter untag-filter discard`,
              10_000,
            );
            if (!/%Error|Invalid|Unrecognized/i.test(out)) {
              await step(
                `vlan-filter veip 1 pri 2 vlan ${params.mgmtVlan}`,
                10_000,
              );
            }
          }
          await step('tr069-mgmt 1 state unlock');

          if (
            params.mgmtIp &&
            params.mgmtMask &&
            params.mgmtGateway &&
            params.mgmtVlan != null
          ) {
            // VEIP TR069 usually binds ip-host 2 (host 1 is often LAN/switch).
            // CLI is `ip-host` (hyphen); VLAN is set via tr069 tag / vlan-filter / service-port.
            const ipLines = [
              `ip-host 2 ip ${params.mgmtIp} mask ${params.mgmtMask} gateway ${params.mgmtGateway}`,
              `ip-host 1 ip ${params.mgmtIp} mask ${params.mgmtMask} gateway ${params.mgmtGateway}`,
              `iphost 1 ip ${params.mgmtIp} mask ${params.mgmtMask} gateway ${params.mgmtGateway}`,
            ];
            let ipOk = false;
            for (const ipLine of ipLines) {
              out = await step(ipLine, 12_000);
              if (!/%Error|Invalid|Unrecognized/i.test(out)) {
                ipOk = true;
                // Best-effort: allow ICMP (lab diagnostics)
                const hostNum = /ip-host 2/.test(ipLine) ? 2 : 1;
                await step(
                  `ip-host ${hostNum} ping-response enable traceroute-response enable`,
                  8_000,
                );
                break;
              }
              logs.push(
                `ip-host try fail: ${this.cleanCliNoise(out).slice(0, 120)}`,
              );
            }
            if (!ipOk) {
              logs.push('ip-host: no syntax accepted by OLT');
            }
          }
        }

        // Use shared helper (end + write) — raw `write` inside submode hangs/fails
        const writeOut = await this.persistRunningConfig(send, read);
        logs.push(
          `write (${Date.now() - t0}ms total) → ${this.cleanCliNoise(writeOut).slice(0, 120)}`,
        );

        this.logger.log(
          `OMCI TR069 OK ${params.onuIf} in ${Date.now() - t0}ms`,
        );
        return {
          ok: true,
          message: params.enable
            ? `TR069 ACS aplicado por OMCI en ${params.onuIf}`
            : `TR069 bloqueado por OMCI en ${params.onuIf}`,
          cliLog: logs.join('\n'),
        };
      });
    } catch (err) {
      this.logger.warn(
        `OMCI TR069 FAIL ${params.onuIf} after ${Date.now() - t0}ms: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        cliLog: logs.join('\n'),
      };
    }
  }

  /**
   * Admin-disable ONU on the PON port (`onu N disable`).
   * Keeps SN registration on OLT — does NOT delete / unauthorize.
   */
  async disableOnu(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const ctx = this.dialectOnuContext(params, params.onuIf);
    if (!ctx) {
      return { ok: false, error: `onuIf inválido: ${params.onuIf}` };
    }
    const oltIf = ctx.oltIf;
    const onuId = ctx.onuId;
    const family = ctx.ponFamily;
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        let out = await read(12_000);
        await send(`interface ${oltIf}`);
        out = await read(10_000);
        if (/%Error|Invalid/i.test(out)) {
          throw new Error(`No se pudo entrar a ${oltIf}`);
        }
        await send(`onu ${onuId} disable`);
        out = await read(12_000);
        const disableOut = this.cleanCliNoise(out);
        this.logger.log(
          `disableOnu ${ctx.onuIfCanon} → ${disableOut.replace(/\s+/g, ' ').slice(0, 200)}`,
        );
        if (
          /does\s*not\s*exist|not\s*exist|no\s+such|not\s*found|unknown\s+onu/i.test(
            disableOut,
          )
        ) {
          throw new Error(
            `La ONU ${ctx.onuIfCanon} no está registrada en la OLT (ya eliminada o nunca autorizada). Usa Delete para quitarla de Conectadas, o vuelve a autorizarla.`,
          );
        }
        if (/%Error|Invalid|Failed|Unknown/i.test(disableOut)) {
          throw new Error(
            `Fallo al deshabilitar (no se borró la ONU): ${disableOut.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
          );
        }
        await send('exit');
        await read(8_000);
        const writeOut = await this.persistRunningConfig(send, read);
        this.logger.log(
          `disableOnu write → ${this.cleanCliNoise(writeOut).replace(/\s+/g, ' ').slice(0, 160)}`,
        );

        // Must still be registered (disable ≠ delete)
        await send(`show ${family} onu state ${oltIf}`);
        const stateOut = this.cleanCliNoise(await read(20_000));
        const stillThere =
          new RegExp(`:${onuId}\\b`).test(stateOut) ||
          stateOut.includes(ctx.onuIfCanon) ||
          stateOut.includes(ctx.onuIf);
        if (!stillThere) {
          throw new Error(
            `Tras disable la ONU ${onuId} desapareció del state — eso sería un borrado, no un disable. Revisa la OLT.`,
          );
        }

        return {
          ok: true,
          message: `ONU ${ctx.onuIfCanon} deshabilitada (sigue autorizada en la OLT; admin disable)`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Re-enable a previously admin-disabled ONU (`onu N enable`).
   * Keeps registration — opposite of disable, not authorize/delete.
   */
  async enableOnu(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const ctx = this.dialectOnuContext(params, params.onuIf);
    if (!ctx) {
      return { ok: false, error: `onuIf inválido: ${params.onuIf}` };
    }
    const oltIf = ctx.oltIf;
    const onuId = ctx.onuId;
    const family = ctx.ponFamily;
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        let out = await read(12_000);
        await send(`interface ${oltIf}`);
        out = await read(10_000);
        if (/%Error|Invalid/i.test(out)) {
          throw new Error(`No se pudo entrar a ${oltIf}`);
        }
        await send(`onu ${onuId} enable`);
        out = await read(12_000);
        const enableOut = this.cleanCliNoise(out);
        this.logger.log(
          `enableOnu ${ctx.onuIfCanon} → ${enableOut.replace(/\s+/g, ' ').slice(0, 200)}`,
        );
        if (/%Error|Invalid|Failed|Unknown/i.test(enableOut)) {
          throw new Error(
            `Fallo al rehabilitar: ${enableOut.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
          );
        }
        await send('exit');
        await read(8_000);
        await this.persistRunningConfig(send, read);

        await send(`show ${family} onu state ${oltIf}`);
        const stateOut = this.cleanCliNoise(await read(20_000));
        if (new RegExp(`:${onuId}\\s+disable\\b`, 'i').test(stateOut)) {
          throw new Error(
            `Tras enable, la ONU ${ctx.onuIfCanon} sigue en admin disable en la OLT. Revisa a mano.`,
          );
        }

        return {
          ok: true,
          message: `ONU ${ctx.onuIfCanon} rehabilitada (admin enable)`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Fully remove ONU authorization from OLT (`no onu N`).
   * Distinct from disable: SN returns to uncfg and must be authorized again.
   */
  async deleteOnu(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const ctx = this.dialectOnuContext(params, params.onuIf);
    if (!ctx) {
      return { ok: false, error: `onuIf inválido: ${params.onuIf}` };
    }
    const oltIf = ctx.oltIf;
    const onuId = ctx.onuId;
    const family = ctx.ponFamily;
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        let out = await read(12_000);

        // Some firmwares refuse `no onu` while disabled — enable first, then delete.
        await send(`interface ${oltIf}`);
        out = await read(10_000);
        if (/%Error|Invalid/i.test(out)) {
          throw new Error(`No se pudo entrar a ${oltIf}`);
        }
        await send(`onu ${onuId} enable`);
        const enableOut = this.cleanCliNoise(await read(10_000));
        // Ignore "already enabled" / not-found; fail on real CLI errors.
        if (
          /%Error|Invalid|Failed/i.test(enableOut) &&
          !/does\s*not\s*exist|not\s*exist|no\s+such|not\s*found|already/i.test(
            enableOut,
          )
        ) {
          this.logger.warn(
            `deleteOnu onu ${onuId} enable @ ${oltIf}: ${enableOut.replace(/\s+/g, ' ').slice(0, 200)}`,
          );
        }

        await send(`no onu ${onuId}`);
        out = await read(20_000);
        let delOut = this.stripCommandEcho(
          this.cleanCliNoise(out),
          `no onu ${onuId}`,
        );
        this.logger.log(
          `deleteOnu no onu ${onuId} @ ${oltIf} → ${delOut.replace(/\s+/g, ' ').slice(0, 240)}`,
        );

        // Do NOT match bare "no onu" — that is the command echo, not "already gone".
        const alreadyGone =
          /does\s*not\s*exist|not\s*exist|no\s+such|not\s*found|cannot\s+find|unknown\s+onu/i.test(
            delOut,
          );
        const hardFail = /%Error|Invalid|Failed/i.test(delOut) && !alreadyGone;

        if (hardFail) {
          // Retry once after leaving/re-entering interface
          await send('exit');
          await read(8_000);
          await send(`interface ${oltIf}`);
          await read(10_000);
          await send(`no onu ${onuId}`);
          out = await read(20_000);
          delOut = this.stripCommandEcho(
            this.cleanCliNoise(out),
            `no onu ${onuId}`,
          );
          const goneRetry =
            /does\s*not\s*exist|not\s*exist|no\s+such|not\s*found|cannot\s+find|unknown\s+onu/i.test(
              delOut,
            );
          if (/%Error|Invalid|Failed/i.test(delOut) && !goneRetry) {
            throw new Error(
              `Fallo al ELIMINAR (no onu) — la ONU puede seguir solo deshabilitada: ${delOut.replace(/\s+/g, ' ').trim().slice(0, 280)}`,
            );
          }
        }

        await send('exit');
        await read(8_000);

        // Drop leftover gpon-onu interface block if present (best-effort)
        await send(`no interface ${ctx.onuIf}`);
        out = await read(12_000);
        const noIfOut = this.cleanCliNoise(out);
        this.logger.log(
          `deleteOnu no interface → ${noIfOut.replace(/\s+/g, ' ').slice(0, 160)}`,
        );

        await this.persistRunningConfig(send, read);

        // Verify: must NOT remain in onu state (that would mean only disabled)
        await send(`show ${family} onu state ${oltIf}`);
        const stateOut = this.cleanCliNoise(await read(20_000));
        const stateRows = parseOnuStateRows(stateOut, oltIf);
        const stillRegistered = stateRows.some(
          (r) =>
            r.onuIf.toLowerCase() === ctx.onuIfCanon.toLowerCase() ||
            r.onuId === onuId,
        );

        if (stillRegistered) {
          throw new Error(
            `Tras eliminar, la ONU ${ctx.onuIfCanon} sigue en «show onu state» (suele verse como disable). ` +
              `No se completó el borrado; inténtalo de nuevo o borra a mano: interface ${oltIf} → no onu ${onuId}`,
          );
        }

        return {
          ok: true,
          message: alreadyGone
            ? `ONU ${ctx.onuIfCanon} ya no estaba en la OLT; se limpia de Conectadas.`
            : `ONU ${ctx.onuIfCanon} eliminada de la OLT (desautorizada). Si está conectada, pedirá autorización de nuevo.`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * ONUs waiting for authorization (uncfg) across in-service PON ports.
   */
  async listUncfgOnus(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    onus: ZteUncfgOnu[];
    probedAt: string;
  }> {
    const probedAt = new Date().toISOString();
    try {
      const onus = await this.runConfigWrite(params, (send, read) =>
        this.collectUncfgOnusFromSession(send, read, params),
      );
      return { ok: true, onus, probedAt };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`listUncfgOnus failed: ${message}`);
      return { ok: false, error: message, onus: [], probedAt };
    }
  }

  /**
   * Configure ONU service-ports for WAN (1) and/or management (2) VLANs.
   * Best-effort: firmware variants may reject some lines; we still try recreate.
   */
  async applyOnuServiceVlans(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    /** Internet / WAN VLAN → service-port 1. null = remove. undefined = leave. */
    wanVlan?: number | null;
    /** Management VLAN → service-port 2. null = remove. undefined = leave. */
    mgmtVlan?: number | null;
    firmwareHint?: string | null;
    subtypeHint?: string | null;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const touchWan = params.wanVlan !== undefined;
    const touchMgmt = params.mgmtVlan !== undefined;
    if (!touchWan && !touchMgmt) {
      return { ok: true, message: 'sin cambios de VLAN en OLT' };
    }
    const family = this.resolveFwFamily(params);
    const onuIf = this.cliOnuIf(params.onuIf, family);
    this.logger.log(
      `ONU service-VLANs ${onuIf} (${family}) → ${params.host}:${params.port} (wan=${
        touchWan ? (params.wanVlan ?? 'quitar') : 'sin cambio'
      } mgmt=${touchMgmt ? (params.mgmtVlan ?? 'quitar') : 'sin cambio'})`,
    );
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        const step = async (line: string, waitMs = 10_000) => {
          const s0 = Date.now();
          await send(line);
          const raw = await read(waitMs);
          const cleaned = this.cleanCliNoise(raw)
            .replace(/\s+/g, ' ')
            .slice(0, 180);
          this.logger.log(
            `SVLAN step ${line.slice(0, 70)} (${Date.now() - s0}ms) → ${cleaned}`,
          );
          return raw;
        };
        const notes: string[] = [`dialect=${family}`];

        await step('configure terminal', 12_000);

        const upsertClassic = async (
          sp: number,
          vport: number,
          vlan: number | null,
          label: string,
        ) => {
          let out = await step(`interface ${onuIf}`, 10_000);
          if (/%Error|Invalid|Unknown/i.test(out)) {
            throw new Error(
              `No se pudo entrar a ${onuIf}: ${this.cleanCliNoise(out).slice(0, 160)}`,
            );
          }
          await step(`no service-port ${sp}`, 8_000);
          if (vlan == null) {
            notes.push(`${label}: service-port ${sp} eliminado`);
            await step('exit', 5_000);
            return;
          }
          await step(`tcont ${sp} profile SMARTOLT-1000MB-UP`, 8_000);
          await step(`gemport ${sp} tcont ${sp}`, 8_000);
          out = await step(
            `service-port ${sp} vport ${vport} user-vlan ${vlan} vlan ${vlan}`,
            10_000,
          );
          if (/already|exist|duplicate|conflict/i.test(out)) {
            await step(`no service-port ${sp}`, 8_000);
            out = await step(
              `service-port ${sp} vport ${vport} user-vlan ${vlan} vlan ${vlan}`,
              10_000,
            );
          }
          await step('exit', 5_000);
          if (/%Error|Invalid|Failed/i.test(out)) {
            throw new Error(
              `${label} service-port ${sp} VLAN ${vlan}: ${this.cleanCliNoise(
                out,
              )
                .replace(/\s+/g, ' ')
                .slice(0, 160)}`,
            );
          }
          notes.push(`${label}: VLAN ${vlan} en service-port ${sp}`);
        };

        /** C6xx Titan: service-port under `interface vport-S/S/P.N:onuId`. */
        const upsertVport = async (
          sp: number,
          vport: number,
          vlan: number | null,
          label: string,
        ) => {
          const vportIf = buildZteC6xxVportIf(
            toZteCanonicalOnuIf(params.onuIf),
            vport,
          );
          if (!vportIf) {
            throw new Error(`vport ifName inválido para ${params.onuIf}`);
          }
          // Ensure tcont/gemport on ONU interface first
          let out = await step(`interface ${onuIf}`, 10_000);
          if (!/%Error|Invalid|Unknown/i.test(out) && vlan != null) {
            await step(`tcont ${sp} profile SMARTOLT-1000MB-UP`, 8_000);
            await step(`gemport ${sp} tcont ${sp}`, 8_000);
            await step('exit', 5_000);
          } else if (!/%Error|Invalid|Unknown/i.test(out)) {
            await step('exit', 5_000);
          }

          out = await step(`interface ${vportIf}`, 10_000);
          if (/%Error|Invalid|Unknown/i.test(out)) {
            throw new Error(
              `No se pudo entrar a ${vportIf}: ${this.cleanCliNoise(out).slice(0, 120)}`,
            );
          }
          await step(`no service-port ${sp}`, 8_000);
          if (vlan == null) {
            notes.push(`${label}: vport ${vportIf} limpiado`);
            await step('exit', 5_000);
            return;
          }
          out = await step(
            `service-port ${sp} user-vlan ${vlan} vlan ${vlan}`,
            10_000,
          );
          if (/%Error|Invalid/i.test(out)) {
            out = await step(
              `service-port ${sp} user-vlan ${vlan} vlan ${vlan} svlan ${vlan}`,
              10_000,
            );
          }
          await step('exit', 5_000);
          if (/%Error|Invalid|Failed/i.test(out)) {
            throw new Error(
              `${label} vport VLAN ${vlan}: ${this.cleanCliNoise(out)
                .replace(/\s+/g, ' ')
                .slice(0, 160)}`,
            );
          }
          notes.push(`${label}: VLAN ${vlan} en ${vportIf}`);
        };

        const upsert = async (
          sp: number,
          vport: number,
          vlan: number | null | undefined,
          label: string,
        ) => {
          if (vlan === undefined) return;
          if (family === 'c6xx') {
            try {
              await upsertVport(sp, vport, vlan, label);
              return;
            } catch (err) {
              notes.push(
                `${label}: vport falló (${err instanceof Error ? err.message : String(err)}), reintento clásico`,
              );
            }
          }
          await upsertClassic(sp, vport, vlan, label);
        };

        if (touchWan) {
          await upsert(1, 1, params.wanVlan ?? null, 'WAN');
        }
        if (touchMgmt) {
          await upsert(2, 2, params.mgmtVlan ?? null, 'Mgmt');
        }

        // Best-effort flow mapping for WAN when set
        if (touchWan && params.wanVlan != null) {
          const out = await step(`pon-onu-mng ${onuIf}`, 10_000);
          if (!/%Error|Invalid|Unknown/i.test(out)) {
            await step(`flow 1 pri 0 vlan ${params.wanVlan}`, 8_000);
            await step('gemport 1 flow 1', 8_000);
            await step('exit', 5_000);
          }
        }

        await this.persistRunningConfig(send, read);
        return {
          ok: true,
          message: notes.join(' · ') || 'VLANs aplicadas en OLT',
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Configure ONU WAN as static IP via OMCI (`wan-ip` + IP/VLAN profiles).
   * This is what `show gpon remote-onu wan-ip` reflects — TR069 alone does not.
   */
  async applyOnuWanStaticOmci(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    /** null = remove wan-ip 1 */
    wan: {
      wanIp: string;
      wanMask: string;
      wanGateway: string;
      wanVlan: number;
      wanDns1: string;
      wanDns2?: string | null;
    } | null;
    firmwareHint?: string | null;
    subtypeHint?: string | null;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const family = this.resolveFwFamily(params);
    const onuIf = this.cliOnuIf(params.onuIf, family);
    this.logger.log(
      `ONU WAN OMCI ${onuIf} (${family}) → ${params.host}:${params.port} (${
        params.wan
          ? `static ${params.wan.wanIp}/${params.wan.wanVlan}`
          : 'quitar'
      })`,
    );
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        const step = async (line: string, waitMs = 10_000) => {
          const s0 = Date.now();
          await send(line);
          const raw = await read(waitMs);
          const cleaned = this.cleanCliNoise(raw)
            .replace(/\s+/g, ' ')
            .slice(0, 200);
          this.logger.log(
            `WANOMCI step ${line.slice(0, 80)} (${Date.now() - s0}ms) → ${cleaned}`,
          );
          return raw;
        };

        await step('configure terminal', 12_000);

        if (params.wan == null) {
          const out = await step(`pon-onu-mng ${onuIf}`, 10_000);
          if (/%Error|Invalid|Unknown/i.test(out)) {
            throw new Error(`No se pudo entrar a pon-onu-mng ${onuIf}`);
          }
          await step('no wan-ip 1', 8_000);
          await step('exit', 5_000);
          await this.persistRunningConfig(send, read);
          return { ok: true, message: 'WAN OMCI eliminada (wan-ip 1)' };
        }

        const { wan } = params;
        const vlanProfile = `ISPCTRL-vlan${wan.wanVlan}`;
        const ipProfile = `ISPCTRL-ip-v${wan.wanVlan}`;

        // Profiles live under `gpon` mode (reusable per VLAN / pool).
        await step('gpon', 8_000);
        let out = await step(
          `onu profile vlan ${vlanProfile} tag-mode tag cvlan ${wan.wanVlan}`,
          10_000,
        );
        if (/%Error|Invalid/i.test(out) && !/already|exist/i.test(out)) {
          this.logger.warn(
            `vlan profile ${vlanProfile}: ${this.cleanCliNoise(out).slice(0, 120)}`,
          );
        }
        const dns2 = wan.wanDns2?.trim() || '0.0.0.0';
        out = await step(
          `onu profile ip ${ipProfile} gateway ${wan.wanGateway} primary-dns ${wan.wanDns1} second-dns ${dns2}`,
          10_000,
        );
        if (/%Error|Invalid/i.test(out) && !/already|exist/i.test(out)) {
          throw new Error(
            `No se pudo crear IP profile ${ipProfile}: ${this.cleanCliNoise(out)
              .replace(/\s+/g, ' ')
              .slice(0, 160)}`,
          );
        }
        await step('exit', 5_000); // leave gpon

        out = await step(`pon-onu-mng ${onuIf}`, 10_000);
        if (/%Error|Invalid|Unknown/i.test(out)) {
          throw new Error(`No se pudo entrar a pon-onu-mng ${onuIf}`);
        }
        // Drop existing WAN so IP/VLAN change takes effect.
        await step('no wan-ip 1', 8_000);
        out = await step(
          `wan-ip 1 mode static ip-profile ${ipProfile} ip-address ${wan.wanIp} mask ${wan.wanMask} vlan-profile ${vlanProfile}`,
          15_000,
        );
        if (/%Error|Invalid|Failed|640\d+/i.test(out)) {
          // Some firmwares accept `vlan` instead of `vlan-profile`
          out = await step(
            `wan-ip 1 mode static ip-profile ${ipProfile} ip-address ${wan.wanIp} mask ${wan.wanMask} vlan ${vlanProfile}`,
            15_000,
          );
        }
        if (/%Error|Invalid|Failed|640\d+/i.test(out)) {
          throw new Error(
            `wan-ip falló: ${this.cleanCliNoise(out)
              .replace(/\s+/g, ' ')
              .slice(0, 180)}`,
          );
        }
        await step('wan-ip 1 ping-response enable', 6_000);
        // Best-effort WAN VLAN tag (may already be embedded via vlan-profile)
        await step(`vlan wan 1 mode tag vlan ${wan.wanVlan}`, 8_000);
        await step('exit', 5_000);

        await this.persistRunningConfig(send, read);
        return {
          ok: true,
          message: `WAN OMCI ${wan.wanIp} VLAN ${wan.wanVlan} (modo static/router)`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Authorize (provision) an ONU by SN on a PON port, optional name.
   * Verifies the OLT accepted the SN (left uncfg / appears in state) and `write`s.
   */
  async authorizeOnu(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    oltIf: string;
    onuId: string | number;
    onuType: string;
    sn: string;
    name?: string | null;
    description?: string | null;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    message?: string;
    onuIf?: string;
  }> {
    const family = this.resolveFwFamily({
      host: params.host,
      port: params.port,
      subtypeHint: params.subtypeHint,
      firmwareHint: params.firmwareHint,
      productHint: params.oltIf,
    });
    // Prefer cached dialect; if unknown, try both forms via CLI name
    const fw =
      family !== 'unknown'
        ? family
        : detectZteFwFamily({
            subtype: params.subtypeHint,
            versionText: params.oltIf,
          });
    const oltIfCanon = normalizePonOltIfName(params.oltIf.trim());
    let oltIf = this.cliOltIf(oltIfCanon, fw === 'unknown' ? 'c3xx' : fw);
    const onuId = String(params.onuId).trim();
    const onuType = params.onuType.trim();
    const sn = params.sn.trim().toUpperCase();
    const name = this.sanitizeOnuDisplayName(params.name);
    const description = this.sanitizeOnuDescription(params.description);
    if (!oltIfCanon || !onuId || !onuType || !sn) {
      return { ok: false, error: 'oltIf, onuId, onuType y sn son requeridos' };
    }
    const onuIf = onuIfFromOltIf(oltIfCanon, onuId);
    const onuIfCli = this.cliOnuIf(onuIf, fw === 'unknown' ? 'c3xx' : fw);
    const ponFamily = oltIfCanon.startsWith('epon') ? 'epon' : 'gpon';
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        let out = await read(12_000);

        await send(`interface ${oltIf}`);
        out = await read(10_000);
        if (/%Error|Invalid|Unknown command/i.test(out) && fw === 'unknown') {
          // Retry opposite dialect ifName
          const alt = this.cliOltIf(
            oltIfCanon,
            oltIf.includes('_olt-') ? 'c3xx' : 'c6xx',
          );
          await send(`interface ${alt}`);
          out = await read(10_000);
          if (!/%Error|Invalid|Unknown command/i.test(out)) {
            oltIf = alt;
            this.rememberFwFamily(
              params.host,
              params.port,
              alt.includes('_olt-') ? 'c6xx' : 'c3xx',
            );
          }
        }
        if (/%Error|Invalid|Unknown command/i.test(out)) {
          throw new Error(`No se pudo entrar a ${oltIf}: ${out.slice(0, 200)}`);
        }

        const cmd = `onu ${onuId} type ${onuType} sn ${sn}`;
        await send(cmd);
        out = await read(20_000);
        const onuOut = this.cleanCliNoise(out);
        this.logger.log(
          `authorizeOnu CLI [${oltIf}] «${cmd}» → ${onuOut.replace(/\s+/g, ' ').slice(0, 240)}`,
        );

        if (
          /%Error|Invalid|Failed|does\s*not\s*exist|not\s*exist|unknown\s*onu\s*type|already\s*exist|duplicate/i.test(
            onuOut,
          )
        ) {
          throw new Error(
            `La OLT rechazó la autorización (revisa que el tipo «${onuType}» exista en show onu-type ${ponFamily}): ${onuOut.replace(/\s+/g, ' ').trim().slice(0, 280)}`,
          );
        }

        // ZTE prints [Successful] on OK; if missing, we still verify below.
        await send('exit');
        await read(8_000);

        if (name || description) {
          await send(`interface ${onuIfCli}`);
          out = await read(10_000);
          if (/%Error|Invalid/i.test(out)) {
            this.logger.warn(
              `authorizeOnu: no se pudo entrar a ${onuIfCli} para name/description`,
            );
          } else {
            if (name) {
              // Sin comillas: las ONUs manuales usan `name Angela pereira`.
              // El guion se elimina en sanitize; fallback compacto si falla.
              const nameCandidates = [
                `name ${name}`,
                (() => {
                  const compact = this.compactOnuDisplayName(name);
                  return compact && compact !== name ? `name ${compact}` : '';
                })(),
              ].filter(Boolean);
              let nameOk = false;
              for (const cmd of nameCandidates) {
                await send(cmd);
                const nameOut = this.cleanCliNoise(await read(8_000));
                if (!this.cliFailed(nameOut)) {
                  nameOk = true;
                  this.logger.log(`authorizeOnu name OK on ${onuIf}: «${cmd}»`);
                  break;
                }
                this.logger.warn(
                  `authorizeOnu name rejected on ${onuIf}: ${cmd} → ${nameOut.replace(/\s+/g, ' ').slice(0, 160)}`,
                );
              }
              if (!nameOk) {
                this.logger.warn(
                  `authorizeOnu: no se pudo aplicar name «${name}» en ${onuIf}`,
                );
              }
            }
            if (description) {
              const descCandidates = [
                `description ${this.quoteCliArg(description)}`,
                `description ${description}`,
              ];
              let descOk = false;
              for (const cmd of descCandidates) {
                await send(cmd);
                const descOut = this.cleanCliNoise(await read(8_000));
                if (!this.cliFailed(descOut)) {
                  descOk = true;
                  break;
                }
                this.logger.warn(
                  `authorizeOnu description rejected on ${onuIf}: ${descOut.replace(/\s+/g, ' ').slice(0, 160)}`,
                );
              }
              if (!descOk) {
                this.logger.warn(
                  `authorizeOnu: no se pudo aplicar description en ${onuIf}`,
                );
              }
            }
            await send('exit');
            await read(8_000);
          }
        }

        // Persist running-config so SmartOLT / reboot keep the ONU.
        const writeOut = await this.persistRunningConfig(send, read);
        this.logger.log(
          `authorizeOnu write → ${this.cleanCliNoise(writeOut).replace(/\s+/g, ' ').slice(0, 160)}`,
        );

        // Verify: SN must appear as authorized and leave uncfg.
        await send(`show ${ponFamily} onu state ${oltIf}`);
        const stateOut = this.cleanCliNoise(await read(20_000));
        const inState =
          new RegExp(
            `${onuIf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            'i',
          ).test(stateOut) ||
          new RegExp(
            `${onuIfCli.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            'i',
          ).test(stateOut) ||
          new RegExp(`:${onuId}\\b`).test(stateOut);

        await send(`show ${ponFamily} onu baseinfo ${oltIf}`);
        const baseOut = this.cleanCliNoise(await read(20_000));
        const snInBase = new RegExp(sn, 'i').test(baseOut);

        await send(`show ${ponFamily} onu uncfg ${oltIf}`);
        const uncfgOut = this.cleanCliNoise(await read(15_000));
        const stillUncfg = new RegExp(sn, 'i').test(uncfgOut);

        if (
          stillUncfg ||
          (!inState && !snInBase && !/Successful/i.test(onuOut))
        ) {
          throw new Error(
            `La OLT no confirmó el registro de ${sn} en ${oltIf}:${onuId}. ` +
              `Sigue en uncfg o no aparece en state. ` +
              `Comprueba el tipo ONU «${onuType}» (debe coincidir exactamente con show onu-type ${ponFamily}). ` +
              `Respuesta CLI: ${onuOut.replace(/\s+/g, ' ').trim().slice(0, 200) || '(vacía)'}`,
          );
        }

        return {
          ok: true,
          onuIf,
          message: `ONU ${sn} autorizada en la OLT como ${onuIf} (config guardada)`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * List ONU type profiles configured on the OLT (`show onu-type gpon|epon`).
   */
  async listOnuTypes(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    types: OltOnuTypeSummary[];
  }> {
    try {
      const types = await this.runConfigWrite(params, async (send, read) => {
        const all: OltOnuTypeSummary[] = [];
        for (const family of ['gpon', 'epon'] as const) {
          await send(`show onu-type ${family}`);
          const out = this.cleanCliNoise(await read(20_000));
          all.push(...parseOnuTypeList(out, family));
        }
        return all;
      });
      return { ok: true, types };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        types: [],
      };
    }
  }

  /**
   * Ensure an ONU-type profile exists on the OLT (create if missing).
   * SmartOLT-style: push capability template so 3rd-party ONUs can auth.
   */
  async ensureOnuTypeOnOlt(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    spec: OnuTypeProfileSpec;
  }): Promise<{
    ok: boolean;
    created: boolean;
    error?: string;
    message?: string;
  }> {
    const name = params.spec.name.trim();
    const family = params.spec.ponType === 'epon' ? 'epon' : 'gpon';
    if (!name)
      return { ok: false, created: false, error: 'nombre de type vacío' };

    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send(`show onu-type ${family}`);
        const listOut = this.cleanCliNoise(await read(20_000));
        const existing = parseOnuTypeList(listOut, family);
        if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
          return {
            ok: true,
            created: false,
            message: `Type «${name}» ya existe en la OLT`,
          };
        }

        const desc = defaultDescription(params.spec);
        await send('configure terminal');
        await read(12_000);
        await send('pon');
        let out = await read(10_000);
        if (/%Error|Invalid|Unknown/i.test(out)) {
          throw new Error(`No se pudo entrar a modo pon: ${out.slice(0, 160)}`);
        }

        await send(`onu-type ${name} ${family} description ${desc}`);
        out = this.cleanCliNoise(await read(15_000));
        this.logger.log(
          `ensureOnuType create «${name}» → ${out.replace(/\s+/g, ' ').slice(0, 200)}`,
        );
        if (
          /%Error|Invalid|Failed|already/i.test(out) &&
          !/already\s*exist/i.test(out)
        ) {
          // Retry compact form used on some firmwares
          await send(
            `onu-type ${name} ${family} description ${desc} max-tcont 7 max-gemport 32`,
          );
          out = this.cleanCliNoise(await read(15_000));
          if (/%Error|Invalid|Failed/i.test(out) && !/already/i.test(out)) {
            throw new Error(
              `No se pudo crear onu-type «${name}»: ${out.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
            );
          }
        }

        const eth = ethIfList(params.spec.ethernetPorts);
        for (const ifName of eth) {
          await send(`onu-type-if ${name} ${ifName}`);
          await read(8_000);
        }
        const pots = potsIfList(params.spec.voipPorts);
        for (const ifName of pots) {
          await send(`onu-type-if ${name} ${ifName}`);
          await read(8_000);
        }
        const wifi = wifiIfList(params.spec.wifiSsids);
        for (const ifName of wifi) {
          await send(`onu-type-if ${name} ${ifName}`);
          await read(8_000);
        }
        if (params.spec.catv) {
          await send(`onu-type-if ${name} rf_0/1`);
          await read(8_000);
        }

        // `write` desde el submodo `pon` es Invalid command: hay que salir
        // hasta EXEC privilegiado, que es justo lo que hace este helper.
        await this.persistRunningConfig(send, read);

        return {
          ok: true,
          created: true,
          message: `Type «${name}» creado en la OLT`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        created: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async collectUncfgOnusFromSession(
    send: (line: string) => Promise<void>,
    read: (ms?: number) => Promise<string>,
    params: {
      host: string;
      port: number;
      subtypeHint?: string | null;
      firmwareHint?: string | null;
    },
  ): Promise<ZteUncfgOnu[]> {
    const found: ZteUncfgOnu[] = [];
    const seenSn = new Set<string>();
    const nextIdByOltIf = new Map<string, number | null>();
    let dialect = this.resolveFwFamily(params);

    const attachSuggestedId = async (
      row: Omit<ZteUncfgOnu, 'suggestedOnuId'>,
    ) => {
      if (seenSn.has(row.sn)) return;
      seenSn.add(row.sn);
      let nextId = nextIdByOltIf.get(row.oltIf);
      if (nextId === undefined) {
        try {
          const oltIfCli = this.cliOltIf(row.oltIf, dialect);
          await send(`show ${row.ponType} onu state ${oltIfCli}`);
          const stateOut = await read(12_000);
          const occupied = parseOnuIdsFromState(stateOut);
          nextId = suggestNextOnuId(occupied, defaultMaxOnus(row.ponType));
        } catch {
          nextId = null;
        }
        nextIdByOltIf.set(row.oltIf, nextId);
      }
      found.push({ ...row, suggestedOnuId: nextId ?? null });
    };

    // Global first (SmartOLT-style) — one/two commands vs tens of per-port loops.
    let globalRows = false;
    let globalDropped = false;
    for (const family of ['gpon', 'epon'] as const) {
      try {
        await send(`show ${family} onu uncfg`);
        const uncfgOut = await read(15_000);
        if (/%Error|Invalid|Unknown command|Incomplete/i.test(uncfgOut)) {
          continue;
        }
        const rows = parseOnuUncfg(uncfgOut);
        const dataLines = countUncfgDataLines(uncfgOut);
        if (!rows.length) {
          if (dataLines > 0) globalDropped = true;
          continue;
        }
        globalRows = true;
        this.logger.log(`ONU uncfg global ${family}: ${rows.length} row(s)`);
        for (const row of rows) await attachSuggestedId(row);
        // Sin oltIf, el formato SN-only del comando global no se puede parsear:
        // si quedaron líneas sin interpretar hay que barrer puerto por puerto.
        if (rows.length < dataLines) {
          globalDropped = true;
          this.logger.warn(
            `ONU uncfg global ${family}: ${rows.length}/${dataLines} líneas parseadas; se completa por puerto`,
          );
        }
      } catch {
        /* try next family / fall through */
      }
    }
    if (globalRows && !globalDropped) {
      this.logger.log(`ONU uncfg found: ${found.length} (global)`);
      return found;
    }

    await send('show card');
    const cardOut = await read(20_000);
    const cards = this.parseShowCard(cardOut);
    dialect = detectZteFwFamily({
      cardTypes: cards.flatMap((c) => [c.cfgType, c.realType]),
      subtype: params.subtypeHint,
      softVer: params.firmwareHint,
      versionText: params.firmwareHint,
    });
    this.rememberFwFamily(
      params.host,
      params.port,
      dialect,
      params.subtypeHint,
    );

    for (const card of cards) {
      const family = isPonLineCard(card.cfgType, card.realType);
      if (!family) continue;
      if (!/INSERVICE|OK|ACTIVE|ONLINE/i.test(card.status)) continue;
      const nPorts = card.ports && card.ports > 0 ? card.ports : 16;

      for (let p = 1; p <= nPorts; p++) {
        const oltIf = buildOltIfName(
          family,
          card.rack,
          card.shelf,
          card.slot,
          p,
        );
        try {
          await send(
            `show ${family} onu uncfg ${this.cliOltIf(oltIf, dialect)}`,
          );
          const uncfgOut = await read(15_000);
          const rows = parseOnuUncfg(uncfgOut, oltIf);
          if (!rows.length) continue;
          for (const row of rows) await attachSuggestedId(row);
        } catch {
          /* skip port */
        }
      }
    }

    this.logger.log(`ONU uncfg found: ${found.length} (per-port)`);
    return found;
  }

  private async collectConnectedOnusFromSession(
    send: (line: string) => Promise<void>,
    read: (ms?: number) => Promise<string>,
    includeRunningConfig = true,
    onlyOltIfs?: string[],
  ): Promise<ZteConnectedOnu[]> {
    // Per-PON-port inventory — same path as listPonPorts (proven on this OLT).
    // Global `show gpon onu state` often returns only the header on C3xx.
    return this.collectConnectedOnusPerPortFallback(
      send,
      read,
      includeRunningConfig,
      onlyOltIfs,
    );
  }

  /** Scan each in-service PON port for authorized ONUs. */
  private async collectConnectedOnusPerPortFallback(
    send: (line: string) => Promise<void>,
    read: (ms?: number) => Promise<string>,
    includeRunningConfig = true,
    onlyOltIfs?: string[],
  ): Promise<ZteConnectedOnu[]> {
    const restrict =
      onlyOltIfs && onlyOltIfs.length > 0
        ? new Set(onlyOltIfs.map((s) => s.toLowerCase()))
        : null;

    await send('show card');
    const cardOut = await read(20_000);
    const cards = this.parseShowCard(cardOut);
    const dialect = detectZteFwFamily({
      cardTypes: cards.flatMap((c) => [c.cfgType, c.realType]),
    });
    this.logger.log(
      `ONU inventory cards=${cards.length} dialect=${dialect} ponLine=${cards.filter((c) => isPonLineCard(c.cfgType, c.realType)).length}${
        restrict ? ` restrictPorts=${restrict.size}` : ''
      }`,
    );
    const onus: ZteConnectedOnu[] = [];

    for (const card of cards) {
      const family = isPonLineCard(card.cfgType, card.realType);
      if (!family) continue;
      if (!/INSERVICE|OK|ACTIVE|ONLINE/i.test(card.status)) continue;
      const nPorts = card.ports && card.ports > 0 ? card.ports : 16;
      for (let p = 1; p <= nPorts; p++) {
        const oltIf = buildOltIfName(
          family,
          card.rack,
          card.shelf,
          card.slot,
          p,
        );
        if (restrict && !restrict.has(oltIf.toLowerCase())) continue;
        const oltIfCli = this.cliOltIf(oltIf, dialect);
        try {
          // Un puerto PON lleno tarda >15 s en firmwares V1.2: recortar este
          // presupuesto hacía perder puertos enteros del inventario.
          await send(`show ${family} onu state ${oltIfCli}`);
          const stateOut = await read(25_000);
          let stateRows = parseOnuStateRows(stateOut, oltIf);
          if (!stateRows.length) {
            const counts = parseOnuStateCounts(stateOut);
            if (counts.total > 0) {
              const sample = stateOut
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(
                  (l) =>
                    l &&
                    !/^OnuIndex/i.test(l) &&
                    !/^----/.test(l) &&
                    !/^ONU\s*Number/i.test(l),
                )
                .slice(0, 5);
              this.logger.warn(
                `ONU state parse miss on ${oltIf} (footer ${counts.online}/${counts.total}). Sample: ${JSON.stringify(sample)}`,
              );
              // Last resort: synthesize rows from ONU ids in the text
              const ids = parseOnuIdsFromState(stateOut);
              stateRows = ids.map((id) => {
                const onuIf = `${oltIf.replace(/-olt_/i, '-onu_')}:${id}`;
                return {
                  onuIf,
                  rack: card.rack,
                  shelf: card.shelf || card.rack,
                  slot: card.slot,
                  port: String(p),
                  onuId: id,
                  adminState: 'enable',
                  omccState: '',
                  phaseState: 'working',
                  online: true,
                  status: 'online' as const,
                  ponType: family,
                };
              });
            } else {
              continue;
            }
          }

          await send(`show ${family} onu baseinfo ${oltIfCli}`);
          const baseOut = await read(25_000);
          const baseByIf = new Map(
            parseOnuBaseInfo(baseOut, oltIf).map((b) => [
              b.onuIf.toLowerCase(),
              b,
            ]),
          );

          let rxByIf = new Map<string, number>();
          if (stateRows.some((r) => r.online)) {
            await send(`show pon power onu-rx ${oltIfCli}`);
            const rxOut = await read(20_000);
            rxByIf = parseOnuRxByIf(rxOut, oltIf);
          }

          for (const row of stateRows) {
            const base =
              baseByIf.get(row.onuIf.toLowerCase()) ||
              baseByIf.get(`${oltIf}:${row.onuId}`.toLowerCase());
            onus.push({
              onuIf: row.onuIf,
              ponType: row.ponType,
              board: row.slot,
              port: row.port,
              onuId: row.onuId,
              status: row.status,
              online: row.online,
              phaseState: row.phaseState,
              adminState: row.adminState,
              sn: base?.sn ?? null,
              onuType: base?.onuType ?? null,
              name: base?.name ?? null,
              description: null,
              signalDbm: rxByIf.get(row.onuIf) ?? null,
              mode: null,
              vlan: null,
              vlans: [],
            });
          }
        } catch (e) {
          this.logger.warn(
            `ONU list skip ${oltIf}: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
    }

    // Names / description / VLANs live in interface blocks — one dump for all.
    if (includeRunningConfig && onus.length > 0) {
      try {
        await send('show running-config');
        const cfgOut = await read(60_000);
        const byIf = parseOnuInterfacesFromRunningConfig(cfgOut);
        for (const o of onus) {
          const cfg = byIf.get(o.onuIf);
          if (!cfg) continue;
          if (cfg.name) o.name = cfg.name;
          if (cfg.description) o.description = cfg.description;
          if (cfg.mode) o.mode = cfg.mode;
          if (cfg.vlans.length) {
            o.vlans = cfg.vlans;
            o.vlan = cfg.vlans[0] ?? o.vlan;
          }
        }
        this.logger.log(
          `ONU inventory names from running-config: ${[...byIf.keys()].length} interfaces`,
        );
      } catch (e) {
        this.logger.warn(
          `ONU running-config names skipped: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    this.logger.log(
      `ONU inventory: ${onus.length} (${onus.filter((o) => o.online).length} online)`,
    );
    return onus;
  }

  private async collectOnuDetailFromSession(
    send: (line: string) => Promise<void>,
    read: (ms?: number) => Promise<string>,
    params: {
      host: string;
      port: number;
      onuIf: string;
      subtypeHint?: string | null;
      firmwareHint?: string | null;
    },
  ): Promise<ZteConnectedOnuDetail> {
    const ctx = this.dialectOnuContext(params, params.onuIf);
    if (!ctx) throw new Error(`onuIf inválido: ${params.onuIf}`);
    const onuIf = ctx.onuIfCanon;
    const onuIfCli = ctx.onuIf;
    const oltIf = ctx.oltIf;
    const family = ctx.ponFamily;
    await send(`show ${family} onu state ${oltIf}`);
    const stateOut = await read(20_000);
    const stateRow: ZteOnuStateRow | undefined = parseOnuStateRows(
      stateOut,
    ).find(
      (r) =>
        r.onuIf.toLowerCase() === onuIf.toLowerCase() || r.onuId === ctx.onuId,
    );

    await send(`show ${family} onu detail-info ${onuIfCli}`);
    const detailOut = await read(25_000);
    const detail = parseOnuDetailInfo(detailOut);

    await send(`show running-config interface ${onuIfCli}`);
    const cfgOut = await read(20_000);
    const cfg = parseOnuInterfaceConfig(onuIf, cfgOut);

    let onuRxDbm: number | null = null;
    let oltRxDbm: number | null = null;
    try {
      await send(`show pon power attenuation ${onuIfCli}`);
      const attOut = await read(15_000);
      const att = parseOnuAttenuation(attOut);
      onuRxDbm = att.onuRxDbm;
      oltRxDbm = att.oltRxDbm;
    } catch {
      /* optional */
    }
    if (onuRxDbm == null) {
      try {
        await send(`show pon power onu-rx ${oltIf}`);
        const rxOut = await read(12_000);
        // `onu-rx` lista el puerto completo: si la ONU pedida no está en el
        // mapa hay que dejarlo en null. Tomar “el primer número del texto”
        // devolvía la lectura de otra ONU (o un dígito del ifName).
        onuRxDbm = parseOnuRxByIf(rxOut, ctx.oltIfCanon).get(onuIf) ?? null;
      } catch {
        /* optional */
      }
    }

    let downloadBps: number | null = null;
    let uploadBps: number | null = null;
    try {
      await send(`show interface ${onuIfCli}`);
      const ifOut = await read(15_000);
      const rates = parseOnuInterfaceRates(ifOut);
      downloadBps = rates.downloadBps;
      uploadBps = rates.uploadBps;
    } catch {
      /* optional */
    }

    const parts = onuIf.match(/^(?:gpon|epon)-onu_(\d+)\/(\d+)\/(\d+):(\d+)$/i);
    const online = stateRow?.online ?? /working/i.test(detail.phaseState ?? '');

    const ethMatches = [...cfg.raw.matchAll(/eth_0\/(\d+)/gi)].map((x) =>
      Number(x[1]),
    );
    const ethMax = ethMatches.length ? Math.max(...ethMatches) : 0;
    const ethernetPorts = Array.from(
      { length: Math.min(Math.max(ethMax, 0), 8) },
      (_, i) => ({
        port: `eth_0/${i + 1}`,
        adminState: 'Enabled',
        mode: 'LAN',
        dhcp: 'Pendiente',
      }),
    );
    const hasWifi = /wifi_0\//i.test(cfg.raw);
    const wifiPorts = hasWifi
      ? [
          {
            port: 'wifi_0/1',
            band: '2.4 GHz',
            adminState: 'Enabled',
            mode: 'LAN',
            ssid: '',
            dhcp: 'Pendiente',
          },
        ]
      : [];

    return {
      onuIf,
      ponType: family,
      board: parts?.[2] ?? stateRow?.slot ?? '',
      port: parts?.[3] ?? stateRow?.port ?? '',
      onuId: parts?.[4] ?? stateRow?.onuId ?? '',
      status: stateRow?.status ?? (online ? 'online' : 'offline'),
      online: Boolean(online),
      phaseState: stateRow?.phaseState ?? detail.phaseState ?? '',
      adminState: stateRow?.adminState ?? detail.adminState ?? '',
      sn: detail.sn,
      onuType: detail.onuType,
      name: cfg.name ?? detail.name,
      description: cfg.description ?? detail.description,
      signalDbm: onuRxDbm,
      mode: cfg.mode,
      vlan: cfg.vlans[0] ?? null,
      vlans: cfg.vlans,
      oltRxDbm,
      distanceM: detail.distanceM,
      onlineDuration: detail.onlineDuration,
      downloadBps,
      uploadBps,
      runningConfig: this.cleanCliNoise(cfgOut),
      detailInfoRaw: this.cleanCliNoise(detailOut),
      ethernetPorts,
      wifiPorts,
      voipSupported: /pots_0\//i.test(cfg.raw) ? true : null,
      catvSupported: /catv/i.test(cfg.raw) ? true : null,
    };
  }

  /** Strip OLT prompts (ZXAN#, hostname#) and pager noise from CLI dumps. */
  private cleanCliNoise(text: string): string {
    return (
      text
        .replace(/\r/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(new RegExp('\\x1b\\[[0-9;]*[A-Za-z]', 'g'), '')
        .replaceAll('\b', '')
        .replace(/--More--|---- More ----/gi, '')
        // Full-line prompts: ZXAN#, ZXAN(config)#, OLT-C320#
        .replace(/^[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[>#]\s*$/gm, '')
        // Prompt at end of a content line: "...config ZXAN#"
        .replace(/\s+[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[>#]\s*$/gm, '')
        // Prompt glued mid-line before next command echo
        .replace(/[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[>#]\s*(?=show\s)/gi, '')
        // Leading command echo lines
        .replace(/^\s*show\s+.+$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  }

  /** Remove echoed config command lines so regexes don't match the command itself. */
  private stripCommandEcho(text: string, command: string): string {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text
      .replace(new RegExp(`^\\s*${escaped}\\s*$`, 'gim'), '')
      .replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** ZTE ONU `name` — ASCII; sin acentos / `+` / `-` / comillas. */
  private sanitizeOnuDisplayName(value?: string | null): string {
    return (value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[+-]/g, ' ')
      .replace(/["'`\\<>|]/g, '')
      .replace(/[^A-Za-z0-9 @#$&()._/,\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  }

  private sanitizeOnuDescription(value?: string | null): string {
    return (value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/["\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  /** Quote CLI free-text so spaces / `-` are not parsed as tokens. */
  private quoteCliArg(value: string): string {
    return `"${value.replace(/"/g, '').trim()}"`;
  }

  /** Compact fallback when quoted name still fails on older firmware. */
  private compactOnuDisplayName(value: string): string {
    return value
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
  }

  private cliFailed(text: string): boolean {
    return /%Error\s*\d+|Invalid\s+(?:input|parameter|command)|Unknown\s+command|Failed/i.test(
      text,
    );
  }

  /** Empty string when CLI returned an error caret block (do not show in UI). */
  private usableCli(text: string): string {
    const t = text?.trim() || '';
    if (!t || this.cliFailed(t)) return '';
    return t;
  }

  private async safeShow(
    send: (line: string) => Promise<void>,
    read: (ms?: number) => Promise<string>,
    cmd: string,
    timeoutMs = 18_000,
  ): Promise<string> {
    try {
      await send(cmd);
      const out = this.cleanCliNoise(await read(timeoutMs));
      return this.usableCli(out);
    } catch {
      return '';
    }
  }

  private async collectOnuStatusReportFromSession(
    send: (line: string) => Promise<void>,
    read: (ms?: number) => Promise<string>,
    params: {
      host: string;
      port: number;
      onuIf: string;
      subtypeHint?: string | null;
      firmwareHint?: string | null;
    },
  ): Promise<{
    report: string;
    runningConfig: string;
    swInfo: ZteRemoteOnuEquip;
  }> {
    const ctx = this.dialectOnuContext(params, params.onuIf);
    if (!ctx) throw new Error(`onuIf inválido: ${params.onuIf}`);
    const onuIf = ctx.onuIfCanon;
    const onuIfCli = ctx.onuIf;
    const family = ctx.ponFamily;
    const oltIf = ctx.oltIf;
    const oltIfCanon = ctx.oltIfCanon;

    // Ensure privileged EXEC (not a leftover config-if from another op).
    await send('end');
    await read(8_000);

    let opticalRaw = await this.safeShow(
      send,
      read,
      `show pon power attenuation ${onuIfCli}`,
      15_000,
    );
    if (!opticalRaw) {
      const rxRaw = await this.safeShow(
        send,
        read,
        `show pon power onu-rx ${oltIf}`,
        15_000,
      );
      const rxMap = parseOnuRxByIf(rxRaw, oltIfCanon);
      const dbm = rxMap.get(onuIf);
      if (dbm != null) {
        opticalRaw = `ONU Rx: ${dbm.toFixed(3)} (dbm)  [via onu-rx ${oltIfCanon}]`;
      }
    }
    const detailRaw = await this.safeShow(
      send,
      read,
      `show ${family} onu detail-info ${onuIfCli}`,
      25_000,
    );
    const catvRaw = await this.safeShow(
      send,
      read,
      `show ${family} remote-onu interface catv ${onuIfCli}`,
    );
    const lanRaw = await this.safeShow(
      send,
      read,
      `show ${family} remote-onu interface eth ${onuIfCli}`,
    );
    // `remote-onu vlan` no existe en firmwares ZTE recientes; usar ex-vlan.
    let vlanRaw = await this.safeShow(
      send,
      read,
      `show ${family} remote-onu ex-vlan ${onuIfCli}`,
    );
    if (!vlanRaw || /No relate|Invalid|Error/i.test(vlanRaw)) {
      vlanRaw = await this.safeShow(
        send,
        read,
        `show ${family} remote-onu ex-vlan-table ${onuIfCli}`,
      );
    }
    const voipRaw = await this.safeShow(
      send,
      read,
      `show ${family} remote-onu voip ${onuIfCli}`,
    );
    const wanRaw = await this.safeShow(
      send,
      read,
      `show ${family} remote-onu wan-ip ${onuIfCli}`,
    );
    // Si no hay ex-vlan, sintetizar VLAN desde wan-ip (CVLAN configurada).
    if (
      (!vlanRaw || /No relate|Invalid|Error/i.test(vlanRaw)) &&
      wanRaw &&
      !/No relate/i.test(wanRaw)
    ) {
      const cvlan = wanRaw.match(/CVLAN:\s*(\d+)/i)?.[1];
      const mode = wanRaw.match(/VLAN tag mode:\s*(\S+)/i)?.[1];
      const ip = wanRaw.match(/^\s*IP:\s*(\S+)/im)?.[1];
      if (cvlan) {
        vlanRaw = [
          'WAN VLAN (desde wan-ip OMCI)',
          `  CVLAN:     ${cvlan}`,
          mode ? `  Tag mode: ${mode}` : null,
          ip ? `  WAN IP:   ${ip}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      }
    }
    const macRaw = await this.safeShow(
      send,
      read,
      `show mac gpon onu ${onuIfCli}`,
    );
    const runningConfig = await this.safeShow(
      send,
      read,
      `show running-config interface ${onuIfCli}`,
      20_000,
    );
    const equipRaw = await this.safeShow(
      send,
      read,
      `show ${family} remote-onu equip ${onuIfCli}`,
      20_000,
    );

    const detail = detailRaw ? parseOnuDetailInfo(detailRaw) : null;
    const opticalRows = opticalRaw ? parseOnuOpticalTable(opticalRaw) : [];
    const lanPorts = lanRaw ? parseRemoteOnuLanPorts(lanRaw) : [];
    const macs = macRaw ? parseOnuMacTable(macRaw) : [];
    const swInfo = parseRemoteOnuEquip(equipRaw || '');

    // Prefer CATV block from detail-info when remote command fails.
    let catvSection = catvRaw;
    if (!catvSection) {
      const fromDetail = detailRaw.match(
        /ONU\s*CATV[\s\S]*?(?=\n\s*ONU\s+details|\n\s*History|\n\s*ONU\s+WAN|$)/i,
      );
      catvSection = fromDetail?.[0]?.replace(/^ONU\s*CATV[^\n]*\n?/i, '') ?? '';
    }

    const report = formatOnuStatusReport({
      opticalRaw,
      opticalRows,
      catvRaw: catvSection,
      detailRaw,
      detail,
      wanRaw: wanRaw || this.extractWanIds(detailRaw),
      lanPorts,
      lanRaw,
      vlanRaw,
      voipRaw,
      macs,
      macRaw,
    });

    return { report, runningConfig, swInfo };
  }

  private extractWanIds(detailRaw: string): string {
    const ids = [...detailRaw.matchAll(/WAN\s*ID\s*[:=]\s*(\d+)/gi)].map(
      (m) => m[1],
    );
    if (!ids.length) return '';
    return ids.map((id) => `WAN ID:           ${id}`).join('\n');
  }

  /**
   * Set ONU display `name` on gpon-onu / epon-onu interface.
   * Unquoted, spaces ok; hyphens stripped by sanitize.
   */
  async configureOnuName(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    name: string | null;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    message?: string;
    appliedName?: string;
  }> {
    const ctx = this.dialectOnuContext(params, params.onuIf);
    if (!ctx) return { ok: false, error: 'onuIf requerido' };
    const onuIf = ctx.onuIf;
    const onuIfCanon = ctx.onuIfCanon;
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        await read(12_000);
        await send(`interface ${onuIf}`);
        const out = await read(10_000);
        if (/%Error|Invalid|Unknown command/i.test(out)) {
          throw new Error(`No se pudo entrar a ${onuIf}: ${out.slice(0, 200)}`);
        }
        const name = this.sanitizeOnuDisplayName(params.name);
        if (!name) {
          throw new Error('name vacío tras sanitizar');
        }
        const nameCandidates = [
          `name ${name}`,
          (() => {
            const compact = this.compactOnuDisplayName(name);
            return compact && compact !== name ? `name ${compact}` : '';
          })(),
        ].filter(Boolean);
        let applied = '';
        for (const cmd of nameCandidates) {
          await send(cmd);
          const nameOut = this.cleanCliNoise(await read(8_000));
          if (!this.cliFailed(nameOut)) {
            applied = cmd.replace(/^name\s+/, '');
            this.logger.log(`configureOnuName OK on ${onuIf}: «${cmd}»`);
            break;
          }
          this.logger.warn(
            `configureOnuName rejected on ${onuIf}: ${cmd} → ${nameOut.replace(/\s+/g, ' ').slice(0, 160)}`,
          );
        }
        if (!applied) {
          throw new Error(`OLT rechazó name «${name}» en ${onuIf}`);
        }
        await send('exit');
        await read(8_000);
        await this.persistRunningConfig(send, read);
        return {
          ok: true,
          message: `Name actualizado en ${onuIfCanon}`,
          appliedName: applied,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Set ONU free-text `description` on gpon-onu / epon-onu interface
   * (used for install address / notes). Independent of `name`.
   */
  async configureOnuDescription(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    onuIf: string;
    description: string | null;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const ctx = this.dialectOnuContext(params, params.onuIf);
    if (!ctx) return { ok: false, error: 'onuIf requerido' };
    const onuIf = ctx.onuIf;
    const onuIfCanon = ctx.onuIfCanon;
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        await read(12_000);
        await send(`interface ${onuIf}`);
        let out = await read(10_000);
        if (/%Error|Invalid|Unknown command/i.test(out)) {
          throw new Error(`No se pudo entrar a ${onuIf}: ${out.slice(0, 200)}`);
        }
        const d = this.sanitizeOnuDescription(params.description);
        if (d) {
          let applied = false;
          for (const cmd of [
            `description ${this.quoteCliArg(d)}`,
            `description ${d}`,
          ]) {
            await send(cmd);
            out = this.cleanCliNoise(await read(8_000));
            if (!this.cliFailed(out)) {
              applied = true;
              break;
            }
          }
          if (!applied) {
            throw new Error(
              `OLT rechazó description: ${out.replace(/\s+/g, ' ').slice(0, 200)}`,
            );
          }
        } else {
          await send('no description');
          out = await read(8_000);
          if (this.cliFailed(out)) {
            throw new Error(
              `OLT rechazó description: ${out.replace(/\s+/g, ' ').slice(0, 200)}`,
            );
          }
        }
        await send('exit');
        await read(8_000);
        await this.persistRunningConfig(send, read);
        return {
          ok: true,
          message: d
            ? `Description actualizada en ${onuIfCanon}`
            : `Description eliminada en ${onuIfCanon}`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async configurePonPort(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    ifName: string;
    adminEnabled: boolean;
    description?: string;
    minRangeM?: number;
    maxRangeM?: number;
    maxOnus?: number | null;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        await read(12_000);
        await send(`interface ${params.ifName}`);
        await read(10_000);
        await send(params.adminEnabled ? 'no shutdown' : 'shutdown');
        await read(8_000);
        if (params.description !== undefined) {
          const d = params.description.trim();
          if (d) {
            await send(`description ${d}`);
          } else {
            await send('no description');
          }
          await read(8_000);
        }
        if (
          params.minRangeM != null &&
          params.maxRangeM != null &&
          Number.isFinite(params.minRangeM) &&
          Number.isFinite(params.maxRangeM)
        ) {
          await send(
            `distance ${Math.round(params.minRangeM)} ${Math.round(params.maxRangeM)}`,
          );
          await read(8_000);
        }
        await send('exit');
        await read(8_000);
        await send('exit');
        await read(8_000);
        return {
          ok: true,
          message: `Puerto ${params.ifName} actualizado`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async enableAllPonPorts(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    message?: string;
    count?: number;
  }> {
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('show card');
        const cardOut = await read(20_000);
        const cards = this.parseShowCard(cardOut);
        const ifNames: string[] = [];
        for (const card of cards) {
          const family = isPonLineCard(card.cfgType, card.realType);
          if (!family) continue;
          if (!/INSERVICE|OK|ACTIVE|ONLINE/i.test(card.status)) continue;
          const nPorts = card.ports && card.ports > 0 ? card.ports : 16;
          for (let p = 1; p <= nPorts; p++) {
            ifNames.push(
              buildOltIfName(family, card.rack, card.shelf, card.slot, p),
            );
          }
        }
        await send('configure terminal');
        await read(12_000);
        for (const ifName of ifNames) {
          await send(`interface ${ifName}`);
          await read(8_000);
          await send('no shutdown');
          await read(8_000);
          await send('exit');
          await read(8_000);
        }
        await send('exit');
        await read(8_000);
        return {
          ok: true,
          message: `${ifNames.length} puertos habilitados`,
          count: ifNames.length,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async rebootOnusOnIf(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    ifName: string;
    subtypeHint?: string | null;
    firmwareHint?: string | null;
  }): Promise<{
    ok: boolean;
    error?: string;
    message?: string;
    count?: number;
  }> {
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        const family = params.ifName.startsWith('epon') ? 'epon' : 'gpon';
        const fw = this.resolveFwFamily(params);
        const oltIfCli = this.cliOltIf(params.ifName, fw);
        await send(`show ${family} onu state ${oltIfCli}`);
        const stateOut = await read(25_000);
        const ids = parseOnuIdsFromState(stateOut);
        await send('configure terminal');
        await read(12_000);
        for (const id of ids) {
          const onuIf = this.cliOnuIf(onuIfFromOltIf(params.ifName, id), fw);
          await send(`pon-onu-mng ${onuIf}`);
          await read(8_000);
          await send('reboot');
          await read(10_000);
          await send('exit');
          await read(8_000);
        }
        await send('exit');
        await read(8_000);
        return {
          ok: true,
          count: ids.length,
          message: `Reinicio enviado a ${ids.length} ONUs en ${params.ifName}`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async rebootAllOnus(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    slot?: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    message?: string;
    count?: number;
  }> {
    const listed = await this.listPonPorts(params);
    if (!listed.ok) return { ok: false, error: listed.error };
    const targets = listed.ports.filter(
      (p) => !params.slot || p.slot === params.slot,
    );
    let total = 0;
    for (const p of targets) {
      const r = await this.rebootOnusOnIf({ ...params, ifName: p.ifName });
      if (r.ok) total += r.count ?? 0;
    }
    return {
      ok: true,
      count: total,
      message: `Reinicio enviado a ${total} ONUs`,
    };
  }

  /** Read rogue-onu-detect status per GPON line card slot. */
  async getRogueDetect(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    cards: Array<{
      slot: string;
      boardType: string;
      detect: boolean;
      locate: boolean;
      autoShutdown: boolean;
    }>;
  }> {
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('show card');
        const cardOut = await read(20_000);
        const cards = this.parseShowCard(cardOut);
        let cfg = '';
        try {
          await send('show running-config | include rogue-onu-detect');
          cfg = await read(12_000);
          if (/%Error|Invalid|Unknown command|Incomplete/i.test(cfg)) {
            cfg = '';
          }
        } catch {
          cfg = '';
        }
        if (!cfg.trim()) {
          await send('show running-config');
          cfg = await read(45_000);
        }
        const bySlot = this.parseRogueDetectConfig(cfg);

        const rows = cards
          .filter((c) => isPonLineCard(c.cfgType, c.realType) === 'gpon')
          .filter((c) => /INSERVICE|OK|ACTIVE|ONLINE/i.test(c.status))
          .map((c) => {
            const st = bySlot.get(c.slot) ?? {
              detect: false,
              locate: false,
              autoShutdown: false,
            };
            return {
              slot: c.slot,
              boardType: c.realType || c.cfgType,
              detect: st.detect,
              locate: st.locate,
              autoShutdown: st.autoShutdown,
            };
          });

        return { ok: true, cards: rows };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        cards: [],
      };
    }
  }

  async setRogueDetect(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    slots: string[];
    enable: boolean;
    locate?: boolean;
    autoShutdown?: boolean;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        await read(12_000);
        for (const slot of params.slots) {
          if (params.enable) {
            const parts = [`rogue-onu-detect ${slot} enable`];
            if (params.locate) parts.push('locate enable');
            if (params.autoShutdown) parts.push('auto-shutdown enable');
            await send(parts.join(' '));
          } else {
            await send(`no rogue-onu-detect ${slot}`);
          }
          await read(10_000);
        }
        await send('exit');
        await read(8_000);
        return {
          ok: true,
          message: params.enable
            ? `Detección habilitada en ranuras ${params.slots.join(', ')}`
            : `Detección deshabilitada en ranuras ${params.slots.join(', ')}`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async checkRogueOnus(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    lines: string[];
    message?: string;
  }> {
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('show logging alarm | include Rogue');
        const out = await read(20_000);
        const lines = out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(
            (l) =>
              l && !/^show /i.test(l) && !/#\s*$/.test(l) && /rogue/i.test(l),
          );
        return {
          ok: true,
          lines,
          message: lines.length
            ? `${lines.length} alarmas Rogue encontradas`
            : 'No hay alarmas Rogue ONU en el log',
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        lines: [],
      };
    }
  }

  private parseRogueDetectConfig(
    text: string,
  ): Map<string, { detect: boolean; locate: boolean; autoShutdown: boolean }> {
    const map = new Map<
      string,
      { detect: boolean; locate: boolean; autoShutdown: boolean }
    >();
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*rogue-onu-detect\s+(\d+)\s+(enable|disable)/i);
      if (!m) continue;
      const slot = m[1];
      const enabled = /^enable$/i.test(m[2]);
      map.set(slot, {
        detect: enabled,
        locate: enabled && /locate\s+enable/i.test(line),
        autoShutdown: enabled && /auto-shutdown\s+enable/i.test(line),
      });
    }
    return map;
  }

  /**
   * Uplink inventory from one `show running-config` dump.
   * Oper status / optics come from SNMP + previous cache (not per-port CLI).
   */
  async listUplinks(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    priority?: 'interactive' | 'background';
  }): Promise<{
    ok: boolean;
    error?: string;
    uplinks: ZteUplinkRaw[];
    probedAt: string;
    summary: string | null;
  }> {
    const probedAt = new Date().toISOString();
    try {
      const uplinks = await this.runConfigWrite(params, async (send, read) => {
        await send('show running-config');
        const cfg = await read(120_000);
        // Un `#` dentro de una description corta el volcado antes de tiempo.
        // Se avisa, pero se sigue: si de verdad no hay nada, el chequeo de
        // `names` de abajo es el que aborta y protege la caché.
        if (!looksCompleteRunningConfig(cfg)) {
          this.logger.warn(
            'running-config parece truncado (uplinks); se parsea lo recibido',
          );
        }
        const blocks = extractAllInterfaceBlocks(cfg);
        const names = extractUplinkIfNames(cfg);
        this.logger.log(
          `uplinks via running-config: ${names.length} ifaces (${blocks.size} blocks)`,
        );
        if (!names.length) {
          throw new Error(
            'No se encontraron interfaces gei_/xgei_ en running-config',
          );
        }
        const rows: ZteUplinkRaw[] = [];
        for (const ifName of names) {
          const block =
            blocks.get(ifName) || extractInterfaceBlock(cfg, ifName) || '';
          const parsed = parseUplinkConfigBlock(block);
          rows.push({
            ifName,
            description: parsed.description,
            mediaType: inferMediaType(ifName, {
              isFiber: /^xgei_/i.test(ifName),
            }),
            adminEnabled: parsed.adminEnabled,
            // Placeholder — SNMP overlay fills live Up/Down/speed
            status: parsed.adminEnabled ? 'Up' : 'Down',
            negotiation: null,
            mtu: parsed.mtu,
            wavelengthNm: null,
            signalDbm: null,
            tempC: null,
            pvidUntag: parsed.pvidUntag,
            mode: parsed.mode,
            taggedVlans: parsed.taggedVlans,
          });
        }
        return rows;
      });
      const up = uplinks.filter((u) => u.status !== 'Down').length;
      return {
        ok: true,
        uplinks,
        probedAt,
        summary: `${up}/${uplinks.length} uplinks Up`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        uplinks: [],
        probedAt,
        summary: null,
      };
    }
  }

  async configureUplink(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    ifName: string;
    description?: string;
    addVlans?: string;
    removeVlans?: string;
    mode?: string;
    adminEnabled?: boolean;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        const add = expandVlanList(params.addVlans ?? '');
        const remove = expandVlanList(params.removeVlans ?? '');

        await send('configure terminal');
        await read(12_000);

        // Ensure VLANs exist before tagging
        for (const v of add) {
          await send(`vlan ${v}`);
          await read(8_000);
          await send('exit');
          await read(8_000);
        }

        await send(`interface ${params.ifName}`);
        await read(10_000);

        if (params.mode) {
          await send(`switchport mode ${params.mode.toLowerCase()}`);
          await read(8_000);
        } else if (add.length || remove.length) {
          await send('switchport mode trunk');
          await read(8_000);
        }

        if (params.description !== undefined) {
          const d = params.description.trim();
          if (d) await send(`description ${d}`);
          else await send('no description');
          await read(8_000);
        }

        for (const v of add) {
          await send(`switchport vlan ${v} tag`);
          await read(8_000);
        }
        for (const v of remove) {
          await send(`no switchport vlan ${v} tag`);
          await read(8_000);
        }

        if (typeof params.adminEnabled === 'boolean') {
          await send(params.adminEnabled ? 'no shutdown' : 'shutdown');
          await read(8_000);
        }

        await send('exit');
        await read(8_000);
        await send('exit');
        await read(8_000);

        const added = formatVlanList(add);
        const removed = formatVlanList(remove);
        return {
          ok: true,
          message: [
            `Uplink ${params.ifName} actualizado`,
            added ? `+VLAN ${added}` : null,
            removed ? `-VLAN ${removed}` : null,
            typeof params.adminEnabled === 'boolean'
              ? params.adminEnabled
                ? 'Habilitado'
                : 'Deshabilitado'
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * List OLT DBA speed profiles (tcont UP + traffic DOWN), paired by name.
   * Mbps ≈ kbps/1024 (ZTE stores kbps).
   */
  async listSpeedProfiles(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    priority?: 'interactive' | 'background';
  }): Promise<{
    ok: boolean;
    error?: string;
    profiles: Array<{
      name: string;
      uploadProfile: string | null;
      downloadProfile: string | null;
      uploadMbps: number | null;
      downloadMbps: number | null;
      uploadKbps: number | null;
      downloadKbps: number | null;
    }>;
    probedAt: string;
  }> {
    const probedAt = new Date().toISOString();
    try {
      const profiles = await this.runConfigWrite(
        { ...params, priority: params.priority ?? 'interactive' },
        async (send, read) => {
          await send('show gpon profile tcont');
          const tcontRaw = this.cleanCliNoise(await read(45_000));
          await send('show gpon profile traffic');
          const trafficRaw = this.cleanCliNoise(await read(45_000));
          const paired = pairOltSpeedProfiles(
            parseTcontProfiles(tcontRaw),
            parseTrafficProfiles(trafficRaw),
          );
          this.logger.log(
            `speed profiles: tcont blocks≈${(tcontRaw.match(/Profile\s+name\s*:/gi) || []).length}, traffic≈${(trafficRaw.match(/Profile\s+name\s*:/gi) || []).length}, paired=${paired.length}`,
          );
          return paired;
        },
      );
      return { ok: true, profiles, probedAt };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        profiles: [],
        probedAt,
      };
    }
  }

  /**
   * Create or update a logical speed profile on the OLT:
   * `{name}-UP` (tcont type 5) + `{name}-DOWN` (traffic sir/pir).
   */
  async upsertSpeedProfile(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    name: string;
    downloadMbps: number;
    uploadMbps: number;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const base = sanitizeSpeedProfileName(params.name);
    if (!base) {
      return {
        ok: false,
        error: 'Nombre inválido (letras, números, guion/underscore)',
      };
    }
    if (
      !Number.isFinite(params.downloadMbps) ||
      params.downloadMbps < 1 ||
      !Number.isFinite(params.uploadMbps) ||
      params.uploadMbps < 1
    ) {
      return { ok: false, error: 'Velocidades inválidas (Mbps ≥ 1)' };
    }
    const downKbps = mbpsToKbps(params.downloadMbps);
    const upKbps = mbpsToKbps(params.uploadMbps);
    const upName = `${base}-UP`;
    const downName = `${base}-DOWN`;

    try {
      return await this.runConfigWrite(params, async (send, read) => {
        const step = async (line: string, waitMs = 10_000) => {
          await send(line);
          return this.cleanCliNoise(await read(waitMs));
        };
        await step('configure terminal', 12_000);
        await step('gpon', 8_000);
        let out = await step(
          `profile tcont ${upName} type 5 fixed 64 assured 64 maximum ${upKbps}`,
          12_000,
        );
        if (/%Error|Invalid|Unrecognized/i.test(out)) {
          throw new Error(
            `tcont ${upName}: ${out.replace(/\s+/g, ' ').slice(0, 160)}`,
          );
        }
        out = await step(
          `profile traffic ${downName} sir ${downKbps} pir ${downKbps}`,
          12_000,
        );
        if (/%Error|Invalid|Unrecognized/i.test(out)) {
          throw new Error(
            `traffic ${downName}: ${out.replace(/\s+/g, ' ').slice(0, 160)}`,
          );
        }
        await step('exit', 5_000);
        await step('exit', 5_000);
        await this.persistRunningConfig(send, read);
        return {
          ok: true,
          message: `Perfil ${base}: ↓${params.downloadMbps}/↑${params.uploadMbps} Mbps (${downName} / ${upName})`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async deleteSpeedProfile(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    name: string;
    uploadProfile?: string | null;
    downloadProfile?: string | null;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const base = sanitizeSpeedProfileName(params.name);
    const upName = params.uploadProfile || (base ? `${base}-UP` : null);
    const downName = params.downloadProfile || (base ? `${base}-DOWN` : null);
    if (!upName && !downName) {
      return { ok: false, error: 'Perfil sin nombres UP/DOWN' };
    }
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        const step = async (line: string, waitMs = 10_000) => {
          await send(line);
          return this.cleanCliNoise(await read(waitMs));
        };
        const notes: string[] = [];
        await step('configure terminal', 12_000);
        await step('gpon', 8_000);
        if (upName) {
          const out = await step(`no profile tcont ${upName}`, 10_000);
          notes.push(
            /%Error|Invalid|Unrecognized/i.test(out)
              ? `tcont ${upName}: aviso`
              : `tcont ${upName} eliminado`,
          );
        }
        if (downName) {
          const out = await step(`no profile traffic ${downName}`, 10_000);
          notes.push(
            /%Error|Invalid|Unrecognized/i.test(out)
              ? `traffic ${downName}: aviso`
              : `traffic ${downName} eliminado`,
          );
        }
        await step('exit', 5_000);
        await step('exit', 5_000);
        await this.persistRunningConfig(send, read);
        return { ok: true, message: notes.join(' · ') };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listVlans(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    priority?: 'interactive' | 'background';
  }): Promise<{
    ok: boolean;
    error?: string;
    vlans: ZteVlanRaw[];
    probedAt: string;
    summary: string | null;
  }> {
    const probedAt = new Date().toISOString();
    try {
      const vlans = await this.runConfigWrite(params, async (send, read) => {
        // `show vlan` table → ids/names. Full running-config fills isolation,
        // names in vlan blocks, PON tags and ONU counts.
        let fromShow: ZteVlanRaw[] = [];
        try {
          await send('show vlan');
          const out = await read(25_000);
          if (!/%Error|Invalid|Unknown command|Incomplete/i.test(out)) {
            fromShow = parseVlansFromShowVlan(out);
            if (fromShow.length <= 1) {
              fromShow = parseVlansFromRunningConfig(out);
            }
            this.logger.log(`vlans via show vlan: ${fromShow.length}`);
          }
        } catch {
          /* try full config */
        }

        try {
          await send('show running-config');
          const cfg = await read(120_000);
          if (!looksCompleteRunningConfig(cfg)) {
            throw new Error('running-config incompleto o truncado (vlans)');
          }
          const fromCfg = parseVlansFromRunningConfig(cfg);
          this.logger.log(`vlans via running-config: ${fromCfg.length}`);
          const merged = mergeVlanCatalogs(fromShow, fromCfg);
          if (merged.length > 1) return merged;
        } catch (err) {
          this.logger.warn(
            `vlans running-config failed: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
        if (fromShow.length > 1) return fromShow;
        // Never invent "solo VLAN 1" as a successful catalog — that wipes cache.
        if (fromShow.length === 1 && fromShow[0]?.vlanId === 1) {
          throw new Error(
            'Catálogo VLAN incompleto (solo VLAN 1); reintente sincronizar',
          );
        }
        if (fromShow.length) return fromShow;
        throw new Error('No se pudieron leer VLANs de la OLT');
      });
      return {
        ok: true,
        vlans,
        probedAt,
        summary: `${vlans.length} VLAN${vlans.length === 1 ? '' : 's'}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        vlans: [],
        probedAt,
        summary: null,
      };
    }
  }

  async upsertVlan(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    vlanId: number;
    description?: string;
    /** true = ONUs in this VLAN cannot reach each other. */
    isolated?: boolean;
    /** PON ifNames that should tag this VLAN (others that had it get untagged). */
    defaultPonPorts?: string[];
    previousDefaultPonPorts?: string[];
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const id = params.vlanId;
    if (!Number.isInteger(id) || id < 1 || id > 4094) {
      return { ok: false, error: 'VLAN ID inválido (1–4094)' };
    }
    const warnings: string[] = [];
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        const step = async (line: string, waitMs = 8_000) => {
          await send(line);
          return read(waitMs);
        };
        const failed = (out: string) =>
          /%\s*Error|Invalid input|Unknown command|Incomplete/i.test(out);

        await step('configure terminal', 12_000);

        await step(`vlan ${id}`);
        if (params.description !== undefined) {
          const d = params.description.trim();
          if (d) {
            await step(`name ${d.replace(/\s+/g, '_').slice(0, 32)}`);
          } else {
            await step('no name');
          }
        }
        if (typeof params.isolated === 'boolean') {
          // Firmware differences: prefer all-to-all, fall back to isolate.
          const candidates = params.isolated
            ? ['no all-to-all', 'isolate enable', 'isolate']
            : ['all-to-all', 'no isolate', 'isolate disable'];
          let applied = false;
          for (const cmd of candidates) {
            const out = await step(cmd);
            if (!failed(out)) {
              applied = true;
              break;
            }
          }
          if (!applied) {
            warnings.push(
              'la OLT rechazó el comando de aislamiento (revisa el firmware)',
            );
          }
        }
        await step('exit');

        if (params.defaultPonPorts !== undefined) {
          const nextPon = new Set(params.defaultPonPorts);
          const prevPon = new Set(params.previousDefaultPonPorts ?? []);
          for (const ifName of nextPon) {
            await step(`interface ${ifName}`);
            await step(`switchport vlan ${id} tag`);
            await step('exit');
          }
          for (const ifName of prevPon) {
            if (nextPon.has(ifName)) continue;
            await step(`interface ${ifName}`);
            await step(`no switchport vlan ${id} tag`);
            await step('exit');
          }
        }

        await step('exit');

        return {
          ok: true,
          message: warnings.length
            ? `VLAN ${id} guardada — ${warnings.join('; ')}`
            : `VLAN ${id} guardada en la OLT`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async deleteVlan(params: {
    host: string;
    port: number;
    protocol: 'telnet' | 'ssh';
    username: string;
    password: string;
    vlanId: number;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const id = params.vlanId;
    if (!Number.isInteger(id) || id < 1 || id > 4094) {
      return { ok: false, error: 'VLAN ID inválido (1–4094)' };
    }
    if (id === 1) {
      return {
        ok: false,
        error: 'La VLAN 1 es del sistema y no se puede eliminar',
      };
    }
    try {
      return await this.runConfigWrite(params, async (send, read) => {
        await send('configure terminal');
        await read(12_000);
        // La VLAN puede no ser multicast: el error de esta línea no importa.
        await send(`no igmp mvlan ${id}`);
        await read(8_000);
        await send(`no vlan ${id}`);
        const out = await read(12_000);
        await send('exit');
        await read(8_000);

        const verdict = interpretNoVlanOutput(out);
        if (!verdict.ok) {
          return {
            ok: false,
            error: `la OLT rechazó \`no vlan ${id}\`: ${
              verdict.detail ?? 'sin detalle'
            }`,
          };
        }
        return {
          ok: true,
          message: verdict.absent
            ? `VLAN ${id} no existía en la OLT`
            : `VLAN ${id} eliminada de la OLT`,
        };
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async runConfigWrite<T>(
    params: {
      host: string;
      port: number;
      protocol: 'telnet' | 'ssh';
      username: string;
      password: string;
      /** interactive (UI) jumps the queue ahead of background pollers. */
      priority?: 'interactive' | 'background';
    },
    fn: (
      send: (line: string) => Promise<void>,
      read: (ms?: number) => Promise<string>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.withCliLock(
      params.host,
      params.port,
      async () => {
        if (params.protocol === 'ssh') {
          return this.withSshShell(params, fn);
        }
        const session = await TelnetSession.connect(
          params.host,
          params.port,
          15_000,
        );
        try {
          await this.ensurePrivilegedTelnet(
            session,
            params.username,
            params.password,
          );
          return await fn(
            async (line) => {
              await session.sendLine(line);
            },
            (ms) => session.readUntilPrompt(ms ?? 15_000),
          );
        } finally {
          try {
            await session.sendLine('exit');
          } catch {
            /* ignore */
          }
          session.close();
        }
      },
      params.priority ?? 'interactive',
    );
  }

  private async withSshShell<T>(
    params: {
      host: string;
      port: number;
      username: string;
      password: string;
    },
    fn: (
      send: (line: string) => Promise<void>,
      read: (ms?: number) => Promise<string>,
    ) => Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const conn = new SshClient();
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error('SSH connection timeout'));
      }, 300_000);
      conn
        .on('ready', () => {
          // ssh2's callback is void-returning; the Promise is handled internally.
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          conn.shell({ term: 'vt100' }, async (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              conn.end();
              reject(err);
              return;
            }
            try {
              const reader = new StreamReader(stream);
              let buf = await reader.readUntil(/[#>]\s*$/, 15_000);
              if (/[Uu]sername\s*:/i.test(buf)) {
                stream.write(params.username + '\n');
                await reader.readUntil(/[Pp]assword\s*:/i, 10_000);
                stream.write(params.password + '\n');
                buf = await reader.readUntil(/[#>]\s*$/, 12_000);
              }
              if (/>\s*$/.test(buf) && !/#\s*$/.test(buf)) {
                stream.write('enable\n');
                const afterEnable = await reader.readUntil(
                  /[Pp]assword\s*:|[#>]\s*$/,
                  8_000,
                );
                if (/[Pp]assword\s*:/i.test(afterEnable)) {
                  stream.write(params.password + '\n');
                  await reader.readUntil(/#\s*$/, 10_000);
                }
              }
              stream.write('terminal length 0\n');
              await reader.readUntilPrompt(8_000);
              const result = await fn(
                (line) => {
                  stream.write(line + '\n');
                  return Promise.resolve();
                },
                (ms) => reader.readUntilPrompt(ms ?? 15_000),
              );
              stream.write('exit\n');
              clearTimeout(timeout);
              conn.end();
              resolve(result);
            } catch (e) {
              clearTimeout(timeout);
              conn.end();
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          });
        })
        .on('error', (e) => {
          clearTimeout(timeout);
          reject(e);
        })
        .connect({
          ...sshHostVerification(params.host, params.port),
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          readyTimeout: 15_000,
        });
    });
  }

  private async collectPonPortsFromSession(
    send: (line: string) => Promise<void>,
    read: (ms?: number) => Promise<string>,
    opts?: { light?: boolean },
  ): Promise<ZtePonPortRaw[]> {
    const light = opts?.light !== false;
    await send('show card');
    const cardOut = await read(20_000);
    const cards = this.parseShowCard(cardOut);

    // Light path: one running-config dump → parse all gpon-olt_/epon-olt_ blocks
    // instead of N× `show running-config interface` (was ~16–64 sequential cmds).
    let blocks = new Map<string, string>();
    let rogueCfg = '';
    let dumpPonNames: string[] = [];
    if (light) {
      await send('show running-config');
      const cfg = await read(120_000);
      if (!looksCompleteRunningConfig(cfg)) {
        this.logger.warn(
          'running-config parece truncado (PON); se parsea lo recibido',
        );
      }
      blocks = extractAllInterfaceBlocks(cfg);
      rogueCfg = cfg;
      dumpPonNames = extractPonOltIfNames(cfg).map(normalizePonOltIfName);
      this.logger.log(
        `PON light: running-config ${blocks.size} blocks, pon-olt ifaces=${dumpPonNames.length}`,
      );
      if (!dumpPonNames.length) {
        throw new Error(
          'No se encontraron interfaces gpon-olt_/epon-olt_ en running-config',
        );
      }
    } else {
      try {
        await send('show running-config | include rogue-onu-detect');
        rogueCfg = await read(12_000);
        if (/%Error|Invalid|Unknown command|Incomplete/i.test(rogueCfg)) {
          rogueCfg = '';
        }
      } catch {
        rogueCfg = '';
      }
    }
    const rogueBySlot = this.parseRogueDetectConfig(rogueCfg);

    const cardBySlot = new Map(
      cards
        .filter((c) => isPonLineCard(c.cfgType, c.realType))
        .map((c) => [c.slot, c]),
    );

    const ports: ZtePonPortRaw[] = [];

    const pushPort = async (
      ifName: string,
      card: {
        rack: string;
        shelf: string;
        slot: string;
        cfgType: string;
        realType: string;
      },
      family: 'gpon' | 'epon',
      portNum: string,
      cfgText: string,
    ) => {
      const range = parseRangeFromConfig(cfgText);
      const maxOnus = defaultMaxOnus(family);
      const adminEnabled = cfgText ? parseAdminShutdown(cfgText) : true;
      const rogue = rogueBySlot.get(card.slot);

      let onuOnline = 0;
      let onuTotal = 0;
      let avgSignal: number | null = null;
      let txPowerDbm: number | null = null;
      let status: 'Up' | 'Down' = adminEnabled ? 'Up' : 'Down';

      if (!light) {
        const ifCli = this.cliOltIf(
          ifName,
          detectZteFwFamily({
            cardTypes: [card.cfgType, card.realType],
          }),
        );
        await send(`show ${family} onu state ${ifCli}`);
        const state = await read(12_000);
        const counts = parseOnuStateCounts(state);
        onuOnline = counts.online;
        onuTotal = counts.total;
        let optical = '';
        if (counts.online > 0 || counts.total > 0) {
          await send(`show interface optical-module-info ${ifCli}`);
          optical = await read(10_000);
          if (counts.online > 0) {
            await send(`show pon power onu-rx ${ifCli}`);
            const rxOut = await read(12_000);
            avgSignal = parseAvgOnuRx(rxOut);
          }
        }
        txPowerDbm = parseOpticalTxPower(optical);
        status = txPowerDbm != null || counts.online > 0 ? 'Up' : 'Down';
      }

      ports.push({
        rack: card.rack,
        shelf: card.shelf,
        slot: card.slot,
        port: portNum,
        ifName,
        boardType: card.realType || card.cfgType,
        ponType: family,
        adminEnabled,
        status,
        onuOnline,
        onuTotal,
        maxOnus,
        avgSignalDbm: avgSignal,
        description: parseDescription(cfgText),
        minRangeM: range.minRangeM,
        maxRangeM: range.maxRangeM,
        rogueDetectEnabled: rogue?.detect ?? false,
        txPowerDbm,
      });
    };

    if (light) {
      // Prefer ifNames from the dump (authoritative) — avoids inventing
      // phantom ports when show card Port column is missing (defaulted to 16).
      for (const rawName of dumpPonNames) {
        const parsed = parsePonOltIfName(rawName);
        if (!parsed) continue;
        const ifName = normalizePonOltIfName(rawName);
        const card =
          cardBySlot.get(parsed.slot) ??
          ({
            rack: '1',
            shelf: parsed.shelf,
            slot: parsed.slot,
            cfgType: parsed.family === 'epon' ? 'ETGO' : 'GTGO',
            realType: parsed.family === 'epon' ? 'ETGO' : 'GTGO',
          } as const);
        const family =
          isPonLineCard(card.cfgType, card.realType) ?? parsed.family;
        const cfg =
          blocks.get(ifName) ||
          blocks.get(toZteCliOltIf(ifName, 'c6xx')) ||
          blocks.get(toZteCliOltIf(ifName, 'c3xx')) ||
          [...blocks.entries()].find(([n]) => {
            const a = n.toLowerCase();
            const b = ifName.toLowerCase();
            return a === b || normalizePonOltIfName(n).toLowerCase() === b;
          })?.[1] ||
          '';
        // Skip empty blocks — do not invent admin-enabled defaults
        if (!cfg.trim()) continue;
        try {
          await pushPort(ifName, card, family, parsed.port, cfg);
        } catch (e) {
          this.logger.warn(
            `PON port ${ifName} skip: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
    } else {
      for (const card of cards) {
        const family = isPonLineCard(card.cfgType, card.realType);
        if (!family) continue;
        if (!/INSERVICE|OK|ACTIVE|ONLINE/i.test(card.status)) continue;
        const nPorts = card.ports && card.ports > 0 ? card.ports : 16;
        for (let p = 1; p <= nPorts; p++) {
          const ifName = buildOltIfName(
            family,
            card.rack,
            card.shelf,
            card.slot,
            p,
          );
          try {
            const ifCli = this.cliOltIf(
              ifName,
              detectZteFwFamily({
                cardTypes: [card.cfgType, card.realType],
              }),
            );
            await send(`show running-config interface ${ifCli}`);
            const cfg = await read(12_000);
            await pushPort(ifName, card, family, String(p), cfg);
          } catch (e) {
            this.logger.warn(
              `PON port ${ifName} skip: ${e instanceof Error ? e.message : e}`,
            );
          }
        }
      }
    }

    this.logger.log(
      `PON collect ${light ? 'light' : 'full'}: ${ports.length} ports`,
    );
    if (light && !ports.length) {
      throw new Error('No se pudieron parsear puertos PON del running-config');
    }
    return ports;
  }

  private async probeTelnet(params: {
    host: string;
    port: number;
    username: string;
    password: string;
  }): Promise<ZteOltProbeResult> {
    const session = await TelnetSession.connect(
      params.host,
      params.port,
      15_000,
    );
    try {
      await session.expect(/[Uu]sername\s*:/i, 10_000);
      await session.sendLine(params.username);
      await session.expect(/[Pp]assword\s*:/i, 10_000);
      await session.sendLine(params.password);

      let buf = await session.readUntil(/[#>]\s*$/, 12_000);
      const product = this.extractProduct(buf);

      if (/>\s*$/.test(buf) && !/#\s*$/.test(buf)) {
        // Factory users only. Dedicated mgmt users (privilege 15) land on "#".
        await session.sendLine('enable');
        const afterEnable = await session.readUntil(
          /[Pp]assword\s*:|[#>]\s*$/,
          8_000,
        );
        if (/[Pp]assword\s*:/i.test(afterEnable)) {
          await session.sendLine(params.password);
          buf = await session.readUntil(/#\s*$/, 10_000);
        } else {
          buf = afterEnable;
        }
      }

      await session.sendLine('terminal length 0');
      await session.readUntil(/#\s*$/, 8_000);

      const collected = await this.collectInventoryAndMetrics({
        send: (line) => session.sendLine(line),
        readPrompt: (ms) => session.readUntil(/#\s*$/, ms ?? 20_000),
      });

      await session.sendLine('exit');

      return {
        ok: true,
        product,
        hostname: this.extractHostname(buf + (collected.cardOut ?? '')),
        ...collected.result,
      };
    } finally {
      session.close();
    }
  }

  private async probeSsh(params: {
    host: string;
    port: number;
    username: string;
    password: string;
  }): Promise<ZteOltProbeResult> {
    return new Promise((resolve) => {
      const conn = new SshClient();
      const timeout = setTimeout(() => {
        conn.end();
        resolve({ ok: false, error: 'SSH connection timeout' });
      }, 45_000);

      conn
        .on('ready', () => {
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          conn.shell({ term: 'vt100' }, async (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              conn.end();
              resolve({ ok: false, error: err.message });
              return;
            }

            try {
              const reader = new StreamReader(stream);
              let buf = await reader.readUntil(/[#>]\s*$/, 15_000);
              // Some firmwares still ask login on shell
              if (/[Uu]sername\s*:/i.test(buf)) {
                stream.write(params.username + '\n');
                await reader.readUntil(/[Pp]assword\s*:/i, 10_000);
                stream.write(params.password + '\n');
                buf = await reader.readUntil(/[#>]\s*$/, 12_000);
              }

              const product = this.extractProduct(buf);
              if (/>\s*$/.test(buf) && !/#\s*$/.test(buf)) {
                // Factory users only. Dedicated mgmt users (privilege 15) land on "#".
                stream.write('enable\n');
                const after = await reader.readUntil(
                  /[Pp]assword\s*:|[#>]\s*$/,
                  8_000,
                );
                if (/[Pp]assword\s*:/i.test(after)) {
                  stream.write(params.password + '\n');
                  await reader.readUntil(/#\s*$/, 10_000);
                }
              }

              stream.write('terminal length 0\n');
              await reader.readUntil(/#\s*$/, 8_000);

              const collected = await this.collectInventoryAndMetrics({
                send: (line) => {
                  stream.write(line + '\n');
                },
                readPrompt: (ms) => reader.readUntil(/#\s*$/, ms ?? 20_000),
              });

              clearTimeout(timeout);
              stream.close();
              conn.end();
              resolve({
                ok: true,
                product,
                hostname: this.extractHostname(buf + (collected.cardOut ?? '')),
                ...collected.result,
              });
            } catch (e) {
              clearTimeout(timeout);
              conn.end();
              resolve({
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          });
        })
        .on('error', (e) => {
          clearTimeout(timeout);
          resolve({ ok: false, error: e.message });
        })
        .connect({
          ...sshHostVerification(params.host, params.port),
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          readyTimeout: 15_000,
          algorithms: undefined,
        });
    });
  }

  private async collectInventoryAndMetrics(io: {
    send: (line: string) => void | Promise<void>;
    readPrompt: (timeoutMs?: number) => Promise<string>;
  }): Promise<{
    cardOut: string;
    result: Omit<ZteOltProbeResult, 'ok' | 'error' | 'product' | 'hostname'>;
  }> {
    await io.send('show card');
    const cardOut = await io.readPrompt(20_000);
    const cards = this.parseShowCard(cardOut);

    let softVer = this.pickSoftVer(cards);
    if (!softVer) {
      await io.send('show version');
      const verOut = await io.readPrompt(15_000);
      softVer = this.extractSoftVer(verOut);
    }

    await io.send('show processor');
    const procOut = await io.readPrompt(15_000);

    await io.send('show card-temperature');
    let tempOut = await io.readPrompt(15_000);
    if (!this.hasNumericTemps(tempOut)) {
      await io.send('show temperature');
      tempOut = await io.readPrompt(15_000);
    }

    await io.send('show system-group');
    const sysOut = await io.readPrompt(15_000);

    const metrics = this.aggregateResourceMetrics(
      cards,
      procOut,
      tempOut,
      sysOut,
    );

    return {
      cardOut,
      result: {
        softVer,
        ponType: detectPonTypeFromCards(cards) ?? undefined,
        cards,
        rawCardSummary: this.summarizeCards(cards),
        ...metrics,
      },
    };
  }

  private extractProduct(text: string): string | undefined {
    const m =
      text.match(/ZXAN\s+product\s+(\S+)/i) ||
      text.match(/\b(C680|C650|C620|C610|C600|C350|C320|C300|C220)\b/i);
    return m?.[1];
  }

  private extractHostname(text: string): string | undefined {
    const m = text.match(/^([A-Za-z0-9._-]+)[>#]\s*$/m);
    return m?.[1];
  }

  private parseShowCard(text: string): ZteOltCard[] {
    const cards: ZteOltCard[] = [];
    for (const line of text.split(/\r?\n/)) {
      // C3xx: rack shelf slot CfgType RealType Port HardVer SoftVer Status
      const m9 = line.match(
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/,
      );
      if (m9 && m9[4].toLowerCase() !== 'cfgtype') {
        const portsRaw = m9[6];
        const ports = /^\d+$/.test(portsRaw) ? Number(portsRaw) : undefined;
        const softRaw = m9[8];
        cards.push({
          rack: m9[1],
          shelf: m9[2],
          slot: m9[3],
          cfgType: m9[4],
          realType: m9[5],
          ports,
          softVer: /^V?\d/i.test(softRaw) ? softRaw : undefined,
          status: m9[9],
        });
        continue;
      }
      // C6xx Titan: Shelf Slot CfgType CardName Port HardVer Status
      const m7 = line.match(
        /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s*$/,
      );
      if (m7 && m7[3].toLowerCase() !== 'cfgtype') {
        const hard = m7[6];
        cards.push({
          rack: '1',
          shelf: m7[1],
          slot: m7[2],
          cfgType: m7[3],
          realType: m7[4],
          ports: Number(m7[5]),
          softVer: /^V?\d/i.test(hard) ? hard : undefined,
          status: m7[7],
        });
      }
    }
    return this.assignRoles(cards);
  }

  private assignRoles(cards: ZteOltCard[]): ZteOltCard[] {
    const controls = cards
      .filter(
        (c) => this.isControlCard(c.cfgType) || this.isControlCard(c.realType),
      )
      .filter((c) => /INSERVICE|OK|ACTIVE|ONLINE/i.test(c.status))
      .sort((a, b) => Number(a.slot) - Number(b.slot));

    const roleByKey = new Map<string, string>();
    controls.forEach((c, i) => {
      roleByKey.set(
        `${c.rack}/${c.shelf}/${c.slot}`,
        i === 0 ? 'Main' : 'Standby',
      );
    });

    return cards.map((c) => {
      const key = `${c.rack}/${c.shelf}/${c.slot}`;
      const isCtrl =
        this.isControlCard(c.cfgType) || this.isControlCard(c.realType);
      return {
        ...c,
        role: roleByKey.get(key) ?? (isCtrl ? null : 'Main'),
      };
    });
  }

  private async ensurePrivilegedTelnet(
    session: TelnetSession,
    username: string,
    password: string,
  ): Promise<string> {
    await session.expect(/[Uu]sername\s*:/i, 10_000);
    await session.sendLine(username);
    await session.expect(/[Pp]assword\s*:/i, 10_000);
    await session.sendLine(password);

    let buf = await session.readUntilPrompt(12_000);
    if (/>\s*$/.test(buf) && !/#\s*$/.test(buf)) {
      await session.sendLine('enable');
      const afterEnable = await session.readUntil(
        /[Pp]assword\s*:|[#>]\s*$/,
        8_000,
      );
      if (/[Pp]assword\s*:/i.test(afterEnable)) {
        await session.sendLine(password);
        buf = await session.readUntilPrompt(10_000);
      } else {
        buf = afterEnable;
      }
    }
    await session.sendLine('terminal length 0');
    await session.readUntilPrompt(8_000);
    return buf;
  }

  /** Leave config modes, then persist. Avoids Invalid command for `write` in submodes. */
  private async persistRunningConfig(
    send: (line: string) => Promise<void>,
    read: (ms?: number) => Promise<string>,
  ): Promise<string> {
    await send('end');
    await read(8_000);
    await send('write');
    return read(30_000);
  }

  private async runCardsTelnet(params: {
    host: string;
    port: number;
    username: string;
    password: string;
  }): Promise<ZteOltCard[]> {
    const session = await TelnetSession.connect(
      params.host,
      params.port,
      15_000,
    );
    try {
      await this.ensurePrivilegedTelnet(
        session,
        params.username,
        params.password,
      );
      await session.sendLine('show card');
      const cardOut = await session.readUntil(/#\s*$/, 20_000);
      await session.sendLine('exit');
      return this.parseShowCard(cardOut);
    } finally {
      session.close();
    }
  }

  private async runCardsSsh(params: {
    host: string;
    port: number;
    username: string;
    password: string;
  }): Promise<ZteOltCard[]> {
    return new Promise((resolve, reject) => {
      const conn = new SshClient();
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error('SSH connection timeout'));
      }, 30_000);

      conn
        .on('ready', () => {
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          conn.shell({ term: 'vt100' }, async (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              conn.end();
              reject(err);
              return;
            }
            try {
              const reader = new StreamReader(stream);
              let buf = await reader.readUntil(/[#>]\s*$/, 15_000);
              if (/[Uu]sername\s*:/i.test(buf)) {
                stream.write(params.username + '\n');
                await reader.readUntil(/[Pp]assword\s*:/i, 10_000);
                stream.write(params.password + '\n');
                buf = await reader.readUntil(/[#>]\s*$/, 12_000);
              }
              if (/>\s*$/.test(buf) && !/#\s*$/.test(buf)) {
                stream.write('enable\n');
                const afterEnable = await reader.readUntil(
                  /[Pp]assword\s*:|[#>]\s*$/,
                  8_000,
                );
                if (/[Pp]assword\s*:/i.test(afterEnable)) {
                  stream.write(params.password + '\n');
                  await reader.readUntil(/#\s*$/, 10_000);
                }
              }
              stream.write('terminal length 0\n');
              await reader.readUntil(/#\s*$/, 8_000);
              stream.write('show card\n');
              const cardOut = await reader.readUntil(/#\s*$/, 20_000);
              stream.write('exit\n');
              clearTimeout(timeout);
              conn.end();
              resolve(this.parseShowCard(cardOut));
            } catch (e) {
              clearTimeout(timeout);
              conn.end();
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          });
        })
        .on('error', (e) => {
          clearTimeout(timeout);
          reject(e);
        })
        .connect({
          ...sshHostVerification(params.host, params.port),
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          readyTimeout: 15_000,
        });
    });
  }

  private async rebootCardTelnet(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    rack: string;
    shelf: string;
    slot: string;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const session = await TelnetSession.connect(
      params.host,
      params.port,
      15_000,
    );
    try {
      await this.ensurePrivilegedTelnet(
        session,
        params.username,
        params.password,
      );
      const target = `${params.rack}/${params.shelf}/${params.slot}`;
      await session.sendLine(`reload slot ${target}`);
      const reply = await session.readUntil(
        /\[yes\/no\]|[Yy]es\/[Nn]o|[#>]\s*$/i,
        15_000,
      );
      if (/yes\/no|\[yes/i.test(reply)) {
        await session.sendLine('yes');
        await session.readUntil(/#\s*$/, 30_000);
      }
      await session.sendLine('exit');
      return {
        ok: true,
        message: `Reload solicitado para slot ${target}`,
      };
    } finally {
      session.close();
    }
  }

  private async rebootCardSsh(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    rack: string;
    shelf: string;
    slot: string;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    return new Promise((resolve) => {
      const conn = new SshClient();
      const timeout = setTimeout(() => {
        conn.end();
        resolve({ ok: false, error: 'SSH connection timeout' });
      }, 45_000);

      conn
        .on('ready', () => {
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          conn.shell({ term: 'vt100' }, async (err, stream) => {
            if (err) {
              clearTimeout(timeout);
              conn.end();
              resolve({ ok: false, error: err.message });
              return;
            }
            try {
              const reader = new StreamReader(stream);
              let buf = await reader.readUntil(/[#>]\s*$/, 15_000);
              if (/[Uu]sername\s*:/i.test(buf)) {
                stream.write(params.username + '\n');
                await reader.readUntil(/[Pp]assword\s*:/i, 10_000);
                stream.write(params.password + '\n');
                buf = await reader.readUntil(/[#>]\s*$/, 12_000);
              }
              if (/>\s*$/.test(buf) && !/#\s*$/.test(buf)) {
                stream.write('enable\n');
                const afterEnable = await reader.readUntil(
                  /[Pp]assword\s*:|[#>]\s*$/,
                  8_000,
                );
                if (/[Pp]assword\s*:/i.test(afterEnable)) {
                  stream.write(params.password + '\n');
                  await reader.readUntil(/#\s*$/, 10_000);
                }
              }
              stream.write('terminal length 0\n');
              await reader.readUntil(/#\s*$/, 8_000);
              const target = `${params.rack}/${params.shelf}/${params.slot}`;
              stream.write(`reload slot ${target}\n`);
              const reply = await reader.readUntil(
                /\[yes\/no\]|[Yy]es\/[Nn]o|[#>]\s*$/i,
                15_000,
              );
              if (/yes\/no|\[yes/i.test(reply)) {
                stream.write('yes\n');
                await reader.readUntil(/#\s*$/, 30_000);
              }
              stream.write('exit\n');
              clearTimeout(timeout);
              conn.end();
              resolve({
                ok: true,
                message: `Reload solicitado para slot ${target}`,
              });
            } catch (e) {
              clearTimeout(timeout);
              conn.end();
              resolve({
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          });
        })
        .on('error', (e) => {
          clearTimeout(timeout);
          resolve({ ok: false, error: e.message });
        })
        .connect({
          ...sshHostVerification(params.host, params.port),
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          readyTimeout: 15_000,
        });
    });
  }

  private pickSoftVer(cards: ZteOltCard[]): string | undefined {
    const versions = cards
      .map((c) => c.softVer)
      .filter((v): v is string => !!v);
    if (!versions.length) return undefined;
    const counts = new Map<string, number>();
    for (const v of versions) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  private extractSoftVer(text: string): string | undefined {
    const m =
      text.match(
        /Soft(?:ware)?\s*Ver(?:sion)?\s*[:=]?\s*(V?[\d.]+[A-Za-z0-9]*)/i,
      ) || text.match(/\b(V[12]\.\d(?:\.\d+)?[A-Za-z0-9]*)\b/);
    return m?.[1];
  }

  private summarizeCards(cards: ZteOltCard[]): string {
    if (!cards.length) return 'Sin tarjetas';
    const up = cards.filter((c) =>
      /INSERVICE|OK|ACTIVE/i.test(c.status),
    ).length;
    return `${up}/${cards.length} tarjetas activas`;
  }

  private isControlCard(type: string): boolean {
    return /^(SMX|SCX|SCTM|SFU|FCSD|SPUF|PRSF)/i.test(type);
  }

  private parseProcessorRows(text: string): Array<{
    slot: string;
    cpu1m: number;
    phyMemMb: number;
    memPct: number;
  }> {
    const rows: Array<{
      slot: string;
      cpu1m: number;
      phyMemMb: number;
      memPct: number;
    }> = [];
    for (const line of text.split(/\r?\n/)) {
      // 1 1 2 10% 13% 13% 512 38%
      const m = line.match(
        /^\s*\d+\s+\d+\s+(\d+)\s+(\d+)%\s+(\d+)%\s+(\d+)%\s+(\d+)\s+(\d+)%\s*$/,
      );
      if (!m) continue;
      rows.push({
        slot: m[1],
        cpu1m: Number(m[3]),
        phyMemMb: Number(m[5]),
        memPct: Number(m[6]),
      });
    }
    return rows;
  }

  private hasNumericTemps(text: string): boolean {
    return this.parseTemperatures(text).length > 0;
  }

  private parseTemperatures(
    text: string,
  ): Array<{ slot: string; temp: number }> {
    const out: Array<{ slot: string; temp: number }> = [];
    for (const line of text.split(/\r?\n/)) {
      // 1 1 2 30 29 29 N/A.
      const m1 = line.match(/^\s*\d+\s+\d+\s+(\d+)\s+(\d+(?:\.\d+)?)\s+/);
      if (m1) {
        out.push({ slot: m1[1], temp: Number(m1[2]) });
        continue;
      }
      // Slot-only: "2 35" or "2 35.0"
      const m2 = line.match(/^\s*(\d+)\s+(\d+(?:\.\d+)?)\s*$/);
      if (m2 && !/n\/a/i.test(line)) {
        out.push({ slot: m2[1], temp: Number(m2[2]) });
      }
    }
    return out.filter(
      (t) => Number.isFinite(t.temp) && t.temp > 0 && t.temp < 120,
    );
  }

  private extractUptime(text: string): string | undefined {
    const m =
      text.match(/Uptime\s*:\s*(.+)/i) ||
      text.match(/Started before\s*:\s*(.+)/i);
    if (!m?.[1]) return undefined;
    return m[1]
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s*\.?\s*$/, '');
  }

  private aggregateResourceMetrics(
    cards: ZteOltCard[],
    procOut: string,
    tempOut: string,
    sysOut: string,
  ): {
    cpuLoad?: number;
    freeMemory?: number;
    totalMemory?: number;
    temperature?: number;
    uptime?: string;
  } {
    const rows = this.parseProcessorRows(procOut);
    const controlSlots = new Set(
      cards
        .filter(
          (c) =>
            this.isControlCard(c.cfgType) || this.isControlCard(c.realType),
        )
        .map((c) => c.slot),
    );

    let primary =
      rows.find((r) => controlSlots.has(r.slot)) ??
      [...rows].sort((a, b) => b.phyMemMb - a.phyMemMb)[0];

    // If control card not in processor list, fall back to max CPU row
    if (!primary && rows.length) {
      primary = [...rows].sort((a, b) => b.cpu1m - a.cpu1m)[0];
    }

    let cpuLoad: number | undefined;
    let freeMemory: number | undefined;
    let totalMemory: number | undefined;
    if (primary) {
      cpuLoad = primary.cpu1m;
      totalMemory = primary.phyMemMb * 1024 * 1024;
      freeMemory = Math.round(totalMemory * ((100 - primary.memPct) / 100));
    }

    const temps = this.parseTemperatures(tempOut);
    let temperature: number | undefined;
    const controlTemp = temps.find((t) => controlSlots.has(t.slot));
    if (controlTemp) {
      temperature = controlTemp.temp;
    } else if (temps.length) {
      temperature = Math.max(...temps.map((t) => t.temp));
    }

    const uptime = this.extractUptime(sysOut);

    return { cpuLoad, freeMemory, totalMemory, temperature, uptime };
  }
}

class TelnetSession {
  private buffer = '';
  private readonly socket: net.Socket;
  private waiters: Array<{
    re: RegExp;
    resolve: (s: string) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (err) => {
      for (const w of this.waiters) {
        clearTimeout(w.timer);
        w.reject(err);
      }
      this.waiters = [];
    });
    socket.on('close', () => {
      for (const w of this.waiters) {
        clearTimeout(w.timer);
        w.reject(new Error('Connection closed'));
      }
      this.waiters = [];
    });
  }

  static connect(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<TelnetSession> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Telnet connection timeout'));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(new TelnetSession(socket));
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private onData(chunk: Buffer) {
    // Strip basic Telnet IAC negotiations
    let i = 0;
    const out: number[] = [];
    while (i < chunk.length) {
      if (chunk[i] === 255 && i + 1 < chunk.length) {
        const cmd = chunk[i + 1];
        if (cmd === 255) {
          out.push(255);
          i += 2;
          continue;
        }
        if (cmd === 251 || cmd === 252 || cmd === 253 || cmd === 254) {
          // WILL/WONT/DO/DONT — reply with WONT/DONT
          if (i + 2 < chunk.length) {
            const opt = chunk[i + 2];
            const reply =
              cmd === 251 || cmd === 252
                ? Buffer.from([255, 254, opt]) // DONT
                : Buffer.from([255, 252, opt]); // WONT
            this.socket.write(reply);
            i += 3;
            continue;
          }
        }
        i += 2;
        continue;
      }
      out.push(chunk[i]);
      i += 1;
    }
    this.buffer += Buffer.from(out).toString('utf8');
    this.flushWaiters();
  }

  private flushWaiters() {
    if (!this.waiters.length) return;
    const w = this.waiters[0];
    if (w.re.test(this.buffer)) {
      this.waiters.shift();
      clearTimeout(w.timer);
      const snap = this.buffer;
      this.buffer = '';
      w.resolve(snap);
    }
  }

  expect(re: RegExp, timeoutMs: number): Promise<string> {
    return this.readUntil(re, timeoutMs);
  }

  readUntil(re: RegExp, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (re.test(this.buffer)) {
        const snap = this.buffer;
        this.buffer = '';
        resolve(snap);
        return;
      }
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(entry);
        if (idx >= 0) this.waiters.splice(idx, 1);
        const tail = this.buffer.slice(-200);
        // Descartar lo leído a medias: si queda en el buffer, la respuesta
        // atrasada de este comando se entrega como respuesta del siguiente y
        // toda la sesión queda desfasada.
        this.buffer = '';
        reject(new Error(`Timeout waiting for ${re}; got: ${tail}`));
      }, timeoutMs);
      const entry = { re, resolve, reject, timer };
      this.waiters.push(entry);
    });
  }

  /**
   * Wait for a hostname prompt, then absorb a possible second prompt.
   * (Some firmwares echo twice when the client sends CR+LF.)
   */
  async readUntilPrompt(timeoutMs: number): Promise<string> {
    let out = await this.readUntil(CLI_PROMPT_RE, timeoutMs);
    out += await this.consumeTrailingPrompts(50);
    return out;
  }

  private consumeTrailingPrompts(budgetMs: number): Promise<string> {
    const onlyPrompt = /^\s*[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[#>]\s*$/;
    return new Promise((resolve) => {
      let acc = '';
      const start = Date.now();
      const tick = () => {
        if (onlyPrompt.test(this.buffer)) {
          acc += this.buffer;
          this.buffer = '';
          if (Date.now() - start < budgetMs) {
            setTimeout(tick, 20);
            return;
          }
          resolve(acc);
          return;
        }
        if (this.buffer.length > 0) {
          resolve(acc);
          return;
        }
        if (Date.now() - start >= budgetMs) {
          resolve(acc);
          return;
        }
        setTimeout(tick, 15);
      };
      setTimeout(tick, 20);
    });
  }

  sendLine(line: string): Promise<void> {
    // LF only — CR+LF often submits the line twice on ZTE and leaves a stray `#`
    // that makes the next readUntil resolve empty (commands collide → Error 20202).
    this.socket.write(line + '\n');
    return Promise.resolve();
  }

  close() {
    this.socket.destroy();
  }
}

const CLI_PROMPT_RE = /[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[#>]\s*$/;

class StreamReader {
  private buffer = '';
  private waiters: Array<{
    re: RegExp;
    resolve: (s: string) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(
    private readonly stream: NodeJS.ReadableStream & {
      write: (s: string) => void;
    },
  ) {
    stream.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      this.flush();
    });
    stream.on('close', () => {
      for (const w of this.waiters) {
        clearTimeout(w.timer);
        w.reject(new Error('SSH shell closed'));
      }
      this.waiters = [];
    });
  }

  private flush() {
    if (!this.waiters.length) return;
    const w = this.waiters[0];
    if (w.re.test(this.buffer)) {
      this.waiters.shift();
      clearTimeout(w.timer);
      const snap = this.buffer;
      this.buffer = '';
      w.resolve(snap);
    }
  }

  readUntil(re: RegExp, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (re.test(this.buffer)) {
        const snap = this.buffer;
        this.buffer = '';
        resolve(snap);
        return;
      }
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(entry);
        if (idx >= 0) this.waiters.splice(idx, 1);
        const tail = this.buffer.slice(-200);
        // Igual que en telnet: sin limpiar, el siguiente comando lee esto.
        this.buffer = '';
        reject(new Error(`Timeout waiting for ${re}; got: ${tail}`));
      }, timeoutMs);
      const entry = { re, resolve, reject, timer };
      this.waiters.push(entry);
    });
  }

  async readUntilPrompt(timeoutMs: number): Promise<string> {
    let out = await this.readUntil(CLI_PROMPT_RE, timeoutMs);
    out += await this.consumeTrailingPrompts(50);
    return out;
  }

  private consumeTrailingPrompts(budgetMs: number): Promise<string> {
    const onlyPrompt = /^\s*[A-Za-z0-9_./()-]+(?:\([^)\n]*\))?[#>]\s*$/;
    return new Promise((resolve) => {
      let acc = '';
      const start = Date.now();
      const tick = () => {
        if (onlyPrompt.test(this.buffer)) {
          acc += this.buffer;
          this.buffer = '';
          if (Date.now() - start < budgetMs) {
            setTimeout(tick, 20);
            return;
          }
          resolve(acc);
          return;
        }
        if (this.buffer.length > 0) {
          resolve(acc);
          return;
        }
        if (Date.now() - start >= budgetMs) {
          resolve(acc);
          return;
        }
        setTimeout(tick, 15);
      };
      setTimeout(tick, 20);
    });
  }
}

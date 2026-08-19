import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import { Client as SshClient, type ClientChannel } from 'ssh2';
import { sshHostVerification } from '../_shared/transport/ssh-host-key';
import type {
  ConnectedOnu,
  ConnectedOnuDetail,
  OltCard,
  OltCardsResult,
  OltProbeResult,
} from '../dto';
import {
  buildHuaweiAcsUrlVariants,
  buildOntIpconfigCommands,
  buildTr069ProfileAddCommands,
  cliRejected,
  detectHuaweiFwFamily,
  nextFreeProfileId,
  parseExistingTr069ProfileId,
  parseHuaweiVersionBanner,
  parseOntLineProfileId,
  parseServicePortIndexesByGemport,
  parseServicePortIndexesByVlan,
  stripHuaweiDialectTag,
  type HuaweiFwFamily,
} from './huawei-olt-firmware.util';
import {
  buildHuaweiOltIf,
  parseHuaweiBoard,
  parseHuaweiConnectedOnus,
  parseHuaweiOltIf,
  parseHuaweiOnuIf,
  parseHuaweiOntAutofind,
  parseHuaweiOpticalSignal,
  parseHuaweiTrafficRates,
  suggestNextOntId,
  isHuaweiEponCard,
  isHuaweiGponCard,
} from './huawei-olt-onu.util';
import {
  buildHuaweiPonPorts,
  type HuaweiPonPortRaw,
} from './huawei-olt-pon.util';
import {
  parseHuaweiUplinks,
  type HuaweiUplinkRaw,
} from './huawei-olt-uplink.util';
import {
  parseHuaweiOntEthPortVlans,
  parseHuaweiVlans,
  type HuaweiVlanRaw,
} from './huawei-olt-vlan.util';
import {
  mergeHuaweiSpeedProfiles,
  parseHuaweiDbaProfiles,
  parseHuaweiLineProfiles,
  parseHuaweiSrvProfiles,
} from './huawei-olt-profile.util';

type CliParams = {
  host: string;
  port: number;
  protocol: 'telnet' | 'ssh';
  username: string;
  password: string;
  priority?: 'interactive' | 'background';
};
type CliIo = {
  send: (command: string) => Promise<void>;
  read: (timeout?: number) => Promise<string>;
};
export type HuaweiConnectedOnu = ConnectedOnu;
export type HuaweiConnectedOnuDetail = ConnectedOnuDetail;

@Injectable()
export class HuaweiOltClient {
  private readonly logger = new Logger(HuaweiOltClient.name);
  private readonly queues = new Map<
    string,
    {
      interactive: Array<() => Promise<void>>;
      background: Array<() => Promise<void>>;
      pumping: boolean;
    }
  >();
  /** Cache dialect after `display version` (5 min). */
  private readonly fwCache = new Map<
    string,
    {
      family: HuaweiFwFamily;
      softVer: string | null;
      product: string | null;
      atMs: number;
    }
  >();

  private fwCacheKey(host: string, port: number) {
    return `${host.trim().toLowerCase()}:${port}`;
  }

  async probe(
    params: CliParams & { subtypeHint?: string | null },
  ): Promise<OltProbeResult> {
    try {
      return await this.run(params, false, async (io) => {
        await io.send('display version');
        const version = await io.read();
        await io.send('display board 0');
        const board = await io.read();
        const cards = parseHuaweiBoard(board) as OltCard[];
        const hasGpon = cards.some((card) =>
          isHuaweiGponCard(card.realType || card.cfgType),
        );
        const hasEpon = cards.some((card) =>
          isHuaweiEponCard(card.realType || card.cfgType),
        );
        if (!hasGpon && hasEpon) {
          throw new Error(
            'Huawei EPON no soportado; esta integración es GPON-only',
          );
        }
        const parsed = parseHuaweiVersionBanner(version);
        const family = detectHuaweiFwFamily({
          subtype: params.subtypeHint,
          product: parsed.product,
          softVer: parsed.softVer,
          versionText: version,
        });
        this.fwCache.set(this.fwCacheKey(params.host, params.port), {
          family,
          softVer: parsed.softVer,
          product: parsed.product,
          atMs: Date.now(),
        });
        const product =
          parsed.product ||
          version.match(/(MA\d{4}[A-Z0-9-]*)/i)?.[1] ||
          undefined;
        const softVer =
          parsed.softVer ||
          version.match(/(?:Version|VRP)\s*[:=]?\s*([^\r\n]+)/i)?.[1]?.trim();
        return {
          ok: true,
          product,
          hostname: this.hostname(version),
          softVer: softVer || undefined,
          firmwareFamily: family !== 'unknown' ? family : undefined,
          ponType: hasGpon ? 'gpon' : undefined,
          cards,
          rawCardSummary: board,
        };
      });
    } catch (error) {
      return { ok: false, error: this.message(error) };
    }
  }

  async listCards(params: CliParams): Promise<OltCardsResult> {
    const probedAt = new Date().toISOString();
    try {
      const cards = await this.run(params, false, async (io) => {
        await io.send('display board 0');
        return parseHuaweiBoard(await io.read());
      });
      return { ok: true, cards, probedAt, summary: `${cards.length} tarjetas` };
    } catch (error) {
      return {
        ok: false,
        error: this.message(error),
        cards: [],
        probedAt,
        summary: null,
      };
    }
  }

  async rebootCard(
    params: CliParams & { rack: string; shelf: string; slot: string },
  ) {
    return this.write(params, async (io) => {
      await io.send(`board reset 0/${params.slot}`);
      const out = await io.read();
      this.throwIfCliError(out);
      return `Reinicio enviado a tarjeta ${params.slot}`;
    });
  }

  async listPonPorts(params: CliParams & { light?: boolean }) {
    const probedAt = new Date().toISOString();
    try {
      const ports = await this.run(params, false, async (io) => {
        await io.send('display board 0');
        return buildHuaweiPonPorts(parseHuaweiBoard(await io.read()));
      });
      return {
        ok: true,
        ports,
        probedAt,
        summary: `${ports.length} puertos GPON`,
      };
    } catch (error) {
      return {
        ok: false,
        error: this.message(error),
        ports: [],
        probedAt,
        summary: null,
      };
    }
  }

  async configurePonPort(
    params: CliParams & {
      ifName: string;
      adminEnabled?: boolean;
      autoFindEnabled?: boolean;
    },
  ) {
    const point = parseHuaweiOltIf(params.ifName);
    if (!point)
      return {
        ok: false,
        error: 'Interfaz GPON Huawei inválida o EPON no soportada',
      };
    return this.write(params, async (io) => {
      await this.config(
        io,
        `interface gpon 0/${point.slot}`,
        `port ${point.port}`,
      );
      if (typeof params.adminEnabled === 'boolean')
        await io.send(params.adminEnabled ? 'undo shutdown' : 'shutdown');
      if (params.autoFindEnabled !== false)
        await io.send('ont-auto-find enable');
      await io.read();
      await io.send('quit');
      await io.read();
      return `Puerto ${params.ifName} actualizado`;
    });
  }

  async enableAllPonPorts(params: CliParams & { ports?: string[] }) {
    const list = params.ports?.length
      ? params.ports
      : (await this.listPonPorts(params)).ports.map((p) => p.ifName);
    for (const ifName of list) {
      const result = await this.configurePonPort({
        ...params,
        ifName,
        adminEnabled: true,
        autoFindEnabled: true,
      });
      if (!result.ok) return result;
    }
    return { ok: true, message: `${list.length} puertos habilitados` };
  }

  async listConnectedOnus(
    params: CliParams & {
      onlyOltIfs?: string[];
      includeRunningConfig?: boolean;
    },
  ) {
    const probedAt = new Date().toISOString();
    try {
      const onus = await this.run(params, false, async (io) => {
        let ports = params.onlyOltIfs?.length ? [...params.onlyOltIfs] : [];
        if (!ports.length) {
          await io.send('display board 0');
          ports = buildHuaweiPonPorts(parseHuaweiBoard(await io.read())).map(
            (p) => p.ifName,
          );
        }
        const all: ConnectedOnu[] = [];
        for (const ifName of ports) {
          const p = parseHuaweiOltIf(ifName);
          if (!p) continue;
          await io.send(`display ont info 0/${p.slot}/${p.port} all`);
          all.push(
            ...(parseHuaweiConnectedOnus(
              await io.read(),
              ifName,
            ) as ConnectedOnu[]),
          );
        }
        return all;
      });
      return {
        ok: true,
        onus,
        probedAt,
        summary: `${onus.filter((o) => o.online).length}/${onus.length} ONUs en línea`,
      };
    } catch (error) {
      return {
        ok: false,
        error: this.message(error),
        onus: [],
        probedAt,
        summary: null,
      };
    }
  }

  async getConnectedOnuDetail(params: CliParams & { onuIf: string }) {
    const probedAt = new Date().toISOString();
    const point = parseHuaweiOnuIf(params.onuIf);
    if (!point)
      return { ok: false, error: 'Interfaz ONU Huawei inválida', probedAt };
    try {
      const onu = await this.run(params, false, async (io) => {
        await io.send(
          `display ont info 0/${point.slot}/${point.port} ${point.ontId}`,
        );
        const detail = await io.read();
        await io.send(
          `display ont optical-info 0/${point.slot}/${point.port} ${point.ontId}`,
        );
        const optical = await io.read();
        const base = parseHuaweiConnectedOnus(
          detail,
          buildHuaweiOltIf(point.slot, point.port),
        )[0] as ConnectedOnu | undefined;
        if (!base) throw new Error('ONU no encontrada');
        return {
          ...base,
          signalDbm: parseHuaweiOpticalSignal(optical),
          oltRxDbm: null,
          distanceM: null,
          onlineDuration: null,
          downloadBps: null,
          uploadBps: null,
          runningConfig: '',
          detailInfoRaw: detail,
          ethernetPorts: [],
          wifiPorts: [],
          voipSupported: null,
          catvSupported: null,
        };
      });
      return { ok: true, onu, probedAt };
    } catch (error) {
      return { ok: false, error: this.message(error), probedAt };
    }
  }

  /** Siguiente índice libre en un puerto PON, leído en vivo. */
  async resolveNextOnuId(
    params: CliParams & { ifName: string },
  ): Promise<{ ok: boolean; onuId?: number; error?: string }> {
    try {
      const point = parseHuaweiOltIf(params.ifName);
      if (!point) {
        return { ok: false, error: `Puerto inválido: ${params.ifName}` };
      }
      const next = await this.run(params, false, async (io) => {
        await io.send(`display ont info 0/${point.slot}/${point.port} all`);
        const occupied = parseHuaweiConnectedOnus(
          await io.read(),
          params.ifName,
        ).map((o) => o.onuId);
        return suggestNextOntId(occupied);
      });
      if (next == null) {
        return {
          ok: false,
          error: `El puerto ${params.ifName} no tiene índices libres.`,
        };
      }
      return { ok: true, onuId: next };
    } catch (error) {
      return { ok: false, error: this.message(error) };
    }
  }

  async listUncfgOnus(params: CliParams) {
    const probedAt = new Date().toISOString();
    try {
      const onus = await this.run(params, false, async (io) => {
        await io.send('display ont autofind all');
        const uncfg = parseHuaweiOntAutofind(await io.read());
        const byPort = new Map<string, string[]>();
        for (const item of uncfg)
          if (!byPort.has(item.oltIf)) byPort.set(item.oltIf, []);
        for (const oltIf of byPort.keys()) {
          const point = parseHuaweiOltIf(oltIf)!;
          await io.send(`display ont info 0/${point.slot}/${point.port} all`);
          byPort.set(
            oltIf,
            parseHuaweiConnectedOnus(await io.read(), oltIf).map(
              (o) => o.onuId,
            ),
          );
        }
        return uncfg.map((o) => ({
          ...o,
          suggestedOnuId: suggestNextOntId(byPort.get(o.oltIf) || []),
        }));
      });
      return {
        ok: true,
        onus,
        probedAt,
        summary: `${onus.length} ONUs sin autorizar`,
      };
    } catch (error) {
      return {
        ok: false,
        error: this.message(error),
        onus: [],
        probedAt,
        summary: null,
      };
    }
  }

  async authorizeOnu(
    params: CliParams & {
      oltIf: string;
      onuId: string | number;
      sn: string;
      onuType?: string | null;
      name?: string | null;
      vlan?: number | null;
    },
  ) {
    const point = parseHuaweiOltIf(params.oltIf);
    if (!point)
      return {
        ok: false,
        error: 'Puerto GPON Huawei inválido o EPON no soportado',
      };
    if (!/^[A-Za-z0-9]{8,20}$/.test(params.sn.trim())) {
      return { ok: false, error: 'Serial GPON Huawei inválido' };
    }
    const onuId = Number(params.onuId);
    if (!Number.isInteger(onuId) || onuId < 0 || onuId > 255) {
      return { ok: false, error: 'ONT ID Huawei inválido' };
    }
    const numericProfile = Number.parseInt(params.onuType || '', 10);
    const lineId = Number.isFinite(numericProfile) ? numericProfile : 10;
    const srvId = Number.isFinite(numericProfile) ? numericProfile : 10;
    this.logger.log(
      `Huawei authorize ${params.sn}: lineprofile=${lineId}, srvprofile=${srvId}`,
    );
    return this.write(params, async (io) => {
      await this.config(
        io,
        `interface gpon 0/${point.slot}`,
        `ont add ${point.port} ${onuId} sn-auth ${params.sn.toUpperCase()} omci ont-lineprofile-id ${lineId} ont-srvprofile-id ${srvId} desc "${this.escape(params.name || params.sn)}"`,
      );
      await io.send('quit');
      await io.read();
      try {
        if (params.vlan && params.vlan > 0) {
          await io.send(
            `service-port vlan ${params.vlan} gpon 0/${point.slot}/${point.port} ont ${onuId} gemport 1 multi-service user-vlan ${params.vlan} tag-transform translate`,
          );
          this.throwIfCliError(await io.read());
        }
        await io.send(
          `display ont info 0/${point.slot}/${point.port} ${onuId}`,
        );
        const verification = await io.read();
        this.throwIfCliError(verification);
        const normalized = verification
          .replace(/[^A-Za-z0-9]/g, '')
          .toUpperCase();
        if (!normalized.includes(params.sn.toUpperCase())) {
          throw new Error('La OLT no confirmó el serial después de autorizar');
        }
      } catch (error) {
        // Roll back only the ONT just added by this transaction.
        await io.send(`interface gpon 0/${point.slot}`);
        await io.read().catch(() => '');
        await io.send(`ont delete ${point.port} ${onuId}`);
        await io.read().catch(() => '');
        await io.send('quit');
        await io.read().catch(() => '');
        throw error;
      }
      return `ONU ${params.sn} autorizada`;
    });
  }

  async rebootOnu(params: CliParams & { onuIf: string }) {
    return this.onuAction(params, 'ont reset', 'Reinicio enviado');
  }
  async disableOnu(params: CliParams & { onuIf: string }) {
    return this.onuAction(params, 'ont deactivate', 'ONU deshabilitada');
  }
  async enableOnu(params: CliParams & { onuIf: string }) {
    return this.onuAction(params, 'ont activate', 'ONU habilitada');
  }
  async deleteOnu(params: CliParams & { onuIf: string }) {
    return this.onuAction(params, 'ont delete', 'ONU eliminada');
  }
  async configureOnuName(params: CliParams & { onuIf: string; name: string }) {
    return this.modifyOnu(params, params.name);
  }
  async configureOnuDescription(
    params: CliParams & { onuIf: string; description: string },
  ) {
    return this.modifyOnu(params, params.description);
  }

  async listUplinks(params: CliParams) {
    const probedAt = new Date().toISOString();
    try {
      const uplinks = await this.display(
        params,
        'display port all',
        parseHuaweiUplinks,
      );
      return {
        ok: true,
        uplinks,
        probedAt,
        summary: `${uplinks.length} uplinks`,
      };
    } catch (error) {
      return {
        ok: false,
        error: this.message(error),
        uplinks: [] as HuaweiUplinkRaw[],
        probedAt,
        summary: null,
      };
    }
  }
  async configureUplink(
    params: CliParams & {
      ifName: string;
      addVlans?: string;
      removeVlans?: string;
      adminEnabled?: boolean;
      description?: string;
    },
  ) {
    return this.write(params, async (io) => {
      await this.config(io, `interface ${params.ifName}`);
      if (params.description !== undefined)
        await io.send(`description ${this.escape(params.description)}`);
      if (typeof params.adminEnabled === 'boolean')
        await io.send(params.adminEnabled ? 'undo shutdown' : 'shutdown');
      for (const vlan of this.vlans(params.addVlans))
        await io.send(`port trunk allow-pass vlan ${vlan}`);
      for (const vlan of this.vlans(params.removeVlans))
        await io.send(`undo port trunk allow-pass vlan ${vlan}`);
      await io.read();
      await io.send('quit');
      await io.read();
      return `Uplink ${params.ifName} actualizado`;
    });
  }

  async listVlans(params: CliParams) {
    const probedAt = new Date().toISOString();
    try {
      const vlans = await this.display(
        params,
        'display vlan all',
        parseHuaweiVlans,
      );
      return { ok: true, vlans, probedAt, summary: `${vlans.length} VLANs` };
    } catch (error) {
      return {
        ok: false,
        error: this.message(error),
        vlans: [] as HuaweiVlanRaw[],
        probedAt,
        summary: null,
      };
    }
  }
  async upsertVlan(
    params: CliParams & {
      vlanId: number;
      description?: string;
      /**
       * Uplink ifNames that must carry this VLAN upstream. Without these the
       * VLAN exists on the OLT but never leaves it, so ONUs cannot reach their
       * gateway.
       */
      tagUplinks?: string[];
      untagUplinks?: string[];
    },
  ) {
    if (
      !Number.isInteger(params.vlanId) ||
      params.vlanId < 1 ||
      params.vlanId > 4094
    )
      return { ok: false, error: 'VLAN ID inválido (1–4094)' };
    const id = params.vlanId;
    return this.write(params, async (io) => {
      await this.config(io, `vlan ${id} smart`);
      await io.read();
      await io.send('quit');
      await io.read();

      // Reported rather than applied silently: a VLAN that fails to reach the
      // uplink looks created but strands every ONU behind it.
      const warnings: string[] = [];
      const tagged: string[] = [];
      const untagged: string[] = [];
      const onUplink = async (ifName: string, command: string) => {
        await io.send(`interface ${ifName}`);
        if (cliRejected(await io.read())) {
          warnings.push(`uplink ${ifName}: no existe en la OLT`);
          return false;
        }
        await io.send(command);
        const rejected = cliRejected(await io.read());
        await io.send('quit');
        await io.read();
        return !rejected;
      };

      for (const ifName of new Set(params.tagUplinks ?? [])) {
        if (await onUplink(ifName, `port trunk allow-pass vlan ${id}`)) {
          tagged.push(ifName);
        } else {
          warnings.push(`no se pudo etiquetar en el uplink ${ifName}`);
        }
      }
      for (const ifName of new Set(params.untagUplinks ?? [])) {
        if (await onUplink(ifName, `undo port trunk allow-pass vlan ${id}`)) {
          untagged.push(ifName);
        } else {
          warnings.push(`no se pudo quitar del uplink ${ifName}`);
        }
      }

      const detail = [
        tagged.length ? `uplinks +${tagged.join(', ')}` : null,
        untagged.length ? `uplinks -${untagged.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      return [
        `VLAN ${id} guardada${detail ? ` (${detail})` : ''}`,
        warnings.length ? `— ${warnings.join('; ')}` : null,
      ]
        .filter(Boolean)
        .join(' ');
    });
  }
  async deleteVlan(params: CliParams & { vlanId: number }) {
    return this.write(params, async (io) => {
      await this.config(io, `undo vlan ${params.vlanId}`);
      await io.read();
      return `VLAN ${params.vlanId} eliminada`;
    });
  }

  /**
   * Huawei BTV/IGMP multicast is a separate integration path.
   * TV VLANs still get the L2 VLAN via upsertVlan; MVLAN is ZTE-first.
   */
  async ensureIgmpMvlan(
    params: CliParams & {
      vlanId: number;
      workMode?: 'snooping' | 'spr' | 'proxy' | 'router';
      hostIp?: string | null;
    },
  ) {
    return {
      ok: true as const,
      message: `VLAN ${params.vlanId}: IGMP/BTV Huawei pendiente (modo ${params.workMode ?? 'snooping'} ignorado)`,
    };
  }

  async syncIgmpMvlanSourcePorts(
    params: CliParams & {
      vlanId: number;
      next: string[];
      previous?: string[];
    },
  ) {
    return {
      ok: true as const,
      message: `VLAN ${params.vlanId}: source-port Huawei pendiente`,
    };
  }

  async setIgmpMvlanReceivePort(
    params: CliParams & {
      vlanId: number;
      onuIf: string;
      vport?: number;
      enable: boolean;
    },
  ) {
    return {
      ok: true as const,
      message: `VLAN ${params.vlanId}: receive-port Huawei pendiente`,
    };
  }

  async listSpeedProfiles(params: CliParams) {
    const probedAt = new Date().toISOString();
    try {
      const profiles = await this.run(params, false, async (io) => {
        await io.send('display dba-profile all');
        const dba = parseHuaweiDbaProfiles(await io.read());
        await io.send('display ont-lineprofile gpon all');
        const line = parseHuaweiLineProfiles(await io.read());
        await io.send('display ont-srvprofile gpon all');
        const srv = parseHuaweiSrvProfiles(await io.read());
        return mergeHuaweiSpeedProfiles([...dba, ...line, ...srv]);
      });
      return { ok: true, profiles, probedAt };
    } catch (error) {
      return { ok: false, error: this.message(error), profiles: [], probedAt };
    }
  }
  async upsertSpeedProfile(
    params: CliParams & {
      name: string;
      downloadMbps: number;
      uploadMbps: number;
    },
  ) {
    const name =
      params.name
        .trim()
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 32) || 'ISP';
    const upKbps = Math.max(64, Math.round(params.uploadMbps * 1024));
    const downKbps = Math.max(64, Math.round(params.downloadMbps * 1024));
    return this.write(params, async (io) => {
      await this.config(io);
      await io.send('display dba-profile all');
      const existing = parseHuaweiDbaProfiles(await io.read());
      const used = new Set(
        existing.map((p) => p.id).filter((id): id is number => id != null),
      );
      let nextId = 10;
      while (used.has(nextId) && nextId < 512) nextId += 1;
      const upName = `${name}-UP`.slice(0, 32);
      const downName = `${name}-DOWN`.slice(0, 32);
      // Type 4 = max bandwidth (common ISP DBA). Downstream often uses traffic table / line profile.
      await io.send(
        `dba-profile add profile-id ${nextId} profile-name "${upName}" type4 maximum ${upKbps}`,
      );
      let out = await io.read();
      if (
        /error|invalid|fail|already/i.test(out) &&
        !/already\s*exist/i.test(out)
      ) {
        await io.send(
          `dba-profile add profile-id ${nextId} profile-name ${upName} type 4 maximum ${upKbps}`,
        );
        out = await io.read();
      }
      const downId = nextId + 1;
      await io.send(
        `dba-profile add profile-id ${downId} profile-name "${downName}" type4 maximum ${downKbps}`,
      );
      await io.read();
      await io.send('quit');
      await io.read();
      return `Perfiles DBA ${upName}/${downName} creados (id ${nextId}/${downId})`;
    });
  }

  async deleteSpeedProfile(params: CliParams & { name: string }) {
    const needle = params.name.trim().toLowerCase();
    return this.write(params, async (io) => {
      await this.config(io);
      await io.send('display dba-profile all');
      const dba = parseHuaweiDbaProfiles(await io.read());
      const matches = dba.filter(
        (p) =>
          p.name.toLowerCase() === needle ||
          p.name.toLowerCase().startsWith(`${needle}-`) ||
          p.name.toLowerCase().includes(needle),
      );
      if (!matches.length) {
        throw new Error(`No se encontró perfil DBA «${params.name}»`);
      }
      for (const p of matches) {
        if (p.id == null) continue;
        await io.send(`undo dba-profile profile-id ${p.id}`);
        await io.read();
      }
      await io.send('quit');
      await io.read();
      return `Eliminados ${matches.length} perfil(es) DBA relacionados con «${params.name}»`;
    });
  }

  async rebootOnusOnIf(params: CliParams & { ifName: string }) {
    const point = parseHuaweiOltIf(params.ifName);
    if (!point) return { ok: false, error: 'Interfaz GPON Huawei inválida' };
    try {
      return await this.run(params, true, async (io) => {
        await io.send(`display ont info 0/${point.slot}/${point.port} all`);
        const onus = parseHuaweiConnectedOnus(await io.read(), params.ifName);
        await this.config(io, `interface gpon 0/${point.slot}`);
        for (const onu of onus) {
          await io.send(`ont reset ${point.port} ${onu.onuId}`);
          await io.read();
        }
        await io.send('quit');
        await io.read();
        return {
          ok: true as const,
          count: onus.length,
          message: `Reinicio enviado a ${onus.length} ONUs en ${params.ifName}`,
        };
      });
    } catch (error) {
      return { ok: false, error: this.message(error) };
    }
  }

  async rebootAllOnus(params: CliParams & { slot?: string }) {
    const listed = await this.listPonPorts(params);
    if (!listed.ok) return { ok: false, error: listed.error };
    const targets = (listed.ports as HuaweiPonPortRaw[]).filter(
      (p) => !params.slot || String(p.slot) === String(params.slot),
    );
    let total = 0;
    for (const p of targets) {
      const r = await this.rebootOnusOnIf({ ...params, ifName: p.ifName });
      if (r.ok && 'count' in r) total += r.count ?? 0;
    }
    return {
      ok: true,
      count: total,
      message: `Reinicio enviado a ${total} ONUs`,
    };
  }

  /** Full `display current-configuration` for backup (may paginate/truncate). */
  async dumpRunningConfig(
    params: CliParams & { priority?: 'interactive' | 'background' },
  ): Promise<string> {
    return this.run(params, false, async (io) => {
      await io.send('screen-length 0 temporary').catch(() => undefined);
      await io.read(8_000).catch(() => '');
      await io.send('display current-configuration');
      return io.read(180_000);
    });
  }

  async getRogueDetect(params: CliParams) {
    try {
      return await this.run(params, false, async (io) => {
        await io.send('display board 0');
        const cards = parseHuaweiBoard(await io.read()).filter((c) =>
          /gp|xg|cg|fl/i.test(`${c.cfgType} ${c.realType}`),
        );
        await io.send('display current-configuration | include rogue');
        let cfg = await io.read();
        if (/error|unknown|incomplete|invalid/i.test(cfg)) {
          await io.send('display alarm active all');
          cfg = await io.read();
        }
        const detectOn = /rogue[^\n]*(enable|on|detect)/i.test(cfg);
        return {
          ok: true as const,
          cards: cards.map((c) => ({
            slot: c.slot,
            boardType: c.realType || c.cfgType,
            detect: detectOn,
            locate: /locate\s+enable/i.test(cfg),
            autoShutdown: /auto-shutdown\s+enable|shutdown\s+enable/i.test(cfg),
          })),
        };
      });
    } catch (error) {
      return { ok: false, error: this.message(error), cards: [] };
    }
  }

  async setRogueDetect(
    params: CliParams & {
      slots: string[];
      enable: boolean;
      locate?: boolean;
      autoShutdown?: boolean;
    },
  ) {
    return this.write(params, async (io) => {
      await this.config(io);
      for (const slot of params.slots) {
        if (params.enable) {
          await io.send('rogue-ont detect enable');
          let out = await io.read();
          if (/error|unknown|invalid|incomplete/i.test(out)) {
            await io.send(`interface gpon 0/${slot}`);
            await io.read();
            await io.send('port ont-rogue-detect enable');
            out = await io.read();
            await io.send('quit');
            await io.read();
          }
          if (params.locate) {
            await io.send('rogue-ont locate enable');
            await io.read();
          }
          if (params.autoShutdown) {
            await io.send('rogue-ont auto-shutdown enable');
            await io.read();
          }
        } else {
          await io.send('undo rogue-ont detect');
          await io.read();
        }
      }
      await io.send('quit');
      await io.read();
      return params.enable
        ? `Detección habilitada en ranuras ${params.slots.join(', ')}`
        : `Detección deshabilitada en ranuras ${params.slots.join(', ')}`;
    });
  }

  async checkRogueOnus(params: CliParams) {
    try {
      return await this.run(params, false, async (io) => {
        await io.send('display alarm active all');
        const out = await io.read();
        const lines = out
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => /rogue/i.test(l));
        return {
          ok: true as const,
          lines,
          message: lines.length
            ? `${lines.length} alarma(s) rogue`
            : 'Sin alarmas rogue activas',
        };
      });
    } catch (error) {
      return {
        ok: false,
        error: this.message(error),
        lines: [] as string[],
      };
    }
  }

  async listOnuTypes(params: CliParams) {
    try {
      const types = await this.run(params, false, async (io) => {
        await io.send('display ont-lineprofile gpon all');
        const line = parseHuaweiLineProfiles(await io.read());
        await io.send('display ont-srvprofile gpon all');
        const srv = parseHuaweiSrvProfiles(await io.read());
        const names = new Map<
          string,
          { name: string; ponType: 'gpon'; description: string | null }
        >();
        for (const p of [...line, ...srv]) {
          const key = p.name.toLowerCase();
          if (names.has(key)) continue;
          names.set(key, {
            name: p.id != null ? String(p.id) : p.name,
            ponType: 'gpon',
            description: `${p.type}:${p.name}${p.id != null ? ` (id ${p.id})` : ''}`,
          });
          // Also expose numeric id as selectable type name for authorize
          if (p.id != null) {
            names.set(`id:${p.id}`, {
              name: String(p.id),
              ponType: 'gpon',
              description: p.name,
            });
          }
        }
        return [...names.values()];
      });
      return { ok: true, types };
    } catch (error) {
      return { ok: false, error: this.message(error), types: [] };
    }
  }

  async ensureOnuTypeOnOlt(
    params: CliParams & {
      spec: {
        name: string;
        ponType: 'gpon' | 'epon';
        description?: string | null;
        ethernetPorts: number;
        wifiSsids: number;
        voipPorts: number;
        catv: boolean;
      };
    },
  ) {
    const name = params.spec.name.trim();
    if (!name)
      return { ok: false, created: false, error: 'nombre de type vacío' };
    if (params.spec.ponType !== 'gpon') {
      return {
        ok: false,
        created: false,
        error: 'Huawei EPON no soportado; solo se permiten perfiles GPON',
      };
    }
    const asId = Number.parseInt(name, 10);
    try {
      return await this.run(params, true, async (io) => {
        await io.send('display ont-lineprofile gpon all');
        const line = parseHuaweiLineProfiles(await io.read());
        await io.send('display ont-srvprofile gpon all');
        const srv = parseHuaweiSrvProfiles(await io.read());
        const exists =
          (Number.isFinite(asId) &&
            (line.some((p) => p.id === asId) ||
              srv.some((p) => p.id === asId))) ||
          line.some((p) => p.name.toLowerCase() === name.toLowerCase()) ||
          srv.some((p) => p.name.toLowerCase() === name.toLowerCase());
        if (exists) {
          return {
            ok: true as const,
            created: false,
            message: `Perfil «${name}» ya existe en la OLT Huawei`,
          };
        }
        const used = new Set(
          [...line, ...srv]
            .map((p) => p.id)
            .filter((id): id is number => id != null),
        );
        let id = Number.isFinite(asId) ? asId : 20;
        while (used.has(id) && id < 512) id += 1;
        const eth = Math.max(1, params.spec.ethernetPorts || 1);
        await this.config(io);
        await io.send(
          `ont-lineprofile gpon profile-id ${id} profile-name "${name.slice(0, 32)}"`,
        );
        await io.read();
        await io.send('tcont 1 dba-profile-id 1');
        await io.read();
        await io.send('gem add 1 eth tcont 1');
        await io.read();
        await io.send('commit');
        await io.read();
        await io.send(
          `ont-srvprofile gpon profile-id ${id} profile-name "${name.slice(0, 32)}"`,
        );
        await io.read();
        await io.send(`ont-port eth adaptive`);
        await io.read();
        await io.send(`port vlan eth 1 translation`);
        await io.read();
        await io.send('commit');
        await io.read();
        await io.send('quit');
        await io.read();
        return {
          ok: true as const,
          created: true,
          message: `Perfiles line/srv «${name}» creados (id ${id}, eth~${eth})`,
        };
      });
    } catch (error) {
      return { ok: false, created: false, error: this.message(error) };
    }
  }

  async applyOnuTr069Mgmt(
    params: CliParams & {
      onuIf: string;
      enable: boolean;
      acsEndpoint?: string;
      acsUsername?: string;
      acsPassword?: string;
      mgmtIp?: string | null;
      mgmtMask?: string | null;
      mgmtGateway?: string | null;
      mgmtVlan?: number | null;
      /** Optional hint from device.subtype / metricVersion */
      firmwareHint?: string | null;
      subtypeHint?: string | null;
    },
  ) {
    const point = parseHuaweiOnuIf(params.onuIf);
    if (!point) return { ok: false, error: 'Interfaz ONU Huawei inválida' };
    if (
      params.enable &&
      (!params.acsEndpoint?.trim() ||
        !params.acsUsername?.trim() ||
        !params.acsPassword?.trim())
    ) {
      return {
        ok: false,
        error:
          'acsEndpoint, acsUsername y acsPassword son requeridos para activar TR069',
      };
    }
    const acsUser = params.acsUsername?.trim().replace(/"/g, '') ?? '';
    const acsPass = params.acsPassword?.replace(/["\r\n]/g, '') ?? '';
    const acsEndpoint = params.acsEndpoint?.trim() ?? '';
    const logs: string[] = [];
    const t0 = Date.now();
    this.logger.log(
      `Huawei OMCI TR069 ${params.enable ? 'enable' : 'disable'} ${params.onuIf} → ${params.host}:${params.port}`,
    );
    try {
      return await this.run(params, true, async (io) => {
        const step = async (cmd: string, waitMs = 12_000) => {
          await io.send(cmd);
          const out = await io.read(waitMs);
          const safeCmd = this.redactSecrets(cmd, [acsUser, acsPass]);
          const cleaned = this.redactSecrets(
            out.replace(/\s+/g, ' ').trim().slice(0, 200),
            [acsUser, acsPass],
          );
          logs.push(`${safeCmd} → ${cleaned}`);
          this.logger.log(
            `HW TR069 step ${safeCmd.slice(0, 70)} (${cleaned.slice(0, 80)})`,
          );
          return out;
        };
        const tryCmds = async (cmds: string[]) => {
          for (const cmd of cmds) {
            const out = await step(cmd);
            if (!cliRejected(out)) return { ok: true as const, out, cmd };
          }
          return { ok: false as const, out: '', cmd: cmds[0] ?? '' };
        };

        const family = await this.resolveFwFamily(io, params, logs);
        logs.push(`dialect=${family}`);

        // OMCI HG method — required on MA5800; harmless try on MA5600T builds that support it
        await step('config');
        await step('gpon ont home-gateway config-method omci');
        await step('quit');

        await this.config(io, `interface gpon 0/${point.slot}`);

        if (!params.enable) {
          await tryCmds([
            `undo ont tr069-server-config ${point.port} ${point.ontId}`,
            `undo ont tr069-server-config ${point.port} ${point.ontId} profile-id 0`,
          ]);
          await tryCmds([
            `undo ont ipconfig ${point.port} ${point.ontId} ip-index 0`,
            `undo ont wan-config ${point.port} ${point.ontId} ip-index 0`,
          ]);
          await step('quit');
          return {
            ok: true as const,
            message: `TR069 OMCI desactivado (${family})`,
            cliLog: logs.join('\n'),
            firmwareFamily: family,
          };
        }

        const user = acsUser;
        const pass = acsPass;
        const urlVariants = buildHuaweiAcsUrlVariants(acsEndpoint);

        await step('quit');
        await step('config');

        await io.send('display ont tr069-server-profile all');
        const profilesOut = await io.read(20_000);
        logs.push(
          `display profiles → ${profilesOut.replace(/\s+/g, ' ').slice(0, 220)}`,
        );

        let profileId =
          parseExistingTr069ProfileId(profilesOut, acsEndpoint) ?? null;
        if (profileId == null) {
          profileId = nextFreeProfileId(profilesOut, 20);
          let created = false;
          for (const acsUrl of urlVariants) {
            const addCmds = buildTr069ProfileAddCommands({
              profileId,
              profileName: 'isp-acs',
              acsUrl,
              username: user,
              password: pass,
              family,
            });
            const res = await tryCmds(addCmds);
            if (res.ok) {
              created = true;
              logs.push(`profile-id ${profileId} created with ${acsUrl}`);
              break;
            }
          }
          if (!created) {
            logs.push(
              'profile create failed — will try bind with id 1/20/existing',
            );
          }
        } else {
          logs.push(`reusing profile-id ${profileId}`);
        }

        const bindIds = [profileId, 20, 1, 2, 3].filter(
          (v, i, a) => v != null && a.indexOf(v) === i,
        );

        // ONT cmds under interface gpon
        await step(`interface gpon 0/${point.slot}`);

        // Mgmt IP / VLAN for TR069 WAN (ip-index 0)
        if (params.mgmtVlan != null) {
          const ipCmds = buildOntIpconfigCommands({
            port: point.port,
            ontId: point.ontId,
            ipIndex: 0,
            vlan: params.mgmtVlan,
            priority: 5,
            mode: params.mgmtIp && params.mgmtMask ? 'static' : 'dhcp',
            ip: params.mgmtIp,
            mask: params.mgmtMask,
            gateway: params.mgmtGateway,
            family,
          });
          await tryCmds(ipCmds);
        }

        // Best-effort: enable tr069-management on the ONT's line profile
        await this.ensureTr069OnLineProfile(io, step, point, logs);

        // MA5800: bind TR069 WAN profile on ip-index 0 (NOT internet-config)
        if (family === 'ma5800' || family === 'unknown') {
          await tryCmds([
            `ont wan-config ${point.port} ${point.ontId} ip-index 0 profile-id 0`,
            `ont wan-config ${point.port} ${point.ontId} ip-index 0 profile-name tr069`,
          ]);
        }

        let bound = false;
        for (const id of bindIds) {
          const out = await step(
            `ont tr069-server-config ${point.port} ${point.ontId} profile-id ${id}`,
          );
          if (!cliRejected(out)) {
            bound = true;
            logs.push(`bound profile-id ${id}`);
            break;
          }
        }
        // Last-resort legacy: inline ACS (rare firmwares)
        if (!bound) {
          for (const acsUrl of urlVariants.slice(0, 2)) {
            const out = await step(
              `ont tr069-server-config ${point.port} ${point.ontId} ${acsUrl} ${user} ${pass}`,
            );
            if (!cliRejected(out)) {
              bound = true;
              break;
            }
          }
        }
        if (!bound) {
          throw new Error(
            `OLT rechazó ont tr069-server-config (${family}). Revisa perfil ACS y lineprofile tr069-management.`,
          );
        }

        await step('quit');

        // service-port is global (config)# — mgmt uses gemport 2 (wan keeps gemport 1)
        if (params.mgmtVlan != null) {
          await tryCmds([
            `service-port vlan ${params.mgmtVlan} gpon 0/${point.slot}/${point.port} ont ${point.ontId} gemport 2 multi-service user-vlan ${params.mgmtVlan} tag-transform translate`,
            `service-port vlan ${params.mgmtVlan} gpon 0/${point.slot}/${point.port} ont ${point.ontId} gemport 3 multi-service user-vlan ${params.mgmtVlan} tag-transform translate`,
          ]);
        }

        this.logger.log(
          `Huawei OMCI TR069 OK ${params.onuIf} (${family}) in ${Date.now() - t0}ms`,
        );
        return {
          ok: true as const,
          message: `TR069 ACS aplicado por OMCI (${family}) en ${params.onuIf}`,
          cliLog: logs.join('\n'),
          firmwareFamily: family,
        };
      });
    } catch (error) {
      this.logger.warn(
        `Huawei OMCI TR069 FAIL ${params.onuIf}: ${this.message(error)}`,
      );
      return {
        ok: false,
        error: this.message(error),
        cliLog: logs.join('\n'),
      };
    }
  }

  async applyOnuServiceVlans(
    params: CliParams & {
      onuIf: string;
      wanVlan?: number | null;
      mgmtVlan?: number | null;
      internetTcontProfile?: string | null;
      firmwareHint?: string | null;
      subtypeHint?: string | null;
    },
  ) {
    const point = parseHuaweiOnuIf(params.onuIf);
    if (!point) return { ok: false, error: 'Interfaz ONU Huawei inválida' };
    const touchWan = params.wanVlan !== undefined;
    const touchMgmt = params.mgmtVlan !== undefined;
    if (!touchWan && !touchMgmt) {
      return { ok: true, message: 'sin cambios de VLAN en OLT' };
    }
    return this.write(params, async (io) => {
      const family = await this.resolveFwFamily(io, params);
      await this.config(io);
      const notes: string[] = [`dialect=${family}`];
      const upsert = async (
        vlan: number | null | undefined,
        label: string,
        gemport: number,
      ) => {
        if (vlan === undefined) return;
        await io.send(
          `display service-port port 0/${point.slot}/${point.port} ont ${point.ontId}`,
        );
        const existing = await io.read();
        const byGem = parseServicePortIndexesByGemport(existing, gemport);
        const byVlan =
          vlan != null ? parseServicePortIndexesByVlan(existing, vlan) : [];
        const indexes = [...new Set([...byGem, ...byVlan])].slice(0, 8);
        for (const idx of indexes) {
          await io.send(`undo service-port ${idx}`);
          await io.read();
        }
        if (vlan == null) {
          notes.push(
            indexes.length
              ? `${label}: service-ports gem${gemport} limpiados`
              : `${label}: sin service-port gem${gemport} (nada que quitar)`,
          );
          return;
        }
        let created = false;
        for (const gem of [
          gemport,
          ...[1, 2, 3].filter((g) => g !== gemport),
        ]) {
          await io.send(
            `service-port vlan ${vlan} gpon 0/${point.slot}/${point.port} ont ${point.ontId} gemport ${gem} multi-service user-vlan ${vlan} tag-transform translate`,
          );
          const out = await io.read();
          if (!cliRejected(out)) {
            created = true;
            break;
          }
        }
        if (!created) {
          notes.push(`${label}: OLT rechazó service-port VLAN ${vlan}`);
          return;
        }
        if (label === 'wan') {
          await io.send(`interface gpon 0/${point.slot}`);
          await io.read();
          await io.send(
            `ont port native-vlan ${point.port} ${point.ontId} eth 1 vlan ${vlan} priority 0`,
          );
          await io.read();
          await io.send('quit');
          await io.read();
        }
        notes.push(`${label}: VLAN ${vlan}`);
      };
      await upsert(params.wanVlan, 'wan', 1);
      await upsert(params.mgmtVlan, 'mgmt', 2);
      await io.send('quit');
      await io.read();
      return notes.join('; ') || 'VLAN service-port actualizado';
    });
  }

  /**
   * Ligar un puerto ETH de la ONT a una VLAN (native-vlan + service-port IPTV).
   * Misma semántica que ZTE `applyOnuEthPortVlan`: gemport 3 = IPTV
   * (1=WAN, 2=mgmt). No toca service-ports WAN/mgmt existentes.
   */
  async applyOnuEthPortVlan(
    params: CliParams & {
      onuIf: string;
      /** 1-based eth port id on the ONT */
      portIndex: number;
      vlanId: number | null;
      mode?: 'tag' | 'untag' | 'hybrid';
      firmwareHint?: string | null;
      subtypeHint?: string | null;
    },
  ): Promise<{ ok: boolean; error?: string; message?: string }> {
    const point = parseHuaweiOnuIf(params.onuIf);
    if (!point) return { ok: false, error: 'Interfaz ONU Huawei inválida' };
    if (
      !Number.isInteger(params.portIndex) ||
      params.portIndex < 1 ||
      params.portIndex > 128
    ) {
      return { ok: false, error: 'Índice de puerto Ethernet inválido' };
    }
    /** IPTV / bridge: gemport 3 (1=WAN, 2=mgmt), igual que ZTE. */
    const iptvGem = 3;
    const ethLabel = `eth ${params.portIndex}`;
    this.logger.log(
      `ONU eth VLAN ${params.onuIf} ${ethLabel} → ${
        params.vlanId == null ? 'quitar' : `native-vlan ${params.vlanId}`
      }`,
    );
    return this.write(params, async (io) => {
      const notes: string[] = [];
      await this.config(io);

      if (params.vlanId != null) {
        await io.send(
          `display service-port port 0/${point.slot}/${point.port} ont ${point.ontId}`,
        );
        const existing = await io.read();
        const byVlan = parseServicePortIndexesByVlan(existing, params.vlanId);
        if (byVlan.length === 0) {
          let created = false;
          for (const gem of [
            iptvGem,
            ...[1, 2, 3].filter((g) => g !== iptvGem),
          ]) {
            await io.send(
              `service-port vlan ${params.vlanId} gpon 0/${point.slot}/${point.port} ont ${point.ontId} gemport ${gem} multi-service user-vlan ${params.vlanId} tag-transform translate`,
            );
            const out = await io.read();
            if (!cliRejected(out)) {
              created = true;
              notes.push(`service-port VLAN ${params.vlanId} gem${gem}`);
              break;
            }
          }
          if (!created) {
            throw new Error(
              `OLT rechazó service-port VLAN ${params.vlanId} para IPTV`,
            );
          }
        } else {
          notes.push(`service-port VLAN ${params.vlanId} ya existía`);
        }
      }

      await io.send(`interface gpon 0/${point.slot}`);
      this.throwIfCliError(await io.read());
      if (params.vlanId != null) {
        await io.send(
          `ont port native-vlan ${point.port} ${point.ontId} eth ${params.portIndex} vlan ${params.vlanId} priority 0`,
        );
        const out = await io.read();
        if (cliRejected(out)) {
          throw new Error(
            `OLT rechazó native-vlan eth ${params.portIndex}: ${out
              .replace(/\s+/g, ' ')
              .slice(0, 160)}`,
          );
        }
      } else {
        await io.send(
          `undo ont port native-vlan ${point.port} ${point.ontId} eth ${params.portIndex}`,
        );
        const out = await io.read();
        // Si no había native-vlan, algunos firmwares avisan — no es fallo duro.
        if (cliRejected(out) && !/does not exist|not exist|no such/i.test(out)) {
          throw new Error(
            `OLT rechazó undo native-vlan eth ${params.portIndex}: ${out
              .replace(/\s+/g, ' ')
              .slice(0, 160)}`,
          );
        }
      }
      await io.send('quit');
      await io.read();

      return params.vlanId != null
        ? `${ethLabel} → VLAN ${params.vlanId}${
            notes.length ? ` · ${notes.join(' · ')}` : ''
          }`
        : `${ethLabel} VLAN cleared${
            notes.length ? ` · ${notes.join(' · ')}` : ''
          }`;
    });
  }

  /** Lee native-vlan / port-attribute de los ETH de la ONT. */
  async getOmciEthPortVlans(
    params: CliParams & {
      onuIf: string;
      firmwareHint?: string | null;
      subtypeHint?: string | null;
    },
  ): Promise<{
    ok: boolean;
    ports: Array<{
      portIndex: number;
      mode: 'tag' | 'untag' | 'hybrid';
      vlanId: number | null;
    }>;
    error?: string;
  }> {
    const point = parseHuaweiOnuIf(params.onuIf);
    if (!point) {
      return { ok: false, ports: [], error: 'Interfaz ONU Huawei inválida' };
    }
    try {
      const ports = await this.run(params, false, async (io) => {
        const chunks: string[] = [];
        const tryCmd = async (cmd: string) => {
          await io.send(cmd);
          const out = await io.read();
          chunks.push(out);
          return out;
        };
        // Variantes según firmware MA56xx / MA58xx.
        await tryCmd(
          `display ont port attribute 0/${point.slot}/${point.port} ${point.ontId}`,
        );
        await this.config(io, `interface gpon 0/${point.slot}`);
        await tryCmd(
          `display ont port attribute ${point.port} ${point.ontId}`,
        );
        await tryCmd(
          `display ont port native-vlan ${point.port} ${point.ontId}`,
        );
        await io.send('quit');
        await io.read().catch(() => '');
        return parseHuaweiOntEthPortVlans(chunks.join('\n')).map((p) => ({
          portIndex: p.portIndex,
          vlanId: p.vlanId,
          mode: (p.mode ?? 'untag') as 'tag' | 'untag' | 'hybrid',
        }));
      });
      return { ok: true, ports };
    } catch (error) {
      return {
        ok: false,
        ports: [],
        error: this.message(error),
      };
    }
  }

  async applyOnuWanStaticOmci(
    params: CliParams & {
      onuIf: string;
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
    },
  ) {
    const point = parseHuaweiOnuIf(params.onuIf);
    if (!point) return { ok: false, error: 'Interfaz ONU Huawei inválida' };
    const logs: string[] = [];
    return this.write(params, async (io) => {
      const step = async (cmd: string) => {
        await io.send(cmd);
        const out = await io.read();
        logs.push(`${cmd} → ${out.replace(/\s+/g, ' ').slice(0, 160)}`);
        return out;
      };
      const tryCmds = async (cmds: string[]) => {
        for (const cmd of cmds) {
          const out = await step(cmd);
          if (!cliRejected(out)) return true;
        }
        return false;
      };

      const family = await this.resolveFwFamily(io, params, logs);

      await step('config');
      await step('gpon ont home-gateway config-method omci');
      await step('quit');

      await this.config(io, `interface gpon 0/${point.slot}`);
      if (params.wan == null) {
        await tryCmds([
          `undo ont ipconfig ${point.port} ${point.ontId} ip-index 1`,
          `undo ont internet-config ${point.port} ${point.ontId}`,
          `undo ont wan-config ${point.port} ${point.ontId} ip-index 1`,
        ]);
        await step('quit');
        return `WAN OMCI eliminada (${family})`;
      }

      const w = params.wan;
      const okIp = await tryCmds(
        buildOntIpconfigCommands({
          port: point.port,
          ontId: point.ontId,
          ipIndex: 1,
          vlan: w.wanVlan,
          priority: 0,
          mode: 'static',
          ip: w.wanIp,
          mask: w.wanMask,
          gateway: w.wanGateway,
          family,
        }),
      );
      if (!okIp) {
        throw new Error(`OLT rechazó ont ipconfig WAN (${family})`);
      }

      await tryCmds([
        `ont internet-config ${point.port} ${point.ontId} ip-index 1`,
        `ont wan-config ${point.port} ${point.ontId} ip-index 1 profile-id 0`,
      ]);
      await step('quit');

      // service-port global (config)#
      const spOk = await tryCmds([
        `service-port vlan ${w.wanVlan} gpon 0/${point.slot}/${point.port} ont ${point.ontId} gemport 1 multi-service user-vlan ${w.wanVlan} tag-transform translate`,
      ]);
      if (!spOk) {
        logs.push('service-port WAN rechazado (ipconfig puede seguir OK)');
      }
      return `WAN estática ${w.wanIp} vlan ${w.wanVlan} (${family})`;
    });
  }

  /** Best-effort enable tr069-management on the ONT line profile. */
  private async ensureTr069OnLineProfile(
    io: CliIo,
    step: (cmd: string, waitMs?: number) => Promise<string>,
    point: {
      slot: string | number;
      port: string | number;
      ontId: string | number;
    },
    logs: string[],
  ): Promise<void> {
    let leftInterface = false;
    try {
      await io.send(
        `display ont info 0/${point.slot}/${point.port} ${point.ontId}`,
      );
      const info = await io.read(15_000);
      const lineId = parseOntLineProfileId(info);
      if (lineId == null) {
        logs.push('lineprofile id not found — skip tr069-management');
        return;
      }
      await step('quit'); // leave interface → (config)#
      leftInterface = true;
      await step(`ont-lineprofile gpon profile-id ${lineId}`);
      const cur = await step('display this');
      if (/tr069-management\s+enable/i.test(cur)) {
        logs.push(`lineprofile ${lineId}: tr069-management already on`);
        await step('quit');
      } else {
        await step('tr069-management ip-index 0');
        await step('tr069-management enable');
        await step('commit');
        await step('quit');
        logs.push(`lineprofile ${lineId}: tr069-management enable`);
      }
    } catch (err) {
      logs.push(
        `lineprofile tr069-management skip: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (leftInterface) {
      await step(`interface gpon 0/${point.slot}`);
    }
  }

  /**
   * Resolve MA5600T vs MA5800 dialect: cache → display version → subtype hint.
   */
  private async resolveFwFamily(
    io: CliIo,
    params: {
      host: string;
      port: number;
      firmwareHint?: string | null;
      subtypeHint?: string | null;
    },
    logs?: string[],
  ): Promise<HuaweiFwFamily> {
    const key = this.fwCacheKey(params.host, params.port);
    const cached = this.fwCache.get(key);
    if (cached && Date.now() - cached.atMs < 5 * 60_000) {
      return cached.family;
    }

    const hintText =
      stripHuaweiDialectTag(params.firmwareHint) ?? params.firmwareHint;
    const fromHint = detectHuaweiFwFamily({
      subtype: params.subtypeHint,
      softVer: hintText,
      product: hintText,
      versionText: params.firmwareHint,
    });

    try {
      await io.send('display version');
      const version = await io.read(15_000);
      logs?.push(
        `display version → ${version.replace(/\s+/g, ' ').slice(0, 200)}`,
      );
      const parsed = parseHuaweiVersionBanner(version);
      const family =
        parsed.family !== 'unknown'
          ? parsed.family
          : fromHint !== 'unknown'
            ? fromHint
            : 'unknown';
      this.fwCache.set(key, {
        family,
        softVer: parsed.softVer,
        product: parsed.product,
        atMs: Date.now(),
      });
      this.logger.log(
        `Huawei FW detect ${params.host}: ${family} product=${parsed.product ?? '-'} soft=${parsed.softVer ?? '-'}`,
      );
      return family;
    } catch (err) {
      logs?.push(
        `display version fail → hint=${fromHint}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (fromHint !== 'unknown') {
        this.fwCache.set(key, {
          family: fromHint,
          softVer: null,
          product: null,
          atMs: Date.now(),
        });
        return fromHint;
      }
      return 'unknown';
    }
  }

  async sampleOnuTrafficRates(params: CliParams & { onuIfs: string[] }) {
    const probedAt = new Date().toISOString();
    try {
      const rates = await this.run(params, false, async (io) => {
        const rows = [];
        for (const onuIf of params.onuIfs) {
          const point = parseHuaweiOnuIf(onuIf);
          if (!point) continue;
          await io.send(
            `display ont traffic 0/${point.slot}/${point.port} ${point.ontId}`,
          );
          const out = await io.read();
          this.throwIfCliError(out);
          rows.push({ onuIf, ...parseHuaweiTrafficRates(out) });
        }
        return rows;
      });
      return { ok: true, rates, probedAt };
    } catch (error) {
      return { ok: false, error: this.message(error), rates: [], probedAt };
    }
  }
  async getOnuLiveTraffic(params: CliParams & { onuIf: string }) {
    const sampled = await this.sampleOnuTrafficRates({
      ...params,
      onuIfs: [params.onuIf],
    });
    const rate = sampled.rates[0];
    if (!sampled.ok || !rate) {
      return {
        ok: false,
        error:
          sampled.error ??
          'Huawei no devolvió contadores de tráfico para la ONU',
        probedAt: sampled.probedAt,
      };
    }
    return { ok: true, ...rate, probedAt: sampled.probedAt };
  }
  async getOnuStatusReport(params: CliParams & { onuIf: string }) {
    const detail = await this.getConnectedOnuDetail(params);
    return {
      ok: detail.ok,
      error: detail.error,
      report: detail.onu?.detailInfoRaw,
      runningConfig: '',
      probedAt: detail.probedAt,
    };
  }
  async getOnuSwInfo(params: CliParams & { onuIf: string }) {
    const point = parseHuaweiOnuIf(params.onuIf);
    if (!point) {
      return {
        ok: false,
        error: 'Interfaz ONU Huawei inválida',
        probedAt: new Date().toISOString(),
      };
    }
    try {
      const equip = await this.run(params, false, async (io) => {
        await io.send(
          `display ont version 0/${point.slot}/${point.port} ${point.ontId}`,
        );
        const out = await io.read();
        return {
          vendor: out.match(/Vendor\s*ID\s*[:=]\s*(\S+)/i)?.[1] ?? null,
          model:
            out.match(/(?:Equipment|ONT)\s*ID\s*[:=]\s*(\S+)/i)?.[1] ?? null,
          softVer:
            out.match(/(?:Main|Software)\s*SoftVer\s*[:=]\s*(\S+)/i)?.[1] ??
            null,
          raw: out.slice(0, 2000),
        };
      });
      return { ok: true, equip, probedAt: new Date().toISOString() };
    } catch (error) {
      return {
        ok: false,
        error: this.message(error),
        probedAt: new Date().toISOString(),
      };
    }
  }

  private async onuAction(
    params: CliParams & { onuIf: string },
    action: string,
    message: string,
  ) {
    const point = parseHuaweiOnuIf(params.onuIf);
    if (!point) return { ok: false, error: 'Interfaz ONU Huawei inválida' };
    return this.write(params, async (io) => {
      await this.config(
        io,
        `interface gpon 0/${point.slot}`,
        `${action} ${point.port} ${point.ontId}`,
      );
      await io.read();
      await io.send('quit');
      await io.read();
      return message;
    });
  }
  private async modifyOnu(
    params: CliParams & { onuIf: string },
    description: string,
  ) {
    const point = parseHuaweiOnuIf(params.onuIf);
    if (!point) return { ok: false, error: 'Interfaz ONU Huawei inválida' };
    return this.write(params, async (io) => {
      await this.config(
        io,
        `interface gpon 0/${point.slot}`,
        `ont modify ${point.port} ${point.ontId} desc "${this.escape(description)}"`,
      );
      await io.read();
      await io.send('quit');
      await io.read();
      return `Descripción de ONU actualizada`;
    });
  }
  private async display<T>(
    params: CliParams,
    command: string,
    parser: (output: string) => T,
  ): Promise<T> {
    return this.run(params, false, async (io) => {
      await io.send(command);
      return parser(await io.read());
    });
  }
  private async config(io: CliIo, ...commands: string[]) {
    await io.send('enable');
    this.throwIfCliError(await io.read());
    await io.send('config');
    this.throwIfCliError(await io.read());
    for (const command of commands) {
      await io.send(command);
      this.throwIfCliError(await io.read());
    }
  }
  private async write(params: CliParams, fn: (io: CliIo) => Promise<string>) {
    try {
      const message = await this.run(params, true, fn);
      return { ok: true, message };
    } catch (error) {
      return { ok: false, error: this.message(error) };
    }
  }
  private async run<T>(
    params: CliParams,
    save: boolean,
    fn: (io: CliIo) => Promise<T>,
  ): Promise<T> {
    return this.withCliLock(params, async () => {
      const io = await this.open(params);
      try {
        const result = await fn(io);
        if (save) {
          await io.send('save');
          const out = await io.read();
          if (/\[(?:Y\/N|yes\/no)\]/i.test(out)) {
            await io.send('y');
            await io.read();
          }
        }
        return result;
      } finally {
        await io.send('quit').catch(() => undefined);
      }
    });
  }
  private async withCliLock<T>(
    params: CliParams,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = `${params.host}:${params.port}`;
    let queue = this.queues.get(key);
    if (!queue) {
      queue = { interactive: [], background: [], pumping: false };
      this.queues.set(key, queue);
    }
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        try {
          resolve(await fn());
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      (params.priority === 'background'
        ? queue.background
        : queue.interactive
      ).push(run);
      if (!queue.pumping) {
        queue.pumping = true;
        void this.pumpCliQueue(key, queue);
      }
    });
  }
  private async pumpCliQueue(
    key: string,
    queue: {
      interactive: Array<() => Promise<void>>;
      background: Array<() => Promise<void>>;
      pumping: boolean;
    },
  ) {
    try {
      for (;;) {
        const next = queue.interactive.shift() ?? queue.background.shift();
        if (!next) break;
        await next();
      }
    } finally {
      queue.pumping = false;
      if (queue.interactive.length || queue.background.length) {
        queue.pumping = true;
        void this.pumpCliQueue(key, queue);
      } else if (this.queues.get(key) === queue) {
        this.queues.delete(key);
      }
    }
  }
  private async open(params: CliParams): Promise<CliIo> {
    const channel =
      params.protocol === 'ssh'
        ? await this.openSsh(params)
        : await this.openTelnet(params);
    let buffer = '';
    let waiter: {
      test: (text: string) => boolean;
      resolve: (text: string) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    } | null = null;
    channel.on('data', (data: Buffer) => {
      buffer += data.toString();
      if (waiter && waiter.test(buffer)) {
        const current = waiter;
        waiter = null;
        clearTimeout(current.timer);
        const out = buffer;
        buffer = '';
        current.resolve(out);
      }
    });
    channel.once('error', (error: Error) => {
      if (!waiter) return;
      const current = waiter;
      waiter = null;
      clearTimeout(current.timer);
      current.reject(error);
    });
    channel.once('close', () => {
      if (!waiter) return;
      const current = waiter;
      waiter = null;
      clearTimeout(current.timer);
      current.reject(new Error('Conexión CLI Huawei cerrada'));
    });
    const waitFor = (test: (text: string) => boolean, timeout = 15_000) =>
      new Promise<string>((resolve, reject) => {
        const done = () => {
          if (waiter) {
            const current = waiter;
            waiter = null;
            clearTimeout(current.timer);
            current.resolve(buffer);
            buffer = '';
          }
        };
        const timer = setTimeout(() => {
          waiter = null;
          reject(new Error('Tiempo de espera de CLI Huawei'));
        }, timeout);
        waiter = { test, resolve, reject, timer };
        if (test(buffer)) done();
      });
    const prompt = (text: string) =>
      /(?:^|\n)[^\r\n]*?(?:\([^)\r\n]*\))?[#>]\s*$/m.test(text);
    const read = (timeout = 15_000) => waitFor(prompt, timeout);
    if (params.protocol === 'telnet') {
      await waitFor((text) => /(?:username|login)\s*[:>]/i.test(text));
      await new Promise<void>((resolve) => {
        channel.write(`${params.username}\n`, () => resolve());
      });
      await waitFor((text) => /password\s*[:>]/i.test(text));
      await new Promise<void>((resolve) => {
        channel.write(`${params.password}\n`, () => resolve());
      });
    }
    await read(15_000);
    await new Promise<void>((resolve) => {
      channel.write('scroll 512\n', () => resolve());
    });
    await read().catch(() => '');
    return {
      send: (command) =>
        new Promise<void>((resolve) => {
          channel.write(`${command}\n`, () => resolve());
        }),
      read,
    };
  }
  private openTelnet(params: CliParams): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(params.port, params.host);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Timeout de conexión Telnet Huawei'));
      }, 15_000);
      socket.setTimeout(30_000, () => {
        socket.destroy(new Error('Timeout de inactividad Telnet Huawei'));
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
  private openSsh(params: CliParams): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      const client = new SshClient();
      client.on('ready', () =>
        client.shell((err, stream) => (err ? reject(err) : resolve(stream))),
      );
      client.on('error', reject).connect({
        ...sshHostVerification(params.host, params.port),
        host: params.host,
        port: params.port,
        username: params.username,
        password: params.password,
        readyTimeout: 15_000,
      });
    });
  }
  private hostname(text: string) {
    return text.match(/^\s*([A-Za-z0-9_.-]+)[#>]\s*$/m)?.[1];
  }
  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  private throwIfCliError(output: string) {
    if (cliRejected(output)) {
      throw new Error(output.replace(/\s+/g, ' ').slice(0, 240));
    }
  }
  private escape(value: string) {
    return value.replace(/["\r\n]/g, ' ').slice(0, 64);
  }
  private redactSecrets(value: string, secrets: string[]) {
    return secrets
      .filter(Boolean)
      .reduce((safe, secret) => safe.split(secret).join('[REDACTED]'), value);
  }
  private vlans(value?: string) {
    return (value || '')
      .split(/[,\s]+/)
      .map(Number)
      .filter((v) => Number.isInteger(v) && v > 0 && v < 4095);
  }
}

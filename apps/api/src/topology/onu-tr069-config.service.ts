import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import {
  GenieAcsNbiClient,
  boolVal,
  genieChildIndices,
  genieGet,
  resolveNbiBaseUrl,
  strVal,
} from './genieacs-nbi.client';
import { IpPoolService } from './ip-pool.service';
import { ZteOltClient } from './zte-olt.client';
import {
  DEFAULT_OLT_PORTS,
  isZteOltDevice,
} from './olt.constants';
import { computeIpNetwork } from './ip-pool.util';
import type { NetworkDevice } from './entities/network-device.entity';
import type { Tr069Profile } from './entities/tr069-profile.entity';

function prefixToMask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return [
    (mask >>> 24) & 255,
    (mask >>> 16) & 255,
    (mask >>> 8) & 255,
    mask & 255,
  ].join('.');
}

function acsEndpointFromUrl(acsUrl: string, fallbackPort: number): string {
  try {
    const u = new URL(acsUrl);
    const port = u.port || String(fallbackPort || 14501);
    return `${u.hostname}:${port}`;
  } catch {
    return acsUrl.replace(/^https?:\/\//i, '');
  }
}

export type Tr069WifiRadio = {
  index: number;
  pathPrefix: string;
  ssidPath: string;
  keyPath: string | null;
  enablePath: string | null;
  ssid: string | null;
  key: string | null;
  enabled: boolean | null;
  channel: string | null;
  standard: string | null;
};

export type Tr069EthPort = {
  index: number;
  pathPrefix: string;
  enablePath: string | null;
  name: string | null;
  enabled: boolean | null;
  status: string | null;
  mac: string | null;
};

export type Tr069WebUser = {
  index: number;
  pathPrefix: string;
  usernamePath: string;
  passwordPath: string;
  username: string | null;
  password: string | null;
  enablePath: string | null;
  enabled: boolean | null;
};

export type Tr069OnuConfigView = {
  onuId: string;
  sn: string | null;
  mgmtIp: string | null;
  acsDeviceId: string | null;
  inAcs: boolean;
  lastInform: string | null;
  model: string | null;
  manufacturer: string | null;
  softwareVersion: string | null;
  dataModel: 'tr098' | 'tr181' | 'unknown';
  wifi: Tr069WifiRadio[];
  ethernet: Tr069EthPort[];
  webUsers: Tr069WebUser[];
  message: string | null;
};

@Injectable()
export class OnuTr069ConfigService {
  private readonly logger = new Logger(OnuTr069ConfigService.name);

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly ipPools: IpPoolService,
    private readonly zteOlt: ZteOltClient,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  private nbi(): GenieAcsNbiClient {
    return new GenieAcsNbiClient(resolveNbiBaseUrl());
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Prefer profiles attached to the OLT; otherwise first tenant profile. */
  private async resolveDefaultTr069Profile(
    schema: string,
    oltId: string,
  ): Promise<Tr069Profile | null> {
    const profileRepo =
      await this.tenantConnections.getTr069ProfileRepository(schema);
    const joinRepo =
      await this.tenantConnections.getTr069ProfileOltRepository(schema);
    const attached = await joinRepo.find({ where: { deviceId: oltId } });
    if (attached.length > 0) {
      const profiles = await profileRepo.find({
        where: { id: In(attached.map((a) => a.profileId)) },
        order: { name: 'ASC' },
      });
      return profiles[0] ?? null;
    }
    const any = await profileRepo.find({
      order: { name: 'ASC' },
      take: 1,
    });
    return any[0] ?? null;
  }

  private zteConn(olt: NetworkDevice) {
    const protocol: 'telnet' | 'ssh' =
      olt.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
    return {
      host: olt.mgmtHost!,
      port:
        olt.mgmtPort ??
        (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet),
      protocol,
      username: olt.mgmtUsername!,
      password: olt.mgmtPassword!,
    };
  }

  /**
   * Enable/disable TR069: profile + mgmt IP in DB, then OMCI push ACS URL on ZTE.
   */
  async setOnuTr069(
    user: AuthUser,
    onuId: string,
    enabled: boolean,
    profileId?: string,
    vlanId?: number,
  ) {
    const schema = this.requireSchema(user);
    const db = await this.ipPools.setOnuTr069(
      user,
      onuId,
      enabled,
      profileId,
      vlanId,
    );

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    let omciOk: boolean | null = null;
    let omciMessage: string | null = null;

    try {
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
      if (!olt || !isZteOltDevice(olt.type, olt.subtype)) {
        omciOk = false;
        omciMessage =
          'TR069 guardado en DB, pero la OLT no es ZTE — OMCI no aplicado';
      } else if (!olt.mgmtHost || !olt.mgmtUsername || !olt.mgmtPassword) {
        omciOk = false;
        omciMessage =
          'TR069 en DB, pero la OLT no tiene credenciales — no se pudo empujar ACS por OMCI';
      } else {
        const protocol: 'telnet' | 'ssh' =
          olt.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
        const port =
          olt.mgmtPort ??
          (protocol === 'ssh'
            ? DEFAULT_OLT_PORTS.ssh
            : DEFAULT_OLT_PORTS.telnet);

        let acsEndpoint: string | undefined;
        let acsUsername: string | undefined;
        let acsPassword: string | undefined;
        let mgmtMask: string | null = null;
        let mgmtGateway: string | null = null;
        // Management VLAN comes from the IP pool — never from onu.vlan (WAN).
        let mgmtVlan: number | null = null;

        if (enabled && db.tr069ProfileId) {
          const profileRepo =
            await this.tenantConnections.getTr069ProfileRepository(schema);
          const profile = await profileRepo.findOne({
            where: { id: db.tr069ProfileId },
          });
          if (profile) {
            acsEndpoint = acsEndpointFromUrl(profile.acsUrl, profile.acsPort);
            acsUsername = profile.acsUsername;
            acsPassword = profile.acsPassword;
          }
          if (onu.mgmtPoolId) {
            const poolRepo =
              await this.tenantConnections.getIpPoolRepository(schema);
            const pool = await poolRepo.findOne({
              where: { id: onu.mgmtPoolId },
            });
            if (pool) {
              mgmtGateway = pool.gateway;
              mgmtMask = prefixToMask(pool.prefix);
              mgmtVlan = pool.vlanId;
              try {
                computeIpNetwork(pool.gateway, pool.prefix);
              } catch {
                /* ignore */
              }
            }
          } else if (vlanId != null) {
            // Explicit management VLAN only (caller must not pass WAN vlan).
            mgmtVlan = vlanId;
          }
        }

        const omciPromise = this.zteOlt.applyOnuTr069Mgmt({
          host: olt.mgmtHost,
          port,
          protocol,
          username: olt.mgmtUsername,
          password: olt.mgmtPassword,
          onuIf: onu.onuIf,
          enable: enabled,
          acsEndpoint,
          acsUsername,
          acsPassword,
          mgmtIp: db.mgmtIp,
          mgmtMask,
          mgmtGateway,
          mgmtVlan,
        });
        const omci = await Promise.race([
          omciPromise,
          new Promise<{ ok: false; error: string }>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: false,
                  error:
                    'Timeout OMCI (90s). Suele ser VTY ocupada por el poll de inventario o write colgado — reintenta.',
                }),
              90_000,
            ),
          ),
        ]);
        omciOk = omci.ok;
        omciMessage = omci.ok
          ? ('message' in omci ? omci.message : null) ?? 'OMCI OK'
          : omci.error ?? 'OMCI falló';
        if (!omci.ok && 'cliLog' in omci && omci.cliLog) {
          omciMessage = `${omciMessage} | ${String(omci.cliLog).slice(-300)}`;
        }
      }
    } catch (e) {
      omciOk = false;
      omciMessage = e instanceof Error ? e.message : String(e);
    }

    return {
      ...db,
      omciOk,
      omciMessage,
      message: enabled
        ? omciOk
          ? `TR069 activo · Mgmt ${db.mgmtIp} · ACS empujado por OMCI. Esperando Inform…`
          : `TR069 activo en DB · Mgmt ${db.mgmtIp}, pero OMCI falló: ${omciMessage}. Sin ACS URL en la ONU no habrá Inform.`
        : omciOk
          ? 'TR069 desactivado (DB + OMCI)'
          : `TR069 desactivado en DB; OMCI: ${omciMessage}`,
    };
  }

  private parseDevice(device: Record<string, unknown>): {
    dataModel: 'tr098' | 'tr181' | 'unknown';
    wifi: Tr069WifiRadio[];
    ethernet: Tr069EthPort[];
    webUsers: Tr069WebUser[];
    model: string | null;
    manufacturer: string | null;
    softwareVersion: string | null;
    lastInform: string | null;
  } {
    const hasIgd = !!device.InternetGatewayDevice;
    const hasDev = !!device.Device;
    const dataModel: 'tr098' | 'tr181' | 'unknown' = hasIgd
      ? 'tr098'
      : hasDev
        ? 'tr181'
        : 'unknown';

    const wifi: Tr069WifiRadio[] = [];
    const ethernet: Tr069EthPort[] = [];
    const webUsers: Tr069WebUser[] = [];

    // —— TR-098 WiFi ——
    const wlanBase = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration';
    for (const i of genieChildIndices(device, wlanBase)) {
      const prefix = `${wlanBase}.${i}`;
      const keyCandidates = [
        `${prefix}.KeyPassphrase`,
        `${prefix}.PreSharedKey.1.PreSharedKey`,
        `${prefix}.PreSharedKey.1.KeyPassphrase`,
      ];
      let keyPath: string | null = null;
      let key: string | null = null;
      for (const kp of keyCandidates) {
        const v = strVal(genieGet(device, kp));
        if (v != null || genieGet(device, kp)) {
          keyPath = kp;
          key = v;
          break;
        }
      }
      wifi.push({
        index: i,
        pathPrefix: prefix,
        ssidPath: `${prefix}.SSID`,
        keyPath,
        enablePath: `${prefix}.Enable`,
        ssid: strVal(genieGet(device, `${prefix}.SSID`)),
        key,
        enabled: boolVal(genieGet(device, `${prefix}.Enable`)),
        channel: strVal(genieGet(device, `${prefix}.Channel`)),
        standard: strVal(genieGet(device, `${prefix}.Standard`)),
      });
    }

    // —— TR-181 WiFi ——
    if (wifi.length === 0) {
      const ssidBase = 'Device.WiFi.SSID';
      for (const i of genieChildIndices(device, ssidBase)) {
        const prefix = `${ssidBase}.${i}`;
        const apPrefix = `Device.WiFi.AccessPoint.${i}`;
        const keyPath = `${apPrefix}.Security.KeyPassphrase`;
        wifi.push({
          index: i,
          pathPrefix: prefix,
          ssidPath: `${prefix}.SSID`,
          keyPath,
          enablePath: `${prefix}.Enable`,
          ssid: strVal(genieGet(device, `${prefix}.SSID`)),
          key: strVal(genieGet(device, keyPath)),
          enabled: boolVal(genieGet(device, `${prefix}.Enable`)),
          channel: strVal(
            genieGet(device, `Device.WiFi.Radio.1.Channel`),
          ),
          standard: strVal(
            genieGet(device, `Device.WiFi.Radio.1.OperatingStandards`),
          ),
        });
      }
    }

    // —— TR-098 Ethernet ——
    const ethBase =
      'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig';
    for (const i of genieChildIndices(device, ethBase)) {
      const prefix = `${ethBase}.${i}`;
      ethernet.push({
        index: i,
        pathPrefix: prefix,
        enablePath: `${prefix}.Enable`,
        name: strVal(genieGet(device, `${prefix}.Name`)) ?? `ETH${i}`,
        enabled: boolVal(genieGet(device, `${prefix}.Enable`)),
        status: strVal(genieGet(device, `${prefix}.Status`)),
        mac: strVal(genieGet(device, `${prefix}.MACAddress`)),
      });
    }

    // —— TR-181 Ethernet ——
    if (ethernet.length === 0) {
      const eth181 = 'Device.Ethernet.Interface';
      for (const i of genieChildIndices(device, eth181)) {
        const prefix = `${eth181}.${i}`;
        ethernet.push({
          index: i,
          pathPrefix: prefix,
          enablePath: `${prefix}.Enable`,
          name: strVal(genieGet(device, `${prefix}.Name`)) ?? `ETH${i}`,
          enabled: boolVal(genieGet(device, `${prefix}.Enable`)),
          status: strVal(genieGet(device, `${prefix}.Status`)),
          mac: strVal(genieGet(device, `${prefix}.MACAddress`)),
        });
      }
    }

    // —— Web users TR-181 ——
    const userBase = 'Device.Users.User';
    for (const i of genieChildIndices(device, userBase)) {
      const prefix = `${userBase}.${i}`;
      webUsers.push({
        index: i,
        pathPrefix: prefix,
        usernamePath: `${prefix}.Username`,
        passwordPath: `${prefix}.Password`,
        username: strVal(genieGet(device, `${prefix}.Username`)),
        password: strVal(genieGet(device, `${prefix}.Password`)),
        enablePath: `${prefix}.Enable`,
        enabled: boolVal(genieGet(device, `${prefix}.Enable`)),
      });
    }

    // —— Vendor / TR-098 user interface (best-effort) ——
    if (webUsers.length === 0) {
      const candidates = [
        {
          prefix:
            'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1',
          user: 'UserName',
          pass: 'Password',
        },
        {
          prefix:
            'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2',
          user: 'UserName',
          pass: 'Password',
        },
        {
          prefix: 'InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.1',
          user: 'UserName',
          pass: 'Password',
        },
        {
          prefix: 'InternetGatewayDevice.X_ZTE-COM_User',
          user: 'Username',
          pass: 'Password',
        },
      ];
      let idx = 1;
      for (const c of candidates) {
        const u = strVal(genieGet(device, `${c.prefix}.${c.user}`));
        if (u != null || genieGet(device, `${c.prefix}.${c.user}`)) {
          webUsers.push({
            index: idx++,
            pathPrefix: c.prefix,
            usernamePath: `${c.prefix}.${c.user}`,
            passwordPath: `${c.prefix}.${c.pass}`,
            username: u,
            password: strVal(genieGet(device, `${c.prefix}.${c.pass}`)),
            enablePath: null,
            enabled: null,
          });
        }
      }
    }

    const model =
      strVal(genieGet(device, 'InternetGatewayDevice.DeviceInfo.ModelName')) ??
      strVal(genieGet(device, 'Device.DeviceInfo.ModelName'));
    const manufacturer =
      strVal(
        genieGet(device, 'InternetGatewayDevice.DeviceInfo.Manufacturer'),
      ) ?? strVal(genieGet(device, 'Device.DeviceInfo.Manufacturer'));
    const softwareVersion =
      strVal(
        genieGet(device, 'InternetGatewayDevice.DeviceInfo.SoftwareVersion'),
      ) ?? strVal(genieGet(device, 'Device.DeviceInfo.SoftwareVersion'));

    let lastInform: string | null = null;
    const li = device._lastInform;
    if (li instanceof Date) lastInform = li.toISOString();
    else if (typeof li === 'string') lastInform = li;
    else if (li && typeof li === 'object' && '$date' in (li as object)) {
      lastInform = String((li as { $date: unknown }).$date);
    }

    return {
      dataModel,
      wifi,
      ethernet,
      webUsers,
      model,
      manufacturer,
      softwareVersion,
      lastInform,
    };
  }

  async getConfig(user: AuthUser, onuId: string): Promise<Tr069OnuConfigView> {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    const base: Tr069OnuConfigView = {
      onuId: onu.id,
      sn: onu.sn,
      mgmtIp: onu.mgmtIp,
      acsDeviceId: null,
      inAcs: false,
      lastInform: null,
      model: onu.onuType,
      manufacturer: null,
      softwareVersion: null,
      dataModel: 'unknown',
      wifi: [],
      ethernet: [],
      webUsers: [],
      message: null,
    };

    if (!onu.mgmtIp) {
      base.message =
        'Activa TR069 en la ONU (elige perfil; se asigna Mgmt IP). Luego la ONU debe Informar al ACS.';
      return base;
    }

    if (!onu.sn?.trim()) {
      base.message = 'La ONU no tiene SN; no se puede buscar en el ACS.';
      return base;
    }

    try {
      const client = this.nbi();
      const device = await client.findBySerial(onu.sn);
      if (!device) {
        base.message =
          'Mgmt IP activa, pero la ONU aún no aparece en GenieACS. Verifica que tenga ACS URL (OMCI/TR069) y que pueda alcanzar el ACS; espera el próximo Inform.';
        return base;
      }
      const id = String(device._id ?? '');
      const parsed = this.parseDevice(device);
      return {
        ...base,
        acsDeviceId: id || null,
        inAcs: true,
        lastInform: parsed.lastInform,
        model: parsed.model ?? base.model,
        manufacturer: parsed.manufacturer,
        softwareVersion: parsed.softwareVersion,
        dataModel: parsed.dataModel,
        wifi: parsed.wifi,
        ethernet: parsed.ethernet,
        webUsers: parsed.webUsers,
        message: null,
      };
    } catch (e) {
      base.message = `No se pudo hablar con GenieACS NBI: ${e instanceof Error ? e.message : e}`;
      return base;
    }
  }

  async applyConfig(
    user: AuthUser,
    onuId: string,
    dto: {
      wifi?: Array<{
        index: number;
        ssid?: string;
        key?: string;
        enabled?: boolean;
      }>;
      ethernet?: Array<{ index: number; enabled?: boolean }>;
      webUsers?: Array<{
        index: number;
        username?: string;
        password?: string;
      }>;
      refresh?: boolean;
    },
  ) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');
    if (!onu.mgmtIp) {
      throw new BadRequestException(
        'Activa TR069 en la ONU antes de configurar vía ACS',
      );
    }
    if (!onu.sn?.trim()) {
      throw new BadRequestException('ONU sin SN');
    }

    const client = this.nbi();
    const device = await client.findBySerial(onu.sn);
    if (!device?._id) {
      throw new BadRequestException(
        'ONU no registrada en el ACS. Espera el Inform o aplica el perfil TR069 (ACS URL) primero.',
      );
    }
    const deviceId = String(device._id);
    const parsed = this.parseDevice(device);
    const params: Array<[string, string | number | boolean, string?]> = [];

    if (dto.refresh) {
      // First Inform is often DeviceInfo-only; pull LAN subtree (WiFi/ETH).
      try {
        await client.refreshObject(
          deviceId,
          'InternetGatewayDevice.LANDevice',
        );
      } catch {
        await client.refreshObject(deviceId, '');
      }
    }

    for (const w of dto.wifi ?? []) {
      const radio = parsed.wifi.find((x) => x.index === w.index);
      if (!radio) {
        throw new BadRequestException(`WiFi index ${w.index} no encontrado`);
      }
      if (w.ssid != null) {
        params.push([radio.ssidPath, w.ssid, 'xsd:string']);
      }
      if (w.key != null && radio.keyPath) {
        params.push([radio.keyPath, w.key, 'xsd:string']);
      }
      if (w.enabled != null && radio.enablePath) {
        params.push([radio.enablePath, w.enabled, 'xsd:boolean']);
      }
    }

    for (const e of dto.ethernet ?? []) {
      const port = parsed.ethernet.find((x) => x.index === e.index);
      if (!port) {
        throw new BadRequestException(`Ethernet index ${e.index} no encontrado`);
      }
      if (e.enabled != null && port.enablePath) {
        params.push([port.enablePath, e.enabled, 'xsd:boolean']);
      }
    }

    for (const u of dto.webUsers ?? []) {
      const userRow = parsed.webUsers.find((x) => x.index === u.index);
      if (!userRow) {
        throw new BadRequestException(`Usuario web index ${u.index} no encontrado`);
      }
      if (u.username != null) {
        params.push([userRow.usernamePath, u.username, 'xsd:string']);
      }
      if (u.password != null) {
        params.push([userRow.passwordPath, u.password, 'xsd:string']);
      }
    }

    if (params.length === 0 && !dto.refresh) {
      throw new BadRequestException('No hay cambios para aplicar');
    }

    let taskStatus: number | null = null;
    if (params.length) {
      const result = await client.setParameterValues(deviceId, params);
      taskStatus = result.status;
    }

    // Re-read after apply (may still be stale if 202 queued)
    const view = await this.getConfig(user, onuId);
    return {
      ok: true,
      taskStatus,
      queued: taskStatus === 202,
      message:
        taskStatus === 202
          ? 'Cambios encolados; se aplicarán en el próximo Inform o Connection Request.'
          : taskStatus === 200
            ? 'Cambios aplicados vía TR069.'
            : dto.refresh
              ? parsedAfterRefreshEmpty(view)
                ? 'Refresh pedido. Si Wi‑Fi sigue vacío, espera el Inform y pulsa «Refrescar desde ONU» de nuevo.'
                : 'Parámetros actualizados desde la ONU.'
              : 'OK',
      config: view,
    };
  }

  /**
   * Change management and/or WAN VLAN for an ONU (full pipeline).
   * Prefer step endpoints for UI progress: /olt → /assign → /apply → /verify.
   */
  async setOnuNetworkVlans(
    user: AuthUser,
    onuId: string,
    dto: {
      mgmtVlanId?: number;
      wanVlanId?: number | null;
      tr069ProfileId?: string;
    },
    opts?: { wanVlanSpecified?: boolean },
  ) {
    const olt = await this.networkVlansOlt(user, onuId, dto, opts);
    const assign = await this.networkVlansAssign(user, onuId, dto, opts);
    const apply = await this.networkVlansApplyOnu(user, onuId, dto, opts);
    const verify = await this.networkVlansVerify(user, onuId);
    return {
      ...verify,
      oltMessage: olt.message,
      assignMessage: assign.message,
      applyMessage: apply.message,
      message: [olt.message, assign.message, apply.message, verify.message]
        .filter(Boolean)
        .join(' · '),
    };
  }

  /** Step 1: configure service-ports on the OLT for WAN/mgmt VLANs. */
  async networkVlansOlt(
    user: AuthUser,
    onuId: string,
    dto: { mgmtVlanId?: number; wanVlanId?: number | null },
    opts?: { wanVlanSpecified?: boolean },
  ) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');
    if (!onu.onuIf) {
      throw new BadRequestException('ONU sin interfaz OLT (onuIf)');
    }

    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
    if (!olt || !isZteOltDevice(olt.type, olt.subtype)) {
      throw new BadRequestException('OLT no es ZTE conectada');
    }
    if (!olt.mgmtHost || !olt.mgmtUsername || !olt.mgmtPassword) {
      throw new BadRequestException('OLT sin credenciales de gestión');
    }

    const protocol: 'telnet' | 'ssh' =
      olt.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
    const conn = {
      host: olt.mgmtHost,
      port:
        olt.mgmtPort ??
        (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet),
      protocol,
      username: olt.mgmtUsername,
      password: olt.mgmtPassword,
    };

    const wanVlan =
      opts?.wanVlanSpecified === true ? (dto.wanVlanId ?? null) : undefined;
    const mgmtVlan = dto.mgmtVlanId != null ? dto.mgmtVlanId : undefined;

    if (wanVlan === undefined && mgmtVlan === undefined) {
      return { ok: true, message: 'OLT: sin cambios de VLAN' };
    }

    const result = await this.zteOlt.applyOnuServiceVlans({
      ...conn,
      onuIf: onu.onuIf,
      wanVlan,
      mgmtVlan,
    });
    if (!result.ok) {
      throw new BadRequestException(
        result.error || 'No se pudo aplicar VLANs en la OLT',
      );
    }
    return { ok: true, message: result.message ?? 'OLT actualizada' };
  }

  /** Step 2: assign/release IPs from pools in DB. */
  async networkVlansAssign(
    user: AuthUser,
    onuId: string,
    dto: { mgmtVlanId?: number; wanVlanId?: number | null },
    opts?: { wanVlanSpecified?: boolean },
  ) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    let onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    const notes: string[] = [];

    if (dto.mgmtVlanId != null) {
      const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
      const currentPool = onu.mgmtPoolId
        ? await poolRepo.findOne({ where: { id: onu.mgmtPoolId } })
        : null;
      if (!currentPool || currentPool.vlanId !== dto.mgmtVlanId) {
        const mgmt = await this.ipPools.assignMgmtIpForVlan(
          schema,
          onu,
          dto.mgmtVlanId,
        );
        notes.push(
          mgmt.mgmtIp
            ? `Mgmt ${mgmt.mgmtIp} (VLAN ${dto.mgmtVlanId})`
            : `Mgmt VLAN ${dto.mgmtVlanId}`,
        );
        onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
      } else {
        notes.push(`Mgmt ya en VLAN ${dto.mgmtVlanId}`);
      }
    }

    if (opts?.wanVlanSpecified) {
      if (dto.wanVlanId == null) {
        await this.ipPools.releaseWanIp(schema, onu);
        notes.push('WAN liberada');
        onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
      } else {
        const wan = await this.ipPools.assignWanIp(
          schema,
          onu,
          dto.wanVlanId,
        );
        notes.push(`WAN ${wan.wanIp} (VLAN ${wan.wanVlan})`);
        onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
      }
    }

    return {
      ok: true,
      message: notes.join(' · ') || 'Sin cambios de asignación',
      mgmtIp: onu.mgmtIp,
      wanIp: onu.wanIp,
    };
  }

  /** Step 3: push config to ONU (OMCI WAN static + OMCI TR069 mgmt + ACS WAN). */
  async networkVlansApplyOnu(
    user: AuthUser,
    onuId: string,
    dto: {
      mgmtVlanId?: number;
      wanVlanId?: number | null;
      tr069ProfileId?: string;
    },
    opts?: { wanVlanSpecified?: boolean },
  ) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    let onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    const notes: string[] = [];

    // Mgmt VLAN ⇒ TR069 must end up active (same as enabling it in the detail modal).
    if (dto.mgmtVlanId != null) {
      let profileId = dto.tr069ProfileId?.trim() || onu.tr069ProfileId;
      if (!profileId) {
        const profile = await this.resolveDefaultTr069Profile(
          schema,
          onu.oltId,
        );
        if (!profile) {
          notes.push(
            'Mgmt en OLT/DB; no hay perfil TR069 — crea uno en Ajustes → TR069',
          );
        } else {
          profileId = profile.id;
        }
      }
      if (profileId) {
        const again = await this.setOnuTr069(
          user,
          onuId,
          true,
          profileId,
          dto.mgmtVlanId,
        );
        notes.push(
          again.message ??
            `TR069 activo${again.tr069ProfileName ? ` (${again.tr069ProfileName})` : ''}`,
        );
        onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
      }
    }

    if (opts?.wanVlanSpecified) {
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
      if (
        olt &&
        isZteOltDevice(olt.type, olt.subtype) &&
        olt.mgmtHost &&
        olt.mgmtUsername &&
        olt.mgmtPassword &&
        onu.onuIf
      ) {
        const conn = this.zteConn(olt);

        if (dto.wanVlanId == null) {
          const cleared = await this.zteOlt.applyOnuWanStaticOmci({
            ...conn,
            onuIf: onu.onuIf,
            wan: null,
          });
          notes.push(
            cleared.ok
              ? cleared.message ?? 'WAN OMCI quitada'
              : `WAN OMCI: ${cleared.error}`,
          );
        } else if (onu.wanIp) {
          const poolRepo =
            await this.tenantConnections.getIpPoolRepository(schema);
          const wanPool = onu.wanPoolId
            ? await poolRepo.findOne({ where: { id: onu.wanPoolId } })
            : null;
          if (wanPool?.dns1) {
            const m =
              wanPool.prefix === 0
                ? 0
                : (~0 << (32 - wanPool.prefix)) >>> 0;
            const wanMask = [
              (m >>> 24) & 255,
              (m >>> 16) & 255,
              (m >>> 8) & 255,
              m & 255,
            ].join('.');

            let omciOk = false;
            let omciErr = '';
            for (let attempt = 1; attempt <= 2; attempt++) {
              const omci = await this.zteOlt.applyOnuWanStaticOmci({
                ...conn,
                onuIf: onu.onuIf,
                wan: {
                  wanIp: onu.wanIp,
                  wanMask,
                  wanGateway: wanPool.gateway,
                  wanVlan: wanPool.vlanId,
                  wanDns1: wanPool.dns1,
                  wanDns2: wanPool.dns2,
                },
              });
              if (omci.ok) {
                omciOk = true;
                notes.push(
                  `${omci.message ?? 'WAN OMCI aplicada'}${
                    attempt > 1 ? ` (intento ${attempt})` : ''
                  }`,
                );
                break;
              }
              omciErr = omci.error || 'No se pudo aplicar WAN por OMCI';
              if (attempt < 2) await this.sleep(3_000);
            }

            if (!omciOk) {
              // Auto OMCI failed → fall back to manual (IPs stay assigned for the tech).
              onu.provisionMode = 'manual';
              await onuRepo.save(onu);
              notes.push(
                `WAN OMCI falló (${omciErr}) → modo manual (configurar por web de la ONU)`,
              );
            } else {
              if (onu.provisionMode === 'manual') {
                onu.provisionMode = 'auto';
                await onuRepo.save(onu);
              }
              const tr069 = await this.applyWanStaticTr069(schema, onu, {
                wanIp: onu.wanIp,
                wanVlan: wanPool.vlanId,
                wanGateway: wanPool.gateway,
                wanMask,
                wanDns1: wanPool.dns1,
                wanDns2: wanPool.dns2,
              });
              notes.push(tr069);
            }
          } else {
            notes.push('WAN sin pool/DNS — OMCI skip');
          }
        }
      } else {
        notes.push('OLT sin credenciales — WAN OMCI skip');
      }
    }

    return {
      ok: true,
      message: notes.join(' · ') || 'Nada que aplicar a la ONU',
      provisionMode: onu.provisionMode,
      tr069ProfileId: onu.tr069ProfileId,
      tr069Enabled: !!onu.tr069ProfileId && !!onu.mgmtIp,
    };
  }

  /**
   * Step 4: wait until the ONU is online on the OLT (config takes effect),
   * refresh DB from live probe, then confirm VLAN/IP state.
   */
  async networkVlansVerify(user: AuthUser, onuId: string) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    let onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });

    const waitMs = 240_000; // up to ~4 min — ONU often reboots after OMCI
    const pollEveryMs = 8_000;
    const started = Date.now();
    let online = false;
    let probes = 0;
    let lastProbeNote = '';

    if (
      olt &&
      isZteOltDevice(olt.type, olt.subtype) &&
      olt.mgmtHost &&
      olt.mgmtUsername &&
      olt.mgmtPassword &&
      onu.onuIf
    ) {
      const conn = this.zteConn(olt);
      while (Date.now() - started < waitMs) {
        probes += 1;
        try {
          const detail = await this.zteOlt.getConnectedOnuDetail({
            ...conn,
            onuIf: onu.onuIf,
          });
          if (detail.ok && detail.onu) {
            const live = detail.onu;
            onu.online = !!live.online;
            if (live.status) onu.status = live.status;
            if (live.phaseState) onu.phaseState = live.phaseState;
            if (live.adminState) onu.adminState = live.adminState;
            if (live.signalDbm !== undefined) onu.signalDbm = live.signalDbm;
            if (live.name) onu.name = live.name;
            if (live.description) onu.description = live.description;
            if (live.mode) onu.mode = live.mode;
            onu.lastProbedAt = new Date();
            await onuRepo.save(onu);

            lastProbeNote = live.online
              ? `online (${live.phaseState || live.status || 'ok'})`
              : `aún ${live.phaseState || live.status || 'offline'}`;

            if (live.online) {
              online = true;
              // Brief settle so running-config / OMCI settles after coming up.
              await this.sleep(4_000);
              break;
            }
          } else {
            lastProbeNote = detail.error || 'sin detalle OLT';
          }
        } catch (e) {
          lastProbeNote = e instanceof Error ? e.message : String(e);
          this.logger.warn(
            `verify probe ${onu.onuIf}: ${lastProbeNote}`,
          );
        }
        await this.sleep(pollEveryMs);
        onu = (await onuRepo.findOne({ where: { id: onuId } })) ?? onu;
      }
    } else {
      lastProbeNote = 'sin OLT/credenciales para sondear';
    }

    onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
    const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
    const mgmtPool = onu.mgmtPoolId
      ? await poolRepo.findOne({ where: { id: onu.mgmtPoolId } })
      : null;
    const wanPool = onu.wanPoolId
      ? await poolRepo.findOne({ where: { id: onu.wanPoolId } })
      : null;

    const mode = onu.wanPoolId ? 'router' : (onu.mode ?? null);
    const waitedSec = Math.round((Date.now() - started) / 1000);

    if (!online) {
      throw new BadRequestException(
        `La ONU no llegó a online tras ${waitedSec}s (${probes} sondeos). ` +
          `Último estado: ${lastProbeNote || 'desconocido'}. ` +
          `Reintenta la verificación o revisa la fibra/OLT.`,
      );
    }

    return {
      ok: true,
      online: true,
      waitedSec,
      probes,
      mgmtIp: onu.mgmtIp,
      mgmtVlanId: mgmtPool?.vlanId ?? null,
      wanIp: onu.wanIp,
      wanVlanId: wanPool?.vlanId ?? onu.vlan ?? null,
      mode,
      tr069Enabled: !!onu.tr069ProfileId && !!onu.mgmtIp,
      provisionMode: onu.provisionMode,
      message: `ONU online · mgmt VLAN ${mgmtPool?.vlanId ?? '—'} · WAN VLAN ${
        wanPool?.vlanId ?? onu.vlan ?? '—'
      }${onu.wanIp ? ` · WAN IP ${onu.wanIp}` : ''}${
        onu.tr069ProfileId ? ' · TR069 activo' : ''
      }${mode === 'router' ? ' · modo router' : ''}${
        onu.provisionMode === 'manual' ? ' · modo manual' : ''
      } · listo en ${waitedSec}s`,
    };
  }

  /** Set provisioning mode: 'auto' (managed) or 'manual' (technician on CPE web). */
  async setProvisionMode(
    user: AuthUser,
    onuId: string,
    mode: 'auto' | 'manual',
  ) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');
    onu.provisionMode = mode === 'manual' ? 'manual' : 'auto';
    await onuRepo.save(onu);
    return { ok: true, provisionMode: onu.provisionMode };
  }

  /**
   * Data a technician needs to configure the CPE by hand (manual mode):
   * WAN static (IP/mask/gateway/DNS/VLAN) + management IP/VLAN.
   */
  async getManualConfig(user: AuthUser, onuId: string) {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
    const wanPool = onu.wanPoolId
      ? await poolRepo.findOne({ where: { id: onu.wanPoolId } })
      : null;
    const mgmtPool = onu.mgmtPoolId
      ? await poolRepo.findOne({ where: { id: onu.mgmtPoolId } })
      : null;

    const wan =
      onu.wanIp && wanPool
        ? {
            mode: 'static' as const,
            connectionType: 'router',
            ip: onu.wanIp,
            prefix: wanPool.prefix,
            mask: prefixToMask(wanPool.prefix),
            gateway: wanPool.gateway,
            vlan: wanPool.vlanId,
            dns1: wanPool.dns1 ?? null,
            dns2: wanPool.dns2 ?? null,
          }
        : null;

    const mgmt =
      onu.mgmtIp && mgmtPool
        ? {
            ip: onu.mgmtIp,
            prefix: mgmtPool.prefix,
            mask: prefixToMask(mgmtPool.prefix),
            gateway: mgmtPool.gateway,
            vlan: mgmtPool.vlanId,
          }
        : null;

    return {
      ok: true,
      provisionMode: (onu.provisionMode as 'auto' | 'manual') ?? 'auto',
      sn: onu.sn,
      onuIf: onu.onuIf,
      wan,
      mgmt,
    };
  }

  /** Push static WAN IP / VLAN / DNS to the CPE via GenieACS. */
  private async applyWanStaticTr069(
    schema: string,
    onu: {
      id: string;
      sn: string | null;
      mgmtIp: string | null;
    },
    wan: {
      wanIp: string;
      wanVlan: number;
      wanGateway: string;
      wanMask: string;
      wanDns1: string;
      wanDns2: string | null;
    },
  ): Promise<string> {
    if (!onu.sn?.trim()) {
      return 'WAN en DB; sin SN no se puede empujar por TR069';
    }
    if (!onu.mgmtIp) {
      return 'WAN en DB; activa TR069 (Mgmt IP) para empujar por ACS';
    }
    try {
      const client = this.nbi();
      let device = await client.findBySerial(onu.sn);
      if (!device?._id) {
        return 'WAN en DB; ONU aún no Informó al ACS';
      }
      const deviceId = String(device._id);

      // Ensure WAN tree is present
      try {
        await client.refreshObject(
          deviceId,
          'InternetGatewayDevice.WANDevice',
        );
        device = (await client.findBySerial(onu.sn)) ?? device;
      } catch {
        /* continue with what we have */
      }

      const conn = this.findWanIpConnection(device);
      if (!conn) {
        return 'WAN en DB; no se encontró WANIPConnection en el árbol TR069 — pulsa Refrescar en Configurar ONU';
      }

      const dns = wan.wanDns2
        ? `${wan.wanDns1},${wan.wanDns2}`
        : wan.wanDns1;
      const params: Array<[string, string | number | boolean, string?]> = [
        [`${conn}.Enable`, true, 'xsd:boolean'],
        // Modo router por defecto: la conexión WAN queda enrutada (NAT/IP_Routed)
        [`${conn}.ConnectionType`, 'IP_Routed', 'xsd:string'],
        [`${conn}.AddressingType`, 'Static', 'xsd:string'],
        [`${conn}.ExternalIPAddress`, wan.wanIp, 'xsd:string'],
        [`${conn}.SubnetMask`, wan.wanMask, 'xsd:string'],
        [`${conn}.DefaultGateway`, wan.wanGateway, 'xsd:string'],
        [`${conn}.DNSServers`, dns, 'xsd:string'],
      ];

      // Vendor VLAN id (Huawei / ZTE common leaves)
      params.push([`${conn}.X_HW_VLAN`, wan.wanVlan, 'xsd:unsignedInt']);
      params.push([`${conn}.X_ZTE-COM_VLANID`, wan.wanVlan, 'xsd:unsignedInt']);

      const result = await client.setParameterValues(deviceId, params);
      return result.status === 200
        ? 'WAN estática aplicada por TR069'
        : result.status === 202
          ? 'WAN encolada en ACS (Connection Request)'
          : `WAN TR069 status ${result.status}`;
    } catch (e) {
      return `WAN en DB; TR069 falló: ${e instanceof Error ? e.message : e}`;
    }
  }

  private findWanIpConnection(
    device: Record<string, unknown>,
  ): string | null {
    const wanDevBase = 'InternetGatewayDevice.WANDevice';
    for (const wd of genieChildIndices(device, wanDevBase)) {
      const connBase = `${wanDevBase}.${wd}.WANConnectionDevice`;
      for (const cd of genieChildIndices(device, connBase)) {
        const ipBase = `${connBase}.${cd}.WANIPConnection`;
        for (const ip of genieChildIndices(device, ipBase)) {
          return `${ipBase}.${ip}`;
        }
        // Sometimes only PPP exists — skip
      }
    }
    // Fallback well-known path
    const fallback =
      'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1';
    if (genieGet(device, `${fallback}.Enable`) || genieGet(device, fallback)) {
      return fallback;
    }
    return fallback; // still try — GenieACS may create on set
  }
}

function parsedAfterRefreshEmpty(view: Tr069OnuConfigView): boolean {
  return (
    view.wifi.length === 0 &&
    view.ethernet.length === 0 &&
    view.webUsers.length === 0
  );
}

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
  genieNodeExists,
  resolveNbiBaseUrl,
  strVal,
} from './genieacs-nbi.client';
import { IpPoolService } from './ip-pool.service';
import { ZteOltClient } from './zte-olt.client';
import { HuaweiOltClient } from './huawei-olt.client';
import {
  DEFAULT_OLT_PORTS,
  isHuaweiOltDevice,
  isManagedOltDevice,
} from './olt.constants';
import { stripHuaweiDialectTag } from './huawei-olt-firmware.util';
import {
  buildConnReqParameterValues,
  connReqPassword,
  CONN_REQ_INFORM_INTERVAL_S,
  detectDataModelRoot,
  shouldShortenInformInterval,
  shouldWriteConnReqCredentials,
} from './onu-connreq-credentials.util';
import {
  buildDigestAuthorization,
  DigestChallenge,
  factoryConnReqCandidates,
  newCnonce,
  parseDigestChallenge,
} from './onu-connreq-kick.util';
import {
  pickServiceWanConnection,
  type WanConnectionCandidate,
} from './onu-wan-connection.util';
import { computeIpNetwork } from './ip-pool.util';
import type { NetworkDevice } from './entities/network-device.entity';
import type { Tr069Profile } from './entities/tr069-profile.entity';

function deviceIdString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function oltFirmwareHint(olt: NetworkDevice): string | null {
  return (
    stripHuaweiDialectTag(olt.metricVersion) ||
    olt.metricVersion ||
    olt.metricBoardName ||
    null
  );
}

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
  /** Binding OMCI `vlan port eth_0/N` (IPTV / bridge). */
  vlanId: number | null;
  vlanMode: 'tag' | 'untag' | 'hybrid' | null;
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
  /** admin / user / etc. when the vendor exposes roles. */
  label: string | null;
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
    private readonly huaweiOlt: HuaweiOltClient,
  ) {}

  private oltCli(device: NetworkDevice) {
    return isHuaweiOltDevice(device.type, device.subtype)
      ? this.huaweiOlt
      : this.zteOlt;
  }

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
      if (!olt || !isManagedOltDevice(olt.type, olt.subtype)) {
        omciOk = false;
        omciMessage =
          'TR069 guardado en DB, pero la OLT no es gestionada (ZTE/Huawei) — OMCI no aplicado';
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

        const omciPromise = this.oltCli(olt).applyOnuTr069Mgmt({
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
          subtypeHint: olt.subtype,
          firmwareHint: oltFirmwareHint(olt),
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
          ? (('message' in omci ? omci.message : null) ?? 'OMCI OK')
          : (omci.error ?? 'OMCI falló');
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
          channel: strVal(genieGet(device, `Device.WiFi.Radio.1.Channel`)),
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
        vlanId: null,
        vlanMode: null,
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
          vlanId: null,
          vlanMode: null,
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
        label: null,
      });
    }

    // —— FiberHome (HG6244C etc.): flat WebSuper*/Web* under DeviceInfo ——
    if (webUsers.length === 0) {
      const fhBase =
        'InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo';
      if (
        genieNodeExists(device, fhBase) ||
        genieGet(device, `${fhBase}.WebSuperPassword`) ||
        genieGet(device, `${fhBase}.WebSuperUsername`)
      ) {
        webUsers.push({
          index: 1,
          pathPrefix: fhBase,
          usernamePath: `${fhBase}.WebSuperUsername`,
          passwordPath: `${fhBase}.WebSuperPassword`,
          username: strVal(genieGet(device, `${fhBase}.WebSuperUsername`)),
          password: strVal(genieGet(device, `${fhBase}.WebSuperPassword`)),
          enablePath: genieNodeExists(device, `${fhBase}.Enable`)
            ? `${fhBase}.Enable`
            : null,
          enabled: boolVal(genieGet(device, `${fhBase}.Enable`)),
          label: 'Admin',
        });
        webUsers.push({
          index: 2,
          pathPrefix: fhBase,
          usernamePath: `${fhBase}.WebUsername`,
          passwordPath: `${fhBase}.WebPassword`,
          username: strVal(genieGet(device, `${fhBase}.WebUsername`)),
          password: strVal(genieGet(device, `${fhBase}.WebPassword`)),
          enablePath: genieNodeExists(device, `${fhBase}.UserEnable`)
            ? `${fhBase}.UserEnable`
            : null,
          enabled: boolVal(genieGet(device, `${fhBase}.UserEnable`)),
          label: 'Usuario',
        });
      }
    }

    // —— Vendor / TR-098 user interface (Huawei / ZTE) ——
    if (webUsers.length === 0) {
      const candidates = [
        {
          prefix: 'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1',
          user: 'UserName',
          pass: 'Password',
          label: 'Admin',
        },
        {
          prefix: 'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2',
          user: 'UserName',
          pass: 'Password',
          label: 'Usuario',
        },
        {
          prefix: 'InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.1',
          user: 'UserName',
          pass: 'Password',
          label: 'Admin',
        },
        {
          prefix: 'InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.2',
          user: 'UserName',
          pass: 'Password',
          label: 'Usuario',
        },
        {
          prefix: 'InternetGatewayDevice.X_ZTE-COM_User',
          user: 'Username',
          pass: 'Password',
          label: 'Admin',
        },
      ];
      let idx = 1;
      for (const c of candidates) {
        if (
          !genieNodeExists(device, c.prefix) &&
          !genieGet(device, `${c.prefix}.${c.user}`) &&
          !genieGet(device, `${c.prefix}.${c.pass}`)
        ) {
          continue;
        }
        webUsers.push({
          index: idx++,
          pathPrefix: c.prefix,
          usernamePath: `${c.prefix}.${c.user}`,
          passwordPath: `${c.prefix}.${c.pass}`,
          username: strVal(genieGet(device, `${c.prefix}.${c.user}`)),
          password: strVal(genieGet(device, `${c.prefix}.${c.pass}`)),
          enablePath: null,
          enabled: null,
          label: c.label,
        });
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
    else if (li && typeof li === 'object' && '$date' in li) {
      lastInform = String(li.$date);
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

  /** Mezcla bindings OMCI `vlan port eth_0/N` sobre los puertos TR-069. */
  private async mergeOmciEthVlans(
    schema: string,
    onu: { oltId: string; onuIf: string | null },
    ethernet: Tr069EthPort[],
  ): Promise<Tr069EthPort[]> {
    if (!onu.onuIf) return ethernet;
    try {
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
      if (
        !olt ||
        !isManagedOltDevice(olt.type, olt.subtype) ||
        isHuaweiOltDevice(olt.type, olt.subtype) ||
        !olt.mgmtHost ||
        !olt.mgmtUsername ||
        !olt.mgmtPassword
      ) {
        return ethernet;
      }
      const result = await this.zteOlt.getOmciEthPortVlans({
        ...this.zteConn(olt),
        onuIf: onu.onuIf,
        subtypeHint: olt.subtype,
        firmwareHint: oltFirmwareHint(olt),
      });
      if (!result.ok) return ethernet;
      const byIndex = new Map(result.ports.map((p) => [p.portIndex, p]));
      const merged = ethernet.map((e) => {
        const omci = byIndex.get(e.index);
        if (!omci) return e;
        return { ...e, vlanId: omci.vlanId, vlanMode: omci.mode };
      });
      // Si el ACS aún no tiene ETH pero la OLT sí tiene bindings, exponerlos.
      if (merged.length === 0 && result.ports.length > 0) {
        return result.ports.map((p) => ({
          index: p.portIndex,
          pathPrefix: '',
          enablePath: null,
          name: `eth_0/${p.portIndex}`,
          enabled: null,
          status: null,
          mac: null,
          vlanId: p.vlanId,
          vlanMode: p.mode,
        }));
      }
      // Asegurar índices presentes en OMCI aunque falten en ACS.
      for (const p of result.ports) {
        if (merged.some((e) => e.index === p.portIndex)) continue;
        merged.push({
          index: p.portIndex,
          pathPrefix: '',
          enablePath: null,
          name: `eth_0/${p.portIndex}`,
          enabled: null,
          status: null,
          mac: null,
          vlanId: p.vlanId,
          vlanMode: p.mode,
        });
      }
      return merged.sort((a, b) => a.index - b.index);
    } catch (e) {
      this.logger.debug(
        `OMCI eth VLAN merge: ${e instanceof Error ? e.message : e}`,
      );
      return ethernet;
    }
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
      const id = deviceIdString(device._id);
      const parsed = this.parseDevice(device);
      const ethernet = await this.mergeOmciEthVlans(schema, onu, parsed.ethernet);
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
        ethernet,
        webUsers: parsed.webUsers,
        message:
          parsed.webUsers.length === 0
            ? 'Sin usuarios web en el árbol. Pulsa «Refrescar desde ONU» para pedir DeviceInfo/UserInterface al ACS.'
            : null,
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
      ethernet?: Array<{
        index: number;
        enabled?: boolean;
        vlanId?: number | null;
        vlanMode?: 'tag' | 'untag' | 'hybrid';
      }>;
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
    const deviceId = deviceIdString(device._id);
    const parsed = this.parseDevice(device);
    const params: Array<[string, string | number | boolean, string?]> = [];
    const omciNotes: string[] = [];

    if (dto.refresh) {
      // First Inform is often DeviceInfo-only; pull LAN + web-user trees.
      const refreshTargets = [
        'InternetGatewayDevice.LANDevice',
        'InternetGatewayDevice.DeviceInfo.X_FH_Account',
        'InternetGatewayDevice.UserInterface',
        'Device.Users',
      ];
      for (const objectName of refreshTargets) {
        try {
          await client.refreshObject(deviceId, objectName);
        } catch {
          /* best-effort per vendor tree */
        }
      }
      // FiberHome a veces solo descubre el path; fuerza get de las hojas.
      try {
        await client.getParameterValues(deviceId, [
          'InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebSuperUsername',
          'InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebSuperPassword',
          'InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebUsername',
          'InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebPassword',
        ]);
      } catch {
        /* optional */
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

    const ethVlanPatches = (dto.ethernet ?? []).filter(
      (e) =>
        Object.prototype.hasOwnProperty.call(e, 'vlanId') ||
        Object.prototype.hasOwnProperty.call(e, 'vlanMode'),
    );

    for (const e of dto.ethernet ?? []) {
      const port = parsed.ethernet.find((x) => x.index === e.index);
      // VLAN OMCI no requiere que el puerto exista aún en el árbol ACS.
      if (!port && e.enabled != null) {
        throw new BadRequestException(
          `Ethernet index ${e.index} no encontrado`,
        );
      }
      if (port && e.enabled != null && port.enablePath) {
        params.push([port.enablePath, e.enabled, 'xsd:boolean']);
      }
    }

    if (ethVlanPatches.length > 0) {
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
      if (
        !olt ||
        !isManagedOltDevice(olt.type, olt.subtype) ||
        !olt.mgmtHost ||
        !olt.mgmtUsername ||
        !olt.mgmtPassword
      ) {
        throw new BadRequestException(
          'OLT sin credenciales para aplicar VLAN de puerto Ethernet (OMCI)',
        );
      }
      if (isHuaweiOltDevice(olt.type, olt.subtype)) {
        throw new BadRequestException(
          'Asignar VLAN a puerto Ethernet vía OMCI aún no está soportado en Huawei',
        );
      }
      if (!onu.onuIf) {
        throw new BadRequestException('ONU sin interfaz OLT (onuIf)');
      }
      for (const e of ethVlanPatches) {
        const vlanSpecified = Object.prototype.hasOwnProperty.call(
          e,
          'vlanId',
        );
        const vlanId = vlanSpecified ? (e.vlanId ?? null) : null;
        if (!vlanSpecified) continue;
        const mode = e.vlanMode ?? 'untag';
        const omci = await this.zteOlt.applyOnuEthPortVlan({
          ...this.zteConn(olt),
          onuIf: onu.onuIf,
          portIndex: e.index,
          vlanId,
          mode,
          subtypeHint: olt.subtype,
          firmwareHint: oltFirmwareHint(olt),
        });
        if (!omci.ok) {
          throw new BadRequestException(
            omci.error || `No se pudo aplicar VLAN en eth_0/${e.index}`,
          );
        }
        if (omci.message) omciNotes.push(omci.message);
      }
    }

    for (const u of dto.webUsers ?? []) {
      const userRow = parsed.webUsers.find((x) => x.index === u.index);
      if (!userRow) {
        throw new BadRequestException(
          `Usuario web index ${u.index} no encontrado`,
        );
      }
      if (u.username != null) {
        params.push([userRow.usernamePath, u.username, 'xsd:string']);
      }
      if (u.password != null) {
        params.push([userRow.passwordPath, u.password, 'xsd:string']);
      }
    }

    if (params.length === 0 && !dto.refresh && omciNotes.length === 0) {
      throw new BadRequestException('No hay cambios para aplicar');
    }

    let taskStatus: number | null = null;
    if (params.length) {
      const result = await client.setParameterValues(deviceId, params);
      taskStatus = result.status;
    }

    // Re-read after apply (may still be stale if 202 queued)
    const view = await this.getConfig(user, onuId);
    const omciSuffix = omciNotes.length ? ` · ${omciNotes.join(' · ')}` : '';
    return {
      ok: true,
      taskStatus,
      queued: taskStatus === 202,
      message:
        taskStatus === 202
          ? `Cambios encolados; se aplicarán en el próximo Inform o Connection Request.${omciSuffix}`
          : taskStatus === 200
            ? `Cambios aplicados vía TR069.${omciSuffix}`
            : dto.refresh
              ? parsedAfterRefreshEmpty(view)
                ? 'Refresh pedido. Si Wi‑Fi / usuarios siguen vacíos, espera el Inform y pulsa «Refrescar desde ONU» de nuevo.'
                : `Parámetros actualizados desde la ONU.${omciSuffix}`
              : omciNotes.length
                ? omciNotes.join(' · ')
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
    if (!olt || !isManagedOltDevice(olt.type, olt.subtype)) {
      throw new BadRequestException('OLT no es ZTE/Huawei gestionada');
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

    const result = await this.oltCli(olt).applyOnuServiceVlans({
      ...conn,
      onuIf: onu.onuIf,
      wanVlan,
      mgmtVlan,
      subtypeHint: olt.subtype,
      firmwareHint: oltFirmwareHint(olt),
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
        const wan = await this.ipPools.assignWanIp(schema, onu, dto.wanVlanId);
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
        isManagedOltDevice(olt.type, olt.subtype) &&
        olt.mgmtHost &&
        olt.mgmtUsername &&
        olt.mgmtPassword &&
        onu.onuIf
      ) {
        const conn = this.zteConn(olt);
        const cli = this.oltCli(olt);

        if (dto.wanVlanId == null) {
          const cleared = await cli.applyOnuWanStaticOmci({
            ...conn,
            onuIf: onu.onuIf,
            wan: null,
            subtypeHint: olt.subtype,
            firmwareHint: oltFirmwareHint(olt),
          });
          notes.push(
            cleared.ok
              ? (cleared.message ?? 'WAN OMCI quitada')
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
              wanPool.prefix === 0 ? 0 : (~0 << (32 - wanPool.prefix)) >>> 0;
            const wanMask = [
              (m >>> 24) & 255,
              (m >>> 16) & 255,
              (m >>> 8) & 255,
              m & 255,
            ].join('.');

            let omciOk = false;
            let omciErr = '';
            for (let attempt = 1; attempt <= 2; attempt++) {
              const omci = await cli.applyOnuWanStaticOmci({
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
                subtypeHint: olt.subtype,
                firmwareHint: oltFirmwareHint(olt),
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
      isManagedOltDevice(olt.type, olt.subtype) &&
      olt.mgmtHost &&
      olt.mgmtUsername &&
      olt.mgmtPassword &&
      onu.onuIf
    ) {
      const conn = this.zteConn(olt);
      const cli = this.oltCli(olt);
      while (Date.now() - started < waitMs) {
        probes += 1;
        try {
          const detail = await cli.getConnectedOnuDetail({
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
          this.logger.warn(`verify probe ${onu.onuIf}: ${lastProbeNote}`);
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
      const deviceId = deviceIdString(device._id);

      const notes: string[] = [];
      const credNote = await this.ensureConnReqCredentials(
        client,
        deviceId,
        device,
        onu.sn,
      );
      if (credNote) notes.push(credNote);

      // Ensure WAN tree is present
      try {
        await client.refreshObject(deviceId, 'InternetGatewayDevice.WANDevice');
        device = (await client.findBySerial(onu.sn)) ?? device;
      } catch {
        /* continue with what we have */
      }

      const withNotes = (msg: string) => [...notes, msg].join(' · ');

      const found = this.findWanIpConnection(device, onu.mgmtIp);
      if (!found) {
        return withNotes(
          'WAN en DB; no se encontró WANIPConnection en el árbol TR069 — pulsa Refrescar en Configurar ONU',
        );
      }
      if (found.isMgmt) {
        // La única conexión WAN del CPE es la de gestión. Escribir la IP de
        // servicio encima deja a la ONU sin camino de gestión y sin TR-069:
        // el servicio necesita su propia conexión, no reutilizar esta.
        return withNotes(
          'WAN en DB; el CPE sólo expone la conexión de gestión ' +
            `(${onu.mgmtIp}) — hace falta crear una WAN de servicio aparte, no se toca`,
        );
      }
      const { conn, connDevice } = found;

      // Sin refrescar la conexión, GenieACS conoce el nodo pero no sus hojas y
      // no hay forma de saber qué acepta este CPE.
      try {
        await client.refreshObject(deviceId, connDevice);
        device = (await client.findBySerial(onu.sn)) ?? device;
      } catch {
        /* seguimos con lo que haya */
      }

      const dns = wan.wanDns2 ? `${wan.wanDns1},${wan.wanDns2}` : wan.wanDns1;
      // Hojas estándar TR-098. NATEnabled es lo que hace que LAN y WiFi salgan
      // por la IP WAN; sin él la ONU enruta pero nadie traduce.
      //
      // SubnetMask va en un SPV aparte: en Huawei HG8245W5 el lote completo
      // puede responder 200 y dejar la máscara en blanco. Sin máscara el CPE
      // declara Connected, no envía unicast y no aparece en ARP.
      const core: Array<[string, string | number | boolean, string?]> = [
        [`${conn}.Enable`, true, 'xsd:boolean'],
        [`${conn}.ConnectionType`, 'IP_Routed', 'xsd:string'],
        [`${conn}.NATEnabled`, true, 'xsd:boolean'],
        [`${conn}.AddressingType`, 'Static', 'xsd:string'],
        [`${conn}.ExternalIPAddress`, wan.wanIp, 'xsd:string'],
        [`${conn}.DefaultGateway`, wan.wanGateway, 'xsd:string'],
        [`${conn}.DNSServers`, dns, 'xsd:string'],
      ];

      const result = await client.setParameterValues(deviceId, core);
      if (result.status === 200) notes.push('WAN estática aplicada por TR069');
      else if (result.status === 202) notes.push('WAN encolada en ACS');
      else notes.push(`WAN TR069 status ${result.status}`);

      const maskNote = await this.ensureWanSubnetMask(
        client,
        deviceId,
        conn,
        wan.wanMask,
      );
      if (maskNote) notes.push(maskNote);

      // La VLAN va en una hoja propietaria distinta por fabricante y sólo se
      // manda si el árbol la expone: SetParameterValues es atómico, así que una
      // hoja inexistente tumbaría también el NAT si fuese en el mismo lote.
      const vlanLeaf = this.findWanVlanLeaf(device, conn, connDevice);
      if (!vlanLeaf) {
        notes.push('VLAN WAN sin hoja TR069 conocida (queda la de OMCI)');
      } else {
        try {
          const vlanParams: Array<[string, string | number | boolean, string]> =
            [[vlanLeaf, wan.wanVlan, 'xsd:unsignedInt']];
          // Sin el marcado activo el CPE guarda el VLAN ID pero saca la WAN sin
          // etiqueta, que en esta red es lo mismo que dejarla muda.
          const enableLeaf = `${conn}.VLANEnable`;
          if (
            vlanLeaf === `${conn}.VLANID` &&
            genieNodeExists(device, enableLeaf)
          ) {
            vlanParams.push([enableLeaf, true, 'xsd:boolean']);
          }
          const r = await client.setParameterValues(deviceId, vlanParams);
          notes.push(
            r.status === 200
              ? `VLAN ${wan.wanVlan} aplicada (${vlanLeaf.split('.').pop()})`
              : `VLAN ${wan.wanVlan} encolada (status ${r.status})`,
          );
        } catch (e) {
          notes.push(
            `VLAN WAN falló: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      return notes.join(' · ');
    } catch (e) {
      return `WAN en DB; TR069 falló: ${e instanceof Error ? e.message : e}`;
    }
  }

  /**
   * Empuja SubnetMask en un SPV propio y, si el CPE la deja en blanco, lo
   * reintenta una vez. Algunos Huawei aceptan el resto del lote WAN y borran
   * la máscara: el resultado es Connected sin ARP.
   */
  private async ensureWanSubnetMask(
    client: GenieAcsNbiClient,
    deviceId: string,
    conn: string,
    wanMask: string,
  ): Promise<string | null> {
    const path = `${conn}.SubnetMask`;
    try {
      const first = await client.setParameterValues(deviceId, [
        [path, wanMask, 'xsd:string'],
      ]);
      if (first.status !== 200 && first.status !== 202) {
        return `máscara WAN status ${first.status}`;
      }

      // Solo podemos verificar al momento si la escritura fue síncrona.
      if (first.status === 202) {
        return `máscara ${wanMask} encolada`;
      }

      try {
        await client.refreshObject(deviceId, conn);
      } catch {
        /* si no refresca, al menos ya la escribimos */
      }
      const rows = await client.findDevices({ _id: deviceId });
      const device = rows[0];
      const got = device ? strVal(genieGet(device, path)) : null;
      if (got && got === wanMask) {
        return `máscara ${wanMask}`;
      }

      const retry = await client.setParameterValues(deviceId, [
        [path, wanMask, 'xsd:string'],
      ]);
      return retry.status === 200
        ? `máscara ${wanMask} (reintento; antes=${got || 'vacía'})`
        : `máscara reintento status ${retry.status} (antes=${got || 'vacía'})`;
    } catch (e) {
      return `máscara WAN: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /**
   * Deja al ACS en condiciones de forzar una conexión con el CPE.
   *
   * Sin estas credenciales el CPE responde 401 a la petición de conexión y todo
   * lo que mandemos se queda en cola hasta el siguiente Inform periódico, que en
   * algunos modelos pasa de la hora.
   *
   * Las ONUs migradas llegan con las credenciales del sistema anterior, así que
   * no basta con mirar si hay usuario: hay que comprobar que sea el nuestro.
   */
  private async ensureConnReqCredentials(
    client: GenieAcsNbiClient,
    deviceId: string,
    device: Record<string, unknown>,
    serial: string,
  ): Promise<string | null> {
    const root = detectDataModelRoot(device);
    const base = `${root}.ManagementServer`;
    const usernamePath = `${base}.ConnectionRequestUsername`;

    const current = strVal(genieGet(device, usernamePath));
    if (!shouldWriteConnReqCredentials(current)) return null;

    // El nodo tiene que existir en el árbol: escribir a ciegas sólo genera un
    // fallo que GenieACS reintenta para siempre.
    if (!genieNodeExists(device, usernamePath)) {
      try {
        await client.refreshObject(deviceId, base);
      } catch {
        /* seguimos: puede llegar en el próximo Inform */
      }
      return 'credenciales de conexión: falta descubrir ManagementServer';
    }

    try {
      const r = await client.setParameterValues(
        deviceId,
        buildConnReqParameterValues(serial, root),
      );
      const note =
        r.status === 200
          ? 'credenciales de conexión fijadas'
          : `credenciales de conexión encoladas (status ${r.status})`;
      const informNote = await this.ensureInformInterval(
        client,
        deviceId,
        device,
        base,
      );
      // Encoladas quiere decir que el CPE nos rechazó: hay que despertarlo con
      // las suyas o esperaría al Inform con la WAN todavía sin configurar.
      const kickNote =
        r.status === 200
          ? null
          : await this.kickWithFactoryCredentials(device, base, current, serial);

      return [note, informNote, kickNote].filter(Boolean).join(' · ');
    } catch (e) {
      return `credenciales de conexión: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /**
   * Llama al CPE por su cuenta con las credenciales que trae de fábrica.
   *
   * El ACS sólo sabe usar las que tiene guardadas, así que con un equipo
   * migrado siempre recibe 401. Una única llamada con las del sistema anterior
   * basta para que abra sesión y aplique de golpe lo que haya en cola, incluidas
   * las credenciales nuestras; a partir de ahí ya no hace falta.
   */
  private async kickWithFactoryCredentials(
    device: Record<string, unknown>,
    base: string,
    currentUsername: string | null,
    serial: string,
  ): Promise<string | null> {
    const url = strVal(genieGet(device, `${base}.ConnectionRequestURL`));
    if (!url) return null;

    let path: string;
    try {
      const parsed = new URL(url);
      path = `${parsed.pathname}${parsed.search}`;
    } catch {
      return null;
    }

    for (const cred of factoryConnReqCandidates(
      currentUsername,
      connReqPassword(serial),
    )) {
      let challenge: DigestChallenge | null;
      try {
        const first = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (first.status < 300) return 'CPE despertado sin autenticación';
        challenge = parseDigestChallenge(
          first.headers.get('www-authenticate'),
        );
      } catch {
        return 'no hay ruta hacia el CPE para despertarlo';
      }
      if (!challenge) return null;

      try {
        const res = await fetch(url, {
          headers: {
            Authorization: buildDigestAuthorization({
              challenge,
              uri: path,
              username: cred.username,
              password: cred.password,
              cnonce: newCnonce(),
            }),
          },
          signal: AbortSignal.timeout(8_000),
        });
        if (res.status < 300) return 'CPE despertado con sus credenciales';
      } catch {
        return 'no hay ruta hacia el CPE para despertarlo';
      }
    }
    return 'el CPE no acepta ninguna credencial conocida: se aplicará en su próximo Inform';
  }

  /**
   * Acorta el Inform periódico del CPE. Es lo que limita cuánto tarda en
   * aplicarse una orden si la petición de conexión falla: las ONUs migradas
   * llegan con 12 horas.
   */
  private async ensureInformInterval(
    client: GenieAcsNbiClient,
    deviceId: string,
    device: Record<string, unknown>,
    base: string,
  ): Promise<string | null> {
    const path = `${base}.PeriodicInformInterval`;
    if (!genieNodeExists(device, path)) return null;

    const raw = genieGet(device, path);
    const current = typeof raw === 'number' ? raw : Number(strVal(raw));
    if (!shouldShortenInformInterval(current)) return null;

    try {
      const r = await client.setParameterValues(deviceId, [
        [`${base}.PeriodicInformEnable`, true, 'xsd:boolean'],
        [path, CONN_REQ_INFORM_INTERVAL_S, 'xsd:unsignedInt'],
      ]);
      return r.status === 200 || r.status === 202
        ? `inform cada ${CONN_REQ_INFORM_INTERVAL_S}s`
        : `inform status ${r.status}`;
    } catch (e) {
      return `inform: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /**
   * Hoja donde vive el VLAN ID de la WAN. FiberHome la cuelga del
   * WANConnectionDevice (`X_FH_WANGponLinkConfig`), Huawei y ZTE de la propia
   * conexión, y algunos modelos (HG6246R) sólo publican el `VLANID` estándar.
   * Las propietarias van primero: cuando conviven, es la que manda. Se devuelve
   * sólo si el CPE la publica.
   */
  private findWanVlanLeaf(
    device: Record<string, unknown>,
    conn: string,
    connDevice: string,
  ): string | null {
    const candidates = [
      `${connDevice}.X_FH_WANGponLinkConfig.VLANID`,
      `${conn}.X_HW_VLAN`,
      `${conn}.X_ZTE-COM_VLANID`,
      `${conn}.X_CT-COM_VLAN`,
      `${conn}.VLANID`,
    ];
    for (const path of candidates) {
      if (genieNodeExists(device, path)) return path;
    }
    return null;
  }

  /**
   * Conexión WAN sobre la que escribir el servicio. Se descarta la de gestión
   * (la que lleva la IP de mgmt): es por donde viaja el TR-069 y sobreescribirla
   * deja la ONU incomunicada. Si es la única, se avisa en vez de tocarla.
   */
  private findWanIpConnection(
    device: Record<string, unknown>,
    mgmtIp?: string | null,
  ): { conn: string; connDevice: string; isMgmt: boolean } | null {
    const wanDevBase = 'InternetGatewayDevice.WANDevice';
    const candidates: WanConnectionCandidate[] = [];
    for (const wd of genieChildIndices(device, wanDevBase)) {
      const connBase = `${wanDevBase}.${wd}.WANConnectionDevice`;
      for (const cd of genieChildIndices(device, connBase)) {
        const connDevice = `${connBase}.${cd}`;
        const ipBase = `${connDevice}.WANIPConnection`;
        for (const ip of genieChildIndices(device, ipBase)) {
          const conn = `${ipBase}.${ip}`;
          candidates.push({
            conn,
            connDevice,
            externalIp: strVal(genieGet(device, `${conn}.ExternalIPAddress`)),
            name: strVal(genieGet(device, `${conn}.Name`)),
          });
        }
        // Sometimes only PPP exists — skip
      }
    }

    const picked = pickServiceWanConnection(candidates, mgmtIp);
    if (!picked) return null;
    return {
      conn: picked.chosen.conn,
      connDevice: picked.chosen.connDevice,
      isMgmt: picked.isMgmt,
    };
  }
}

function parsedAfterRefreshEmpty(view: Tr069OnuConfigView): boolean {
  return (
    view.wifi.length === 0 &&
    view.ethernet.length === 0 &&
    view.webUsers.length === 0
  );
}

import { ZteC3xxOltClient } from '../../drivers/olt/zte/c3xx/cli';
import { ZteC3xxOltSnmpClient } from '../../drivers/olt/zte/c3xx/snmp';
import { ZteTitanOltClient } from '../../drivers/olt/zte/titan/cli';
import { ZteTitanOltSnmpClient } from '../../drivers/olt/zte/titan/snmp';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { In, Not } from 'typeorm';
import type { AuthUser } from '../../auth/auth.types';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import {
  GenieAcsNbiClient,
  boolVal,
  genieChildIndices,
  genieGet,
  genieNodeExists,
  resolveNbiBaseUrl,
  strVal,
} from '../shared/genieacs-nbi.client';
import { IpPoolService } from '../routers/ip-pool.service';
import { ServiceVlanService } from '../olts/service-vlan.service';
import { OnuCatalogAdminService } from './onu-catalog-admin.service';
import { OnuAcsDriverCatalogService } from './onu-acs-driver-catalog.service';
import { NetworkAuditService } from './network-audit.service';
import { isZteHguModel } from '../../drivers/onu/infra/inspect-generic-playbook';
import { HuaweiOltClient } from '../../drivers/olt/huawei/huawei-olt.client';
import { resolveOltCli, type ManagedOltCliClient } from '../../drivers/olt';
import {
  DEFAULT_OLT_PORTS,
  isHuaweiOltDevice,
  isManagedOltDevice,
} from '../olts/olt.constants';
import { shouldSkipOltHealWrites } from '../olts/olt-config-backup.util';
import { stripHuaweiDialectTag } from '../../drivers/olt/huawei/huawei-olt-firmware.util';
import { oltIfFromOnuIf } from '../../drivers/olt/zte/shared/zte-olt-onu.util';
import {
  expectedInternetTcontUp,
  expectedInternetTrafficDown,
  internetTcontProfileOf,
  tcontProfileMatches,
} from '../../drivers/olt/zte/shared/zte-olt-dba.util';
import { toSystemOltProfileName } from '../../drivers/olt/zte/shared/zte-olt-speed.util';
import {
  addLanPort,
  boundEthPortsFromWan,
  iptvBridgeName,
  isIptvBridgeWan,
  isProtectedWan,
  joinLanInterfaceList,
  parseLanInterfaceList,
  removeLanPort,
  type FhWanConn,
} from '../../drivers/onu/models/fiberhome-hg6143d/iptv-bridge';
import {
  buildConnReqParameterValues,
  connReqPassword,
  CONN_REQ_INFORM_INTERVAL_S,
  CONN_REQ_USERNAME,
  detectDataModelRoot,
  shouldShortenInformInterval,
  shouldWriteConnReqCredentials,
} from '../../drivers/onu/infra/connreq-credentials';
import {
  factoryConnReqCandidates,
  requestCpeConnection,
  type ConnectionRequestResult,
} from '../../drivers/onu/infra/connreq-kick';
import {
  dataModelOf,
  wanRefreshTargets,
} from '../../drivers/onu/infra/wan-datamodel';
import { assessServiceRoute } from '../../drivers/onu/models/generic-zte/route';
import {
  resolveServiceWanForVerify,
  shouldHealServiceRoute,
} from '../../drivers/onu/infra/resolve-service-wan-for-verify';
import {
  applyGenericServiceSpv,
  decideModelPrepReboot,
  driverSkipsOmciServiceWan,
  findHuaweiInternetWan,
  listHuaweiWanIpConnections,
  mergeProgressState,
  resolveAcsModelFromDevice,
  resolveOmciPlan,
  resolveOnuDriver,
  resolveOnuModelHandler,
} from '../../drivers/onu';
import type {
  ModelPrepState,
  OnuDriver,
  OnuModelProvisionCtx,
  OnuModelProvisionWanPlan,
  OnuModelRebootResult,
  OnuOmciTr069Result,
  OnuProgressState,
} from '../../drivers/onu';
import { HG8145X6_INFORM_INTERVAL_S } from '../../drivers/onu/models/huawei-hg8145x6';
import {
  RESYNC_WAKE_DELAY_MS,
  RESYNC_WAKE_MAX_ATTEMPTS,
} from './onu-post-provision-verify.util';
import { computeIpNetwork } from '../routers/ip-pool.util';
import type { NetworkDevice } from '../shared/entities/network-device.entity';
import type { Tr069Profile } from '../shared/entities/tr069-profile.entity';
import {
  findServiceWanConnection,
  readWanConnectionState,
} from '../../drivers/onu/infra/wan-datamodel';
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

export type Tr069IptvBridgeInfo = {
  /** True when an IPTV bridge WAN exists (ports may be edited). */
  active: boolean;
  connectionPath: string | null;
  vlanId: number | null;
  boundPorts: number[];
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
  iptvBridge: Tr069IptvBridgeInfo;
  message: string | null;
};

/**
 * Espera mínima entre peticiones de conexión al mismo CPE. Varios modelos
 * contestan 401 sin reto durante unos segundos tras recibir una.
 */
const CONN_REQ_MIN_GAP_MS = 8_000;

@Injectable()
export class OnuTr069ConfigService {
  private readonly logger = new Logger(OnuTr069ConfigService.name);
  private readonly lastConnReqAt = new Map<string, number>();

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly ipPools: IpPoolService,
    private readonly serviceVlans: ServiceVlanService,
    private readonly onuCatalog: OnuCatalogAdminService,
    private readonly acsDrivers: OnuAcsDriverCatalogService,
    private readonly audit: NetworkAuditService,
    private readonly zteC3xxOlt: ZteC3xxOltClient,
    private readonly zteTitanOlt: ZteTitanOltClient,
    private readonly huaweiOlt: HuaweiOltClient,
  ) {}

  private oltCli(device: NetworkDevice): ManagedOltCliClient {
    return resolveOltCli(device, { zteC3xx: this.zteC3xxOlt, zteTitan: this.zteTitanOlt, huawei: this.huaweiOlt });
  }

  /** Persiste binding eth_0/N → VLAN para Ajustes → TV. */
  private async persistEthOmciVlan(
    schema: string,
    onuId: string,
    portIndex: number,
    vlanId: number | null,
  ): Promise<void> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) return;
    const next: Record<string, number> = { ...(onu.ethOmciVlans ?? {}) };
    const key = String(portIndex);
    if (vlanId == null) delete next[key];
    else next[key] = vlanId;
    onu.ethOmciVlans = next;
    await onuRepo.save(onu);
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

  /**
   * Cliente NBI que despierta al CPE por su cuenta.
   *
   * GenieACS no puede hacerlo: la ConnectionRequestPassword es de sólo escritura
   * y en cuanto el equipo informa el ACS se queda con el hueco que le devuelve
   * el árbol. Nosotros sí la sabemos, porque se deriva del número de serie.
   */
  private nbiFor(
    device: Record<string, unknown>,
    serial: string,
  ): GenieAcsNbiClient {
    const client = this.nbi();
    this.attachWake(client, device, serial);
    return client;
  }

  private attachWake(
    client: GenieAcsNbiClient,
    device: Record<string, unknown>,
    serial: string,
  ): void {
    client.useConnectionRequest(
      async () => (await this.wake(device, serial)).ok,
    );
  }

  /**
   * Paths donde escribir la clave Wi‑Fi. Si existen nodos PreSharedKey.1.*,
   * se usan esos y se omite el KeyPassphrase de nivel superior: Huawei con
   * BeaconType 11i lo rechaza (9007) y anula todo el lote (también el SSID).
   */
  private wifiKeyWritePaths(
    device: Record<string, unknown>,
    radio: Tr069WifiRadio,
  ): string[] {
    const prefix = radio.pathPrefix;
    const pskPaths = [
      `${prefix}.PreSharedKey.1.KeyPassphrase`,
      `${prefix}.PreSharedKey.1.PreSharedKey`,
    ].filter((p) => genieNodeExists(device, p));
    if (pskPaths.length) return pskPaths;
    if (radio.keyPath) return [radio.keyPath];
    const fallback = [
      `${prefix}.KeyPassphrase`,
      `${prefix}.X_HW_WPAKey`,
      `${prefix}.X_ZTE-COM_KeyPassphrase`,
      `${prefix}.X_FH_WPAKey`,
    ].find((p) => genieNodeExists(device, p));
    return fallback ? [fallback] : [];
  }

  private connReqUrl(device: Record<string, unknown>): string | null {
    const base = `${detectDataModelRoot(device)}.ManagementServer`;
    return strVal(genieGet(device, `${base}.ConnectionRequestURL`));
  }

  /** Petición de conexión con nuestras credenciales. */
  private wake(
    device: Record<string, unknown>,
    serial: string,
  ): Promise<ConnectionRequestResult> {
    return this.connectionRequest(
      this.connReqUrl(device),
      CONN_REQ_USERNAME,
      connReqPassword(serial),
    );
  }

  /**
   * Espacia los intentos contra un mismo CPE: varios modelos —las Huawei entre
   * ellos— contestan 401 sin reto durante unos segundos tras una petición, y
   * encadenarlas convierte un equipo sano en uno que parece inalcanzable.
   */
  private async connectionRequest(
    url: string | null,
    username: string,
    password: string,
  ): Promise<ConnectionRequestResult> {
    if (!url) return { ok: false, reason: 'sin-url', detail: 'sin URL' };
    const since = Date.now() - (this.lastConnReqAt.get(url) ?? 0);
    if (since < CONN_REQ_MIN_GAP_MS) {
      await this.sleep(CONN_REQ_MIN_GAP_MS - since);
    }
    this.lastConnReqAt.set(url, Date.now());
    const result = await requestCpeConnection(url, username, password);
    if (!result.ok) {
      this.logger.debug(
        `petición de conexión ${url}: ${result.reason} (${result.detail})`,
      );
    }
    return result;
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
    const pushTr098Wifi = (wlanBase: string) => {
      for (const i of genieChildIndices(device, wlanBase)) {
        if (wifi.some((w) => w.pathPrefix === `${wlanBase}.${i}`)) continue;
        const prefix = `${wlanBase}.${i}`;
        // PreSharedKey.* antes que KeyPassphrase: Huawei (BeaconType 11i)
        // rechaza el KeyPassphrase de nivel superior con 9007 y tumba todo el
        // SetParameterValues — incluido el SSID del mismo lote.
        const keyCandidates = [
          `${prefix}.PreSharedKey.1.KeyPassphrase`,
          `${prefix}.PreSharedKey.1.PreSharedKey`,
          `${prefix}.KeyPassphrase`,
          `${prefix}.X_HW_WPAKey`,
          `${prefix}.X_ZTE-COM_KeyPassphrase`,
          `${prefix}.X_FH_WPAKey`,
        ];
        let keyPath: string | null = null;
        let key: string | null = null;
        for (const kp of keyCandidates) {
          const raw = genieGet(device, kp);
          const v = strVal(raw);
          if (v != null && v !== '') {
            keyPath = kp;
            key = v;
            break;
          }
          if (!keyPath && (raw || genieNodeExists(device, kp))) keyPath = kp;
        }
        if (!keyPath) {
          for (const kp of keyCandidates) {
            if (genieNodeExists(device, kp)) {
              keyPath = kp;
              break;
            }
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
    };
    pushTr098Wifi('InternetGatewayDevice.LANDevice.1.WLANConfiguration');
    if (wifi.length === 0) {
      for (const lan of genieChildIndices(
        device,
        'InternetGatewayDevice.LANDevice',
      )) {
        if (lan === 1) continue;
        pushTr098Wifi(
          `InternetGatewayDevice.LANDevice.${lan}.WLANConfiguration`,
        );
      }
    }

    // —— TR-181 WiFi ——
    if (wifi.length === 0) {
      const ssidBase = 'Device.WiFi.SSID';
      for (const i of genieChildIndices(device, ssidBase)) {
        const prefix = `${ssidBase}.${i}`;
        const apPrefix = `Device.WiFi.AccessPoint.${i}`;
        const keyCandidates = [
          `${apPrefix}.Security.KeyPassphrase`,
          `${apPrefix}.Security.PreSharedKey`,
          `${prefix}.KeyPassphrase`,
        ];
        let keyPath: string | null = null;
        let key: string | null = null;
        for (const kp of keyCandidates) {
          const raw = genieGet(device, kp);
          const v = strVal(raw);
          if (v != null) {
            keyPath = kp;
            key = v;
            break;
          }
          if (!keyPath && (raw || genieNodeExists(device, kp))) keyPath = kp;
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
      const hwBase = 'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo';
      for (const i of genieChildIndices(device, hwBase)) {
        const prefix = `${hwBase}.${i}`;
        const userLeaf = genieNodeExists(device, `${prefix}.UserName`)
          ? 'UserName'
          : genieNodeExists(device, `${prefix}.Username`)
            ? 'Username'
            : 'UserName';
        const passLeaf = genieNodeExists(device, `${prefix}.Password`)
          ? 'Password'
          : genieNodeExists(device, `${prefix}.PassWord`)
            ? 'PassWord'
            : 'Password';
        webUsers.push({
          index: i,
          pathPrefix: prefix,
          usernamePath: `${prefix}.${userLeaf}`,
          passwordPath: `${prefix}.${passLeaf}`,
          username: strVal(genieGet(device, `${prefix}.${userLeaf}`)),
          password: strVal(genieGet(device, `${prefix}.${passLeaf}`)),
          enablePath: null,
          enabled: null,
          label: i === 1 ? 'Admin' : i === 2 ? 'Usuario' : `User ${i}`,
        });
      }
    }
    if (webUsers.length === 0) {
      const candidates = [
        {
          prefix: 'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1',
          user: 'UserName',
          pass: 'Password',
          label: 'Admin',
        },
        {
          prefix: 'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1',
          user: 'Username',
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
          prefix: 'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2',
          user: 'Username',
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
        {
          prefix: 'InternetGatewayDevice.X_ZTE-COM_User',
          user: 'UserName',
          pass: 'Password',
          label: 'Admin',
        },
      ];
      const seenPrefix = new Set<string>();
      let idx = 1;
      for (const c of candidates) {
        if (seenPrefix.has(c.prefix)) continue;
        if (
          !genieNodeExists(device, c.prefix) &&
          !genieGet(device, `${c.prefix}.${c.user}`) &&
          !genieGet(device, `${c.prefix}.${c.pass}`)
        ) {
          continue;
        }
        seenPrefix.add(c.prefix);
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

    const model = resolveAcsModelFromDevice(device as Record<string, unknown>);
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
    onu: { id: string; oltId: string; onuIf: string | null },
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
        !olt.mgmtHost ||
        !olt.mgmtUsername ||
        !olt.mgmtPassword
      ) {
        return ethernet;
      }
      const result = await this.oltCli(olt).getOmciEthPortVlans({
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
        // ZTE "mode tag vlan X" = acceso untagged hacia el CPE (panel: untag).
        // Huawei native-vlan ya viene como untag desde el parser.
        const vlanMode =
          omci.mode === 'tag' && omci.vlanId != null ? 'untag' : omci.mode;
        return { ...e, vlanId: omci.vlanId, vlanMode };
      });
      // Si el ACS aún no tiene ETH pero la OLT sí tiene bindings, exponerlos.
      if (merged.length === 0 && result.ports.length > 0) {
        for (const p of result.ports) {
          merged.push({
            index: p.portIndex,
            pathPrefix: '',
            enablePath: null,
            name: `eth_0/${p.portIndex}`,
            enabled: null,
            status: null,
            mac: null,
            vlanId: p.vlanId,
            vlanMode: p.mode === 'tag' && p.vlanId != null ? 'untag' : p.mode,
          });
        }
      } else {
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
            vlanMode: p.mode === 'tag' && p.vlanId != null ? 'untag' : p.mode,
          });
        }
      }
      // Mirror OMCI → DB so Ajustes → TV can list linked ONUs.
      try {
        const next: Record<string, number> = {};
        for (const p of result.ports) {
          if (p.vlanId != null) next[String(p.portIndex)] = p.vlanId;
        }
        const onuRepo = await this.tenantConnections.getOnuRepository(schema);
        const row = await onuRepo.findOne({ where: { id: onu.id } });
        if (row) {
          const prev = JSON.stringify(row.ethOmciVlans ?? {});
          const cur = JSON.stringify(next);
          if (prev !== cur) {
            row.ethOmciVlans = next;
            await onuRepo.save(row);
          }
        }
      } catch (e) {
        this.logger.debug(
          `eth_omci_vlans sync: ${e instanceof Error ? e.message : e}`,
        );
      }
      return merged.sort((a, b) => a.index - b.index);
    } catch (e) {
      this.logger.debug(
        `OMCI eth VLAN merge: ${e instanceof Error ? e.message : e}`,
      );
      return ethernet;
    }
  }

  private listFhWanConnections(device: Record<string, unknown>): FhWanConn[] {
    const out: FhWanConn[] = [];
    const base = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice';
    for (const cd of genieChildIndices(device, base)) {
      for (const kind of ['WANIPConnection', 'WANPPPConnection'] as const) {
        for (const ip of genieChildIndices(device, `${base}.${cd}.${kind}`)) {
          const path = `${base}.${cd}.${kind}.${ip}`;
          out.push({
            path,
            cdIndex: cd,
            ipIndex: ip,
            name: strVal(genieGet(device, `${path}.Name`)) ?? '',
            type: strVal(genieGet(device, `${path}.ConnectionType`)) ?? '',
            vlanId: (() => {
              const gpon = genieGet(
                device,
                `${base}.${cd}.X_FH_WANGponLinkConfig.VLANID`,
              )?.value;
              const gponN = typeof gpon === 'number' ? gpon : Number(gpon);
              if (Number.isFinite(gponN) && gponN > 0) return gponN;
              const v = genieGet(device, `${path}.VLANID`)?.value;
              const n = typeof v === 'number' ? v : Number(v);
              return Number.isFinite(n) && n > 0 ? n : null;
            })(),
            serviceList:
              strVal(genieGet(device, `${path}.X_FH_ServiceList`)) ??
              strVal(genieGet(device, `${path}.X_CT-COM_ServiceList`)) ??
              '',
            lanInterface:
              strVal(genieGet(device, `${path}.X_FH_LanInterface`)) ?? '',
            addressingType:
              strVal(genieGet(device, `${path}.AddressingType`)) ?? '',
            externalIp:
              strVal(genieGet(device, `${path}.ExternalIPAddress`)) ?? '',
          });
        }
      }
    }
    return out;
  }

  private detectIptvBridge(
    device: Record<string, unknown>,
  ): Tr069IptvBridgeInfo {
    const bridges = this.listFhWanConnections(device).filter(isIptvBridgeWan);
    if (!bridges.length) {
      return {
        active: false,
        connectionPath: null,
        vlanId: null,
        boundPorts: [],
      };
    }
    const primary = bridges[0];
    const bound = [
      ...new Set(bridges.flatMap((b) => boundEthPortsFromWan(b))),
    ].sort((a, b) => a - b);
    return {
      active: true,
      connectionPath: primary.path,
      vlanId: primary.vlanId,
      boundPorts: bound,
    };
  }

  private findInternetWan(wans: FhWanConn[]): FhWanConn | null {
    return (
      wans.find((w) => /INTERNET/i.test(w.serviceList)) ||
      wans.find((w) => /INTERNET/i.test(w.name) && /Routed/i.test(w.type)) ||
      null
    );
  }

  private async reloadAcsDevice(
    client: GenieAcsNbiClient,
    sn: string,
  ): Promise<Record<string, unknown>> {
    const device = await client.findBySerial(sn);
    if (!device) throw new BadRequestException('ONU no encontrada en ACS');
    return device;
  }

  private async ensureIptvBridgeWan(
    client: GenieAcsNbiClient,
    deviceId: string,
    sn: string,
    vlanId: number | null,
  ): Promise<{ device: Record<string, unknown>; bridge: FhWanConn }> {
    let device = await this.reloadAcsDevice(client, sn);
    let wans = this.listFhWanConnections(device);
    const wantedName = iptvBridgeName(vlanId);
    let bridge =
      wans.find(
        (w) =>
          isIptvBridgeWan(w) &&
          (vlanId == null || w.vlanId === vlanId || w.name === wantedName),
      ) || wans.find(isIptvBridgeWan);

    if (!bridge) {
      const beforeCds = new Set(wans.map((w) => w.cdIndex));
      const add = await client.addObject(
        deviceId,
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice',
      );
      this.logger.log(
        `IPTV bridge AddObject status=${add.status} for ${deviceId}`,
      );
      // Poll until a new CD appears (Genie often returns 202).
      for (let i = 0; i < 12; i++) {
        await this.sleep(2500);
        try {
          await client.refreshObject(
            deviceId,
            'InternetGatewayDevice.WANDevice.',
          );
        } catch {
          /* ignore */
        }
        await this.sleep(2000);
        device = await this.reloadAcsDevice(client, sn);
        wans = this.listFhWanConnections(device);
        const fresh = wans.find((w) => !beforeCds.has(w.cdIndex));
        if (fresh) {
          bridge = fresh;
          break;
        }
        // Empty/new IP connection on existing CD
        const empty = wans.find(
          (w) =>
            !isProtectedWan(w) &&
            !w.type &&
            !w.serviceList &&
            !beforeCds.has(w.cdIndex),
        );
        if (empty) {
          bridge = empty;
          break;
        }
      }
      if (!bridge) {
        // Last resort: highest CD that is not protected
        const candidates = wans
          .filter((w) => !isProtectedWan(w))
          .sort((a, b) => b.cdIndex - a.cdIndex);
        bridge = candidates[0];
      }
      if (!bridge) {
        throw new BadRequestException(
          'No se pudo crear el WAN bridge IPTV en la ONU (AddObject sin instancia nueva). Reintenta tras el próximo Inform.',
        );
      }
      if (isProtectedWan(bridge)) {
        throw new BadRequestException(
          'Refusing to overwrite INTERNET/TR069 WAN while creating IPTV bridge',
        );
      }
    }

    if (isProtectedWan(bridge)) {
      throw new BadRequestException(
        'El WAN seleccionado es INTERNET/TR069; abortado para no pisarlo',
      );
    }

    const params: Array<[string, string | number | boolean, string]> = [
      [bridge.path + '.Enable', true, 'xsd:boolean'],
      [bridge.path + '.ConnectionType', 'IP_Bridged', 'xsd:string'],
      [bridge.path + '.Name', wantedName, 'xsd:string'],
      [bridge.path + '.X_FH_ServiceList', 'OTHER', 'xsd:string'],
    ];
    if (vlanId != null) {
      const gponBase = bridge.path.replace(
        /\.WAN(?:IP|PPP)Connection\.\d+$/i,
        '',
      );
      const gponVlan = `${gponBase}.X_FH_WANGponLinkConfig.VLANID`;
      if (genieNodeExists(device, gponVlan)) {
        params.push(
          [
            `${gponBase}.X_FH_WANGponLinkConfig.Enable`,
            true,
            'xsd:boolean',
          ],
          [gponVlan, vlanId, 'xsd:unsignedInt'],
          [
            `${gponBase}.X_FH_WANGponLinkConfig.VLANIDMark`,
            vlanId,
            'xsd:unsignedInt',
          ],
        );
      } else {
        params.push([bridge.path + '.VLANEnable', true, 'xsd:boolean']);
        params.push([bridge.path + '.VLANID', vlanId, 'xsd:unsignedInt']);
      }
    } else if (genieNodeExists(device, bridge.path + '.VLANEnable')) {
      params.push([bridge.path + '.VLANEnable', true, 'xsd:boolean']);
    }
    // Never clear LanInterface here if already bound — caller manages ports.
    if (!bridge.lanInterface) {
      params.push([bridge.path + '.X_FH_LanInterface', '', 'xsd:string']);
    }
    await client.setParameterValues(deviceId, params, { timeoutMs: 120_000 });
    await this.sleep(3000);
    device = await this.reloadAcsDevice(client, sn);
    wans = this.listFhWanConnections(device);
    const updated =
      wans.find((w) => w.path === bridge.path) ||
      wans.find(isIptvBridgeWan) ||
      bridge;
    return { device, bridge: updated };
  }

  /**
   * Create IPTV bridge WAN (FiberHome) without touching INTERNET/TR069.
   */
  async enableIptvBridge(
    user: AuthUser,
    onuId: string,
  ): Promise<{ ok: boolean; message: string; config: Tr069OnuConfigView }> {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');
    if (!onu.sn?.trim()) throw new BadRequestException('ONU sin SN');

    const client = this.nbi();
    const device = await client.findBySerial(onu.sn);
    if (!device) throw new BadRequestException('ONU no está en el ACS');
    const deviceId = deviceIdString(device._id);
    if (!deviceId) throw new BadRequestException('ACS device id inválido');
    this.attachWake(client, device, onu.sn);

    const existing = this.detectIptvBridge(device);
    if (existing.active) {
      return {
        ok: true,
        message: 'El bridge IPTV ya estaba activo',
        config: await this.getConfig(user, onuId),
      };
    }

    await this.ensureIptvBridgeWan(client, deviceId, onu.sn, null);
    const config = await this.getConfig(user, onuId);
    if (!config.iptvBridge.active) {
      throw new BadRequestException(
        'Se envió la creación del bridge pero aún no aparece en el ACS. Espera el Inform y reintenta.',
      );
    }
    return {
      ok: true,
      message: 'Bridge IPTV creado. Ya puedes asignar VLAN TV a los puertos.',
      config,
    };
  }

  /**
   * Remove IPTV bridge WANs and return eth ports to INTERNET LanInterface.
   * Never deletes/modifies INTERNET or TR069 ConnectionType/VLAN/IP.
   */
  async disableIptvBridge(
    user: AuthUser,
    onuId: string,
  ): Promise<{ ok: boolean; message: string; config: Tr069OnuConfigView }> {
    const schema = this.requireSchema(user);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');
    if (!onu.sn?.trim()) throw new BadRequestException('ONU sin SN');

    const client = this.nbi();
    let device = await client.findBySerial(onu.sn);
    if (!device) throw new BadRequestException('ONU no está en el ACS');
    const deviceId = deviceIdString(device._id);
    if (!deviceId) throw new BadRequestException('ACS device id inválido');
    this.attachWake(client, device, onu.sn);

    let wans = this.listFhWanConnections(device);
    const bridges = wans.filter(isIptvBridgeWan);
    const internet = this.findInternetWan(wans);
    if (!internet) {
      throw new BadRequestException(
        'No se encontró la WAN INTERNET para devolver los puertos',
      );
    }

    const ports = [...new Set(bridges.flatMap((b) => boundEthPortsFromWan(b)))];
    const notes: string[] = [];

    // 1) Restore INTERNET LanInterface (only LanInterface field).
    let inetLan = parseLanInterfaceList(internet.lanInterface);
    for (const p of ports) inetLan = addLanPort(inetLan, p);
    const params: Array<[string, string | number | boolean, string]> = [
      [
        internet.path + '.X_FH_LanInterface',
        joinLanInterfaceList(inetLan),
        'xsd:string',
      ],
    ];
    for (const b of bridges) {
      params.push([b.path + '.X_FH_LanInterface', '', 'xsd:string']);
      params.push([b.path + '.Enable', false, 'xsd:boolean']);
    }
    if (params.length) {
      await client.setParameterValues(deviceId, params, { timeoutMs: 120_000 });
      notes.push('Puertos devueltos a INTERNET');
    }

    // 2) OMCI: clear eth vlan bindings + IGMP receive-port en la OLT de esta ONU
    if (onu.onuIf && ports.length) {
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
      if (
        olt &&
        isManagedOltDevice(olt.type, olt.subtype) &&
        olt.mgmtHost &&
        olt.mgmtUsername &&
        olt.mgmtPassword
      ) {
        const stored = onu.ethOmciVlans ?? {};
        for (const portIndex of ports) {
          const prevVlan = stored[String(portIndex)] ?? null;
          const omci = await this.oltCli(olt).applyOnuEthPortVlan({
            ...this.zteConn(olt),
            onuIf: onu.onuIf,
            portIndex,
            vlanId: null,
            mode: 'untag',
            subtypeHint: olt.subtype,
            firmwareHint: oltFirmwareHint(olt),
          });
          if (omci.message) notes.push(omci.message);
          if (prevVlan != null) {
            try {
              const off = await this.serviceVlans.setOnuIgmpReceivePort(
                schema,
                olt,
                onu.onuIf,
                prevVlan,
                false,
              );
              if (off.message) notes.push(off.message);
            } catch (err) {
              this.logger.warn(
                `receive-port off eth_0/${portIndex}: ${
                  err instanceof Error ? err.message : err
                }`,
              );
            }
          }
          try {
            await this.persistEthOmciVlan(schema, onu.id, portIndex, null);
          } catch (err) {
            this.logger.warn(
              `persist eth_omci_vlans clear: ${
                err instanceof Error ? err.message : err
              }`,
            );
          }
        }
      }
    }

    // 3) Delete bridge WANConnectionDevice objects (CD), never internet/tr069 CDs
    device = await this.reloadAcsDevice(client, onu.sn);
    wans = this.listFhWanConnections(device);
    for (const b of wans.filter(isIptvBridgeWan)) {
      if (isProtectedWan(b)) continue;
      const cdPath = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${b.cdIndex}`;
      try {
        await client.deleteObject(deviceId, cdPath);
        notes.push(`Bridge CD ${b.cdIndex} eliminado`);
      } catch (e) {
        this.logger.warn(
          `delete IPTV bridge CD ${b.cdIndex}: ${
            e instanceof Error ? e.message : e
          }`,
        );
        notes.push(`No se pudo borrar CD ${b.cdIndex} (quedó deshabilitado)`);
      }
    }

    await this.sleep(2000);
    const config = await this.getConfig(user, onuId);
    return {
      ok: true,
      message: notes.join(' · ') || 'Bridge IPTV eliminado',
      config,
    };
  }

  /**
   * Move one eth port onto IPTV bridge WAN for vlanId (FiberHome LanInterface).
   * Only mutates X_FH_LanInterface on INTERNET and the IPTV bridge — never
   * ConnectionType/VLAN/IP of INTERNET or TR069.
   */
  private async bindFhPortToIptvBridge(params: {
    client: GenieAcsNbiClient;
    deviceId: string;
    sn: string;
    portIndex: number;
    vlanId: number | null;
  }): Promise<string> {
    const { client, deviceId, sn, portIndex, vlanId } = params;
    let device = await this.reloadAcsDevice(client, sn);
    let wans = this.listFhWanConnections(device);
    const internet = this.findInternetWan(wans);
    if (!internet) {
      throw new BadRequestException('WAN INTERNET no encontrada en la ONU');
    }

    if (vlanId == null) {
      // Unbind: remove from all bridges, add back to internet
      const bridges = wans.filter(isIptvBridgeWan);
      let inetLan = parseLanInterfaceList(internet.lanInterface);
      inetLan = addLanPort(inetLan, portIndex);
      const spv: Array<[string, string | number | boolean, string]> = [
        [
          internet.path + '.X_FH_LanInterface',
          joinLanInterfaceList(inetLan),
          'xsd:string',
        ],
      ];
      for (const b of bridges) {
        if (isProtectedWan(b)) continue;
        const next = removeLanPort(
          parseLanInterfaceList(b.lanInterface),
          portIndex,
        );
        spv.push([
          b.path + '.X_FH_LanInterface',
          joinLanInterfaceList(next),
          'xsd:string',
        ]);
      }
      await client.setParameterValues(deviceId, spv, { timeoutMs: 120_000 });
      return `eth_0/${portIndex} devuelto a INTERNET`;
    }

    const { bridge } = await this.ensureIptvBridgeWan(
      client,
      deviceId,
      sn,
      vlanId,
    );
    if (isProtectedWan(bridge)) {
      throw new BadRequestException('Abortado: bridge apunta a WAN protegida');
    }

    device = await this.reloadAcsDevice(client, sn);
    wans = this.listFhWanConnections(device);
    const inet = this.findInternetWan(wans) || internet;
    const br =
      wans.find((w) => w.path === bridge.path) ||
      wans.find((w) => isIptvBridgeWan(w) && w.vlanId === vlanId) ||
      bridge;

    const inetLan = removeLanPort(
      parseLanInterfaceList(inet.lanInterface),
      portIndex,
    );
    // Also remove port from other IPTV bridges
    const spv: Array<[string, string | number | boolean, string]> = [
      [
        inet.path + '.X_FH_LanInterface',
        joinLanInterfaceList(inetLan),
        'xsd:string',
      ],
      [br.path + '.ConnectionType', 'IP_Bridged', 'xsd:string'],
      [br.path + '.Name', iptvBridgeName(vlanId), 'xsd:string'],
      [br.path + '.X_FH_ServiceList', 'OTHER', 'xsd:string'],
      [br.path + '.Enable', true, 'xsd:boolean'],
      [
        br.path + '.X_FH_LanInterface',
        joinLanInterfaceList(
          addLanPort(parseLanInterfaceList(br.lanInterface), portIndex),
        ),
        'xsd:string',
      ],
    ];
    const gponBase = br.path.replace(/\.WAN(?:IP|PPP)Connection\.\d+$/i, '');
    const gponVlan = `${gponBase}.X_FH_WANGponLinkConfig.VLANID`;
    if (genieNodeExists(device, gponVlan)) {
      spv.push(
        [`${gponBase}.X_FH_WANGponLinkConfig.Enable`, true, 'xsd:boolean'],
        [gponVlan, vlanId, 'xsd:unsignedInt'],
        [
          `${gponBase}.X_FH_WANGponLinkConfig.VLANIDMark`,
          vlanId,
          'xsd:unsignedInt',
        ],
      );
    } else {
      spv.push(
        [br.path + '.VLANID', vlanId, 'xsd:unsignedInt'],
        [br.path + '.VLANEnable', true, 'xsd:boolean'],
      );
    }
    for (const other of wans.filter(
      (w) => isIptvBridgeWan(w) && w.path !== br.path,
    )) {
      spv.push([
        other.path + '.X_FH_LanInterface',
        joinLanInterfaceList(
          removeLanPort(parseLanInterfaceList(other.lanInterface), portIndex),
        ),
        'xsd:string',
      ]);
    }
    await client.setParameterValues(deviceId, spv, { timeoutMs: 120_000 });
    return `eth_0/${portIndex} → bridge VLAN ${vlanId}`;
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
      iptvBridge: {
        active: false,
        connectionPath: null,
        vlanId: null,
        boundPorts: [],
      },
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
      const ethernet = await this.mergeOmciEthVlans(
        schema,
        onu,
        parsed.ethernet,
      );
      const iptvBridge = this.detectIptvBridge(device);
      // Primera vez en ACS con WAN en auto: arranca el chequeo para que el
      // badge «test» aparezca al lado de ACS (ONUs migradas/antiguas se
      // quedaban en idle para siempre).
      if (
        onu.provisionMode !== 'manual' &&
        !!onu.wanIp?.trim() &&
        onu.verifyStatus === 'idle' &&
        !onu.verifyStartedAt
      ) {
        try {
          await this.markPostProvisionVerify(schema, onu.id);
        } catch (e) {
          this.logger.debug(
            `auto-verify ${onu.sn}: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
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
        iptvBridge,
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
    this.attachWake(client, device, onu.sn);
    const deviceId = deviceIdString(device._id);
    const parsed = this.parseDevice(device);
    const params: Array<[string, string | number | boolean, string?]> = [];
    const omciNotes: string[] = [];

    if (dto.refresh) {
      // First Inform is often DeviceInfo-only; pull LAN + WiFi + web-user trees.
      const refreshTargets = [
        'InternetGatewayDevice.LANDevice',
        'InternetGatewayDevice.DeviceInfo.X_FH_Account',
        'InternetGatewayDevice.UserInterface',
        'Device.Users',
        'Device.WiFi',
        ...wanRefreshTargets(dataModelOf(device)),
      ];
      for (const objectName of refreshTargets) {
        try {
          await client.refreshObject(deviceId, objectName);
        } catch {
          /* best-effort per vendor tree */
        }
      }

      // Re-read tree so we can request concrete leaves that GenieACS discovered
      // without `_value` yet (common after first refreshObject).
      let fresh = device;
      try {
        const again = await client.findBySerial(onu.sn);
        if (again) fresh = again;
      } catch {
        /* keep original */
      }
      const parsedFresh = this.parseDevice(fresh);
      const leafPaths = new Set<string>();
      for (const w of parsedFresh.wifi) {
        leafPaths.add(w.ssidPath);
        if (w.keyPath) leafPaths.add(w.keyPath);
        if (w.enablePath) leafPaths.add(w.enablePath);
      }
      for (const u of parsedFresh.webUsers) {
        leafPaths.add(u.usernamePath);
        leafPaths.add(u.passwordPath);
      }
      // FiberHome / Huawei / ZTE fallbacks if tree still empty.
      for (const p of [
        'InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebSuperUsername',
        'InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebSuperPassword',
        'InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebUsername',
        'InternetGatewayDevice.DeviceInfo.X_FH_Account.X_FH_WebUserInfo.WebPassword',
        'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1.UserName',
        'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1.Password',
        'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2.UserName',
        'InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2.Password',
        'InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.1.UserName',
        'InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.1.Password',
        'InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.2.UserName',
        'InternetGatewayDevice.UserInterface.X_ZTE-COM_WebUserInfo.2.Password',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase',
        'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.PreSharedKey',
      ]) {
        leafPaths.add(p);
      }
      if (leafPaths.size > 0) {
        try {
          await client.getParameterValues(deviceId, [...leafPaths]);
        } catch {
          /* optional */
        }
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
      if (w.key != null) {
        for (const kp of this.wifiKeyWritePaths(device, radio)) {
          params.push([kp, w.key, 'xsd:string']);
        }
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
      if (!onu.onuIf) {
        throw new BadRequestException('ONU sin interfaz OLT (onuIf)');
      }
      const oltClient = this.oltCli(olt);
      for (const e of ethVlanPatches) {
        const vlanSpecified = Object.prototype.hasOwnProperty.call(e, 'vlanId');
        const vlanId = vlanSpecified ? (e.vlanId ?? null) : null;
        if (!vlanSpecified) continue;
        const mode = e.vlanMode ?? 'untag';

        // Asegura VLAN en OLT + uplink antes del binding OMCI.
        if (vlanId != null) {
          try {
            const uplink = await this.serviceVlans.ensureVlanTaggedOnUplinks(
              schema,
              onu.oltId,
              vlanId,
              `TV eth_0/${e.index}`,
              { forIptv: true },
            );
            if (uplink.message) omciNotes.push(uplink.message);
          } catch (err) {
            this.logger.warn(
              `ensure uplink VLAN ${vlanId}: ${
                err instanceof Error ? err.message : err
              }`,
            );
          }
          if (isHuaweiOltDevice(olt.type, olt.subtype)) {
            const created = await this.huaweiOlt.upsertVlan({
              ...this.zteConn(olt),
              vlanId,
              description: 'TV',
            });
            if (!created.ok) {
              omciNotes.push(
                `VLAN ${vlanId}: ${created.error || 'aviso Huawei'}`,
              );
            } else if ('message' in created && created.message) {
              omciNotes.push(created.message);
            }
          } else {
            const ponIf = oltIfFromOnuIf(onu.onuIf);
            if (ponIf) {
              const ponTag = await this.oltCli(olt).upsertVlan({
                ...this.zteConn(olt),
                vlanId,
                description: `TV`,
                defaultPonPorts: [ponIf],
                previousDefaultPonPorts: [],
              });
              if (!ponTag.ok) {
                omciNotes.push(
                  `PON ${ponIf} VLAN ${vlanId}: ${ponTag.error || 'aviso'}`,
                );
              } else if (ponTag.message) {
                omciNotes.push(ponTag.message);
              }
            }
          }
        }

        const omci = await oltClient.applyOnuEthPortVlan({
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

        // IGMP receive-port en la MVLAN (lado OLT) para esta ONU/vport IPTV.
        // Siempre sobre la OLT de la ONU (`onu.oltId`), nunca otra.
        const prevEth = parsed.ethernet.find((x) => x.index === e.index);
        const previousVlanId = prevEth?.vlanId ?? null;
        if (onu.onuIf) {
          try {
            if (
              previousVlanId != null &&
              previousVlanId !== vlanId
            ) {
              const off = await this.serviceVlans.setOnuIgmpReceivePort(
                schema,
                olt,
                onu.onuIf,
                previousVlanId,
                false,
              );
              if (off.message) omciNotes.push(off.message);
              else if (!off.ok && off.error) {
                omciNotes.push(`receive-port off: ${off.error}`);
              }
            }
            if (vlanId != null) {
              const on = await this.serviceVlans.setOnuIgmpReceivePort(
                schema,
                olt,
                onu.onuIf,
                vlanId,
                true,
              );
              if (on.message) omciNotes.push(on.message);
              else if (!on.ok && on.error) {
                omciNotes.push(`receive-port: ${on.error}`);
              }
            }
          } catch (err) {
            this.logger.warn(
              `IGMP receive-port eth_0/${e.index}: ${
                err instanceof Error ? err.message : err
              }`,
            );
            omciNotes.push(
              `receive-port aviso: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }

        try {
          await this.persistEthOmciVlan(schema, onu.id, e.index, vlanId);
        } catch (err) {
          this.logger.warn(
            `persist eth_omci_vlans: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }

        // FiberHome HGU: también mover X_FH_LanInterface al WAN bridge IPTV
        // (OMCI solo no saca el puerto de la LAN/INTERNET).
        try {
          const mfr = (
            parsed.manufacturer ||
            strVal(
              genieGet(device, 'InternetGatewayDevice.DeviceInfo.Manufacturer'),
            ) ||
            ''
          ).toLowerCase();
          const isFh =
            mfr.includes('fiberhome') ||
            mfr.includes('fiber home') ||
            /fhtt|hg62|hg61/i.test(onu.sn || '') ||
            genieNodeExists(
              device,
              'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_FH_LanInterface',
            );
          if (isFh) {
            const bridgeState = this.detectIptvBridge(device);
            if (!bridgeState.active && vlanId != null) {
              throw new BadRequestException(
                'Activa el bridge IPTV antes de asignar VLAN TV a un puerto',
              );
            }
            const note = await this.bindFhPortToIptvBridge({
              client,
              deviceId,
              sn: onu.sn,
              portIndex: e.index,
              vlanId,
            });
            omciNotes.push(note);
            // Refresh device snapshot for subsequent ports
            const refreshed = await client.findBySerial(onu.sn);
            if (refreshed) Object.assign(device, refreshed);
          }
        } catch (err) {
          if (err instanceof BadRequestException) throw err;
          this.logger.warn(
            `FH lanbind eth_0/${e.index}: ${
              err instanceof Error ? err.message : err
            }`,
          );
          omciNotes.push(
            `TR069 lanbind aviso: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
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
      // Wi‑Fi / usuarios / Ethernet del modal: encolar al tiro. Esperar el
      // connreq (hasta 120s) dejaba la UI en «Aplicando…» sin aportar más
      // certeza — el CPE a veces sólo recoge en el Inform. El wake va en
      // background para adelantar cuando el CPE sí contesta.
      const result = await client.setParameterValues(deviceId, params, {
        wait: false,
      });
      taskStatus = result.status;
      void this.wake(device, onu.sn).catch((e) =>
        this.logger.debug(
          `wake tras applyConfig ${onu.sn}: ${
            e instanceof Error ? e.message : e
          }`,
        ),
      );
    }

    // Re-read after apply (may still be stale if 202 queued)
    const view = await this.getConfig(user, onuId);
    const omciSuffix = omciNotes.length ? ` · ${omciNotes.join(' · ')}` : '';
    const queued = taskStatus === 202 || (params.length > 0 && taskStatus !== 200);
    return {
      ok: true,
      taskStatus,
      queued,
      message:
        queued
          ? `Cambios encolados; se aplicarán en el próximo Inform o al despertar la ONU. Usa «Refrescar desde ONU» para confirmar.${omciSuffix}`
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

    const dba = await this.resolveInternetDba(schema, onu.id);
    const result = await this.oltCli(olt).applyOnuServiceVlans({
      ...conn,
      onuIf: onu.onuIf,
      wanVlan,
      mgmtVlan,
      internetTcontProfile: dba?.upProfile ?? null,
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

  async resolveInternetDba(
    schema: string,
    onuId: string,
  ): Promise<{
    upProfile: string;
    downProfile: string | null;
    speedProfileName: string;
    oltBaseName: string;
    downloadMbps: number;
    uploadMbps: number;
  } | null> {
    const svcRepo =
      await this.tenantConnections.getClientServiceRepository(schema);
    const svc = await svcRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.servicePlan', 'plan')
      .leftJoinAndSelect('plan.speedProfile', 'sp')
      .where('s.onu_id = :onuId', { onuId })
      .orderBy(`CASE WHEN s.status = 'ended' THEN 1 ELSE 0 END`, 'ASC')
      .addOrderBy('s.createdAt', 'DESC')
      .getOne();
    const sp = svc?.servicePlan?.speedProfile;
    const name = sp?.name?.trim();
    const up = expectedInternetTcontUp(name);
    const oltBaseName = name ? toSystemOltProfileName(name) : null;
    if (!up || !oltBaseName || !sp) return null;
    return {
      upProfile: up,
      downProfile: expectedInternetTrafficDown(name),
      speedProfileName: name!,
      oltBaseName,
      downloadMbps: sp.downloadMbps,
      uploadMbps: sp.uploadMbps,
    };
  }

  /** Crea el par UP/DOWN en la OLT si el plan lo exige y aún no está. */
  private async ensureOltSpeedProfile(
    olt: NetworkDevice,
    expected: {
      upProfile: string;
      oltBaseName: string;
      downloadMbps: number;
      uploadMbps: number;
    },
  ): Promise<{ ok: boolean; message: string }> {
    const protocol: 'telnet' | 'ssh' =
      olt.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
    const conn = {
      host: olt.mgmtHost!,
      port:
        olt.mgmtPort ??
        (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet),
      protocol,
      username: olt.mgmtUsername!,
      password: olt.mgmtPassword!,
    };
    const cli = this.oltCli(olt);
    const listed = await cli.listSpeedProfiles({
      ...conn,
      priority: 'interactive',
    });
    if (listed.ok) {
      const hit = listed.profiles.some(
        (p) =>
          p.uploadProfile?.trim().toUpperCase() ===
          expected.upProfile.trim().toUpperCase(),
      );
      if (hit) {
        return { ok: true, message: `${expected.upProfile} ya en OLT` };
      }
    }
    const upsert = await cli.upsertSpeedProfile({
      ...conn,
      name: expected.oltBaseName,
      downloadMbps: expected.downloadMbps,
      uploadMbps: expected.uploadMbps,
    });
    if (!upsert.ok) {
      return {
        ok: false,
        message: upsert.error || `no se creó ${expected.upProfile} en OLT`,
      };
    }
    return {
      ok: true,
      message: upsert.message ?? `${expected.upProfile} sincronizado a OLT`,
    };
  }

  /**
   * Alinea T-CONT 1 de internet con el plan CRM. Una escritura si hay mismatch.
   */
  async syncInternetDba(
    schema: string,
    onuId: string,
    opts?: { heal?: boolean },
  ): Promise<{
    ok: boolean;
    matched: boolean;
    expected: string | null;
    actual: string | null;
    message: string;
    healed: boolean;
  }> {
    const t0 = Date.now();
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu?.onuIf) {
      return {
        ok: false,
        matched: false,
        expected: null,
        actual: null,
        message: 'ONU sin interfaz OLT',
        healed: false,
      };
    }
    const expected = await this.resolveInternetDba(schema, onuId);
    if (!expected) {
      return {
        ok: true,
        matched: true,
        expected: null,
        actual: null,
        message: 'sin plan/perfil de velocidad ligado',
        healed: false,
      };
    }
    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
    if (!olt || !isManagedOltDevice(olt.type, olt.subtype)) {
      return {
        ok: false,
        matched: false,
        expected: expected.upProfile,
        actual: null,
        message: 'OLT no gestionada',
        healed: false,
      };
    }
    if (!olt.mgmtHost || !olt.mgmtUsername || !olt.mgmtPassword) {
      return {
        ok: false,
        matched: false,
        expected: expected.upProfile,
        actual: null,
        message: 'OLT sin credenciales',
        healed: false,
      };
    }
    const heal =
      opts?.heal === true && !shouldSkipOltHealWrites(olt.technicianMode);
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
      onuIf: onu.onuIf,
      subtypeHint: olt.subtype,
      firmwareHint: oltFirmwareHint(olt),
    };
    const cli = this.oltCli(olt);
    const read = await cli.readOnuTcontBinds(conn);
    const actual = internetTcontProfileOf(read.tconts ?? []);
    if (tcontProfileMatches(actual, expected.upProfile)) {
      return {
        ok: true,
        matched: true,
        expected: expected.upProfile,
        actual,
        message: `T-CONT 1 ${actual}`,
        healed: false,
      };
    }
    if (!heal) {
      return {
        ok: false,
        matched: false,
        expected: expected.upProfile,
        actual,
        message: shouldSkipOltHealWrites(olt.technicianMode)
          ? 'Técnico en OLT: no escribe T-CONT'
          : `T-CONT 1 ${actual ?? '—'} ≠ ${expected.upProfile}`,
        healed: false,
      };
    }
    const ensured = await this.ensureOltSpeedProfile(olt, expected);
    if (!ensured.ok) {
      const fail = {
        ok: false,
        matched: false,
        expected: expected.upProfile,
        actual,
        message: ensured.message,
        healed: false,
      };
      await this.audit.record(schema, {
        action: 'dba_heal',
        actorKind: 'system',
        ok: false,
        durationMs: Date.now() - t0,
        sn: onu.sn,
        onuId: onu.id,
        oltId: onu.oltId,
        onuIf: onu.onuIf,
        detail: { message: fail.message },
      });
      return fail;
    }
    const applied = await cli.applyOnuInternetTcont({
      ...conn,
      upProfile: expected.upProfile,
      downProfile: expected.downProfile,
    });
    if (!applied.ok) {
      const fail = {
        ok: false,
        matched: false,
        expected: expected.upProfile,
        actual,
        message: applied.error || 'no se aplicó T-CONT',
        healed: false,
      };
      await this.audit.record(schema, {
        action: 'dba_heal',
        actorKind: 'system',
        ok: false,
        durationMs: Date.now() - t0,
        sn: onu.sn,
        onuId: onu.id,
        oltId: onu.oltId,
        onuIf: onu.onuIf,
        detail: { message: fail.message },
      });
      return fail;
    }
    const again = await cli.readOnuTcontBinds(conn);
    const after = internetTcontProfileOf(again.tconts ?? []);
    const matched = tcontProfileMatches(after, expected.upProfile);
    const out = {
      ok: matched,
      matched,
      expected: expected.upProfile,
      actual: after,
      message: matched
        ? `T-CONT 1 curado → ${after}`
        : `T-CONT 1 sigue ${after ?? '—'} (esperado ${expected.upProfile})`,
      healed: true,
    };
    await this.audit.record(schema, {
      action: 'dba_heal',
      actorKind: 'system',
      ok: out.ok,
      durationMs: Date.now() - t0,
      sn: onu.sn,
      onuId: onu.id,
      oltId: onu.oltId,
      onuIf: onu.onuIf,
      detail: { message: out.message },
    });
    return out;
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
        let preferIp: string | null = null;
        if (onu.sn?.trim()) {
          preferIp = await this.peekAcsInternetIp(onu.sn).catch(() => null);
        }
        const wan = await this.ipPools.assignWanIp(
          schema,
          onu,
          dto.wanVlanId,
          { preferIp },
        );
        notes.push(
          preferIp && wan.wanIp === preferIp
            ? `WAN ${wan.wanIp} (VLAN ${wan.wanVlan}, reutilizada del ACS)`
            : `WAN ${wan.wanIp} (VLAN ${wan.wanVlan})`,
        );
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

    // Modelo real del ACS antes de elegir driver / plan OMCI·TR069.
    try {
      const sync = await this.onuCatalog.syncOnuTypeFromAcs(schema, onuId);
      if (sync.message) notes.push(sync.message);
      if (sync.changed) {
        onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
      }
    } catch (err) {
      notes.push(
        `Modelo ACS: ${err instanceof Error ? err.message : 'error'}`,
      );
    }

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
        // HG8145X6 et al.: WAN solo por ACS — tras OMCI hay que despertar el
        // agente (reboot) para que Inform drene AddObject/SPV.
        const drv = resolveOnuDriver({
          sn: onu.sn ?? '',
          onuType: onu.onuType,
          acsModel: null,
        });
        if (
          (driverSkipsOmciServiceWan(drv) ||
            isZteHguModel(onu.onuType, null)) &&
          again.omciOk !== false
        ) {
          const rb = await this.rebootOnuWithCap(
            schema,
            { id: onu.id, oltId: onu.oltId, onuIf: onu.onuIf },
            true,
          );
          notes.push(`post-OMCI ${rb.note}`);
        }
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
            const wanPlan = {
              wanIp: onu.wanIp,
              wanVlan: wanPool.vlanId,
              wanGateway: wanPool.gateway,
              wanMask,
              wanDns1: wanPool.dns1,
              wanDns2: wanPool.dns2,
            };

            // Política OMCI del modelo: skip → plan ACS; apply → wan-ip OLT primero.
            let acsModelForDriver: string | null = null;
            if (onu.sn?.trim()) {
              try {
                const acsDev = await this.nbi().findBySerial(onu.sn);
                acsModelForDriver = resolveAcsModelFromDevice(
                  acsDev as Record<string, unknown> | null,
                );
              } catch {
                /* sin ACS aún → match solo por onuType */
              }
            }
            const onuDriver = resolveOnuDriver({
              sn: onu.sn ?? '',
              onuType: onu.onuType,
              acsModel: acsModelForDriver,
            });
            const omciPlan = resolveOmciPlan(onuDriver);
            if (omciPlan.serviceWanOmci === 'skip') {
              if (onu.provisionMode === 'manual') {
                onu.provisionMode = 'auto';
                await onuRepo.save(onu);
              }
              notes.push(
                `OMCI WAN omitido · driver ${onuDriver?.id ?? '?'} (omciPlan.skip)`,
              );
              const tr069 = await this.applyWanStaticTr069(schema, onu, wanPlan, {
                explicit: true,
              });
              notes.push(tr069);
            } else {
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
                const tr069 = await this.applyWanStaticTr069(
                  schema,
                  onu,
                  wanPlan,
                  { explicit: true },
                );
                notes.push(tr069);
              }
            }
          } else {
            notes.push('WAN sin pool/DNS — OMCI skip');
          }
        }
      } else {
        notes.push('OLT sin credenciales — WAN OMCI skip');
      }
    }

    // Tras un apply con WAN en auto, arranca el chequeo silencioso de 15 min.
    onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
    await this.markPostProvisionVerify(schema, onu.id);

    return {
      ok: true,
      message: notes.join(' · ') || 'Nada que aplicar a la ONU',
      provisionMode: onu.provisionMode,
      tr069ProfileId: onu.tr069ProfileId,
      tr069Enabled: !!onu.tr069ProfileId && !!onu.mgmtIp,
    };
  }

  /**
   * Arranca el chequeo silencioso de 15 min tras un apply con WAN en modo auto.
   * Se escribe directo en BD para no acoplar el poller al flujo de VLANs.
   */
  async markPostProvisionVerify(schema: string, onuId: string): Promise<void> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) return;
    if (onu.provisionMode === 'manual') return;
    if (!onu.wanIp?.trim()) return;
    onu.verifyStatus = 'test';
    onu.verifyStartedAt = new Date();
    onu.verifyCheckedAt = null;
    onu.verifyAttempt = 0;
    // Conservar progress ACS del apply — el modal del script lo necesita.
    const prev = (onu.verifyDetail ?? {}) as { progress?: OnuProgressState };
    onu.verifyDetail = prev.progress ? { progress: prev.progress } : {};
    await onuRepo.save(onu);
  }

  /** Curación usada por el poller: reescribe credenciales ajenas y despierta el CPE. */
  async healConnReqForVerify(
    schema: string,
    onuId: string,
  ): Promise<string | null> {
    const result = await this.ensureCredentialsFirst(schema, onuId);
    return result.note;
  }

  /**
   * Paso 0 de cualquier curación TR-069: las credenciales de petición de
   * conexión tienen que ser las nuestras. Sin ellas el ACS recibe 401 y toda
   * la WAN se queda en cola hasta el Inform periódico.
   *
   * Un único intento (encola + kick). El Resync forzado usa `wakeForTr069`
   * para insistir varias veces.
   *
   * `probeReachable` sólo lo pide el Resync: el silencioso no necesita pegarle
   * al CPE en cada tick si el usuario ya es el nuestro.
   */
  async ensureCredentialsFirst(
    schema: string,
    onuId: string,
    opts?: { probeReachable?: boolean },
  ): Promise<{
    ours: boolean;
    awake: boolean;
    username: string | null;
    note: string | null;
  }> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu?.sn?.trim()) {
      return {
        ours: false,
        awake: false,
        username: null,
        note: 'credenciales: sin SN',
      };
    }
    try {
      let device = await this.nbi().findBySerial(onu.sn);
      if (!device?._id) {
        return {
          ours: false,
          awake: false,
          username: null,
          note: 'credenciales: sin Inform al ACS',
        };
      }
      const client = this.nbiFor(device, onu.sn);
      const deviceId = deviceIdString(device._id);
      const root = detectDataModelRoot(device);
      const usernamePath = `${root}.ManagementServer.ConnectionRequestUsername`;
      let username = strVal(genieGet(device, usernamePath));

      if (!shouldWriteConnReqCredentials(username)) {
        if (!opts?.probeReachable) {
          return { ours: true, awake: true, username, note: null };
        }
        const probe = await this.probeConnectionRequest(device, onu.sn);
        if (probe.ok) {
          return { ours: true, awake: true, username, note: null };
        }
        // Username `acs` también es el de fábrica Huawei (y a veces migradas).
        // 401 `limitado` / digest / timeout → reescribir password (Inform).
        const rewritten = await this.ensureConnReqCredentials(
          client,
          deviceId,
          device,
          onu.sn,
          { force: true },
        );
        return {
          ours: false,
          awake: false,
          username,
          note:
            rewritten ??
            `CR falló (${probe.reason}): ${probe.detail} → reescribir clave`,
        };
      }

      const note = await this.ensureConnReqCredentials(
        client,
        deviceId,
        device,
        onu.sn,
      );
      device = (await client.findBySerial(onu.sn)) ?? device;
      username = strVal(genieGet(device, usernamePath));
      const ours = !shouldWriteConnReqCredentials(username);
      const awake =
        opts?.probeReachable && ours
          ? (await this.probeConnectionRequest(device, onu.sn)).ok
          : ours;
      return {
        ours,
        awake,
        username,
        note: note ?? (ours ? 'credenciales nuestras' : null),
      };
    } catch (e) {
      return {
        ours: false,
        awake: false,
        username: null,
        note: `credenciales: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * Resync forzado: insiste hasta que el ACS pueda hablar con el CPE.
   *
   * Orden por intento: comprobar usuario → si es ajeno, encolar el nuestro +
   * acortar Inform + kick con las credenciales heredadas → probar
   * connection_request. Si el CPE abre sesión (Inform o kick), el siguiente
   * intento ya ve usuario `acs` y un SPV 200.
   */
  async wakeForTr069(
    schema: string,
    onuId: string,
    opts?: { maxAttempts?: number; delayMs?: number },
  ): Promise<{
    ok: boolean;
    awake: boolean;
    ours: boolean;
    attempts: number;
    username: string | null;
    notes: string[];
    message: string;
  }> {
    const maxAttempts = Math.max(
      1,
      opts?.maxAttempts ?? RESYNC_WAKE_MAX_ATTEMPTS,
    );
    const delayMs = Math.max(0, opts?.delayMs ?? RESYNC_WAKE_DELAY_MS);
    const notes: string[] = [];

    // Por si el apply anterior no pudo ver el ACS aún: sincroniza modelo
    // antes de curar WAN (el driver depende de onu_type + ProductClass).
    try {
      const sync = await this.onuCatalog.syncOnuTypeFromAcs(schema, onuId);
      if (sync.message) notes.push(sync.message);
    } catch (err) {
      notes.push(
        `Modelo ACS: ${err instanceof Error ? err.message : 'error'}`,
      );
    }

    let awake = false;
    let ours = false;
    let username: string | null = null;
    let attempts = 0;

    for (let i = 1; i <= maxAttempts; i += 1) {
      attempts = i;
      const tick = await this.ensureCredentialsFirst(schema, onuId, {
        probeReachable: true,
      });
      username = tick.username;
      ours = tick.ours;
      awake = tick.awake;
      if (tick.note) notes.push(`intento ${i}: ${tick.note}`);

      if (awake && ours) {
        // Ya despierta: reempujar WAN/DNS por si el apply anterior quedó en cola.
        const wanNote = await this.repushWanForVerify(schema, onuId);
        if (wanNote) notes.push(wanNote);
        const routeNote = await this.healServiceRouteForVerify(schema, onuId);
        if (routeNote) notes.push(routeNote);
        return {
          ok: true,
          awake: true,
          ours: true,
          attempts,
          username,
          notes,
          message: `ONU despierta tras ${attempts} intento(s)`,
        };
      }

      if (i < maxAttempts && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return {
      ok: false,
      awake,
      ours,
      attempts,
      username,
      notes,
      message: awake
        ? `ACS alcanzó al CPE pero credenciales aún ajenas (${username || '—'})`
        : `ONU no despertó tras ${attempts} intento(s); se aplicará en su próximo Inform`,
    };
  }

  /**
   * ¿Contesta el CPE a una petición de conexión nuestra?
   *
   * No vale preguntárselo al ACS encolando un refresh: esa tarea también se
   * completa cuando llega el Inform periódico, así que con Informs cada pocos
   * minutos daba por «despierta» a una ONU que rechazaba todas las peticiones.
   */
  async probeConnectionRequest(
    device: Record<string, unknown>,
    serial: string,
  ): Promise<ConnectionRequestResult> {
    return this.wake(device, serial);
  }

  /** Curación usada por el poller: vuelve a empujar WAN/NAT/máscara/VLAN. */
  async repushWanForVerify(
    schema: string,
    onuId: string,
  ): Promise<string | null> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    let onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu?.wanIp || !onu.wanPoolId) return null;
    const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
    let wanPool = await poolRepo.findOne({ where: { id: onu.wanPoolId } });
    if (!wanPool?.dns1) return 'curación WAN: pool sin DNS';
    try {
      const sn = onu.sn?.trim();
      if (!sn) return 'curación WAN: sin SN';
      const client = this.nbi();
      const device = await client.findBySerial(sn);
      if (!device?._id) return 'curación WAN: ONU aún no Informó al ACS';
      const deviceDoc = device as Record<string, unknown>;

      // Si el CPE ya tiene otra IP del mismo pool (fantasma post-delete),
      // alinear BD en lugar de SPV ExternalIPAddress (Huawei 9005 sin carrier).
      const acsIp = this.internetIpFromDevice(deviceDoc);
      const adoptNotes: string[] = [];
      if (acsIp && acsIp !== onu.wanIp) {
        const adopt = await this.ipPools.adoptWanIpIfFree(schema, onu, acsIp);
        if (adopt.adopted) {
          adoptNotes.push(adopt.note);
          onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
          wanPool = onu.wanPoolId
            ? await poolRepo.findOne({ where: { id: onu.wanPoolId } })
            : wanPool;
          if (!onu?.wanIp || !wanPool?.dns1) {
            return adoptNotes.join(' · ');
          }
        } else if (adopt.note.includes('ocupada')) {
          adoptNotes.push(adopt.note);
        }
      }

      const wan: OnuModelProvisionWanPlan = {
        wanIp: onu.wanIp!,
        wanVlan: wanPool!.vlanId,
        wanGateway: wanPool!.gateway,
        wanMask: prefixToMask(wanPool!.prefix),
        wanDns1: wanPool!.dns1!,
        wanDns2: wanPool!.dns2,
      };
      const acsModel = resolveAcsModelFromDevice(deviceDoc);
      const matchCtx = {
        sn,
        onuType: onu.onuType,
        acsModel,
      };
      const driver = resolveOnuDriver(matchCtx);
      const heal = driver?.verifyHeal ?? driver?.healOne;
      if (driver && heal) {
        this.attachWake(client, device, sn);
        const deviceId = deviceIdString(device._id);
        const gaps =
          driver.diagnoseGaps?.(deviceDoc, wan, {
            mgmtIp: onu.mgmtIp,
          }) ?? {};
        // Checker: no re-provisionar si WAN panel ok y carrier ok/indefinido.
        // Si falta carrier (false), sí curar L2.
        if (
          gaps.serviceWanOk === true &&
          gaps.serviceCarrierOk !== false
        ) {
          return adoptNotes.length
            ? adoptNotes.join(' · ')
            : null;
        }
        const reachable =
          gaps.reachable ??
          (await this.probeConnectionRequest(device, sn)).ok;
        const ctx = this.buildModelProvisionCtx({
          schema,
          onuId: onu.id,
          sn,
          mgmtIp: onu.mgmtIp,
          onuType: onu.onuType,
          oltId: onu.oltId,
          onuIf: onu.onuIf,
          acsModel,
          client,
          deviceId,
          device: deviceDoc,
          wan,
          explicit: false,
        });
        const result = await heal({
          ...ctx,
          gaps: { ...gaps, reachable },
        });
        if (result.progress) {
          const prev = (onu.verifyDetail ?? {}) as {
            progress?: OnuProgressState;
            modelPrep?: ModelPrepState;
          };
          const progress = mergeProgressState(prev.progress, result.progress);
          onu.verifyDetail = {
            ...prev,
            progress,
          };
          await onuRepo.save(onu);
        }
        const msg = result.notes.join(' · ') || driver.id;
        const healNote = result.ok
          ? `curación WAN: driver ${driver.id} heal: ${msg}`
          : `curación WAN: driver ${driver.id} heal falló: ${msg}`;
        return [...adoptNotes, healNote].join(' · ');
      }

      // Checker NUNCA re-corre provision completo (eso es Resync / apply).
      return [
        ...adoptNotes,
        `curación WAN: driver ${driver?.id ?? 'desconocido'} sin verifyHeal (omitido; usar Resync para re-provisionar)`,
      ].join(' · ');
    } catch (e) {
      return `curación WAN: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** IP INTERNET reportada por el ACS (Huawei o genérico). */
  private internetIpFromDevice(
    device: Record<string, unknown>,
  ): string | null {
    const hw = findHuaweiInternetWan(listHuaweiWanIpConnections(device));
    if (hw?.externalIp?.trim()) return hw.externalIp.trim();
    const found = findServiceWanConnection(device);
    if (!found || found.isMgmt) return null;
    return readWanConnectionState(device, found).ip?.trim() || null;
  }

  private async peekAcsInternetIp(sn: string): Promise<string | null> {
    const device = await this.nbi().findBySerial(sn);
    if (!device) return null;
    return this.internetIpFromDevice(device as Record<string, unknown>);
  }
  /**
   * Curación TR-181: desactiva WAN SmartOLT (10.0.110.*) y reapunta
   * `0.0.0.0/0` a la WAN de servicio del pool. Sin esto el verify puede
   * marcar wan/dns ok y el cliente no navega.
   */
  async healServiceRouteForVerify(
    schema: string,
    onuId: string,
  ): Promise<string | null> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu?.sn?.trim() || !onu.wanIp || !onu.wanPoolId) return null;
    const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
    const wanPool = await poolRepo.findOne({ where: { id: onu.wanPoolId } });
    if (!wanPool?.gateway) return null;

    try {
      const client = this.nbi();
      let device = await client.findBySerial(onu.sn);
      if (!device?._id) return 'curación ruta: ONU aún no Informó al ACS';
      this.attachWake(client, device, onu.sn);
      const deviceId = deviceIdString(device._id);

      const acsModel = resolveAcsModelFromDevice(
        device as Record<string, unknown>,
      );
      const driver = resolveOnuDriver({
        sn: onu.sn,
        onuType: onu.onuType,
        acsModel,
      });
      const found = resolveServiceWanForVerify(device, {
        sn: onu.sn,
        onuType: onu.onuType,
        acsModel,
        mgmtIp: onu.mgmtIp,
        expectedIp: onu.wanIp,
        expectedVlanId: wanPool.vlanId,
      });
      // SmartOLT / defroute: solo si el driver lo soporta y la WAN es TR-181.
      if (
        !shouldHealServiceRoute(found, {
          supportsTr181RouteHeal: driver?.supportsTr181RouteHeal,
        })
      ) {
        return null;
      }

      const assessment = assessServiceRoute(device, {
        serviceConn: found!.conn,
        expectedGateway: wanPool.gateway,
        dataModel: found!.model,
      });
      if (assessment.ok) return 'curación ruta: ya alineada';

      const notes: string[] = [];
      for (const path of assessment.disablePaths) {
        try {
          const r = await client.setParameterValues(deviceId, [
            [`${path}.Enable`, false, 'xsd:boolean'],
          ]);
          notes.push(
            r.status === 200
              ? `legacy ${path.split('.').pop()} off`
              : `legacy ${path.split('.').pop()} encolado (${r.status})`,
          );
        } catch (e) {
          notes.push(
            `legacy ${path}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      if (assessment.routeFix?.length) {
        try {
          const r = await client.setParameterValues(
            deviceId,
            assessment.routeFix,
          );
          notes.push(
            r.status === 200
              ? `defroute → ${wanPool.gateway}`
              : `defroute encolada (${r.status})`,
          );
        } catch (e) {
          notes.push(
            `defroute: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      try {
        await client.refreshObject(deviceId, 'Device.IP.Interface');
        await client.refreshObject(deviceId, 'Device.Routing.Router');
      } catch {
        /* ok */
      }

      return notes.length
        ? `curación ruta: ${notes.join(' · ')}`
        : `curación ruta: ${assessment.message}`;
    } catch (e) {
      return `curación ruta: ${e instanceof Error ? e.message : String(e)}`;
    }
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
            if (
              live.adminState &&
              !(
                /disable/i.test(onu.adminState ?? '') &&
                !/disable/i.test(live.adminState)
              )
            ) {
              onu.adminState = live.adminState;
            }
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
      onuType?: string | null;
      oltId?: string | null;
      onuIf?: string | null;
    },
    wan: {
      wanIp: string;
      wanVlan: number;
      wanGateway: string;
      wanMask: string;
      wanDns1: string;
      wanDns2: string | null;
    },
    opts?: { explicit?: boolean },
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
      this.attachWake(client, device, onu.sn);
      const deviceId = deviceIdString(device._id);

      const notes: string[] = [];
      const deviceDocEarly = device as Record<string, unknown>;
      const acsModelEarly = resolveAcsModelFromDevice(deviceDocEarly);
      const matchCtxEarly = {
        sn: onu.sn,
        onuType: onu.onuType,
        acsModel: acsModelEarly,
      };
      const driverEarly = resolveOnuDriver(matchCtxEarly);
      // Si el modelo posee provision (ownsWanSelection), él hace creds/WAN
      // paso a paso: no precargar refresh+creds aquí.
      const skipBulkPrep = !!driverEarly?.ownsWanSelection?.(matchCtxEarly);

      if (!skipBulkPrep) {
        const credNote = await this.ensureConnReqCredentials(
          client,
          deviceId,
          device,
          onu.sn,
        );
        if (credNote) notes.push(credNote);

        for (const target of wanRefreshTargets(dataModelOf(device))) {
          try {
            await client.refreshObject(deviceId, target);
          } catch {
            /* continue with what we have */
          }
        }
        device = (await client.findBySerial(onu.sn)) ?? device;
      }

      const withNotes = (msg: string) => [...notes, msg].join(' · ');

      // Driver por modelo: si library reclama la WAN, solo su script (sin
      // picker genérico ni SPV multi-vendor).
      const deviceDoc = device as Record<string, unknown>;
      const acsModel = resolveAcsModelFromDevice(deviceDoc);
      const matchCtx = {
        sn: onu.sn,
        onuType: onu.onuType,
        acsModel,
      };
      const driver = resolveOnuDriver(matchCtx);
      if (
        (driver?.provisionPipeline || driver?.provision) &&
        driver.ownsWanSelection?.(matchCtx)
      ) {
        const ctx = this.buildModelProvisionCtx({
          schema,
          onuId: onu.id,
          sn: onu.sn,
          mgmtIp: onu.mgmtIp,
          onuType: onu.onuType,
          oltId: onu.oltId,
          onuIf: onu.onuIf,
          acsModel,
          client,
          deviceId,
          device: deviceDoc,
          wan,
          explicit: opts?.explicit ?? false,
        });
        const run = driver.provisionPipeline ?? driver.provision!;
        const result = await run(ctx);
        if (result.progress) {
          const onuRepo = await this.tenantConnections.getOnuRepository(schema);
          const onuFresh = await onuRepo.findOne({ where: { id: onu.id } });
          if (onuFresh) {
            const prev = (onuFresh.verifyDetail ?? {}) as {
              progress?: OnuProgressState;
            };
            onuFresh.verifyDetail = {
              ...prev,
              progress: mergeProgressState(prev.progress, result.progress),
            };
            await onuRepo.save(onuFresh);
          }
        }
        const msg = result.notes.join(' · ') || driver.id;
        return withNotes(
          result.ok
            ? `driver ${driver.id}: ${msg}`
            : `driver ${driver.id} falló: ${msg}`,
        );
      }

      const found =
        driver?.resolveServiceWan?.(deviceDoc, {
          mgmtIp: onu.mgmtIp,
          expectedIp: wan.wanIp,
          expectedVlanId: wan.wanVlan,
        }) ?? null;
      if (!found || found.isMgmt) {
        await this.acsDrivers.seedLibraries(schema).catch(() => undefined);
                const creator = driver ?? resolveOnuModelHandler(matchCtx);
        if (creator?.ensureServiceWan) {
          const result = await creator.ensureServiceWan(
            this.buildModelProvisionCtx({
              schema,
              onuId: onu.id,
              sn: onu.sn,
              mgmtIp: onu.mgmtIp,
              onuType: onu.onuType,
              oltId: onu.oltId,
              onuIf: onu.onuIf,
              acsModel,
              client,
              deviceId,
              device: deviceDoc,
              wan,
              explicit: opts?.explicit ?? false,
            }),
          );
          const msg = result.notes.join(' · ') || creator.id;
          await this.audit.record(schema, {
            action: 'acs_wan',
            actorKind: 'system',
            ok: result.ok,
            sn: onu.sn,
            onuId: onu.id,
            oltId: onu.oltId ?? null,
            onuIf: onu.onuIf ?? null,
            detail: { message: msg, driver: creator.id },
          });
          return withNotes(
            result.ok
              ? `driver ${creator.id}: ${msg}`
              : `driver ${creator.id} falló: ${msg}`,
          );
        }
        if (!found) {
          return withNotes(
            'WAN en DB; no se encontró una WAN de servicio en el árbol TR069 — pulsa Refrescar en Configurar ONU',
          );
        }
        return withNotes(
          'WAN en DB; el CPE sólo expone la conexión de gestión ' +
            `(${onu.mgmtIp}) — hace falta crear una WAN de servicio aparte, no se toca`,
        );
      }

      const spv = driver?.applyServiceSpv ?? applyGenericServiceSpv;
      return spv({
        client,
        deviceId,
        device: deviceDoc,
        sn: onu.sn,
        wan,
        found,
        priorNotes: notes,
        onEnqueued: async () =>
          this.ensureConnReqCredentials(client, deviceId, device, onu.sn!, {
            force: true,
          }),
      }).then(async (msg) => {
        const text = driver ? `${msg} · driver ${driver.id}` : msg;
        await this.audit.record(schema, {
          action: 'apply_wan',
          actorKind: 'system',
          ok: true,
          sn: onu.sn,
          onuId: onu.id,
          oltId: onu.oltId ?? null,
          onuIf: onu.onuIf ?? null,
          detail: { message: text },
        });
        return text;
      });
    } catch (e) {
      const fail = `WAN en DB; TR069 falló: ${e instanceof Error ? e.message : e}`;
      await this.audit.record(schema, {
        action: 'apply_wan',
        actorKind: 'system',
        ok: false,
        sn: onu.sn,
        onuId: onu.id,
        oltId: onu.oltId ?? null,
        onuIf: onu.onuIf ?? null,
        detail: { message: fail },
      });
      return fail;
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
   *
   * `force` sirve para el caso en que el usuario ya es `acs` pero el CPE sigue
   * devolviendo 401: la contraseña es de sólo escritura, así que la única forma
   * de descartar que venga de fábrica es volver a fijarla.
   */
  private async ensureConnReqCredentials(
    client: GenieAcsNbiClient,
    deviceId: string,
    device: Record<string, unknown>,
    serial: string,
    opts?: { force?: boolean },
  ): Promise<string | null> {
    const root = detectDataModelRoot(device);
    const base = `${root}.ManagementServer`;
    const usernamePath = `${base}.ConnectionRequestUsername`;

    const current = strVal(genieGet(device, usernamePath));
    if (!opts?.force && !shouldWriteConnReqCredentials(current)) return null;

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
          : await this.kickWithFactoryCredentials(
              device,
              base,
              current,
              serial,
            );

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

    for (const cred of factoryConnReqCandidates(
      currentUsername,
      connReqPassword(serial),
    )) {
      const res = await this.connectionRequest(
        url,
        cred.username,
        cred.password,
      );
      if (res.ok) return `CPE despertado (${res.detail})`;
      if (res.reason === 'sin-camino' || res.reason === 'sin-url') {
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
   * Construye el contexto que reciben los handlers por modelo, cableando los
   * callbacks que sólo el servicio sabe hacer (NBI + OLT): pre-carga de
   * credenciales, reinicio con tope y probe de manejabilidad.
   */
  private buildModelProvisionCtx(params: {
    schema: string;
    onuId: string;
    sn: string;
    mgmtIp: string | null;
    onuType?: string | null;
    oltId?: string | null;
    onuIf?: string | null;
    acsModel: string | null;
    client: GenieAcsNbiClient;
    deviceId: string;
    device: Record<string, unknown>;
    wan: OnuModelProvisionWanPlan;
    explicit: boolean;
  }): OnuModelProvisionCtx {
    const { schema, onuId, sn, oltId, onuIf, client, deviceId, device, wan } =
      params;
    const matchCtx = {
      sn,
      onuType: params.onuType,
      acsModel: params.acsModel,
    };
    const driver = resolveOnuDriver(matchCtx);
    // Modelos con verifyHeal (p. ej. HG8145X6): preload SPV-only sin refresh MS.
    const useSpvOnlyPreload = !!(driver?.verifyHeal || driver?.healOne);
    return {
      sn,
      onuType: params.onuType,
      acsModel: params.acsModel,
      client,
      deviceId,
      device,
      wan,
      mgmtIp: params.mgmtIp,
      serviceVlan: wan.wanVlan,
      explicit: params.explicit,
      preloadConnReq: () =>
        useSpvOnlyPreload
          ? this.preloadConnReqSpvOnly(
              client,
              deviceId,
              device,
              sn,
              driver?.id === 'huawei-hg8145x6'
                ? HG8145X6_INFORM_INTERVAL_S
                : CONN_REQ_INFORM_INTERVAL_S,
            )
          : this.preloadConnReq(client, deviceId, device, sn),
      reboot: (o) =>
        this.rebootOnuWithCap(schema, { id: onuId, oltId, onuIf }, !!o?.force),
      isReachable: async () =>
        (await this.probeConnectionRequest(device, sn)).ok,
      ensureOmciTr069: () => this.applyOmciTr069ForOnu(schema, onuId),
      ensureServiceL2: () => this.applyServiceL2ForOnu(schema, onuId),
      onProgress: async (partial) => {
        try {
          const onuRepo =
            await this.tenantConnections.getOnuRepository(schema);
          const row = await onuRepo.findOne({ where: { id: onuId } });
          if (!row) return;
          const prev = (row.verifyDetail ?? {}) as {
            progress?: OnuProgressState;
          };
          if (row.verifyStatus === 'idle' || !row.verifyStatus) {
            row.verifyStatus = 'test';
          }
          if (!row.verifyStartedAt) row.verifyStartedAt = new Date();
          row.verifyDetail = {
            ...prev,
            progress: mergeProgressState(prev.progress, partial),
          };
          await onuRepo.save(row);
        } catch {
          /* el modal reintenta en el próximo poll */
        }
      },
    };
  }

  /**
   * Preload SPV-only (sin refreshObject ManagementServer). Usado por HG8145X6:
   * el refresh en bootstrap provoca session_terminated.
   */
  private async preloadConnReqSpvOnly(
    client: GenieAcsNbiClient,
    deviceId: string,
    device: Record<string, unknown>,
    serial: string,
    informIntervalS: number,
  ): Promise<string> {
    const root = detectDataModelRoot(device);
    const base = `${root}.ManagementServer`;
    const params: Array<[string, string | number | boolean, string]> = [
      ...buildConnReqParameterValues(serial, root),
      [`${base}.PeriodicInformEnable`, true, 'xsd:boolean'],
      [
        `${base}.PeriodicInformInterval`,
        informIntervalS,
        'xsd:unsignedInt',
      ],
    ];
    try {
      const r = await client.enqueueTask(
        deviceId,
        {
          name: 'setParameterValues',
          parameterValues: params.map(([p, v, t]) => [p, v, t]),
        },
        { connectionRequest: false, timeoutMs: 60_000 },
      );
      return r.status === 200 || r.status === 202
        ? `preload connreq+inform ${informIntervalS}s (status ${r.status})`
        : `preload connreq status ${r.status}`;
    } catch (e) {
      return `preload connreq falló: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /**
   * Pre-carga en la cola del ACS lo que rompe el deadlock de la ONU que sólo
   * informa en el bootstrap: refresca ManagementServer y encola credenciales de
   * conexión + Inform corto SIN pedir conexión (la ONU no responde todavía). Se
   * aplica de golpe en el siguiente Inform, que fuerza el reinicio.
   */
  private async preloadConnReq(
    client: GenieAcsNbiClient,
    deviceId: string,
    device: Record<string, unknown>,
    serial: string,
  ): Promise<string> {
    const root = detectDataModelRoot(device);
    const base = `${root}.ManagementServer`;
    try {
      await client.refreshObject(deviceId, base);
    } catch {
      /* seguimos con lo que haya */
    }
    const params: Array<[string, string | number | boolean, string]> = [
      ...buildConnReqParameterValues(serial, root),
      [`${base}.PeriodicInformEnable`, true, 'xsd:boolean'],
      [
        `${base}.PeriodicInformInterval`,
        CONN_REQ_INFORM_INTERVAL_S,
        'xsd:unsignedInt',
      ],
    ];
    try {
      const r = await client.enqueueTask(
        deviceId,
        {
          name: 'setParameterValues',
          parameterValues: params.map(([p, v, t]) => [p, v, t]),
        },
        { connectionRequest: false, timeoutMs: 60_000 },
      );
      return r.status === 200 || r.status === 202
        ? `preload connreq+inform ${CONN_REQ_INFORM_INTERVAL_S}s (status ${r.status})`
        : `preload connreq status ${r.status}`;
    } catch (e) {
      return `preload connreq falló: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /**
   * Reaplica service-port / flow L2 de la VLAN WAN (y mgmt si hay) en la OLT.
   * Usado por drivers Huawei ACS cuando el CPE reporta ERROR_NO_CARRIER.
   * Siempre usa la VLAN del panel/pool (nunca la fantasma del ACS).
   */
  private async applyServiceL2ForOnu(
    schema: string,
    onuId: string,
  ): Promise<OnuOmciTr069Result> {
    const notes: string[] = [];
    try {
      const onuRepo = await this.tenantConnections.getOnuRepository(schema);
      const onu = await onuRepo.findOne({ where: { id: onuId } });
      if (!onu) return { ok: false, notes: ['L2: ONU no encontrada'] };
      if (!onu.onuIf?.trim()) {
        return { ok: false, notes: ['L2: ONU sin onuIf'] };
      }
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
      if (!olt || !isManagedOltDevice(olt.type, olt.subtype)) {
        return { ok: false, notes: ['L2: OLT no gestionada'] };
      }
      if (!olt.mgmtHost || !olt.mgmtUsername || !olt.mgmtPassword) {
        return { ok: false, notes: ['L2: OLT sin credenciales'] };
      }

      let wanVlan: number | null = onu.vlan ?? null;
      let mgmtVlan: number | null = null;
      const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
      if (onu.wanPoolId) {
        const wanPool = await poolRepo.findOne({ where: { id: onu.wanPoolId } });
        if (wanPool?.vlanId != null) wanVlan = wanPool.vlanId;
      }
      if (onu.mgmtPoolId) {
        const mgmtPool = await poolRepo.findOne({
          where: { id: onu.mgmtPoolId },
        });
        if (mgmtPool?.vlanId != null) mgmtVlan = mgmtPool.vlanId;
      }
      if (wanVlan == null) {
        return { ok: false, notes: ['L2: sin VLAN WAN asignada'] };
      }

      const dba = await this.resolveInternetDba(schema, onu.id);
      const protocol: 'telnet' | 'ssh' =
        olt.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
      const port =
        olt.mgmtPort ??
        (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);

      const result = await this.oltCli(olt).applyOnuServiceVlans({
        host: olt.mgmtHost,
        port,
        protocol,
        username: olt.mgmtUsername,
        password: olt.mgmtPassword,
        onuIf: onu.onuIf,
        wanVlan,
        mgmtVlan: mgmtVlan ?? undefined,
        internetTcontProfile: dba?.upProfile ?? null,
        subtypeHint: olt.subtype,
        firmwareHint: oltFirmwareHint(olt),
      });
      if (!result.ok) {
        return {
          ok: false,
          notes: [
            `L2 service-port VLAN ${wanVlan}: ${result.error || 'falló'}`,
          ],
        };
      }
      notes.push(
        result.message ??
          `L2 service-port VLAN ${wanVlan} aplicado${
            mgmtVlan != null ? ` + mgmt ${mgmtVlan}` : ''
          }`,
      );
      return { ok: true, notes };
    } catch (e) {
      return {
        ok: false,
        notes: [`L2: ${e instanceof Error ? e.message : String(e)}`],
      };
    }
  }

  /**
   * Reaplica OMCI ip-host + tr069-mgmt para una ONU (sin AuthUser).
   * Usado por el driver HG8145X6 cuando el agente dejó de Informar.
   */
  private async applyOmciTr069ForOnu(
    schema: string,
    onuId: string,
  ): Promise<OnuOmciTr069Result> {
    const notes: string[] = [];
    try {
      const onuRepo = await this.tenantConnections.getOnuRepository(schema);
      const onu = await onuRepo.findOne({ where: { id: onuId } });
      if (!onu) return { ok: false, notes: ['OMCI: ONU no encontrada'] };
      if (!onu.tr069ProfileId) {
        return { ok: false, notes: ['OMCI: sin perfil TR069 en la ONU'] };
      }
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
      if (!olt || !isManagedOltDevice(olt.type, olt.subtype)) {
        return { ok: false, notes: ['OMCI: OLT no gestionada'] };
      }
      if (!olt.mgmtHost || !olt.mgmtUsername || !olt.mgmtPassword) {
        return { ok: false, notes: ['OMCI: OLT sin credenciales'] };
      }
      if (!onu.onuIf?.trim()) {
        return { ok: false, notes: ['OMCI: ONU sin onuIf'] };
      }

      const profileRepo =
        await this.tenantConnections.getTr069ProfileRepository(schema);
      const profile = await profileRepo.findOne({
        where: { id: onu.tr069ProfileId },
      });
      if (!profile) {
        return { ok: false, notes: ['OMCI: perfil TR069 no encontrado'] };
      }

      let mgmtMask: string | null = null;
      let mgmtGateway: string | null = null;
      let mgmtVlan: number | null = null;
      if (onu.mgmtPoolId) {
        const poolRepo =
          await this.tenantConnections.getIpPoolRepository(schema);
        const pool = await poolRepo.findOne({ where: { id: onu.mgmtPoolId } });
        if (pool) {
          mgmtGateway = pool.gateway;
          mgmtMask = prefixToMask(pool.prefix);
          mgmtVlan = pool.vlanId;
        }
      }
      if (mgmtVlan == null) {
        return {
          ok: false,
          notes: ['OMCI: sin VLAN de gestión (pool mgmt)'],
        };
      }

      const protocol: 'telnet' | 'ssh' =
        olt.mgmtProtocol === 'ssh' ? 'ssh' : 'telnet';
      const port =
        olt.mgmtPort ??
        (protocol === 'ssh' ? DEFAULT_OLT_PORTS.ssh : DEFAULT_OLT_PORTS.telnet);
      const acsEndpoint = acsEndpointFromUrl(profile.acsUrl, profile.acsPort);

      const omciPromise = this.oltCli(olt).applyOnuTr069Mgmt({
        host: olt.mgmtHost,
        port,
        protocol,
        username: olt.mgmtUsername,
        password: olt.mgmtPassword,
        onuIf: onu.onuIf,
        enable: true,
        acsEndpoint,
        acsUsername: profile.acsUsername,
        acsPassword: profile.acsPassword,
        mgmtIp: onu.mgmtIp,
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
                error: 'Timeout OMCI (90s)',
              }),
            90_000,
          ),
        ),
      ]);
      if (!omci.ok) {
        notes.push(`OMCI falló: ${omci.error ?? 'desconocido'}`);
        return { ok: false, notes };
      }
      notes.push(
        ('message' in omci ? omci.message : null) ??
          `OMCI TR069 OK (mgmt ${onu.mgmtIp} vlan ${mgmtVlan})`,
      );
      return { ok: true, notes };
    } catch (e) {
      return {
        ok: false,
        notes: [`OMCI: ${e instanceof Error ? e.message : String(e)}`],
      };
    }
  }

  /**
   * Reinicia la ONU en la OLT respetando el tope anti-bucle guardado en
   * `onus.verify_detail.modelPrep`. El poller reinicia como mucho
   * MODEL_PREP_MAX_REBOOTS veces y con MODEL_PREP_MIN_GAP_MS entre reinicios;
   * las acciones explícitas fuerzan (con una guarda corta anti doble clic).
   */
  private async rebootOnuWithCap(
    schema: string,
    onu: { id: string; oltId?: string | null; onuIf?: string | null },
    force: boolean,
  ): Promise<OnuModelRebootResult> {
    if (!onu.oltId || !onu.onuIf?.trim()) {
      return { ok: false, skipped: true, note: 'reinicio omitido: ONU sin OLT/onuIf' };
    }

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const row = await onuRepo.findOne({ where: { id: onu.id } });
    const detail = (row?.verifyDetail ?? {}) as Record<string, unknown>;
    const prep = (detail.modelPrep ?? {}) as ModelPrepState;
    const reboots = Number(prep.reboots ?? 0) || 0;

    const decision = decideModelPrepReboot(prep, { force });
    if (!decision.allow) {
      return { ok: false, skipped: true, note: decision.note };
    }

    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
    if (!olt || !isManagedOltDevice(olt.type, olt.subtype)) {
      return { ok: false, skipped: true, note: 'reinicio omitido: OLT no gestionada' };
    }

    try {
      const rebootParams = {
        ...this.zteConn(olt),
        onuIf: onu.onuIf.trim(),
        subtypeHint: olt.subtype,
        firmwareHint: oltFirmwareHint(olt),
      };
      const result = await Promise.race([
        this.oltCli(olt).rebootOnu(rebootParams),
        new Promise<{ ok: false; error: string }>((resolve) =>
          setTimeout(
            () => resolve({ ok: false, error: 'timeout reinicio OLT (60s)' }),
            60_000,
          ),
        ),
      ]);
      if (!result.ok) {
        return { ok: false, note: `reinicio falló: ${result.error ?? 'desconocido'}` };
      }
      if (row) {
        row.verifyDetail = {
          ...detail,
          modelPrep: {
            ...prep,
            reboots: reboots + 1,
            lastRebootAt: new Date().toISOString(),
          },
        };
        await onuRepo.save(row);
      }
      return { ok: true, note: `ONU reiniciada (${reboots + 1}ª vez)` };
    } catch (e) {
      return {
        ok: false,
        note: `reinicio falló: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

}

function parsedAfterRefreshEmpty(view: Tr069OnuConfigView): boolean {
  const wifiEmpty =
    view.wifi.length === 0 || view.wifi.every((w) => !w.ssid?.trim());
  const usersEmpty =
    view.webUsers.length === 0 ||
    view.webUsers.every((u) => !u.username?.trim());
  return wifiEmpty && view.ethernet.length === 0 && usersEmpty;
}

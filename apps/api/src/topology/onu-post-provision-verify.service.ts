import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service';
import type { Onu } from './entities/onu.entity';
import type { NetworkDevice } from './entities/network-device.entity';
import {
  GenieAcsNbiClient,
  boolVal,
  genieChildIndices,
  genieGet,
  resolveNbiBaseUrl,
  strVal,
} from './genieacs-nbi.client';
import { RouterOsApiClient } from './routeros-api.client';
import {
  CONN_REQ_USERNAME,
  shouldWriteConnReqCredentials,
} from './onu-connreq-credentials.util';
import {
  decideVerifyOutcome,
  isVerifyWindowExpired,
  shouldCloseVerifyWindow,
  shouldRunVerifyTick,
  summarizeVerifyDetail,
  VERIFY_HEAL_MAX_ATTEMPTS,
  type OnuVerifyCheckResult,
  type OnuVerifyDetail,
} from './onu-post-provision-verify.util';
import {
  pickServiceWanConnection,
  type WanConnectionCandidate,
} from './onu-wan-connection.util';
import { inspectWanVlanLeaves } from './onu-wan-vlan-leaf.util';
import { OnuTr069ConfigService } from './onu-tr069-config.service';

function prefixToMask(prefix: number): string {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return [
    (mask >>> 24) & 255,
    (mask >>> 16) & 255,
    (mask >>> 8) & 255,
    mask & 255,
  ].join('.');
}

function reRows(
  replies: { type: string; attrs: Record<string, string> }[],
): Record<string, string>[] {
  return replies.filter((r) => r.type === '!re').map((r) => r.attrs);
}

/**
 * Chequeo silencioso post-aprovisionamiento: ARP en el router del pool,
 * credenciales de conexión, WAN TR-069 y evidencia de tráfico.
 */
@Injectable()
export class OnuPostProvisionVerifyService {
  private readonly logger = new Logger(OnuPostProvisionVerifyService.name);

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly tr069: OnuTr069ConfigService,
  ) {}

  /** Arranca (o reinicia) el ciclo de 15 minutos. */
  async start(schema: string, onuId: string): Promise<Onu> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    onu.verifyStatus = 'test';
    onu.verifyStartedAt = new Date();
    onu.verifyCheckedAt = null;
    onu.verifyAttempt = 0;
    onu.verifyDetail = {};
    return onuRepo.save(onu);
  }

  /**
   * Arranca sólo si hay WAN y modo auto. Se llama al terminar el apply.
   */
  async startAfterApply(schema: string, onuId: string): Promise<void> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) return;
    if (onu.provisionMode === 'manual') return;
    if (!onu.wanIp?.trim()) return;
    await this.start(schema, onuId);
  }

  /** Un tick de todas las ONUs en `test` del esquema. */
  async tickSchema(schema: string): Promise<void> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const candidates = await onuRepo.find({
      where: { verifyStatus: 'test' },
    });
    for (const onu of candidates) {
      if (
        !shouldRunVerifyTick({
          status: onu.verifyStatus,
          checkedAt: onu.verifyCheckedAt,
        })
      ) {
        continue;
      }
      try {
        await this.runOne(schema, onu.id);
      } catch (err) {
        this.logger.warn(
          `verify ${onu.sn ?? onu.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  async runOne(schema: string, onuId: string): Promise<Onu> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');
    if (onu.verifyStatus !== 'test') return onu;
    return this.executeCheck(schema, onuId, { manual: false });
  }

  /**
   * Chequeo a demanda desde el panel (botón Check ONU).
   * Corre las mismas pruebas que el poller y deja el indicador en ok/fail.
   */
  async runManual(schema: string, onuId: string): Promise<Onu> {
    return this.executeCheck(schema, onuId, { manual: true });
  }

  private async executeCheck(
    schema: string,
    onuId: string,
    opts: { manual: boolean },
  ): Promise<Onu> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    let onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    const attempt = opts.manual ? 1 : (onu.verifyAttempt ?? 0) + 1;
    const prevDetail = (onu.verifyDetail ?? {}) as OnuVerifyDetail;
    const healed: string[] = [];
    let irrecoverable = false;

    const detail: OnuVerifyDetail = {};

    if (!onu.wanIp?.trim()) {
      detail.arp = { ok: false, message: 'sin IP WAN asignada' };
      detail.wan = { ok: false, message: 'sin IP WAN asignada' };
      detail.connreq = { ok: false, message: 'sin IP WAN' };
      detail.traffic = { ok: false, message: 'sin IP WAN' };
      irrecoverable = true;
    } else {
      const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
      const wanPool = onu.wanPoolId
        ? await poolRepo.findOne({ where: { id: onu.wanPoolId } })
        : null;

      if (!wanPool?.routerId) {
        detail.arp = {
          ok: false,
          message: 'el pool WAN no tiene router asignado',
        };
        irrecoverable = true;
      } else {
        const deviceRepo =
          await this.tenantConnections.getNetworkDeviceRepository(schema);
        const router = await deviceRepo.findOne({
          where: { id: wanPool.routerId },
        });
        if (!router) {
          detail.arp = { ok: false, message: 'router del pool no encontrado' };
          irrecoverable = true;
        } else {
          const routerProbe = await this.probeRouter(
            router,
            onu.wanIp,
            prevDetail.traffic?.meta,
          );
          detail.arp = routerProbe.arp;
          detail.traffic = routerProbe.traffic;
        }
      }

      const acs = await this.probeAcs(onu, wanPool);
      detail.connreq = acs.connreq;
      detail.wan = acs.wan;

      // Si el router no vio conexiones, aún puede haber bytes en el CPE.
      if (detail.traffic && !detail.traffic.ok && acs.bytesOk) {
        detail.traffic = {
          ok: true,
          message: acs.bytesOk,
          meta: acs.wan.meta,
        };
      } else if (
        detail.traffic &&
        !detail.traffic.ok &&
        typeof prevDetail.wan?.meta?.bytesRecv === 'number' &&
        typeof acs.wan.meta?.bytesRecv === 'number' &&
        (acs.wan.meta.bytesRecv as number) >
          (prevDetail.wan.meta.bytesRecv as number)
      ) {
        detail.traffic = {
          ok: true,
          message: 'bytes WAN crecieron',
          meta: acs.wan.meta,
        };
      }

      const canHeal = attempt <= VERIFY_HEAL_MAX_ATTEMPTS;
      if (canHeal && detail.connreq && !detail.connreq.ok) {
        const note = await this.tr069.healConnReqForVerify(schema, onuId);
        if (note) healed.push(note);
      }
      // ARP ausente con una WAN que parece correcta también merece reempuje:
      // el árbol ACS puede estar desactualizado o el CPE haber guardado la VLAN
      // en otra hoja propietaria. applyWanStaticTr069 vuelve a inspeccionar el
      // modelo antes de elegir la hoja y nunca toca la conexión de gestión.
      if (
        canHeal &&
        wanPool &&
        ((!detail.wan?.ok && !!detail.wan) || (!detail.arp?.ok && !!detail.arp))
      ) {
        const note = await this.tr069.repushWanForVerify(schema, onuId);
        if (note) healed.push(note);
      }
    }

    if (healed.length) detail.healed = healed;

    // Manual: cierra el veredicto ya (essentials bastan sin tráfico).
    // Automático: respeta la ventana de 15 min.
    const rawWindowExpired = opts.manual
      ? true
      : isVerifyWindowExpired({ startedAt: onu.verifyStartedAt });
    // Una curación debe tener al menos un chequeo posterior para probar si
    // prendió. Incluso con la ventana vencida, se permiten los tres intentos;
    // recién el tick siguiente al tercero puede cerrar en fail.
    const windowExpired = shouldCloseVerifyWindow({
      windowExpired: rawWindowExpired,
      healingApplied: healed.length > 0,
    });
    const next = decideVerifyOutcome({
      detail,
      windowExpired,
      irrecoverable,
    });

    onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
    onu.verifyAttempt = attempt;
    onu.verifyCheckedAt = new Date();
    onu.verifyDetail = detail as Record<string, unknown>;
    onu.verifyStatus = next;
    if (opts.manual) {
      onu.verifyStartedAt = onu.verifyStartedAt ?? new Date();
    }
    await onuRepo.save(onu);

    this.logger.log(
      `verify${opts.manual ? ' (manual)' : ''} ${onu.sn ?? onuId} attempt=${attempt} → ${next}` +
        (summarizeVerifyDetail(detail)
          ? ` (${summarizeVerifyDetail(detail)})`
          : ''),
    );
    return onu;
  }

  private mikrotikApi(device: NetworkDevice): RouterOsApiClient | null {
    if (
      device.subtype !== 'mikrotik' ||
      !device.mgmtHost ||
      !device.mgmtUsername ||
      !device.mgmtPassword
    ) {
      return null;
    }
    const protocol = device.mgmtProtocol ?? 'api_ssl';
    const useApiPlain = protocol === 'api_plain';
    const useTls = !useApiPlain;
    const port = device.mgmtPort ?? (useApiPlain ? 8728 : 8729);
    if (protocol === 'rest_https' && device.mgmtPort === 443) return null;
    return new RouterOsApiClient(device.mgmtHost, port, useTls, 30_000);
  }

  private async probeRouter(
    router: NetworkDevice,
    wanIp: string,
    prevTrafficMeta?: Record<string, unknown>,
  ): Promise<{ arp: OnuVerifyCheckResult; traffic: OnuVerifyCheckResult }> {
    const api = this.mikrotikApi(router);
    if (!api) {
      return {
        arp: {
          ok: false,
          message: `${router.name}: sin API MikroTik usable`,
        },
        traffic: { ok: false, message: 'sin API' },
      };
    }

    try {
      await api.connect();
      await api.login(router.mgmtUsername!, router.mgmtPassword!);

      // Ping fuerza resolución ARP aunque el CPE filtre ICMP.
      try {
        await api.write([
          '/ping',
          `=address=${wanIp}`,
          '=count=2',
          '=interval=300ms',
        ]);
      } catch {
        /* el ping es auxiliar */
      }

      const arpRows = reRows(
        await api.write(['/ip/arp/print', `?address=${wanIp}`]),
      );
      const entry = arpRows[0];
      const complete = entry?.complete === 'true';
      const mac = entry?.['mac-address'] || '';
      const arp: OnuVerifyCheckResult = entry
        ? complete
          ? {
              ok: true,
              message: `resuelta ${mac || ''}`.trim(),
              meta: { mac, routerId: router.id, routerName: router.name },
            }
          : {
              ok: false,
              message: 'ARP incompleta',
              meta: { routerId: router.id },
            }
        : {
            ok: false,
            message: `ausente en ${router.name}`,
            meta: { routerId: router.id },
          };

      const conns = reRows(
        await api.write([
          '/ip/firewall/connection/print',
          `?src-address=${wanIp}`,
          '=.proplist=src-address,dst-address,protocol',
        ]),
      );
      // RouterOS a veces guarda src-address con puerto; filtramos por prefijo.
      const matched = conns.filter((c) =>
        String(c['src-address'] || '').startsWith(wanIp),
      );
      const prevCount =
        typeof prevTrafficMeta?.connCount === 'number'
          ? prevTrafficMeta.connCount
          : 0;
      const traffic: OnuVerifyCheckResult =
        matched.length > 0
          ? {
              ok: true,
              message: `${matched.length} conexiones en ${router.name}`,
              meta: { connCount: matched.length },
            }
          : {
              ok: false,
              message:
                prevCount > 0
                  ? 'sin conexiones ahora'
                  : 'sin conexiones activas',
              meta: { connCount: 0 },
            };

      return { arp, traffic };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        arp: { ok: false, message: `router: ${msg}` },
        traffic: { ok: false, message: `router: ${msg}` },
      };
    } finally {
      await api.close().catch(() => undefined);
    }
  }

  private async probeAcs(
    onu: Onu,
    wanPool: {
      vlanId: number;
      gateway: string;
      prefix: number;
      dns1: string | null;
      dns2: string | null;
    } | null,
  ): Promise<{
    connreq: OnuVerifyCheckResult;
    wan: OnuVerifyCheckResult;
    bytesOk: string | null;
  }> {
    if (!onu.sn?.trim()) {
      return {
        connreq: { ok: false, message: 'sin SN' },
        wan: { ok: false, message: 'sin SN' },
        bytesOk: null,
      };
    }

    try {
      const client = new GenieAcsNbiClient(resolveNbiBaseUrl());
      const device = await client.findBySerial(onu.sn);
      if (!device?._id) {
        return {
          connreq: { ok: false, message: 'aún no Informó al ACS' },
          wan: { ok: false, message: 'aún no Informó al ACS' },
          bytesOk: null,
        };
      }

      const user = strVal(
        genieGet(
          device,
          'InternetGatewayDevice.ManagementServer.ConnectionRequestUsername',
        ),
      );
      const connreq: OnuVerifyCheckResult = !shouldWriteConnReqCredentials(user)
        ? { ok: true, message: CONN_REQ_USERNAME }
        : {
            ok: false,
            message: user
              ? `credenciales ajenas (${user})`
              : 'credenciales vacías',
            meta: { username: user },
          };

      const found = this.findServiceWan(device, onu.mgmtIp);
      if (!found) {
        return {
          connreq,
          wan: { ok: false, message: 'sin WANIPConnection de servicio' },
          bytesOk: null,
        };
      }
      if (found.isMgmt) {
        return {
          connreq,
          wan: {
            ok: false,
            message: 'sólo existe la WAN de gestión',
          },
          bytesOk: null,
        };
      }

      const { conn, connDevice } = found;
      const ip = strVal(genieGet(device, `${conn}.ExternalIPAddress`));
      const mask = strVal(genieGet(device, `${conn}.SubnetMask`));
      const gw = strVal(genieGet(device, `${conn}.DefaultGateway`));
      const nat = boolVal(genieGet(device, `${conn}.NATEnabled`));
      const addressingType = strVal(genieGet(device, `${conn}.AddressingType`));
      const connectionStatus = strVal(
        genieGet(device, `${conn}.ConnectionStatus`),
      );
      const vlanInspection = inspectWanVlanLeaves(device, conn, connDevice);
      const vlanPath = vlanInspection.selected;
      const vlanRaw = vlanPath ? genieGet(device, vlanPath) : null;
      const vlan =
        typeof vlanRaw === 'number'
          ? vlanRaw
          : Number(strVal(vlanRaw) ?? Number.NaN);

      const expectMask = wanPool ? prefixToMask(wanPool.prefix) : null;
      const problems: string[] = [];
      if (onu.wanIp && ip !== onu.wanIp) {
        problems.push(`ip=${ip || '—'} (esperada ${onu.wanIp})`);
      }
      if (addressingType && addressingType !== 'Static') {
        problems.push(`modo=${addressingType} (esperado Static)`);
      }
      if (expectMask && mask !== expectMask) {
        problems.push(`máscara=${mask || 'vacía'}`);
      }
      if (wanPool && gw && gw !== wanPool.gateway) {
        problems.push(`gw=${gw}`);
      }
      if (nat !== true) problems.push('NAT off');
      if (wanPool && Number.isFinite(vlan) && vlan !== wanPool.vlanId) {
        problems.push(`vlan=${vlan} (esperada ${wanPool.vlanId})`);
      } else if (wanPool && !Number.isFinite(vlan)) {
        problems.push('vlan ausente');
      }

      const bytesSent = Number(
        strVal(genieGet(device, `${conn}.Stats.EthernetBytesSent`)) ??
          strVal(genieGet(device, `${conn}.BytesSent`)) ??
          0,
      );
      const bytesRecv = Number(
        strVal(genieGet(device, `${conn}.Stats.EthernetBytesReceived`)) ??
          strVal(genieGet(device, `${conn}.BytesReceived`)) ??
          0,
      );
      const bytesOk =
        Number.isFinite(bytesRecv) && bytesRecv > 0
          ? `BytesReceived=${bytesRecv}`
          : Number.isFinite(bytesSent) && bytesSent > 0
            ? `BytesSent=${bytesSent}`
            : null;

      const wan: OnuVerifyCheckResult =
        problems.length === 0
          ? {
              ok: true,
              message: `${ip} vlan=${vlan} nat=true`,
              meta: {
                bytesSent,
                bytesRecv,
                conn,
                addressingType,
                connectionStatus,
                vlanPath,
                exposedVlanLeaves: vlanInspection.exposed,
              },
            }
          : {
              ok: false,
              message: problems.join('; '),
              meta: {
                bytesSent,
                bytesRecv,
                conn,
                ip,
                mask,
                gw,
                nat,
                vlan,
                addressingType,
                connectionStatus,
                vlanPath,
                exposedVlanLeaves: vlanInspection.exposed,
              },
            };

      return { connreq, wan, bytesOk };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        connreq: { ok: false, message: `ACS: ${msg}` },
        wan: { ok: false, message: `ACS: ${msg}` },
        bytesOk: null,
      };
    }
  }

  private findServiceWan(
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

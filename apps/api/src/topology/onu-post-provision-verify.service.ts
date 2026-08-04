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
  mapWithConcurrency,
  shouldCloseVerifyWindow,
  shouldRunVerifyTick,
  summarizeVerifyDetail,
  VERIFY_HEAL_MAX_ATTEMPTS,
  VERIFY_MAX_CONCURRENCY_PER_TENANT,
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

  /** ONUs del esquema que toca chequear ahora (ventana/intervalo). */
  async listDue(
    schema: string,
  ): Promise<Array<{ schema: string; id: string; sn: string | null }>> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const candidates = await onuRepo.find({
      where: { verifyStatus: 'test' },
      select: ['id', 'sn', 'verifyStatus', 'verifyCheckedAt'],
    });
    return candidates
      .filter((onu) =>
        shouldRunVerifyTick({
          status: onu.verifyStatus,
          checkedAt: onu.verifyCheckedAt,
        }),
      )
      .map((onu) => ({ schema, id: onu.id, sn: onu.sn }));
  }

  /** Un tick de todas las ONUs en `test` del esquema (respeta el tope). */
  async tickSchema(
    schema: string,
    concurrency = VERIFY_MAX_CONCURRENCY_PER_TENANT,
  ): Promise<void> {
    const due = await this.listDue(schema);
    if (!due.length) return;
    if (due.length > concurrency) {
      this.logger.log(
        `verify ${schema}: ${due.length} pendientes, concurrencia≤${concurrency}`,
      );
    }
    await mapWithConcurrency(due, concurrency, async (job) => {
      try {
        await this.runOne(job.schema, job.id);
      } catch (err) {
        this.logger.warn(
          `verify ${job.sn ?? job.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
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
   * Corre las mismas pruebas y curaciones que el poller. Si aplica una
   * curación, vuelve a comprobar inmediatamente; hace como máximo tres
   * intentos y una lectura final para confirmar el resultado.
   */
  async runManual(schema: string, onuId: string): Promise<Onu> {
    for (let attempt = 1; attempt <= VERIFY_HEAL_MAX_ATTEMPTS; attempt += 1) {
      const onu = await this.executeCheck(schema, onuId, {
        manual: true,
        attempt,
        allowHeal: true,
      });
      if (onu.verifyStatus !== 'test') return onu;
    }

    // El tercer intento necesita una relectura: sin ella reportaríamos el
    // estado anterior a la última escritura. Esta lectura ya no cura.
    return this.executeCheck(schema, onuId, {
      manual: true,
      attempt: VERIFY_HEAL_MAX_ATTEMPTS,
      allowHeal: false,
    });
  }

  private async executeCheck(
    schema: string,
    onuId: string,
    opts: { manual: boolean; attempt?: number; allowHeal?: boolean },
  ): Promise<Onu> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    let onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    const attempt =
      opts.attempt ?? (opts.manual ? 1 : (onu.verifyAttempt ?? 0) + 1);
    const prevDetail = (onu.verifyDetail ?? {}) as OnuVerifyDetail;
    const healed: string[] = [];
    let irrecoverable = false;

    const detail: OnuVerifyDetail = {};

    if (!onu.wanIp?.trim()) {
      detail.arp = { ok: false, message: 'sin IP WAN asignada' };
      detail.wan = { ok: false, message: 'sin IP WAN asignada' };
      detail.dns = { ok: false, message: 'sin IP WAN' };
      detail.connreq = { ok: false, message: 'sin IP WAN' };
      detail.traffic = { ok: false, message: 'sin IP WAN' };
      irrecoverable = true;
    } else {
      const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
      const wanPool = onu.wanPoolId
        ? await poolRepo.findOne({ where: { id: onu.wanPoolId } })
        : null;

      const canHeal =
        opts.allowHeal !== false && attempt <= VERIFY_HEAL_MAX_ATTEMPTS;

      // Paso 0: credenciales nuestras ANTES de mirar WAN/DNS. Sin ellas el ACS
      // recibe 401 y cualquier curación de WAN se queda en cola.
      let credentialsOurs = true;
      if (canHeal) {
        const cred = await this.tr069.ensureCredentialsFirst(schema, onuId);
        credentialsOurs = cred.ours;
        if (cred.note) healed.push(cred.note);
      }

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
      detail.dns = acs.dns;
      if (detail.connreq) {
        credentialsOurs = detail.connreq.ok;
      }

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

      // ARP ausente / WAN / DNS: sólo se reempuja si ya tenemos el camino de
      // connection_request. Empujar con credenciales ajenas sólo alarga la cola.
      if (
        canHeal &&
        credentialsOurs &&
        wanPool &&
        ((!detail.wan?.ok && !!detail.wan) ||
          (!detail.dns?.ok && !!detail.dns) ||
          (!detail.arp?.ok && !!detail.arp))
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
    dns: OnuVerifyCheckResult;
    bytesOk: string | null;
  }> {
    if (!onu.sn?.trim()) {
      return {
        connreq: { ok: false, message: 'sin SN' },
        wan: { ok: false, message: 'sin SN' },
        dns: { ok: false, message: 'sin SN' },
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
          dns: { ok: false, message: 'aún no Informó al ACS' },
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
          dns: { ok: false, message: 'sin WANIPConnection de servicio' },
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
          dns: { ok: false, message: 'sólo existe la WAN de gestión' },
          bytesOk: null,
        };
      }

      const { conn, connDevice } = found;
      const ip = strVal(genieGet(device, `${conn}.ExternalIPAddress`));
      const mask = strVal(genieGet(device, `${conn}.SubnetMask`));
      const gw = strVal(genieGet(device, `${conn}.DefaultGateway`));
      const nat = boolVal(genieGet(device, `${conn}.NATEnabled`));
      const dns = strVal(genieGet(device, `${conn}.DNSServers`));
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
                dns,
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
                dns,
                vlan,
                addressingType,
                connectionStatus,
                vlanPath,
                exposedVlanLeaves: vlanInspection.exposed,
              },
            };

      // El DNS es esencial pero se reporta aparte: una WAN puede estar
      // Connected, responder ARP y cursar tráfico por IP mientras el cliente
      // sigue sin poder navegar por nombres.
      const expectedDns = [wanPool?.dns1, wanPool?.dns2]
        .filter((value): value is string => !!value?.trim())
        .join(',');
      const dnsCheck: OnuVerifyCheckResult = !expectedDns
        ? { ok: true, message: 'pool sin DNS requerido' }
        : dns?.trim()
          ? {
              ok: true,
              message: dns,
              meta: { configured: dns, expected: expectedDns },
            }
          : {
              ok: false,
              message: `vacío (esperado ${expectedDns})`,
              meta: { configured: dns, expected: expectedDns },
            };

      return { connreq, wan, dns: dnsCheck, bytesOk };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        connreq: { ok: false, message: `ACS: ${msg}` },
        wan: { ok: false, message: `ACS: ${msg}` },
        dns: { ok: false, message: `ACS: ${msg}` },
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

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import type { Onu } from '../shared/entities/onu.entity';
import type { NetworkDevice } from '../shared/entities/network-device.entity';
import {
  GenieAcsNbiClient,
  genieGet,
  resolveNbiBaseUrl,
  strVal,
} from '../shared/genieacs-nbi.client';
import { RouterOsApiClient } from '../routers/routeros-api.client';
import {
  CONN_REQ_USERNAME,
  detectDataModelRoot,
  shouldWriteConnReqCredentials,
} from '../../drivers/onu/infra/connreq-credentials';
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
  readWanConnectionState,
} from '../../drivers/onu/infra/wan-datamodel';
import { assessServiceRoute } from '../../drivers/onu/models/generic-zte/route';
import { resolveServiceWanForVerify } from '../../drivers/onu/infra/resolve-service-wan-for-verify';
import { OnuTr069ConfigService } from './onu-tr069-config.service';
import {
  needsMigratedHealthBackfill,
  shouldSkipHealthPass,
} from '../../drivers/olt/zte/shared/zte-olt-dba.util';
import { ServiceVlanService } from '../olts/service-vlan.service';
import {
  resolveAcsModelFromDevice,
  resolveOnuDriver,
  resolveProgressPlan,
  resolveVerifyChecks,
} from '../../drivers/onu';
import type { OnuVerifyCheckId } from '../../drivers/onu';

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
 * credenciales de conexión, WAN TR-069, VLAN en uplink de la OLT y evidencia
 * de tráfico.
 */
@Injectable()
export class OnuPostProvisionVerifyService {
  private readonly logger = new Logger(OnuPostProvisionVerifyService.name);
  /** Serializa verify/run|kick|poller por ONU (evita ok↔test↔fail por carreras). */
  private readonly verifyChains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly tr069: OnuTr069ConfigService,
    private readonly serviceVlans: ServiceVlanService,
  ) {}

  private async withOnuVerifyLock<T>(
    schema: string,
    onuId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = `${schema}:${onuId}`;
    const prev = this.verifyChains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const chained = prev.then(() => gate);
    this.verifyChains.set(
      key,
      chained.catch(() => undefined),
    );
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      if (this.verifyChains.get(key) === chained) {
        this.verifyChains.delete(key);
      }
    }
  }

  /** Arranca (o reinicia) el ciclo de 15 minutos. */
  async start(schema: string, onuId: string): Promise<Onu> {
    return this.withOnuVerifyLock(schema, onuId, async () => {
      const onuRepo = await this.tenantConnections.getOnuRepository(schema);
      const onu = await onuRepo.findOne({ where: { id: onuId } });
      if (!onu) throw new NotFoundException('ONU not found');

      onu.verifyStatus = 'test';
      onu.verifyStartedAt = new Date();
      onu.verifyCheckedAt = null;
      onu.verifyAttempt = 0;
      onu.verifyDetail = {};
      return onuRepo.save(onu);
    });
  }

  /**
   * Plan + estado de avance para el modal (poll desde UI).
   */
  async getProgress(schema: string, onuId: string) {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const onu = await onuRepo.findOne({ where: { id: onuId } });
    if (!onu) throw new NotFoundException('ONU not found');

    let acsModel: string | null = null;
    if (onu.sn?.trim()) {
      try {
        const client = new GenieAcsNbiClient(resolveNbiBaseUrl());
        const device = await client.findBySerial(onu.sn);
        acsModel = resolveAcsModelFromDevice(
          device as Record<string, unknown> | null,
        );
      } catch {
        /* sin ACS */
      }
    }
    const driver = onu.sn?.trim()
      ? resolveOnuDriver({
          sn: onu.sn,
          onuType: onu.onuType,
          acsModel,
        })
      : null;
    const plan = resolveProgressPlan(driver);
    const detail = (onu.verifyDetail ?? {}) as OnuVerifyDetail;
    return {
      onuId: onu.id,
      sn: onu.sn,
      driverId: driver?.id ?? null,
      verifyStatus: onu.verifyStatus ?? 'idle',
      verifyAttempt: onu.verifyAttempt ?? 0,
      verifyStartedAt: onu.verifyStartedAt?.toISOString() ?? null,
      verifyCheckedAt: onu.verifyCheckedAt?.toISOString() ?? null,
      plan,
      progress: detail.progress ?? null,
      checks: {
        arp: detail.arp ?? null,
        connreq: detail.connreq ?? null,
        wan: detail.wan ?? null,
        dns: detail.dns ?? null,
        route: detail.route ?? null,
        uplinkVlan: detail.uplinkVlan ?? null,
        traffic: detail.traffic ?? null,
      },
      healed: detail.healed ?? [],
    };
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
      where: [{ verifyStatus: 'test' }],
      select: ['id', 'sn', 'verifyStatus', 'verifyCheckedAt', 'verifyAttempt'],
    });
    return candidates
      .filter((onu) => {
        const st = onu.verifyStatus ?? 'idle';
        if (st === 'ok' || st === 'fail' || st === 'check') return false;
        return shouldRunVerifyTick({
          status: 'test',
          checkedAt: onu.verifyCheckedAt,
        });
      })
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

  /**
   * Un pipeline de salud (resync = revisor). force=false salta ok/check/fail.
   */
  async runOnuHealthPass(
    schema: string,
    onuId: string,
    opts?: { force?: boolean },
  ): Promise<Onu> {
    const force = !!opts?.force;
    return this.withOnuVerifyLock(schema, onuId, async () => {
      const onuRepo = await this.tenantConnections.getOnuRepository(schema);
      const onu = await onuRepo.findOne({ where: { id: onuId } });
      if (!onu) throw new NotFoundException('ONU not found');
      if (shouldSkipHealthPass(onu.verifyStatus, force)) return onu;
      if (!force && (onu.verifyStatus === 'fail' || onu.verifyStatus === 'check')) {
        return onu;
      }
      if (onu.verifyStatus !== 'test') {
        onu.verifyStatus = 'test';
        onu.verifyStartedAt = onu.verifyStartedAt ?? new Date();
        if (force) onu.verifyAttempt = 0;
        await onuRepo.save(onu);
      }
      return this.executeCheck(schema, onuId, { manual: force });
    });
  }

  async runOne(schema: string, onuId: string): Promise<Onu> {
    return this.runOnuHealthPass(schema, onuId, { force: false });
  }

  /**
   * Chequeo a demanda desde el panel (botón Check ONU).
   * Corre las mismas pruebas y curaciones que el poller. Si aplica una
   * curación, vuelve a comprobar inmediatamente; hace como máximo tres
   * intentos y una lectura final para confirmar el resultado.
   */
  async runManual(schema: string, onuId: string): Promise<Onu> {
    return this.withOnuVerifyLock(schema, onuId, async () => {
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
    });
  }

  /**
   * Kick post-apply (wizards): cura + mide sin cerrar en fail por “ventana
   * vencida”. El Check ONU manual sí fuerza veredicto; aquí solo ok / test
   * (fail solo si irrecuperable, p. ej. sin IP WAN).
   */
  async runKick(schema: string, onuId: string): Promise<Onu> {
    return this.withOnuVerifyLock(schema, onuId, async () => {
      for (let attempt = 1; attempt <= VERIFY_HEAL_MAX_ATTEMPTS; attempt += 1) {
        const onu = await this.executeCheck(schema, onuId, {
          manual: false,
          soft: true,
          attempt,
          allowHeal: true,
        });
        if (onu.verifyStatus !== 'test') return onu;
      }
      return this.executeCheck(schema, onuId, {
        manual: false,
        soft: true,
        attempt: VERIFY_HEAL_MAX_ATTEMPTS,
        allowHeal: false,
      });
    });
  }

  async countMigratedHealthPending(schema: string): Promise<number> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const rows = await onuRepo.find({
      select: ['id', 'migratedAt', 'verifyStatus', 'verifyCheckedAt'],
    });
    return rows.filter((o) =>
      needsMigratedHealthBackfill({
        migratedAt: o.migratedAt,
        verifyStatus: o.verifyStatus,
        verifyCheckedAt: o.verifyCheckedAt,
      }),
    ).length;
  }

  /** Encola un pass de salud para ONUs migradas pendientes (Recheck all). */
  async recheckMigrated(schema: string): Promise<{ queued: number }> {
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const rows = await onuRepo.find();
    const pending = rows.filter((o) =>
      needsMigratedHealthBackfill({
        migratedAt: o.migratedAt,
        verifyStatus: o.verifyStatus,
        verifyCheckedAt: o.verifyCheckedAt,
      }),
    );
    for (const o of pending) {
      o.verifyStatus = 'idle';
      o.verifyAttempt = 0;
    }
    if (pending.length) await onuRepo.save(pending);
    await mapWithConcurrency(pending, 2, async (o) => {
      try {
        await this.runOnuHealthPass(schema, o.id, { force: true });
      } catch (err) {
        this.logger.warn(
          `recheckMigrated ${o.sn ?? o.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    });
    return { queued: pending.length };
  }

  private async executeCheck(
    schema: string,
    onuId: string,
    opts: {
      manual: boolean;
      /** No fuerza ventana vencida (post-apply / wizard). */
      soft?: boolean;
      attempt?: number;
      allowHeal?: boolean;
    },
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
    const verifyDriver = onu.sn?.trim()
      ? resolveOnuDriver({ sn: onu.sn, onuType: onu.onuType })
      : null;
    const verifyChecks = resolveVerifyChecks(verifyDriver);
    const needs = (id: OnuVerifyCheckId) => verifyChecks[id] !== 'skip';

    const canHeal =
      opts.allowHeal !== false && attempt <= VERIFY_HEAL_MAX_ATTEMPTS;

    try {
      const dba = await this.tr069.syncInternetDba(schema, onuId, {
        heal: canHeal,
      });
      detail.plan = {
        ok: dba.matched,
        message: dba.message,
      };
      if (dba.healed) healed.push(dba.message);
    } catch (err) {
      detail.plan = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const skipAcs = detail.plan?.ok === false;

    if (skipAcs) {
      /* DBA del plan no cuadra: no tocar ACS/OMCI WAN en esta visita. */
    } else if (!onu.wanIp?.trim()) {
      if (needs('arp')) detail.arp = { ok: false, message: 'sin IP WAN asignada' };
      if (needs('wan')) detail.wan = { ok: false, message: 'sin IP WAN asignada' };
      if (needs('dns')) detail.dns = { ok: false, message: 'sin IP WAN' };
      if (needs('route')) detail.route = { ok: false, message: 'sin IP WAN' };
      if (needs('uplinkVlan'))
        detail.uplinkVlan = { ok: false, message: 'sin IP WAN' };
      if (needs('connreq'))
        detail.connreq = { ok: false, message: 'sin IP WAN' };
      if (needs('traffic'))
        detail.traffic = { ok: false, message: 'sin IP WAN' };
      irrecoverable = true;
    } else {
      const poolRepo = await this.tenantConnections.getIpPoolRepository(schema);
      const wanPool = onu.wanPoolId
        ? await poolRepo.findOne({ where: { id: onu.wanPoolId } })
        : null;

      // Paso 0: credenciales nuestras ANTES de mirar WAN/DNS. Sin ellas el ACS
      // recibe 401 y cualquier curación de WAN se queda en cola.
      // Excepción: drivers con verifyHeal delegan el paso 0 al propio modelo.
      let credentialsOurs = true;
      const healDriver = verifyDriver;
      const usesHealOne = !!(healDriver?.verifyHeal || healDriver?.healOne);
      if (canHeal && !usesHealOne && needs('connreq')) {
        const cred = await this.tr069.ensureCredentialsFirst(schema, onuId);
        credentialsOurs = cred.ours;
        if (cred.note) healed.push(cred.note);
      }

      if (needs('arp') || needs('traffic')) {
        if (!wanPool?.routerId) {
          if (needs('arp')) {
            detail.arp = {
              ok: false,
              message: 'el pool WAN no tiene router asignado',
            };
          }
          if (verifyChecks.arp === 'required') irrecoverable = true;
        } else {
          const deviceRepo =
            await this.tenantConnections.getNetworkDeviceRepository(schema);
          const router = await deviceRepo.findOne({
            where: { id: wanPool.routerId },
          });
          if (!router) {
            if (needs('arp')) {
              detail.arp = {
                ok: false,
                message: 'router del pool no encontrado',
              };
            }
            if (verifyChecks.arp === 'required') irrecoverable = true;
          } else {
            // ARP primero (rápido). Conexiones firewall solo si traffic lo pide
            // y ACS no aportó bytes — ese dump es muy lento en routers cargados.
            const routerProbe = await this.probeRouter(
              router,
              onu.wanIp,
              prevDetail.traffic?.meta,
              { includeConnections: false },
            );
            if (needs('arp')) detail.arp = routerProbe.arp;
            if (needs('traffic')) detail.traffic = routerProbe.traffic;
          }
        }
      }

      const acs = await this.probeAcs(onu, wanPool);
      if (needs('connreq')) detail.connreq = acs.connreq;
      if (needs('wan')) detail.wan = acs.wan;
      if (needs('dns')) detail.dns = acs.dns;
      if (needs('route')) detail.route = acs.route;
      if (detail.connreq) {
        credentialsOurs = detail.connreq.ok;
      }

      // VLAN en el uplink de la OLT: sin eso el CPE puede verse Connected en
      // TR-069 y aun así no responder ARP (el tráfico no sale del chasis).
      if (needs('uplinkVlan')) {
        detail.uplinkVlan = await this.probeUplinkVlan(schema, onu, wanPool);
      }

      // Traffic rápido: bytes ACS → WAN+ARP → count-only (sin dump lento).
      if (needs('traffic')) {
        if (acs.bytesOk) {
          detail.traffic = {
            ok: true,
            message: acs.bytesOk,
            meta: acs.wan.meta,
          };
        } else if (
          typeof prevDetail.wan?.meta?.bytesRecv === 'number' &&
          typeof acs.wan.meta?.bytesRecv === 'number' &&
          acs.wan.meta.bytesRecv > prevDetail.wan.meta.bytesRecv
        ) {
          detail.traffic = {
            ok: true,
            message: 'bytes WAN crecieron',
            meta: acs.wan.meta,
          };
        } else if (detail.arp?.ok && detail.wan?.ok) {
          // CPE con IP correcta + ARP viva en el gateway = camino a internet listo.
          detail.traffic = {
            ok: true,
            message: 'WAN Connected + ARP viva',
            meta: {
              ...(detail.arp.meta ?? {}),
              ...(detail.wan.meta ?? {}),
              via: 'arp+wan',
            },
          };
        } else if (
          detail.traffic &&
          !detail.traffic.ok &&
          wanPool?.routerId
        ) {
          const deviceRepo =
            await this.tenantConnections.getNetworkDeviceRepository(schema);
          const router = await deviceRepo.findOne({
            where: { id: wanPool.routerId },
          });
          if (router) {
            const slow = await this.probeRouter(
              router,
              onu.wanIp!,
              prevDetail.traffic?.meta,
              { includeConnections: true, arpOnly: false },
            );
            if (slow.traffic.ok) detail.traffic = slow.traffic;
          }
        }
      }

      if (
        canHeal &&
        needs('uplinkVlan') &&
        detail.uplinkVlan &&
        !detail.uplinkVlan.ok &&
        wanPool?.vlanId &&
        onu.oltId
      ) {
        const fix = await this.serviceVlans.ensureVlanTaggedOnUplinks(
          schema,
          onu.oltId,
          wanPool.vlanId,
          wanPool.name ?? null,
        );
        healed.push(fix.message);
        if (fix.ok) {
          detail.uplinkVlan = {
            ok: true,
            message: `VLAN ${wanPool.vlanId} en uplink (${fix.carrying.join(', ') || 'agregada'})`,
            meta: {
              vlanId: wanPool.vlanId,
              carrying: fix.carrying,
              tagged: fix.tagged,
              healed: true,
            },
          };
        }
      }

      // ARP ausente / WAN / DNS: normalmente sólo se reempuja si ya tenemos el
      // camino de connection_request (empujar con credenciales ajenas sólo
      // alarga la cola). Excepción: las ONU con handler por modelo que "posee"
      // la selección de WAN necesitan correr aunque el CPE no sea manejable —
      // su provision rompe el deadlock (pre-carga credenciales + reinicia) y sin
      // esto nunca se dispararía. También corrige LAN/SSID bind aunque WAN/DNS
      // ya estén ok (isServiceWanApplied es idempotente y sale temprano).
      const modelOwnsWan = !!healDriver?.ownsWanSelection?.({
        sn: onu.sn!,
        onuType: onu.onuType,
      });
      const wanNeedsHeal =
        canHeal &&
        !!wanPool &&
        (modelOwnsWan ||
          usesHealOne ||
          (needs('wan') && !detail.wan?.ok && !!detail.wan) ||
          (needs('dns') && !detail.dns?.ok && !!detail.dns) ||
          (needs('arp') && !detail.arp?.ok && !!detail.arp) ||
          (needs('route') && !detail.route?.ok && !!detail.route));
      if (wanNeedsHeal && (credentialsOurs || modelOwnsWan || usesHealOne)) {
        const note = await this.tr069.repushWanForVerify(schema, onuId);
        if (note) healed.push(note);
        if (needs('route') && !detail.route?.ok) {
          const routeNote = await this.tr069.healServiceRouteForVerify(
            schema,
            onuId,
          );
          if (routeNote) healed.push(routeNote);
        }
        // Heal pudo escribir verifyDetail.progress — recargar.
        const refreshed = await onuRepo.findOne({ where: { id: onuId } });
        if (refreshed) onu = refreshed;
      }
    }

    if (healed.length) detail.healed = healed;

    // Marcar pasos net_* como completed cuando el probe pasó.
    const netCompleted: string[] = [];
    for (const id of [
      'arp',
      'connreq',
      'wan',
      'dns',
      'route',
      'uplinkVlan',
      'traffic',
    ] as const) {
      const c = detail[id];
      if (c?.ok) netCompleted.push(`net_${id}`);
    }
    const prevProgress = (onu.verifyDetail as OnuVerifyDetail)?.progress;
    if (netCompleted.length || prevProgress) {
      detail.progress = {
        currentStepId: prevProgress?.currentStepId ?? null,
        completed: [
          ...new Set([...(prevProgress?.completed ?? []), ...netCompleted]),
        ],
        notes: prevProgress?.notes ?? [],
        updatedAt: new Date().toISOString(),
      };
    }

    // Manual (Check ONU): cierra el veredicto ya (essentials bastan).
    // Soft (kick post-apply): nunca cierra por ventana — deja test al poller.
    // Automático: respeta la ventana de 15 min.
    const rawWindowExpired = opts.soft
      ? false
      : opts.manual
        ? true
        : isVerifyWindowExpired({ startedAt: onu.verifyStartedAt });
    // Una curación debe tener al menos un chequeo posterior para probar si
    // prendió. Incluso con la ventana vencida, se permiten los tres intentos;
    // recién el tick siguiente al tercero puede cerrar en fail.
    const windowExpired = shouldCloseVerifyWindow({
      windowExpired: rawWindowExpired,
      healingApplied: healed.length > 0,
    });
    const next = skipAcs
      ? 'check'
      : decideVerifyOutcome({
          detail,
          windowExpired,
          irrecoverable,
          checks: verifyChecks,
          planOk: detail.plan ? detail.plan.ok : null,
        });

    onu = (await onuRepo.findOne({ where: { id: onuId } }))!;
    // No degradar un ok reciente: ticks concurrentes (Check ONU × N) o un
    // connreq flaky no deben tumbar ARP+WAN ya verificados.
    if (
      onu.verifyStatus === 'ok' &&
      next !== 'ok' &&
      !irrecoverable &&
      !opts.manual
    ) {
      const carriedPrep = (onu.verifyDetail as OnuVerifyDetail)?.modelPrep;
      onu.verifyDetail = {
        ...detail,
        ...(carriedPrep ? { modelPrep: carriedPrep } : {}),
      };
      onu.verifyCheckedAt = new Date();
      await onuRepo.save(onu);
      this.logger.log(
        `verify ${onu.sn ?? onuId} attempt=${attempt} → ok (sticky; tick dijo ${next})`,
      );
      return onu;
    }
    onu.verifyAttempt = attempt;
    onu.verifyCheckedAt = new Date();
    // El handler por modelo pudo escribir `modelPrep` (tope de reinicio) durante
    // este tick vía repushWanForVerify; hay que conservarlo o el poller volvería
    // a reiniciar sin límite.
    const carriedPrep = (onu.verifyDetail as OnuVerifyDetail)?.modelPrep;
    // Preferimos progress recién calculado en detail; si no, el de heal.
    const carriedProgress =
      detail.progress ?? (onu.verifyDetail as OnuVerifyDetail)?.progress;
    onu.verifyDetail = {
      ...detail,
      ...(carriedPrep ? { modelPrep: carriedPrep } : {}),
      ...(carriedProgress ? { progress: carriedProgress } : {}),
    };
    onu.verifyStatus = next;
    if (opts.manual) {
      onu.verifyStartedAt = onu.verifyStartedAt ?? new Date();
    }
    await onuRepo.save(onu);

    this.logger.log(
      `verify${opts.soft ? ' (kick)' : opts.manual ? ' (manual)' : ''} ${onu.sn ?? onuId} attempt=${attempt} → ${next}` +
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
    opts?: { includeConnections?: boolean; arpOnly?: boolean },
  ): Promise<{ arp: OnuVerifyCheckResult; traffic: OnuVerifyCheckResult }> {
    const includeConnections = opts?.includeConnections === true;
    const skipArp = opts?.arpOnly === false && includeConnections;
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

      let arp: OnuVerifyCheckResult = {
        ok: false,
        message: 'omitido',
      };
      if (!skipArp) {
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
        arp = entry
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
      }

      if (!includeConnections) {
        return {
          arp,
          traffic: { ok: false, message: 'sin conexiones activas' },
        };
      }

      // count-only: mucho más rápido que volcar todas las conexiones.
      const CONN_PRINT_MS = 3_000;
      let count = 0;
      try {
        const replies = await Promise.race([
          api.write([
            '/ip/firewall/connection/print',
            `?src-address=${wanIp}`,
            '=count-only=',
          ]),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('timeout conexiones')),
              CONN_PRINT_MS,
            ),
          ),
        ]);
        const done = replies.find((r) => r.type === '!done');
        const ret = done?.attrs?.['ret'] ?? done?.attrs?.['=ret'];
        count = Number(ret);
        if (!Number.isFinite(count)) {
          // Fallback: algunos RouterOS no respetan count-only con filtro.
          const rows = reRows(replies).filter((c) =>
            String(c['src-address'] || '').startsWith(wanIp),
          );
          count = rows.length;
        }
      } catch {
        return {
          arp,
          traffic: {
            ok: false,
            message: 'conexiones: timeout',
          },
        };
      }
      const prevCount =
        typeof prevTrafficMeta?.connCount === 'number'
          ? prevTrafficMeta.connCount
          : 0;
      const traffic: OnuVerifyCheckResult =
        count > 0
          ? {
              ok: true,
              message: `${count} conexiones en ${router.name}`,
              meta: { connCount: count },
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
    route: OnuVerifyCheckResult;
    bytesOk: string | null;
  }> {
    if (!onu.sn?.trim()) {
      return {
        connreq: { ok: false, message: 'sin SN' },
        wan: { ok: false, message: 'sin SN' },
        dns: { ok: false, message: 'sin SN' },
        route: { ok: false, message: 'sin SN' },
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
          route: { ok: false, message: 'aún no Informó al ACS' },
          bytesOk: null,
        };
      }

      const user = strVal(
        genieGet(
          device,
          `${detectDataModelRoot(device)}.ManagementServer.ConnectionRequestUsername`,
        ),
      );
      // El nombre de usuario no basta: la contraseña no se puede releer del
      // CPE, así que la única prueba es pedirle una conexión de verdad. Varios
      // modelos traen `acs` de fábrica con otra clave, y darlos por buenos
      // dejaba la ONU marcada como despierta mientras rechazaba todo.
      const connreq: OnuVerifyCheckResult = shouldWriteConnReqCredentials(user)
        ? {
            ok: false,
            message: user
              ? `credenciales ajenas (${user})`
              : 'credenciales vacías',
            meta: { username: user },
          }
        : await this.checkConnectionRequest(device, onu.sn);

      const acsModel =
        strVal(genieGet(device, 'InternetGatewayDevice.DeviceInfo.ModelName')) ??
        strVal(genieGet(device, 'Device.DeviceInfo.ModelName'));
      const found = resolveServiceWanForVerify(device, {
        sn: onu.sn,
        onuType: onu.onuType,
        acsModel,
        mgmtIp: onu.mgmtIp,
        expectedIp: onu.wanIp,
        expectedVlanId: wanPool?.vlanId ?? null,
      });
      if (!found) {
        return {
          connreq,
          wan: { ok: false, message: 'sin WAN de servicio en el árbol TR-069' },
          dns: { ok: false, message: 'sin WAN de servicio en el árbol TR-069' },
          route: { ok: false, message: 'sin WAN de servicio en el árbol TR-069' },
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
          route: { ok: false, message: 'sólo existe la WAN de gestión' },
          bytesOk: null,
        };
      }

      const { conn } = found;
      const state = readWanConnectionState(device, found);
      const {
        ip,
        mask,
        gateway: gw,
        nat,
        dns,
        addressingType,
        connectionStatus,
        vlanPath,
        bytesSent,
        bytesRecv,
      } = state;
      const vlan = state.vlan ?? Number.NaN;

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
      // Un NAT desconocido no es un NAT apagado: hay modelos que no publican la
      // hoja hasta que el ACS descubre su subárbol.
      if (nat === false || (found.model === 'tr098' && nat !== true)) {
        problems.push('NAT off');
      }
      if (wanPool && Number.isFinite(vlan) && vlan !== wanPool.vlanId) {
        problems.push(`vlan=${vlan} (esperada ${wanPool.vlanId})`);
      } else if (wanPool && !Number.isFinite(vlan)) {
        problems.push('vlan ausente');
      }

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
              message: `${ip} vlan=${vlan} nat=${nat ?? 'n/d'}`,
              meta: {
                bytesSent,
                bytesRecv,
                conn,
                dns,
                dataModel: found.model,
                addressingType,
                connectionStatus,
                vlanPath,
                exposedVlanLeaves: state.exposedVlanLeaves,
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
                dataModel: found.model,
                addressingType,
                connectionStatus,
                vlanPath,
                exposedVlanLeaves: state.exposedVlanLeaves,
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

      const routeAssessment = assessServiceRoute(device, {
        serviceConn: conn,
        expectedGateway: wanPool?.gateway ?? '',
        dataModel: found.model,
      });
      const route: OnuVerifyCheckResult = {
        ok: routeAssessment.ok,
        message: routeAssessment.message,
        meta: {
          model: routeAssessment.model,
          defaultRoute: routeAssessment.defaultRoute,
          legacy: routeAssessment.legacyIfaces.map((i) => ({
            path: i.path,
            ip: i.ip,
          })),
          disablePaths: routeAssessment.disablePaths,
        },
      };

      return { connreq, wan, dns: dnsCheck, route, bytesOk };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        connreq: { ok: false, message: `ACS: ${msg}` },
        wan: { ok: false, message: `ACS: ${msg}` },
        dns: { ok: false, message: `ACS: ${msg}` },
        route: { ok: false, message: `ACS: ${msg}` },
        bytesOk: null,
      };
    }
  }

  private async checkConnectionRequest(
    device: Record<string, unknown>,
    serial: string,
  ): Promise<OnuVerifyCheckResult> {
    const probe = await this.tr069.probeConnectionRequest(device, serial);
    return probe.ok
      ? { ok: true, message: CONN_REQ_USERNAME }
      : {
          ok: false,
          message: `no contesta la petición de conexión: ${probe.detail}`,
          meta: { username: CONN_REQ_USERNAME, reason: probe.reason },
        };
  }

  private async probeUplinkVlan(
    schema: string,
    onu: Onu,
    wanPool: { vlanId: number; name: string | null } | null,
  ): Promise<OnuVerifyCheckResult> {
    if (!wanPool?.vlanId) {
      return { ok: true, message: 'sin VLAN WAN' };
    }
    if (!onu.oltId) {
      return { ok: false, message: `VLAN ${wanPool.vlanId}: ONU sin OLT` };
    }
    try {
      const deviceRepo =
        await this.tenantConnections.getNetworkDeviceRepository(schema);
      const olt = await deviceRepo.findOne({ where: { id: onu.oltId } });
      if (!olt) {
        return {
          ok: false,
          message: `VLAN ${wanPool.vlanId}: OLT no encontrada`,
        };
      }
      const presence = this.serviceVlans.probeVlanOnUplinks(
        olt,
        wanPool.vlanId,
      );
      if (presence.status === 'present') {
        return {
          ok: true,
          message: `VLAN ${wanPool.vlanId} en uplink (${presence.carrying.join(', ')})`,
          meta: {
            vlanId: wanPool.vlanId,
            carrying: presence.carrying,
            oltId: olt.id,
            oltName: olt.name,
          },
        };
      }
      if (presence.status === 'unknown') {
        // Sin inventario no tumbamos el veredicto: el poller aún no leyó.
        return {
          ok: true,
          message: `VLAN ${wanPool.vlanId}: inventario de uplinks pendiente`,
          meta: { vlanId: wanPool.vlanId, pendingInventory: true },
        };
      }
      return {
        ok: false,
        message: `VLAN ${wanPool.vlanId} no actualizada en uplink — actualizar`,
        meta: {
          vlanId: wanPool.vlanId,
          oltId: olt.id,
          oltName: olt.name,
          assignable: presence.assignable,
          action: 'update_uplink',
        },
      };
    } catch (e) {
      return {
        ok: false,
        message: `VLAN uplink: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

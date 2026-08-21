import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CrmService } from '../crm/crm.service';
import { BillingService } from '../billing/billing.service';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { TopologyService } from '../topology/topology.service';
import { VpnService } from '../topology/vpn.service';
import { OnuConnectedService } from '../topology/onus/onu-connected.service';
import { OnuPostProvisionVerifyService } from '../topology/onus/onu-post-provision-verify.service';
import { PlatformAiRestorePointsService } from './platform-ai-restore-points.service';
import { BUILTIN_AI_TOOLS } from './ai-tools.catalog';
import {
  compactMikrotikRows,
  isMikrotikReadPath,
  isMikrotikReadWords,
  isMikrotikWriteWordsAllowed,
} from './mikrotik-safe.util';
import type { NetworkDevice } from '../topology/shared/entities/network-device.entity';
import type { VpnTunnel } from '../topology/shared/entities/vpn-tunnel.entity';
import type { VpnTunnelClient } from '../topology/shared/entities/vpn-tunnel-client.entity';
import type {
  AiToolExecContext,
  AiToolHandlerResult,
  AiUiView,
} from './ai-tool.types';
import { asString, requireUuid } from './ai-tools.args.util';

type ToolDef = {
  slug: string;
  name: string;
  description: string;
  mutates: boolean;
  parametersSchema: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ) => Promise<AiToolHandlerResult>;
};

function asWords(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);
}

const DEVICE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

function deviceMgmtPort(device: {
  type?: string | null;
  mgmtPort?: number | null;
  mgmtProtocol?: string | null;
}) {
  if (device.mgmtPort) return device.mgmtPort;
  const proto = (device.mgmtProtocol ?? '').toLowerCase();
  if (proto === 'api_plain') return 8728;
  if (proto === 'api_ssl') return 8729;
  if (device.type === 'olt') return 22;
  return null;
}

/** Credenciales completas para que el agente acceda al activo (tenant interno). */
function deviceConnection(device: NetworkDevice) {
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    subtype: device.subtype ?? null,
    mgmtHost: device.mgmtHost ?? null,
    mgmtPort: deviceMgmtPort(device),
    mgmtUsername: device.mgmtUsername ?? null,
    mgmtPassword: device.mgmtPassword ?? null,
    mgmtProtocol: device.mgmtProtocol ?? null,
    snmpCommunity: device.snmpCommunity ?? null,
    snmpCommunityRw: device.snmpCommunityRw ?? null,
    snmpPort: device.snmpPort ?? 161,
    connectionStatus: device.connectionStatus,
    lastError: device.lastError ?? null,
    isActive: device.isActive,
    accessVia:
      'Backend conecta por mgmtHost; LAN privada usa rutas VPN del tenant.',
  };
}

function tunnelConnection(tunnel: VpnTunnel, clients: VpnTunnelClient[]) {
  return {
    id: tunnel.id,
    name: tunnel.name,
    protocol: tunnel.protocol,
    status: tunnel.status,
    clientAddress: tunnel.clientAddress,
    serverAddress: tunnel.serverAddress,
    tunnelSubnet: tunnel.tunnelSubnet,
    tunnelRoutes: tunnel.tunnelRoutes,
    password: tunnel.password ?? null,
    wgPrivateKey: tunnel.wgPrivateKey ?? null,
    wgPublicKey: tunnel.wgPublicKey ?? null,
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      clientAddress: c.clientAddress,
      password: c.password ?? null,
      wgPrivateKey: c.wgPrivateKey ?? null,
      wgPublicKey: c.wgPublicKey ?? null,
      deviceId: c.deviceId ?? null,
    })),
  };
}

function compactOnu(o: {
  id: string;
  sn?: string | null;
  oltId?: string;
  oltName?: string;
  onuIf?: string;
  online?: boolean;
  verifyStatus?: string;
  signalDbm?: number | null;
  wanIp?: string | null;
  status?: string;
  name?: string | null;
  onuType?: string | null;
}) {
  return {
    id: o.id,
    sn: o.sn ?? null,
    name: o.name ?? null,
    oltId: o.oltId ?? null,
    oltName: o.oltName ?? null,
    onuIf: o.onuIf ?? null,
    online: !!o.online,
    status: o.status ?? null,
    verifyStatus: o.verifyStatus ?? 'idle',
    signalDbm: o.signalDbm ?? null,
    wanIp: o.wanIp ?? null,
    onuType: o.onuType ?? null,
  };
}

function clientLabel(c: {
  firstName?: string;
  lastName?: string;
  companyName?: string;
}) {
  const person = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return person || c.companyName || 'Cliente';
}

function compactClient(c: Record<string, unknown>) {
  return {
    id: c.id,
    name: clientLabel(c as { firstName?: string; lastName?: string; companyName?: string }),
    firstName: c.firstName ?? '',
    lastName: c.lastName ?? '',
    companyName: c.companyName ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    documentNumber: c.documentNumber ?? '',
    companyTaxId: c.companyTaxId ?? '',
    city: c.city ?? '',
    isLead: !!c.isLead,
    isActive: c.isActive !== false,
    hasSuspendedService: !!c.hasSuspendedService,
    createdAt:
      c.createdAt instanceof Date
        ? c.createdAt.toISOString()
        : typeof c.createdAt === 'string'
          ? c.createdAt
          : null,
  };
}

function compactService(s: Record<string, unknown>) {
  const plan = s.servicePlan as { name?: string } | undefined;
  const state = s.serviceState as Record<string, unknown> | undefined;
  return {
    id: s.id,
    clientId: s.clientId,
    name: s.name ?? null,
    status: s.status ?? null,
    onuId: s.onuId ?? null,
    planName: plan?.name ?? null,
    price: s.price ?? null,
    street: s.street ?? null,
    city: s.city ?? null,
    serviceState: state
      ? {
          label: state.label ?? null,
          tone: state.tone ?? null,
          desired: state.desired ?? null,
        }
      : null,
  };
}

/** Redacta secretos de equipos de topología para el LLM. */
function compactDevice(d: Record<string, unknown>) {
  return {
    id: d.id,
    name: d.name ?? null,
    type: d.type ?? null,
    subtype: d.subtype ?? null,
    mgmtHost: d.mgmtHost ?? null,
    mgmtPort: d.mgmtPort ?? null,
    mgmtUsername: d.mgmtUsername ?? null,
    mgmtProtocol: d.mgmtProtocol ?? null,
    connectionStatus: d.connectionStatus ?? null,
    isActive: d.isActive !== false,
    hasPassword: !!(d.hasPassword ?? d.mgmtPassword),
    hasSnmpCommunity: !!(d.snmpCommunity || d.hasSnmpCommunity),
    hasSnmpCommunityRw: !!(d.snmpCommunityRw || d.hasSnmpCommunityRw),
    lastError: d.lastError ?? null,
  };
}

/**
 * Registry tipado de tools ejecutables (no eval de código de DB).
 * Acceso acotado al schema del tenant del usuario JWT.
 * Topology/CRM se resuelven vía ModuleRef para no crear ciclos de módulos.
 */
@Injectable()
export class AiToolsService {
  private readonly logger = new Logger(AiToolsService.name);
  private readonly bySlug: Map<string, ToolDef>;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly tenantConnections: TenantConnectionService,
    private readonly restorePoints: PlatformAiRestorePointsService,
  ) {
    const handlers: Record<
      string,
      (args: Record<string, unknown>, ctx: AiToolExecContext) => Promise<AiToolHandlerResult>
    > = {
      crm_search_clients: (a, c) => this.crmSearchClients(a, c),
      crm_get_client: (a, c) => this.crmGetClient(a, c),
      crm_list_services: (a, c) => this.crmListServices(a, c),
      crm_get_service: (a, c) => this.crmGetService(a, c),
      crm_update_client: (a, c) => this.crmUpdateClient(a, c),
      crm_find_duplicates: (a, c) => this.crmFindDuplicates(a, c),
      crm_merge_clients: (a, c) => this.crmMergeClients(a, c),
      crm_find_duplicate_services: (a, c) => this.crmFindDuplicateServices(a, c),
      crm_merge_services: (a, c) => this.crmMergeServices(a, c),
      billing_search_invoices: (a, c) => this.billingSearchInvoices(a, c),
      billing_list_debt: (a, c) => this.billingListDebt(a, c),
      billing_get_invoice: (a, c) => this.billingGetInvoice(a, c),
      billing_compare_invoices: (a, c) => this.billingCompareInvoices(a, c),
      ui_open_view: (a, c) => this.uiOpenView(a, c),
      topo_list_routers: (a, c) => this.topoListDevices(a, c, 'router'),
      topo_list_olts: (a, c) => this.topoListDevices(a, c, 'olt'),
      topo_get_device: (a, c) => this.topoGetDevice(a, c),
      asset_get_connection: (a, c) => this.assetGetConnection(a, c),
      topo_test_connection: (a, c) => this.topoTestConnection(a, c),
      mikrotik_read: (a, c) => this.mikrotikRead(a, c),
      mikrotik_apply: (a, c) => this.mikrotikApply(a, c),
      vpn_list_tunnels: (a, c) => this.vpnListTunnels(a, c),
      vpn_probe_tunnel: (a, c) => this.vpnProbeTunnel(a, c),
      onu_list_connected: (a, c) => this.listConnected(a, c),
      onu_list_failed: (a, c) => this.onuListFailed(a, c),
      onu_lookup: (a, c) => this.lookup(a, c),
      onu_verify_status: (a, c) => this.verifyStatus(a, c),
      onu_live_status: (a, c) => this.onuLiveStatus(a, c),
      olt_discover_onus_live: (a, c) => this.oltDiscoverOnusLive(a, c),
      onu_verify_run: (a, c) => this.verifyRun(a, c),
      onu_refresh: (a, c) => this.onuRefresh(a, c),
      onu_reboot: (a, c) => this.onuReboot(a, c),
      crm_set_service_status: (a, c) => this.crmSetServiceStatus(a, c),
      crm_reconcile_olt: (a, c) => this.crmReconcileOlt(a, c),
    };

    const defs: ToolDef[] = BUILTIN_AI_TOOLS.map((meta) => {
      const execute = handlers[meta.slug];
      if (!execute) {
        throw new Error(`Missing handler for builtin tool ${meta.slug}`);
      }
      return {
        slug: meta.slug,
        name: meta.name,
        description: meta.description,
        mutates: meta.mutates,
        parametersSchema: meta.parametersSchema,
        execute,
      };
    });
    this.bySlug = new Map(defs.map((d) => [d.slug, d]));
  }

  private resolve<T>(token: abstract new (...args: never[]) => T): T {
    return this.moduleRef.get(token as never, { strict: false });
  }

  private get onus() {
    return this.resolve(OnuConnectedService);
  }

  private get verify() {
    return this.resolve(OnuPostProvisionVerifyService);
  }

  private get crm() {
    return this.resolve(CrmService);
  }

  private get billing() {
    return this.resolve(BillingService);
  }

  private get topology() {
    return this.resolve(TopologyService);
  }

  private get vpn() {
    return this.resolve(VpnService);
  }

  listBuiltinCatalog() {
    return BUILTIN_AI_TOOLS;
  }

  getMeta(slug: string) {
    const d = this.bySlug.get(slug);
    if (!d) return null;
    return {
      slug: d.slug,
      name: d.name,
      description: d.description,
      mutates: d.mutates,
    };
  }

  /**
   * Acepta UUID o nombre de equipo (p. ej. "edge-mikrotik").
   * Evita el error Postgres `invalid input syntax for type uuid` cuando el LLM
   * pasa el nombre en vez del id.
   */
  private async resolveDevice(
    schemaName: string,
    idOrName: string,
  ): Promise<
    | { ok: true; device: NetworkDevice }
    | { ok: false; result: AiToolHandlerResult }
  > {
    const key = idOrName.trim();
    if (!key) {
      return {
        ok: false,
        result: {
          ok: false,
          summary: 'deviceId requerido',
          data: { error: 'deviceId requerido' },
        },
      };
    }

    const devices =
      await this.tenantConnections.getNetworkDeviceRepository(schemaName);

    if (DEVICE_UUID_RE.test(key)) {
      const device = await devices.findOne({ where: { id: key } });
      if (!device) {
        return {
          ok: false,
          result: {
            ok: false,
            summary: 'Equipo no encontrado',
            data: { error: 'Equipo no encontrado', deviceId: key },
          },
        };
      }
      return { ok: true, device };
    }

    const exact = await devices
      .createQueryBuilder('d')
      .where('LOWER(d.name) = LOWER(:n)', { n: key })
      .getMany();
    if (exact.length === 1) return { ok: true, device: exact[0] };
    if (exact.length > 1) {
      return {
        ok: false,
        result: {
          ok: false,
          summary: `Varios equipos llamados «${key}»`,
          data: {
            error: 'Nombre ambiguo; usa el UUID de topo_list_routers',
            candidates: exact.map((d) => ({
              id: d.id,
              name: d.name,
              type: d.type,
            })),
          },
        },
      };
    }

    const fuzzy = await devices
      .createQueryBuilder('d')
      .where('d.name ILIKE :n', { n: `%${escapeIlike(key)}%` })
      .take(10)
      .getMany();
    if (fuzzy.length === 1) return { ok: true, device: fuzzy[0] };
    if (fuzzy.length > 1) {
      return {
        ok: false,
        result: {
          ok: false,
          summary: `Varios equipos coinciden con «${key}»`,
          data: {
            error: 'Nombre ambiguo; elige un UUID',
            candidates: fuzzy.map((d) => ({
              id: d.id,
              name: d.name,
              type: d.type,
            })),
          },
        },
      };
    }

    return {
      ok: false,
      result: {
        ok: false,
        summary: `Equipo no encontrado: ${key}`,
        data: {
          error: `No hay equipo con id/nombre «${key}». Usa topo_list_routers y el campo id (UUID).`,
          deviceId: key,
        },
      },
    };
  }

  has(slug: string) {
    return this.bySlug.has(slug);
  }

  async execute(
    slug: string,
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const def = this.bySlug.get(slug);
    if (!def) {
      return {
        ok: false,
        summary: `Tool desconocida: ${slug}`,
        data: { error: `Tool no registrada: ${slug}` },
      };
    }
    if (ctx.readOnly && def.mutates) {
      return {
        ok: false,
        summary: 'Bloqueada: desactiva S lectura',
        data: {
          error:
            'Esta acción modifica el sistema. Pedile al usuario que desactive «S lectura» en el asistente y vuelva a intentarlo.',
          code: 'READ_ONLY_BLOCKED',
          userHint:
            'Para modificar, desactivá «S lectura» en el asistente y volvé a pedirlo.',
        },
      };
    }
    try {
      return await def.execute(args ?? {}, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Tool ${slug} failed: ${message}`);
      return {
        ok: false,
        summary: message,
        data: { error: message },
      };
    }
  }

  private async maybeRecordRestore(
    ctx: AiToolExecContext,
    input: {
      toolSlug: string;
      title: string;
      summary?: string;
      beforeState?: Record<string, unknown> | null;
      afterState?: Record<string, unknown> | null;
      undoPayload?: Record<string, unknown> | null;
    },
  ) {
    if (!ctx.restorePoints || !ctx.sessionId || !ctx.tenantId) return;
    try {
      await this.restorePoints.record({
        tenantId: ctx.tenantId,
        sessionId: ctx.sessionId,
        toolSlug: input.toolSlug,
        title: input.title,
        summary: input.summary,
        beforeState: input.beforeState ?? null,
        afterState: input.afterState ?? null,
        undoPayload: input.undoPayload ?? null,
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo guardar restore point: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ─── CRM ─────────────────────────────────────────────────────────────

  private async uiOpenView(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const view = asString(args.view).toLowerCase();
    const title = asString(args.title) || undefined;
    const modeRaw = asString(args.mode).toLowerCase();
    const mode =
      modeRaw === 'summary' ? ('summary' as const) : ('full' as const);

    if (view === 'close') {
      return {
        ok: true,
        summary: 'Vista cerrada',
        data: { closed: true },
        ui: { kind: 'close' },
      };
    }

    if (view === 'client') {
      const clientId = requireUuid('clientId', args.clientId);
      const client = await this.crm.getClient(ctx.user, clientId);
      const label = clientLabel(client);
      const ui: AiUiView = {
        kind: 'client',
        clientId,
        title: title || label,
        mode,
      };
      return {
        ok: true,
        summary: `Abriendo ficha de ${label} (${mode})`,
        data: { view: ui },
        ui,
      };
    }

    if (view === 'service') {
      const serviceId = requireUuid('serviceId', args.serviceId);
      const repo = await this.tenantConnections.getClientServiceRepository(
        ctx.schemaName,
      );
      const row = await repo.findOne({ where: { id: serviceId } });
      if (!row) {
        return {
          ok: false,
          summary: 'Servicio no encontrado',
          data: { error: 'Servicio no encontrado', serviceId },
        };
      }
      const ui: AiUiView = {
        kind: 'service',
        serviceId,
        clientId: row.clientId,
        title: title || row.name || serviceId,
        mode,
      };
      return {
        ok: true,
        summary: `Abriendo servicio ${ui.title} (${mode})`,
        data: { view: ui },
        ui,
      };
    }

    if (view === 'onu') {
      const onuIdRaw = asString(args.onuId);
      const onuId = onuIdRaw
        ? requireUuid('onuId', onuIdRaw)
        : '';
      let oltId = asString(args.oltId);
      let onuIf = asString(args.onuIf);
      let sn: string | null = null;

      if (onuId || (!oltId && !onuIf)) {
        const listed = await this.onus.list(ctx.user);
        const found = listed.onus.find((o) =>
          onuId ? o.id === onuId : false,
        );
        if (!found && onuId) {
          return {
            ok: false,
            summary: 'ONU no encontrada',
            data: { error: 'ONU no encontrada', onuId },
          };
        }
        if (found) {
          oltId = found.oltId;
          onuIf = found.onuIf;
          sn = found.sn ?? null;
        }
      }

      if (!oltId || !onuIf) {
        throw new BadRequestException(
          'Indica onuId o el par oltId + onuIf',
        );
      }

      const ui: AiUiView = {
        kind: 'onu',
        onuId: onuId || undefined,
        oltId,
        onuIf,
        title: title || sn || onuIf,
        mode,
      };
      return {
        ok: true,
        summary: `Abriendo ONU ${ui.title} (${mode})`,
        data: { view: ui },
        ui,
      };
    }

    if (view === 'device') {
      const deviceId = asString(args.deviceId);
      if (!deviceId) throw new BadRequestException('deviceId requerido');
      const resolved = await this.resolveDevice(ctx.schemaName, deviceId);
      if (!resolved.ok) return resolved.result;
      const device = resolved.device;
      const ui: AiUiView = {
        kind: 'device',
        deviceId: device.id,
        title: title || device.name,
        mode,
      };
      return {
        ok: true,
        summary: `Abriendo equipo ${device.name} (${mode})`,
        data: { view: ui },
        ui,
      };
    }

    throw new BadRequestException(
      'view debe ser client, onu, service, device o close',
    );
  }

  private async crmSearchClients(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const qRaw = asString(args.q);
    const q = qRaw.toLowerCase();
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 40);
    const rows = await this.crm.listClients(ctx.user);
    // Sin q (o *, recientes, último…): devolver los más nuevos (listClients ya va DESC).
    const wantRecent =
      !q ||
      q === '*' ||
      q === 'recientes' ||
      q === 'reciente' ||
      q === 'recent' ||
      q === 'ultimo' ||
      q === 'último' ||
      q === 'nuevos' ||
      q === 'nuevo';
    const matched = (
      wantRecent
        ? rows
        : rows.filter((c) => {
            const hay = [
              c.firstName,
              c.lastName,
              c.companyName,
              c.phone,
              c.email,
              c.documentNumber,
              c.companyTaxId,
              c.city,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return hay.includes(q);
          })
    )
      .slice(0, limit)
      .map((c) => compactClient(c as unknown as Record<string, unknown>));
    return {
      ok: true,
      summary: wantRecent
        ? `${matched.length} cliente(s) más reciente(s)`
        : `${matched.length} cliente(s) para «${qRaw}»`,
      data: {
        q: wantRecent ? null : qRaw,
        recent: wantRecent,
        returned: matched.length,
        clients: matched,
      },
    };
  }

  private async crmGetClient(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const clientId = requireUuid('clientId', args.clientId);
    const client = await this.crm.getClient(ctx.user, clientId);
    const services = (client.services ?? []).map((s) =>
      compactService(s as unknown as Record<string, unknown>),
    );
    return {
      ok: true,
      summary: `${clientLabel(client)} · ${services.length} servicio(s)`,
      data: {
        client: compactClient(client as unknown as Record<string, unknown>),
        services,
      },
    };
  }

  private async crmListServices(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const clientId = requireUuid('clientId', args.clientId);
    const services = await this.crm.listClientServices(ctx.user, clientId);
    const compact = services.map((s) =>
      compactService(s as unknown as Record<string, unknown>),
    );
    return {
      ok: true,
      summary: `${compact.length} servicio(s)`,
      data: { clientId, services: compact },
    };
  }

  private async crmGetService(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const serviceId = requireUuid('serviceId', args.serviceId);
    const repo = await this.tenantConnections.getClientServiceRepository(
      ctx.schemaName,
    );
    const row = await repo.findOne({
      where: { id: serviceId },
      relations: { servicePlan: { speedProfile: true } },
    });
    if (!row) {
      return {
        ok: false,
        summary: 'Servicio no encontrado',
        data: { error: 'Servicio no encontrado', serviceId },
      };
    }
    const client = await this.crm.getClient(ctx.user, row.clientId);
    const service = (client.services ?? []).find((s) => s.id === serviceId);
    const compact = compactService(
      (service ?? row) as unknown as Record<string, unknown>,
    );
    let onu: ReturnType<typeof compactOnu> | null = null;
    if (compact.onuId) {
      const listed = await this.onus.list(ctx.user);
      const found = listed.onus.find((o) => o.id === compact.onuId);
      if (found) onu = compactOnu(found);
    }
    return {
      ok: true,
      summary: `${compact.name ?? serviceId} · ${compact.status}${
        onu?.sn ? ` · SN ${onu.sn}` : ''
      }`,
      data: {
        client: compactClient(client as unknown as Record<string, unknown>),
        service: compact,
        onu,
      },
    };
  }

  private async crmUpdateClient(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const clientId = requireUuid('clientId', args.clientId);
    const patch: Record<string, unknown> = {};
    for (const key of [
      'firstName',
      'lastName',
      'companyName',
      'phone',
      'email',
      'documentType',
      'documentNumber',
      'companyTaxId',
      'street',
      'city',
      'zipCode',
      'note',
      'zoneId',
    ] as const) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    if (typeof args.isActive === 'boolean') patch.isActive = args.isActive;
    if (typeof args.isLead === 'boolean') patch.isLead = args.isLead;
    if (typeof args.isCompany === 'boolean') patch.isCompany = args.isCompany;
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('Indica al menos un campo a actualizar');
    }
    const before = await this.crm.getClient(ctx.user, clientId);
    const updated = await this.crm.updateClient(
      ctx.user,
      clientId,
      patch as never,
    );
    await this.maybeRecordRestore(ctx, {
      toolSlug: 'crm_update_client',
      title: `Cliente ${clientLabel(updated)}`,
      summary: `Campos: ${Object.keys(patch).join(', ')}`,
      beforeState: {
        clientId,
        snapshot: compactClient(before as unknown as Record<string, unknown>),
      },
      afterState: {
        client: compactClient(updated as unknown as Record<string, unknown>),
      },
      undoPayload: { note: 'Reaplicar campos anteriores con crm_update_client', clientId },
    });
    return {
      ok: true,
      summary: `Cliente actualizado: ${clientLabel(updated)}`,
      data: {
        client: compactClient(updated as unknown as Record<string, unknown>),
        updatedFields: Object.keys(patch),
      },
    };
  }

  private async crmFindDuplicates(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const fieldRaw = asString(args.field).toLowerCase() || 'auto';
    const field = (
      ['auto', 'phone', 'document', 'email', 'name'].includes(fieldRaw)
        ? fieldRaw
        : 'auto'
    ) as 'auto' | 'phone' | 'document' | 'email' | 'name';
    const result = await this.crm.findDuplicateClients(ctx.user, {
      field,
      q: asString(args.q) || undefined,
      limit: Number(args.limit) || 40,
      includeInactive: args.includeInactive === true,
    });
    return {
      ok: true,
      summary: `${result.groupCount} grupo(s) duplicado(s)`,
      data: result,
    };
  }

  private async crmMergeClients(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const targetClientId = requireUuid('targetClientId', args.targetClientId);
    const sourceClientId = requireUuid('sourceClientId', args.sourceClientId);
    if (!targetClientId || !sourceClientId) {
      throw new BadRequestException(
        'targetClientId y sourceClientId requeridos',
      );
    }
    const result = await this.crm.mergeClients(ctx.user, {
      targetClientId,
      sourceClientId,
      fillEmptyFields: args.fillEmptyFields !== false,
      deleteSource: args.deleteSource === true,
    });
    await this.maybeRecordRestore(ctx, {
      toolSlug: 'crm_merge_clients',
      title: `Merge → ${result.target.name}`,
      summary: `Origen ${sourceClientId} → destino ${targetClientId}`,
      beforeState: { targetClientId, sourceClientId },
      afterState: result as unknown as Record<string, unknown>,
      undoPayload: {
        note: 'Undo manual: reabrir origen y reasignar servicios/facturas si hace falta',
        targetClientId,
        sourceClientId,
      },
    });
    return {
      ok: true,
      summary: `Unificado en ${result.target.name} (servicios ${result.moved.services}, facturas ${result.moved.invoices})`,
      data: result,
      ui: {
        kind: 'client',
        clientId: targetClientId,
        title: result.target.name,
        mode: 'full',
      },
    };
  }

  private async crmFindDuplicateServices(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const matchRaw = asString(args.match).toLowerCase();
    const match = matchRaw === 'onu' ? 'onu' : 'onu_and_plan';
    const result = await this.crm.findDuplicateServices(ctx.user, {
      match,
      clientId: asString(args.clientId) || undefined,
      includeEnded: args.includeEnded === true,
      limit: Number(args.limit) || 40,
    });
    return {
      ok: true,
      summary: `${result.groupCount} grupo(s) de servicios duplicados (${match})`,
      data: result,
    };
  }

  private async crmMergeServices(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const targetServiceId = requireUuid('targetServiceId', args.targetServiceId);
    const sourceServiceId = requireUuid('sourceServiceId', args.sourceServiceId);
    if (!targetServiceId || !sourceServiceId) {
      throw new BadRequestException(
        'targetServiceId y sourceServiceId requeridos',
      );
    }
    const result = await this.crm.mergeServices(ctx.user, {
      targetServiceId,
      sourceServiceId,
      requireSamePlan: args.requireSamePlan !== false,
    });
    await this.maybeRecordRestore(ctx, {
      toolSlug: 'crm_merge_services',
      title: `Merge servicio → ${result.target.name}`,
      summary: `Origen ${sourceServiceId} → destino ${targetServiceId}`,
      beforeState: { targetServiceId, sourceServiceId },
      afterState: result as unknown as Record<string, unknown>,
      undoPayload: {
        note: 'Undo manual: reabrir servicio origen y reasignar ONU/facturas si hace falta',
        targetServiceId,
        sourceServiceId,
      },
    });
    return {
      ok: true,
      summary: `Servicio unificado: quedó «${result.target.name}» (${result.target.status}); origen ended; facturas ${result.moved.invoices}`,
      data: result,
      ui: {
        kind: 'service',
        serviceId: targetServiceId,
        clientId: result.target.clientId,
        title: result.target.name,
        mode: 'full',
      },
    };
  }

  private async billingSearchInvoices(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const result = await this.billing.searchInvoices(ctx.user, {
      q: asString(args.q) || undefined,
      status: asString(args.status) || undefined,
      clientId: asString(args.clientId) || undefined,
      limit: Number(args.limit) || 40,
    });
    return {
      ok: true,
      summary: `${result.returned} factura(s)${
        result.debtTotal > 0 ? ` · deuda $${result.debtTotal}` : ''
      }`,
      data: result,
    };
  }

  private async billingListDebt(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const onlyOverdue = args.onlyOverdue === true;
    const result = await this.billing.searchInvoices(ctx.user, {
      status: onlyOverdue ? 'overdue' : 'open',
      clientId: asString(args.clientId) || undefined,
      limit: Number(args.limit) || 50,
    });
    return {
      ok: true,
      summary: onlyOverdue
        ? `${result.returned} vencida(s) · $${result.overdueTotal}`
        : `${result.returned} en deuda · $${result.debtTotal} (vencidas $${result.overdueTotal})`,
      data: {
        onlyOverdue,
        ...result,
      },
    };
  }

  private async billingGetInvoice(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const invoiceId = asString(args.invoiceId);
    if (!invoiceId) throw new BadRequestException('invoiceId requerido');
    const inv = await this.billing.getInvoiceCompact(ctx.user, invoiceId);
    return {
      ok: true,
      summary: `${inv.number} · ${inv.status} · $${inv.total}`,
      data: { invoice: inv },
    };
  }

  private async billingCompareInvoices(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const invoiceIdA = asString(args.invoiceIdA);
    const invoiceIdB = asString(args.invoiceIdB);
    if (!invoiceIdA || !invoiceIdB) {
      throw new BadRequestException('invoiceIdA e invoiceIdB requeridos');
    }
    const a = await this.billing.getInvoiceCompact(ctx.user, invoiceIdA);
    const b = await this.billing.getInvoiceCompact(ctx.user, invoiceIdB);
    const totalA = Number(a.total) || 0;
    const totalB = Number(b.total) || 0;
    return {
      ok: true,
      summary: `${a.number} ($${totalA}) vs ${b.number} ($${totalB}) · Δ $${(totalA - totalB).toFixed(2)}`,
      data: {
        a,
        b,
        diff: {
          total: Number((totalA - totalB).toFixed(2)),
          statusSame: a.status === b.status,
          clientSame: a.clientId === b.clientId,
          periodSame:
            a.periodStart === b.periodStart && a.periodEnd === b.periodEnd,
        },
      },
    };
  }

  // ─── Topology ────────────────────────────────────────────────────────

  private async topoListDevices(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
    type: 'router' | 'olt',
  ): Promise<AiToolHandlerResult> {
    const q = asString(args.q).toLowerCase();
    const graph = await this.topology.getGraph(ctx.user);
    let devices = (graph.devices as Array<Record<string, unknown>>).filter(
      (d) => d.type === type,
    );
    if (q) {
      devices = devices.filter((d) => {
        const hay = [d.name, d.mgmtHost, d.subtype]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    const compact = devices.map((d) => compactDevice(d));
    return {
      ok: true,
      summary: `${compact.length} ${type === 'router' ? 'router(s)' : 'OLT(s)'}`,
      data: { type, returned: compact.length, devices: compact },
    };
  }

  private async topoGetDevice(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const deviceId = asString(args.deviceId);
    if (!deviceId) throw new BadRequestException('deviceId requerido');
    const resolved = await this.resolveDevice(ctx.schemaName, deviceId);
    if (!resolved.ok) return resolved.result;
    const detail = (await this.topology.getDeviceDetail(
      ctx.user,
      resolved.device.id,
    )) as unknown as Record<string, unknown> & {
      ports?: Array<Record<string, unknown>>;
    };
    const device = compactDevice(detail);
    return {
      ok: true,
      summary: `${device.name ?? resolved.device.id} · ${device.type}/${device.subtype}`,
      data: {
        device,
        credentialsHint:
          'Usa asset_get_connection con este deviceId para host, usuario y contraseña.',
        ports: Array.isArray(detail.ports)
          ? detail.ports.slice(0, 40).map((p) => ({
              id: p.id,
              name: p.name,
              role: p.role ?? null,
            }))
          : [],
      },
    };
  }

  private async assetGetConnection(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const deviceId = asString(args.deviceId);
    const tunnelId = asString(args.tunnelId);
    if (!deviceId && !tunnelId) {
      throw new BadRequestException('Indica deviceId o tunnelId');
    }

    if (deviceId) {
      const resolved = await this.resolveDevice(ctx.schemaName, deviceId);
      if (!resolved.ok) return resolved.result;
      const device = resolved.device;
      const conn = deviceConnection(device);
      return {
        ok: !!(conn.mgmtHost && conn.mgmtUsername),
        summary: `${device.name} · ${conn.mgmtHost ?? 'sin host'}`,
        data: { kind: 'device', connection: conn },
      };
    }

    const tunnelRepo =
      await this.tenantConnections.getVpnTunnelRepository(ctx.schemaName);
    const tunnel = await tunnelRepo.findOne({ where: { id: tunnelId } });
    if (!tunnel) {
      return {
        ok: false,
        summary: 'Túnel no encontrado',
        data: { error: 'Túnel no encontrado', tunnelId },
      };
    }
    const clientRepo =
      await this.tenantConnections.getVpnTunnelClientRepository(
        ctx.schemaName,
      );
    const clients = await clientRepo.find({
      where: { tunnelId },
      order: { clientAddress: 'ASC' },
    });
    const conn = tunnelConnection(tunnel, clients);
    return {
      ok: true,
      summary: `${tunnel.name} · ${tunnel.clientAddress}`,
      data: { kind: 'vpn_tunnel', connection: conn },
    };
  }

  private async mikrotikRead(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const deviceIdRaw = asString(args.deviceId);
    if (!deviceIdRaw) throw new BadRequestException('deviceId requerido');
    const resolved = await this.resolveDevice(ctx.schemaName, deviceIdRaw);
    if (!resolved.ok) return resolved.result;
    const deviceId = resolved.device.id;
    const path = asString(args.path);
    const words = asWords(args.words);
    if (!path && !words.length) {
      throw new BadRequestException('Indica path o words');
    }
    if (path && !isMikrotikReadPath(path)) {
      throw new BadRequestException(
        'path debe ser lectura (print/monitor/ping/resource)',
      );
    }
    if (words.length && !isMikrotikReadWords(words)) {
      throw new BadRequestException(
        'words debe ser solo lectura (print/monitor/ping)',
      );
    }

    const result = await this.topology.runMikrotikCommand(ctx.user, deviceId, {
      path: path || undefined,
      words: words.length ? words : undefined,
    });
    const cmd = result as {
      ok?: boolean;
      error?: string;
      rows?: Record<string, string>[];
    };
    const compact = compactMikrotikRows(cmd.rows ?? []);
    return {
      ok: !!cmd.ok,
      summary: cmd.ok
        ? `${resolved.device.name}: ${compact.total} fila(s)${compact.truncated ? ' (truncado)' : ''}`
        : cmd.error || 'Error MikroTik',
      data: {
        deviceId,
        deviceName: resolved.device.name,
        path: path || null,
        words: words.length ? words : null,
        ok: cmd.ok ?? false,
        error: cmd.error ?? null,
        ...compact,
      },
    };
  }

  private async mikrotikApply(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const deviceIdRaw = asString(args.deviceId);
    const words = asWords(args.words);
    const note = asString(args.note);
    if (!deviceIdRaw) throw new BadRequestException('deviceId requerido');
    const resolved = await this.resolveDevice(ctx.schemaName, deviceIdRaw);
    if (!resolved.ok) return resolved.result;
    const deviceId = resolved.device.id;
    if (!words.length) throw new BadRequestException('words requerido');
    if (!isMikrotikWriteWordsAllowed(words)) {
      throw new BadRequestException(
        'Comando no permitido (solo set/add/enable/disable/comment; sin reboot/reset/remove)',
      );
    }

    const result = await this.topology.runMikrotikCommand(ctx.user, deviceId, {
      words,
    });
    const cmd = result as {
      ok?: boolean;
      error?: string;
      rows?: Record<string, string>[];
    };

    await this.maybeRecordRestore(ctx, {
      toolSlug: 'mikrotik_apply',
      title: `MikroTik ${resolved.device.name}`,
      summary: note || words.join(' ').slice(0, 120),
      beforeState: { pendingWords: words },
      afterState: {
        ok: cmd.ok,
        rows: cmd.rows,
        error: cmd.error,
      },
      undoPayload: {
        note: 'Undo manual: revertir con mikrotik_apply o RouterOS CLI',
        deviceId,
        appliedWords: words,
      },
    });

    return {
      ok: !!cmd.ok,
      summary: cmd.ok
        ? `Cambio aplicado en ${resolved.device.name}`
        : cmd.error || 'Error MikroTik',
      data: {
        deviceId,
        deviceName: resolved.device.name,
        words,
        ok: cmd.ok ?? false,
        error: cmd.error ?? null,
        rows: cmd.rows ?? [],
      },
    };
  }

  private async oltDiscoverOnusLive(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const oltId = asString(args.oltId);
    if (!oltId) throw new BadRequestException('oltId requerido');
    const preferSnmp = args.preferSnmp !== false;
    const limit = Math.min(Math.max(Number(args.limit) || 60, 1), 120);

    const discovered = await this.onus.discover(ctx.user, oltId, {
      preferSnmp,
      includeRunningConfig: false,
    });
    const onus = (discovered.onus as Array<Record<string, unknown>>) ?? [];
    const sliced = onus.slice(0, limit).map((o) => ({
      onuIf: o.onuIf ?? null,
      sn: o.sn ?? null,
      online: o.online ?? null,
      signalDbm: o.signalDbm ?? null,
      phaseState: o.phaseState ?? null,
      adminState: o.adminState ?? null,
      name: o.name ?? null,
      board: o.board ?? null,
      port: o.port ?? null,
    }));

    return {
      ok: true,
      summary: `${discovered.oltName}: ${discovered.total} ONU(s), ${discovered.online} online (${discovered.source})`,
      data: {
        oltId: discovered.oltId,
        oltName: discovered.oltName,
        probedAt: discovered.probedAt,
        source: discovered.source,
        total: discovered.total,
        online: discovered.online,
        importedCount: discovered.importedCount,
        ports: discovered.ports,
        returned: sliced.length,
        truncated: onus.length > sliced.length,
        onus: sliced,
        via: 'SNMP/CLI por mgmtHost de la OLT (VPN del tenant si aplica)',
      },
    };
  }

  private async topoTestConnection(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const deviceIdRaw = asString(args.deviceId);
    if (!deviceIdRaw) throw new BadRequestException('deviceId requerido');
    const resolved = await this.resolveDevice(ctx.schemaName, deviceIdRaw);
    if (!resolved.ok) return resolved.result;
    const deviceId = resolved.device.id;
    const detail = (await this.topology.testConnection(
      ctx.user,
      deviceId,
    )) as unknown as Record<string, unknown>;
    const device = compactDevice(detail);
    return {
      ok: device.connectionStatus === 'connected',
      summary: `${device.name ?? deviceId} · ${device.connectionStatus}${
        device.lastError ? ` · ${device.lastError}` : ''
      }`,
      data: {
        device,
        via:
          'Probe en vivo por mgmtHost del equipo (VPN del tenant si está en modo secure/LAN privada)',
      },
    };
  }

  private async vpnListTunnels(
    _args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const listed = await this.vpn.list(ctx.user);
    const tunnels = (
      listed.tunnels as Array<Record<string, unknown>>
    ).map((t) => ({
      id: t.id,
      name: t.name ?? null,
      protocol: t.protocol ?? null,
      status: t.status ?? null,
      clientAddress: t.clientAddress ?? null,
      serverAddress: t.serverAddress ?? null,
      hasPassword: !!t.hasPassword,
      tunnelRoutes: t.tunnelRoutes ?? null,
    }));
    return {
      ok: true,
      summary: `${tunnels.length} túnel(es) VPN`,
      data: { tunnels },
    };
  }

  private async vpnProbeTunnel(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const tunnelId = asString(args.tunnelId);
    if (!tunnelId) throw new BadRequestException('tunnelId requerido');
    const result = await this.vpn.probeTunnelReachability(ctx.user, tunnelId);
    return {
      ok: !!result.ok,
      summary: result.summary || (result.ok ? 'VPN OK' : 'VPN con fallos'),
      data: {
        tunnelId,
        status: result.status,
        reachable: result.reachable,
        peerSeen: result.peerSeen,
        routeOk: result.routeOk,
        clientAddress: result.clientAddress,
        steps: (result.steps ?? []).map((s) => ({
          id: s.id,
          ok: s.ok,
          label: s.label,
          detail: s.detail,
        })),
      },
    };
  }

  private async onuLiveStatus(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const onuId = asString(args.onuId);
    if (!onuId) throw new BadRequestException('onuId requerido');
    const listed = await this.onus.list(ctx.user);
    const onu = listed.onus.find((o) => o.id === onuId);
    if (!onu) {
      return {
        ok: false,
        summary: 'ONU no encontrada',
        data: { error: 'ONU no encontrada', onuId },
      };
    }
    const live = await this.onus.statusReport(ctx.user, onu.oltId, onu.onuIf);
    const report = live.report as unknown as Record<string, unknown> | null;
    return {
      ok: true,
      summary: `Live ${onu.sn ?? onu.onuIf} · OLT ${live.oltName}`,
      data: {
        onu: compactOnu(onu),
        live: {
          oltId: live.oltId,
          oltName: live.oltName,
          onuIf: live.onuIf,
          probedAt: live.probedAt,
          report: report
            ? {
                phaseState: report.phaseState ?? report.phase ?? null,
                adminState: report.adminState ?? null,
                rxPower: report.rxPower ?? report.rx ?? null,
                txPower: report.txPower ?? report.tx ?? null,
                distance: report.distance ?? null,
                online: report.online ?? null,
                raw:
                  typeof live.report === 'string'
                    ? live.report.slice(0, 1200)
                    : undefined,
              }
            : typeof live.report === 'string'
              ? { text: live.report.slice(0, 1200) }
              : null,
          swInfo: live.swInfo
            ? {
                model: live.swInfo.model ?? null,
                version: live.swInfo.version ?? null,
                sn: live.swInfo.sn ?? null,
              }
            : null,
        },
        via: 'Consulta CLI a la OLT por mgmtHost (VPN del tenant si aplica)',
      },
    };
  }

  // ─── ONU ─────────────────────────────────────────────────────────────

  private async listConnected(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const listed = await this.onus.list(ctx.user);
    const statusFilter = asString(args.verifyStatus).toLowerCase();
    const onlineOnly = args.onlineOnly === true;
    const limit = Math.min(Math.max(Number(args.limit) || 40, 1), 80);

    let items = listed.onus.map((o) => compactOnu(o));
    if (statusFilter) {
      items = items.filter(
        (o) => (o.verifyStatus ?? '').toLowerCase() === statusFilter,
      );
    }
    if (onlineOnly) items = items.filter((o) => o.online);

    const byStatus = {
      ok: listed.onus.filter((o) => o.verifyStatus === 'ok').length,
      fail: listed.onus.filter((o) => o.verifyStatus === 'fail').length,
      test: listed.onus.filter((o) => o.verifyStatus === 'test').length,
      check: listed.onus.filter((o) => o.verifyStatus === 'check').length,
      idle: listed.onus.filter(
        (o) => !o.verifyStatus || o.verifyStatus === 'idle',
      ).length,
    };

    const sliced = items.slice(0, limit);
    return {
      ok: true,
      summary: `${listed.total} ONUs · ${listed.online} online · fail=${byStatus.fail}`,
      data: {
        total: listed.total,
        online: listed.online,
        byStatus,
        returned: sliced.length,
        truncated: items.length > sliced.length,
        onus: sliced,
        message: listed.message,
      },
    };
  }

  private async onuListFailed(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const kindRaw = asString(args.kind).toLowerCase() || 'all';
    const kind = ['verify_fail', 'offline', 'suspended', 'all'].includes(
      kindRaw,
    )
      ? kindRaw
      : 'all';
    const oltId = asString(args.oltId);
    const limit = Math.min(Math.max(Number(args.limit) || 40, 1), 100);
    const listed = await this.onus.list(ctx.user);

    let onus = listed.onus;
    if (oltId) onus = onus.filter((o) => o.oltId === oltId);

    const isProblem = (o: (typeof onus)[number]) => {
      const vs = (o.verifyStatus ?? '').toLowerCase();
      const status = String(o.status ?? '').toLowerCase();
      const suspended = status === 'disabled';
      if (kind === 'verify_fail') return vs === 'fail' || vs === 'check';
      if (kind === 'offline') return !o.online;
      if (kind === 'suspended') return suspended;
      return vs === 'fail' || vs === 'check' || !o.online || suspended;
    };

    const matched = onus.filter(isProblem);
    const sliced = matched.slice(0, limit).map((o) => {
      const status = String(o.status ?? '').toLowerCase();
      return {
        ...compactOnu(o),
        reasons: [
          (o.verifyStatus === 'fail' || o.verifyStatus === 'check') &&
            `verify=${o.verifyStatus}`,
          !o.online && 'offline',
          status === 'disabled' && 'disabled',
        ].filter(Boolean),
      };
    });

    return {
      ok: true,
      summary: `${matched.length} ONU(s) con problemas (${kind})`,
      data: {
        kind,
        oltId: oltId || null,
        matched: matched.length,
        returned: sliced.length,
        truncated: matched.length > sliced.length,
        counts: {
          verifyFail: onus.filter((o) => o.verifyStatus === 'fail').length,
          verifyCheck: onus.filter((o) => o.verifyStatus === 'check').length,
          offline: onus.filter((o) => !o.online).length,
          suspended: onus.filter(
            (o) => String(o.status ?? '').toLowerCase() === 'disabled',
          ).length,
        },
        onus: sliced,
      },
    };
  }

  private async lookup(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const sn = asString(args.sn).toUpperCase();
    const onuId = asString(args.onuId);
    const serviceId = asString(args.serviceId);
    const clientId = asString(args.clientId);

    if (!sn && !onuId && !serviceId && !clientId) {
      throw new BadRequestException(
        'Indica sn, onuId, serviceId o clientId',
      );
    }

    // Por servicio
    if (serviceId && !onuId && !sn) {
      const svc = await this.crmGetService({ serviceId }, ctx);
      return {
        ok: svc.ok,
        summary: svc.summary,
        data: svc.data,
      };
    }

    // Por cliente: todas las ONUs de sus servicios
    if (clientId && !onuId && !sn && !serviceId) {
      const services = await this.crm.listClientServices(ctx.user, clientId);
      const listed = await this.onus.list(ctx.user);
      const byId = new Map(listed.onus.map((o) => [o.id, o]));
      const linked = services
        .filter((s) => !!s.onuId)
        .map((s) => {
          const onu = s.onuId ? byId.get(s.onuId) : undefined;
          return {
            service: compactService(s as unknown as Record<string, unknown>),
            onu: onu ? compactOnu(onu) : null,
          };
        });
      return {
        ok: true,
        summary: `${linked.length} ONU(s) enlazada(s) al cliente`,
        data: { clientId, links: linked },
      };
    }

    const listed = await this.onus.list(ctx.user);
    const found = listed.onus.find((o) =>
      onuId
        ? o.id === onuId
        : (o.sn ?? '').toUpperCase() === sn,
    );
    if (!found) {
      return {
        ok: false,
        summary: 'ONU no encontrada',
        data: { error: 'ONU no encontrada en este tenant', sn, onuId },
      };
    }
    const progress = await this.verify.getProgress(ctx.schemaName, found.id);
    return {
      ok: true,
      summary: `${found.sn ?? found.id} · verify=${found.verifyStatus}`,
      data: {
        onu: compactOnu(found),
        verify: {
          verifyStatus: progress.verifyStatus,
          failureSummary: progress.failureSummary,
          checks: progress.checks,
          healed: progress.healed,
          verifyCheckedAt: progress.verifyCheckedAt,
        },
      },
    };
  }

  private async verifyStatus(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const onuId = asString(args.onuId);
    if (!onuId) throw new BadRequestException('onuId requerido');
    const progress = await this.verify.getProgress(ctx.schemaName, onuId);
    const failBits = Object.entries(progress.checks)
      .filter(([, c]) => c && c.ok === false)
      .map(([k, c]) => `${k}: ${c?.message ?? 'fail'}`);
    return {
      ok: progress.verifyStatus === 'ok' || progress.verifyStatus === 'check',
      summary:
        progress.verifyStatus === 'ok'
          ? `${progress.sn ?? onuId} OK`
          : `${progress.sn ?? onuId} ${progress.verifyStatus}${
              progress.failureSummary ? ` · ${progress.failureSummary}` : ''
            }`,
      data: { ...progress, failedChecks: failBits },
    };
  }

  private async verifyRun(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const onuId = asString(args.onuId);
    if (!onuId) throw new BadRequestException('onuId requerido');
    const before = await this.verify.getProgress(ctx.schemaName, onuId);
    const onu = await this.verify.runManual(ctx.schemaName, onuId);
    const progress = await this.verify.getProgress(ctx.schemaName, onuId);
    await this.maybeRecordRestore(ctx, {
      toolSlug: 'onu_verify_run',
      title: `Verificación ONU ${onu.sn ?? onuId}`,
      summary: `Estado ${before.verifyStatus} → ${onu.verifyStatus}`,
      beforeState: {
        verifyStatus: before.verifyStatus,
        checks: before.checks,
      },
      afterState: {
        verifyStatus: onu.verifyStatus,
        checks: progress.checks,
      },
      undoPayload: {
        note: 'La verificación no tiene undo automático; re-ejecutar o corregir manualmente si hace falta.',
        onuId,
      },
    });
    return {
      ok: onu.verifyStatus === 'ok',
      summary: `Verificación ${onu.verifyStatus}${
        progress.failureSummary ? ` · ${progress.failureSummary}` : ''
      }`,
      data: {
        onuId: onu.id,
        sn: onu.sn,
        verifyStatus: onu.verifyStatus,
        verifyCheckedAt: onu.verifyCheckedAt?.toISOString() ?? null,
        failureSummary: progress.failureSummary,
        checks: progress.checks,
        healed: progress.healed,
      },
    };
  }

  private async onuRefresh(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const onuId = asString(args.onuId);
    if (!onuId) throw new BadRequestException('onuId requerido');
    const listed = await this.onus.list(ctx.user);
    const before = listed.onus.find((o) => o.id === onuId);
    if (!before) {
      return {
        ok: false,
        summary: 'ONU no encontrada',
        data: { error: 'ONU no encontrada', onuId },
      };
    }
    const result = await this.onus.refresh(ctx.user, onuId);
    const afterOnu =
      (result as { onu?: Parameters<typeof compactOnu>[0] }).onu ?? null;
    await this.maybeRecordRestore(ctx, {
      toolSlug: 'onu_refresh',
      title: `Refresh ONU ${before.sn ?? onuId}`,
      summary: 'Relectura desde OLT',
      beforeState: compactOnu(before) as unknown as Record<string, unknown>,
      afterState: afterOnu
        ? (compactOnu(afterOnu) as unknown as Record<string, unknown>)
        : null,
      undoPayload: { note: 'Refresh no requiere undo', onuId },
    });
    return {
      ok: true,
      summary: `Refresh OK · ${before.sn ?? onuId}`,
      data: {
        onu: afterOnu ? compactOnu(afterOnu) : compactOnu(before),
      },
    };
  }

  private async onuReboot(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const onuId = asString(args.onuId);
    if (!onuId) throw new BadRequestException('onuId requerido');
    const listed = await this.onus.list(ctx.user);
    const onu = listed.onus.find((o) => o.id === onuId);
    if (!onu) {
      return {
        ok: false,
        summary: 'ONU no encontrada',
        data: { error: 'ONU no encontrada', onuId },
      };
    }
    await this.onus.reboot(ctx.user, onu.oltId, onu.onuIf);
    await this.maybeRecordRestore(ctx, {
      toolSlug: 'onu_reboot',
      title: `Reboot ONU ${onu.sn ?? onuId}`,
      summary: 'Reinicio enviado a OLT',
      beforeState: compactOnu(onu) as unknown as Record<string, unknown>,
      afterState: { rebooted: true },
      undoPayload: {
        note: 'No se puede deshacer un reboot; la ONU volverá sola.',
        onuId,
      },
    });
    return {
      ok: true,
      summary: `Reboot enviado · ${onu.sn ?? onu.onuIf}`,
      data: { onu: compactOnu(onu), rebooted: true },
    };
  }

  private async crmSetServiceStatus(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const serviceId = asString(args.serviceId);
    const status = asString(args.status).toLowerCase();
    if (!serviceId) throw new BadRequestException('serviceId requerido');
    if (status !== 'active' && status !== 'suspended') {
      throw new BadRequestException('status debe ser active o suspended');
    }
    const before = await this.crmGetService({ serviceId }, ctx);
    const saved = await this.crm.setServiceStatus(
      ctx.user,
      serviceId,
      status as 'active' | 'suspended',
    );
    await this.maybeRecordRestore(ctx, {
      toolSlug: 'crm_set_service_status',
      title: `Servicio ${serviceId} → ${status}`,
      summary: `Estado anterior: ${(before.data as { service?: { status?: string } })?.service?.status ?? '?'}`,
      beforeState: (before.data as Record<string, unknown>) ?? null,
      afterState: {
        serviceId,
        status: saved.status,
      },
      undoPayload: {
        tool: 'crm_set_service_status',
        arguments: {
          serviceId,
          status:
            (before.data as { service?: { status?: string } })?.service
              ?.status === 'suspended'
              ? 'suspended'
              : 'active',
        },
      },
    });
    return {
      ok: true,
      summary: `Servicio → ${saved.status}`,
      data: {
        serviceId: saved.id,
        status: saved.status,
        onuId: saved.onuId,
      },
    };
  }

  private async crmReconcileOlt(
    args: Record<string, unknown>,
    ctx: AiToolExecContext,
  ): Promise<AiToolHandlerResult> {
    const serviceId = asString(args.serviceId);
    if (!serviceId) throw new BadRequestException('serviceId requerido');
    const before = await this.crmGetService({ serviceId }, ctx);
    const result = await this.crm.reconcileOlt(ctx.user, serviceId, {
      removeOnu: false,
    });
    await this.maybeRecordRestore(ctx, {
      toolSlug: 'crm_reconcile_olt',
      title: `Reconciliar OLT servicio ${serviceId}`,
      summary: 'Reaplicación de estado CRM en red',
      beforeState: (before.data as Record<string, unknown>) ?? null,
      afterState: result as unknown as Record<string, unknown>,
      undoPayload: {
        note: 'Re-ejecutar reconcile o ajustar estado CRM si hace falta',
        serviceId,
      },
    });
    return {
      ok: true,
      summary: 'Reconciliación OLT OK',
      data: result,
    };
  }
}

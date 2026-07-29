import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import type { Onu } from './entities/onu.entity';
import { OnuConnectedService } from './onu-connected.service';
import { suggestClientNameFromOlt } from './onu-migration-name.util';

export type MigrationCandidate = {
  onuIf: string;
  ponType: string;
  board: string;
  port: string;
  onuId: string;
  sn: string | null;
  onuType: string | null;
  name: string | null;
  description: string | null;
  status: string;
  phaseState: string;
  adminState: string;
  online: boolean;
  signalDbm: number | null;
  mode: string | null;
  vlan: number | null;
  vlans: number[];
  inDb: boolean;
  onuDbId: string | null;
  suggestedClientName: string;
  suggestedFirstName: string;
  suggestedLastName: string;
  suggestedServiceName: string;
  nameSource: 'name' | 'description' | 'empty';
  nameConfidence: 'high' | 'medium' | 'low';
};

@Injectable()
export class OnuMigrationService {
  private readonly logger = new Logger(OnuMigrationService.name);

  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly onus: OnuConnectedService,
  ) {}

  private requireSchema(user: AuthUser) {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema missing from session');
    }
    return user.schemaName;
  }

  /**
   * List ONUs without a linked client/service.
   * Default: inventory from DB (fast). Optional live OLT merge with fromOlt.
   */
  async scan(user: AuthUser, oltId: string, opts: { fromOlt?: boolean } = {}) {
    const schema = this.requireSchema(user);
    if (!oltId?.trim()) {
      throw new BadRequestException('oltId requerido');
    }

    const deviceRepo =
      await this.tenantConnections.getNetworkDeviceRepository(schema);
    const olt = await deviceRepo.findOne({
      where: { id: oltId, type: 'olt' },
    });
    if (!olt) throw new BadRequestException('OLT no encontrada');

    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const serviceRepo =
      await this.tenantConnections.getClientServiceRepository(schema);

    const linked = await serviceRepo.find({
      where: { onuId: Not(IsNull()) },
      select: ['onuId'],
    });
    const linkedIds = new Set(
      linked.map((s) => s.onuId).filter((id): id is string => !!id),
    );

    const dbRows = await onuRepo.find({ where: { oltId } });
    const byIf = new Map(dbRows.map((r) => [r.onuIf.toLowerCase(), r]));
    const bySn = new Map(
      dbRows
        .filter((r) => r.sn?.trim())
        .map((r) => [r.sn!.trim().toUpperCase(), r]),
    );

    const candidatesByIf = new Map<string, MigrationCandidate>();
    const vlanSet = new Set<number>();

    const addCandidate = (
      o: {
        onuIf: string;
        ponType: string;
        board: string;
        port: string;
        onuId: string;
        sn: string | null;
        onuType: string | null;
        name: string | null;
        description: string | null;
        status: string;
        phaseState: string;
        adminState: string;
        online: boolean;
        signalDbm: number | null;
        mode: string | null;
        vlan: number | null;
        vlans: number[];
      },
      db?: Onu | null,
    ) => {
      if (db && linkedIds.has(db.id)) return;
      const key = o.onuIf.toLowerCase();
      if (candidatesByIf.has(key)) return;

      const hint = suggestClientNameFromOlt({
        name: o.name,
        description: o.description,
      });
      const vlans = Array.isArray(o.vlans)
        ? o.vlans.filter((v): v is number => Number.isFinite(v))
        : [];
      for (const v of vlans) vlanSet.add(v);
      if (o.vlan != null && Number.isFinite(o.vlan)) vlanSet.add(o.vlan);

      candidatesByIf.set(key, {
        onuIf: o.onuIf,
        ponType: o.ponType,
        board: o.board,
        port: o.port,
        onuId: o.onuId,
        sn: o.sn ?? null,
        onuType: o.onuType ?? null,
        name: o.name ?? null,
        description: o.description ?? null,
        status: o.status,
        phaseState: o.phaseState,
        adminState: o.adminState,
        online: !!o.online,
        signalDbm: o.signalDbm ?? null,
        mode: o.mode ?? null,
        vlan: o.vlan ?? null,
        vlans,
        inDb: !!db,
        onuDbId: db?.id ?? null,
        suggestedClientName: hint.suggestedName,
        suggestedFirstName: hint.suggestedFirstName,
        suggestedLastName: hint.suggestedLastName,
        suggestedServiceName: hint.suggestedServiceName,
        nameSource: hint.source,
        nameConfidence: hint.confidence,
      });
    };

    // Fast path: DB inventory without client/service.
    for (const row of dbRows) {
      if (linkedIds.has(row.id)) continue;
      addCandidate(
        {
          onuIf: row.onuIf,
          ponType: row.ponType,
          board: row.board,
          port: row.port,
          onuId: row.onuId,
          sn: row.sn,
          onuType: row.onuType,
          name: row.name,
          description: row.description || null,
          status: row.status,
          phaseState: row.phaseState,
          adminState: row.adminState,
          online: row.online,
          signalDbm: row.signalDbm,
          mode: row.mode,
          vlan: row.vlan,
          vlans: Array.isArray(row.vlans) ? row.vlans : [],
        },
        row,
      );
    }

    let totalLive = dbRows.length;
    let liveWarning: string | null = null;
    let source: 'db' | 'olt' | 'mixed' = 'db';
    const probedAt = new Date().toISOString();

    if (opts.fromOlt) {
      try {
        // Fast live sync: skip running-config dump (names/VLANs come from DB).
        const discovered = await this.onus.discover(user, oltId, {
          includeRunningConfig: false,
        });
        totalLive = discovered.total;
        source = candidatesByIf.size > 0 ? 'mixed' : 'olt';
        for (const o of discovered.onus) {
          const db =
            byIf.get(o.onuIf.toLowerCase()) ??
            (o.sn?.trim() ? bySn.get(o.sn.trim().toUpperCase()) : undefined);
          const key = o.onuIf.toLowerCase();
          if (db && linkedIds.has(db.id)) {
            candidatesByIf.delete(key);
            continue;
          }
          // Prefer live status; keep name/desc/vlans from inventory when present.
          candidatesByIf.delete(key);
          addCandidate(
            {
              onuIf: o.onuIf,
              ponType: o.ponType ?? db?.ponType ?? 'gpon',
              board: o.board ?? db?.board ?? '',
              port: o.port ?? db?.port ?? '',
              onuId: o.onuId ?? db?.onuId ?? '',
              sn: o.sn ?? db?.sn ?? null,
              onuType: o.onuType ?? db?.onuType ?? null,
              name: db?.name || o.name || null,
              description: (db?.description || o.description || null) ?? null,
              status: o.status || db?.status || 'other',
              phaseState: o.phaseState || db?.phaseState || '',
              adminState: o.adminState || db?.adminState || '',
              online: !!o.online,
              signalDbm: o.signalDbm ?? db?.signalDbm ?? null,
              mode: o.mode ?? db?.mode ?? null,
              vlan: o.vlan ?? db?.vlan ?? null,
              vlans:
                Array.isArray(o.vlans) && o.vlans.length
                  ? o.vlans
                  : Array.isArray(db?.vlans)
                    ? db.vlans
                    : [],
            },
            db ?? null,
          );
        }
      } catch (err) {
        liveWarning =
          err instanceof Error
            ? err.message
            : 'No se pudo sincronizar la OLT; se usan datos en base.';
        this.logger.warn(
          `migration scan live failed olt=${oltId}: ${liveWarning}`,
        );
      }
    }

    const candidates = [...candidatesByIf.values()].sort((a, b) =>
      a.onuIf.localeCompare(b.onuIf, undefined, { numeric: true }),
    );
    const sourceVlans = [...vlanSet].sort((a, b) => a - b);

    this.logger.log(
      `migration scan olt=${oltId} source=${source}: ${candidates.length} candidates / live=${totalLive}`,
    );

    return {
      oltId: olt.id,
      oltName: olt.name,
      probedAt,
      totalLive,
      totalCandidates: candidates.length,
      sourceVlans,
      candidates,
      source,
      liveWarning,
    };
  }

  async sourceVlans(user: AuthUser, oltId: string) {
    const scan = await this.scan(user, oltId, { fromOlt: false });
    return {
      oltId: scan.oltId,
      oltName: scan.oltName,
      sourceVlans: scan.sourceVlans,
      totalCandidates: scan.totalCandidates,
    };
  }
}

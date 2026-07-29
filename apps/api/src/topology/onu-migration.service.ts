import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
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
   * Discover OLT inventory and return ONUs without a linked client service.
   */
  async scan(user: AuthUser, oltId: string) {
    const schema = this.requireSchema(user);
    if (!oltId?.trim()) {
      throw new BadRequestException('oltId requerido');
    }

    const discovered = await this.onus.discover(user, oltId);
    const onuRepo = await this.tenantConnections.getOnuRepository(schema);
    const serviceRepo =
      await this.tenantConnections.getClientServiceRepository(schema);

    const dbRows = await onuRepo.find({ where: { oltId } });
    const byIf = new Map(dbRows.map((r) => [r.onuIf.toLowerCase(), r]));
    const bySn = new Map(
      dbRows
        .filter((r) => r.sn?.trim())
        .map((r) => [r.sn!.trim().toUpperCase(), r]),
    );

    const linked = await serviceRepo.find({
      where: { onuId: Not(IsNull()) },
      select: ['onuId'],
    });
    const linkedIds = new Set(
      linked.map((s) => s.onuId).filter((id): id is string => !!id),
    );

    const candidates: MigrationCandidate[] = [];
    const vlanSet = new Set<number>();

    for (const o of discovered.onus) {
      const db =
        byIf.get(o.onuIf.toLowerCase()) ??
        (o.sn?.trim() ? bySn.get(o.sn.trim().toUpperCase()) : undefined);
      if (db && linkedIds.has(db.id)) continue;

      const hint = suggestClientNameFromOlt({
        name: o.name,
        description: o.description,
      });

      const vlans = Array.isArray(o.vlans)
        ? o.vlans.filter((v): v is number => Number.isFinite(v))
        : [];
      for (const v of vlans) vlanSet.add(v);
      if (o.vlan != null && Number.isFinite(o.vlan)) vlanSet.add(o.vlan);

      candidates.push({
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
    }

    const sourceVlans = [...vlanSet].sort((a, b) => a - b);

    this.logger.log(
      `migration scan olt=${oltId}: ${candidates.length} candidates / ${discovered.total} live`,
    );

    return {
      oltId: discovered.oltId,
      oltName: discovered.oltName,
      probedAt: discovered.probedAt,
      totalLive: discovered.total,
      totalCandidates: candidates.length,
      sourceVlans,
      candidates,
    };
  }

  async sourceVlans(user: AuthUser, oltId: string) {
    const scan = await this.scan(user, oltId);
    return {
      oltId: scan.oltId,
      oltName: scan.oltName,
      sourceVlans: scan.sourceVlans,
      totalCandidates: scan.totalCandidates,
    };
  }
}

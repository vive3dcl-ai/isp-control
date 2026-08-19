import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../../auth/auth.types';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import type { DeviceAuditActorKind } from '../shared/entities/device-audit-event.entity';
import { clipAuditDetail, errorMessage } from './network-audit.util';

export type NetworkAuditInput = {
  action: string;
  ok: boolean;
  durationMs?: number;
  sn?: string | null;
  onuId?: string | null;
  oltId?: string | null;
  onuIf?: string | null;
  detail?: Record<string, unknown>;
  actorId?: string | null;
  actorEmail?: string | null;
  actorKind?: DeviceAuditActorKind;
};

@Injectable()
export class NetworkAuditService {
  private readonly logger = new Logger(NetworkAuditService.name);

  constructor(private readonly tenants: TenantConnectionService) {}

  actorFromUser(user: AuthUser | null | undefined): {
    actorId: string | null;
    actorEmail: string | null;
    actorKind: DeviceAuditActorKind;
  } {
    if (!user) {
      return { actorId: null, actorEmail: null, actorKind: 'system' };
    }
    return {
      actorId: user.sub ?? null,
      actorEmail: user.email ?? null,
      actorKind: 'user',
    };
  }

  async record(schema: string, input: NetworkAuditInput): Promise<void> {
    try {
      const repo = await this.tenants.getDeviceAuditEventRepository(schema);
      await repo.save(
        repo.create({
          action: input.action,
          ok: input.ok,
          durationMs: input.durationMs ?? 0,
          sn: input.sn?.trim().toUpperCase() || null,
          onuId: input.onuId ?? null,
          oltId: input.oltId ?? null,
          onuIf: input.onuIf ?? null,
          detail: clipAuditDetail(input.detail),
          actorId: input.actorId ?? null,
          actorEmail: input.actorEmail ?? null,
          actorKind: input.actorKind ?? 'system',
        }),
      );
    } catch (err) {
      this.logger.warn(
        `audit ${input.action}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async run<T>(
    schema: string,
    meta: Omit<NetworkAuditInput, 'ok' | 'durationMs'>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const t0 = Date.now();
    try {
      const result = await fn();
      await this.record(schema, {
        ...meta,
        ok: true,
        durationMs: Date.now() - t0,
      });
      return result;
    } catch (err) {
      await this.record(schema, {
        ...meta,
        ok: false,
        durationMs: Date.now() - t0,
        detail: { ...(meta.detail ?? {}), error: errorMessage(err) },
      });
      throw err;
    }
  }

  async listForOnu(
    schema: string,
    onuId: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      occurredAt: string;
      actorEmail: string | null;
      actorKind: string;
      action: string;
      ok: boolean;
      durationMs: number;
      detail: Record<string, unknown>;
    }>
  > {
    const repo = await this.tenants.getDeviceAuditEventRepository(schema);
    const take = Math.min(100, Math.max(1, limit));
    const rows = await repo.find({
      where: { onuId },
      order: { occurredAt: 'DESC' },
      take,
    });
    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt.toISOString(),
      actorEmail: r.actorEmail,
      actorKind: r.actorKind,
      action: r.action,
      ok: r.ok,
      durationMs: r.durationMs,
      detail: r.detail ?? {},
    }));
  }
}

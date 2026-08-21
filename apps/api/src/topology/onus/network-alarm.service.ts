import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import { SupportService } from '../../support/support.service';
import { Tenant } from '../../tenants/entities/tenant.entity';
import {
  GenieAcsNbiClient,
  deviceIdMatchesSerial,
  resolveNbiBaseUrl,
} from '../shared/genieacs-nbi.client';
import type { Onu } from '../shared/entities/onu.entity';
import type { NetworkAlarm } from '../shared/entities/network-alarm.entity';
import {
  RX_CHANGE_WINDOW_MS,
  RX_POOR_DBM,
  alarmBody,
  alarmTitle,
  classifyAccessAlarms,
  type AccessAlarmKind,
} from './network-alarm.util';

@Injectable()
export class NetworkAlarmService {
  private readonly logger = new Logger(NetworkAlarmService.name);

  constructor(
    private readonly tenants: TenantConnectionService,
    private readonly support: SupportService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async listOpen(schema: string): Promise<NetworkAlarm[]> {
    const repo = await this.tenants.getNetworkAlarmRepository(schema);
    return repo.find({
      where: { status: 'open' },
      order: { openedAt: 'DESC' },
      take: 50,
    });
  }

  async syncSchema(schema: string): Promise<void> {
    const onuRepo = await this.tenants.getOnuRepository(schema);
    const rows = await onuRepo.find({
      select: [
        'id',
        'sn',
        'oltId',
        'online',
        'phaseState',
        'status',
        'adminState',
        'signalDbm',
        'mgmtIp',
        'tr069ProfileId',
      ],
    });
    if (!rows.length) return;

    const informBySn = await this.loadAcsInformMap(rows);
    const rxByOnu = await this.loadRecentSignalByOnu(schema, rows);
    for (const onu of rows) {
      try {
        await this.syncOnu(schema, onu, informBySn, rxByOnu);
      } catch (err) {
        this.logger.debug(
          `alarm ${onu.sn ?? onu.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private async loadAcsInformMap(
    onus: Onu[],
  ): Promise<Map<string, { at: Date | null; inAcs: boolean }>> {
    const map = new Map<string, { at: Date | null; inAcs: boolean }>();
    const want = onus.filter((o) => o.online && o.sn?.trim());
    if (!want.length) return map;
    try {
      const nbi = new GenieAcsNbiClient(resolveNbiBaseUrl());
      const devices = await nbi.findDevices(
        {},
        { projection: '_id,_lastInform' },
      );
      for (const onu of want) {
        const sn = onu.sn!.trim();
        const hit = devices.find((d) =>
          deviceIdMatchesSerial(String(d._id ?? ''), sn),
        );
        if (!hit) {
          map.set(sn.toUpperCase(), { at: null, inAcs: false });
          continue;
        }
        const raw = hit._lastInform;
        let at: Date | null = null;
        if (raw instanceof Date) at = raw;
        else if (typeof raw === 'string' || typeof raw === 'number') {
          const t = new Date(raw);
          if (Number.isFinite(t.getTime())) at = t;
        } else if (raw && typeof raw === 'object' && '$date' in raw) {
          const t = new Date(String((raw as { $date: unknown }).$date));
          if (Number.isFinite(t.getTime())) at = t;
        }
        map.set(sn.toUpperCase(), { at, inAcs: true });
      }
    } catch (err) {
      this.logger.debug(
        `ACS inform map: ${err instanceof Error ? err.message : err}`,
      );
    }
    return map;
  }

  private async loadRecentSignalByOnu(
    schema: string,
    onus: Onu[],
  ): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    const poor = onus.filter(
      (o) =>
        o.online &&
        o.signalDbm != null &&
        Number.isFinite(o.signalDbm) &&
        o.signalDbm < RX_POOR_DBM,
    );
    if (!poor.length) return out;
    try {
      const samples = await this.tenants.getOnuMetricSampleRepository(schema);
      const since = new Date(Date.now() - RX_CHANGE_WINDOW_MS);
      const rows = await samples.find({
        where: {
          onuId: In(poor.map((o) => o.id)),
          kind: 'signal',
          sampledAt: MoreThan(since),
        },
        select: ['onuId', 'value'],
        order: { sampledAt: 'ASC' },
      });
      for (const row of rows) {
        const list = out.get(row.onuId) ?? [];
        list.push(row.value);
        out.set(row.onuId, list);
      }
    } catch (err) {
      this.logger.debug(
        `RX samples: ${err instanceof Error ? err.message : err}`,
      );
    }
    return out;
  }

  private async syncOnu(
    schema: string,
    onu: Onu,
    informBySn: Map<string, { at: Date | null; inAcs: boolean }>,
    rxByOnu: Map<string, number[]>,
  ) {
    const snKey = onu.sn?.trim().toUpperCase() ?? '';
    const acs = snKey ? informBySn.get(snKey) : undefined;
    const wanted = new Set(
      classifyAccessAlarms({
        online: onu.online,
        phaseState: onu.phaseState,
        status: onu.status,
        adminState: onu.adminState,
        signalDbm: onu.signalDbm,
        recentSignalDbms: rxByOnu.get(onu.id) ?? [],
        lastInformAt: acs?.at ?? null,
        hadAcsRecord: acs?.inAcs === true,
        acsExpected: !!(onu.mgmtIp?.trim() || onu.tr069ProfileId),
      }),
    );

    const repo = await this.tenants.getNetworkAlarmRepository(schema);
    const open = await repo.find({
      where: { onuId: onu.id, status: 'open' },
    });
    const openKinds = new Set(open.map((a) => a.kind as AccessAlarmKind));

    for (const kind of wanted) {
      if (openKinds.has(kind)) continue;
      const row = repo.create({
        kind,
        onuId: onu.id,
        sn: onu.sn,
        oltId: onu.oltId,
        status: 'open',
        detail: {
          phaseState: onu.phaseState,
          signalDbm: onu.signalDbm,
          online: onu.online,
        },
      });
      const saved = await repo.save(row);
      await this.notifyOpen(schema, saved);
    }

    for (const row of open) {
      if (wanted.has(row.kind as AccessAlarmKind)) continue;
      row.status = 'cleared';
      row.clearedAt = new Date();
      await repo.save(row);
    }
  }

  private async notifyOpen(schema: string, alarm: NetworkAlarm) {
    const kind = alarm.kind as AccessAlarmKind;
    const sn = alarm.sn?.trim() || 'ONU';
    try {
      const tenant = await this.tenantRepo.findOne({
        where: { schemaName: schema },
      });
      if (!tenant) return;
      const users = await this.tenants.getUserRepository(schema);
      const admins = await users.find({
        where: [
          { role: 'owner', isActive: true },
          { role: 'admin', isActive: true },
        ],
      });
      await Promise.all(
        admins.map((admin) =>
          this.support.notifyTenantUser({
            tenantId: tenant.id,
            userId: admin.id,
            type: 'network_alarm',
            title: alarmTitle(kind, sn),
            body: alarmBody(kind),
            link: alarm.onuId
              ? `/app/settings?tab=onus&onuId=${alarm.onuId}`
              : '/app/settings?tab=onus',
            meta: {
              kind,
              onuId: alarm.onuId,
              sn: alarm.sn,
              oltId: alarm.oltId,
            },
          }),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `notify ${kind} ${sn}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

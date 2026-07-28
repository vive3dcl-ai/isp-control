import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { TenantConnectionService } from '../database/tenant-connection.service';
import { SupportService } from '../support/support.service';
import {
  CalendarEvent,
  type CalendarEventStatus,
  type CalendarEventType,
} from './entities/calendar-event.entity';
import {
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto';

const TYPE_LABEL: Record<string, string> = {
  visit: 'Visita',
  support: 'Soporte',
  installation: 'Instalación',
};

@Injectable()
export class CalendarService {
  constructor(
    private readonly tenantConnections: TenantConnectionService,
    private readonly support: SupportService,
  ) {}

  private requireSchema(user: AuthUser): string {
    if (!user.schemaName) {
      throw new BadRequestException('Tenant schema required');
    }
    return user.schemaName;
  }

  private requireTenantId(user: AuthUser): string {
    if (!user.tenantId) {
      throw new BadRequestException('Tenant requerido');
    }
    return user.tenantId;
  }

  private serialize(e: CalendarEvent) {
    return {
      id: e.id,
      type: e.type,
      title: e.title,
      notes: e.notes,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      allDay: e.allDay,
      status: e.status,
      clientId: e.clientId,
      assignedUserId: e.assignedUserId,
      address: e.address,
      createdBy: e.createdBy,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private async assertAssignee(schema: string, assignedUserId: string | null) {
    if (!assignedUserId) return;
    const users = await this.tenantConnections.getUserRepository(schema);
    const assignee = await users.findOne({
      where: { id: assignedUserId, isActive: true },
    });
    if (!assignee) {
      throw new BadRequestException('Usuario asignado no encontrado o inactivo');
    }
  }

  private formatWhen(startsAt: Date) {
    return startsAt.toLocaleString('es', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private async notifyAssignee(
    user: AuthUser,
    event: CalendarEvent,
    assignedUserId: string,
  ) {
    if (!assignedUserId || assignedUserId === user.sub) return;
    const tenantId = this.requireTenantId(user);
    const typeLabel = TYPE_LABEL[event.type] ?? event.type;
    const when = this.formatWhen(event.startsAt);
    await this.support.notifyTenantUser({
      tenantId,
      userId: assignedUserId,
      type: 'calendar_assigned',
      title: `Nueva agenda: ${event.title}`,
      body: `Te asignaron ${typeLabel.toLowerCase()} · ${when}`,
      link: '/app/calendar',
      meta: {
        eventId: event.id,
        assignedUserId,
        type: event.type,
        startsAt: event.startsAt.toISOString(),
      },
    });
  }

  async list(
    user: AuthUser,
    fromIso: string,
    toIso: string,
    opts?: { type?: string; status?: string },
  ) {
    if (!fromIso?.trim() || !toIso?.trim()) {
      throw new BadRequestException('Parámetros from y to son requeridos');
    }
    const schema = this.requireSchema(user);
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Rango de fechas inválido');
    }
    if (to < from) {
      throw new BadRequestException('to debe ser >= from');
    }
    const repo =
      await this.tenantConnections.getCalendarEventRepository(schema);
    const qb = repo
      .createQueryBuilder('e')
      .where('e.starts_at < :to', { to })
      .andWhere('e.ends_at > :from', { from })
      .orderBy('e.starts_at', 'ASC');
    if (opts?.type) qb.andWhere('e.type = :type', { type: opts.type });
    if (opts?.status) qb.andWhere('e.status = :status', { status: opts.status });
    const rows = await qb.getMany();
    return rows.map((e) => this.serialize(e));
  }

  async get(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getCalendarEventRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Agenda no encontrada');
    return this.serialize(row);
  }

  async create(user: AuthUser, dto: CreateCalendarEventDto) {
    const schema = this.requireSchema(user);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('Fechas inválidas');
    }
    if (endsAt <= startsAt) {
      throw new BadRequestException('La hora de fin debe ser posterior al inicio');
    }
    if (dto.clientId) {
      const clients = await this.tenantConnections.getClientRepository(schema);
      const client = await clients.findOne({ where: { id: dto.clientId } });
      if (!client) throw new BadRequestException('Cliente no encontrado');
    }
    const assignedUserId = dto.assignedUserId ?? null;
    await this.assertAssignee(schema, assignedUserId);

    const repo =
      await this.tenantConnections.getCalendarEventRepository(schema);
    const row = repo.create({
      type: dto.type as CalendarEventType,
      title: dto.title.trim(),
      notes: (dto.notes ?? '').trim(),
      startsAt,
      endsAt,
      allDay: !!dto.allDay,
      status: (dto.status as CalendarEventStatus) || 'scheduled',
      clientId: dto.clientId ?? null,
      assignedUserId,
      address: (dto.address ?? '').trim(),
      createdBy: user.sub,
    });
    const saved = await repo.save(row);
    if (assignedUserId) {
      await this.notifyAssignee(user, saved, assignedUserId);
    }
    return this.serialize(saved);
  }

  async update(user: AuthUser, id: string, dto: UpdateCalendarEventDto) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getCalendarEventRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Agenda no encontrada');

    const prevAssignee = row.assignedUserId;

    if (dto.type !== undefined) row.type = dto.type as CalendarEventType;
    if (dto.title !== undefined) row.title = dto.title.trim();
    if (dto.notes !== undefined) row.notes = dto.notes.trim();
    if (dto.allDay !== undefined) row.allDay = dto.allDay;
    if (dto.status !== undefined) row.status = dto.status as CalendarEventStatus;
    if (dto.address !== undefined) row.address = dto.address.trim();
    if (dto.assignedUserId !== undefined) {
      await this.assertAssignee(schema, dto.assignedUserId);
      row.assignedUserId = dto.assignedUserId;
    }
    if (dto.clientId !== undefined) {
      if (dto.clientId) {
        const clients = await this.tenantConnections.getClientRepository(schema);
        const client = await clients.findOne({ where: { id: dto.clientId } });
        if (!client) throw new BadRequestException('Cliente no encontrado');
      }
      row.clientId = dto.clientId;
    }
    if (dto.startsAt !== undefined) {
      const d = new Date(dto.startsAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('startsAt inválido');
      row.startsAt = d;
    }
    if (dto.endsAt !== undefined) {
      const d = new Date(dto.endsAt);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('endsAt inválido');
      row.endsAt = d;
    }
    if (row.endsAt <= row.startsAt) {
      throw new BadRequestException('La hora de fin debe ser posterior al inicio');
    }
    const saved = await repo.save(row);

    const nextAssignee = saved.assignedUserId;
    if (nextAssignee && nextAssignee !== prevAssignee) {
      await this.notifyAssignee(user, saved, nextAssignee);
    }

    return this.serialize(saved);
  }

  async remove(user: AuthUser, id: string) {
    const schema = this.requireSchema(user);
    const repo =
      await this.tenantConnections.getCalendarEventRepository(schema);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Agenda no encontrada');
    await repo.delete({ id });
    return { ok: true };
  }

  async listDay(user: AuthUser, dayIso: string) {
    if (!dayIso?.trim() || !/^\d{4}-\d{2}-\d{2}/.test(dayIso)) {
      throw new BadRequestException('Parámetro day requerido (YYYY-MM-DD)');
    }
    const day = dayIso.slice(0, 10);
    // Wide window; clients should pass local-day bounds via /events?from&to when precise.
    const start = new Date(`${day}T00:00:00.000Z`);
    start.setUTCHours(start.getUTCHours() - 14);
    const end = new Date(`${day}T23:59:59.999Z`);
    end.setUTCHours(end.getUTCHours() + 14);
    return this.list(user, start.toISOString(), end.toISOString());
  }
}

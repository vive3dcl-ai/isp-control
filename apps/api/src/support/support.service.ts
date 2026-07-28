import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { isPlatformRole } from '../auth/auth.types';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AppNotification } from './entities/app-notification.entity';
import { SupportTicketMessage } from './entities/support-ticket-message.entity';
import {
  SupportTicket,
  type SupportTicketStatus,
} from './entities/support-ticket.entity';
import type {
  CreateSupportMessageDto,
  CreateSupportTicketDto,
  UpdateSupportTicketDto,
} from './dto/support.dto';
import { PushService } from './push.service';

const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: 'Abierto',
  awaiting_tenant: 'Espera empresa',
  awaiting_admin: 'Espera soporte',
  resolved: 'Resuelto',
  closed: 'Cerrado',
};

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportTicket)
    private readonly tickets: Repository<SupportTicket>,
    @InjectRepository(SupportTicketMessage)
    private readonly messages: Repository<SupportTicketMessage>,
    @InjectRepository(AppNotification)
    private readonly notifications: Repository<AppNotification>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly push: PushService,
  ) {}

  private requireTenantId(user: AuthUser): string {
    if (!user.tenantId) {
      throw new ForbiddenException('Tenant requerido');
    }
    return user.tenantId;
  }

  private async tenantName(tenantId: string): Promise<string> {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    return tenant?.name ?? 'Empresa';
  }

  private serializeTicket(
    ticket: SupportTicket,
    extra?: { tenantName?: string; messageCount?: number },
  ) {
    return {
      id: ticket.id,
      tenantId: ticket.tenantId,
      tenantName: extra?.tenantName,
      createdByUserId: ticket.createdByUserId,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      priority: ticket.priority,
      lastMessageAt: ticket.lastMessageAt,
      tenantUnread: ticket.tenantUnread,
      adminUnread: ticket.adminUnread,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      messageCount: extra?.messageCount,
    };
  }

  private serializeMessage(message: SupportTicketMessage) {
    return {
      id: message.id,
      ticketId: message.ticketId,
      authorRole: message.authorRole,
      authorUserId: message.authorUserId,
      authorName: message.authorName,
      body: message.body,
      createdAt: message.createdAt,
    };
  }

  private serializeNotification(n: AppNotification) {
    return {
      id: n.id,
      audience: n.audience,
      tenantId: n.tenantId,
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      readAt: n.readAt,
      meta: n.meta,
      createdAt: n.createdAt,
    };
  }

  private async createNotification(input: {
    audience: 'tenant' | 'platform';
    tenantId: string | null;
    userId?: string | null;
    type: AppNotification['type'];
    title: string;
    body: string;
    link: string;
    meta?: Record<string, unknown>;
  }) {
    const row = this.notifications.create({
      audience: input.audience,
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      readAt: null,
      meta: input.meta ?? {},
    });
    const saved = await this.notifications.save(row);
    void this.push.dispatchForNotification(saved).catch((err) => {
      this.logger.warn(
        `Push falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return saved;
  }

  /** Notificación dirigida a un usuario del tenant (p. ej. agenda asignada). */
  async notifyTenantUser(input: {
    tenantId: string;
    userId: string;
    type: AppNotification['type'];
    title: string;
    body: string;
    link: string;
    meta?: Record<string, unknown>;
  }) {
    return this.createNotification({
      audience: 'tenant',
      tenantId: input.tenantId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      meta: input.meta,
    });
  }

  async listTenantTickets(user: AuthUser) {
    const tenantId = this.requireTenantId(user);
    const rows = await this.tickets.find({
      where: { tenantId },
      order: { lastMessageAt: 'DESC' },
    });
    return rows.map((t) => this.serializeTicket(t));
  }

  async listAdminTickets(status?: string) {
    const qb = this.tickets
      .createQueryBuilder('t')
      .orderBy('t.adminUnread', 'DESC')
      .addOrderBy('t.lastMessageAt', 'DESC');
    if (status) {
      qb.andWhere('t.status = :status', { status });
    }
    const rows = await qb.getMany();
    const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
    const tenants =
      tenantIds.length > 0
        ? await this.tenants.find({ where: { id: In(tenantIds) } })
        : [];
    const nameById = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((t) =>
      this.serializeTicket(t, { tenantName: nameById.get(t.tenantId) }),
    );
  }

  async getTenantTicket(user: AuthUser, ticketId: string) {
    const tenantId = this.requireTenantId(user);
    const ticket = await this.tickets.findOne({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    const messages = await this.messages.find({
      where: { ticketId },
      order: { createdAt: 'ASC' },
    });
    if (ticket.tenantUnread) {
      ticket.tenantUnread = false;
      await this.tickets.save(ticket);
    }
    return {
      ...this.serializeTicket(ticket),
      messages: messages.map((m) => this.serializeMessage(m)),
    };
  }

  async getAdminTicket(ticketId: string) {
    const ticket = await this.tickets.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    const messages = await this.messages.find({
      where: { ticketId },
      order: { createdAt: 'ASC' },
    });
    const tenantName = await this.tenantName(ticket.tenantId);
    if (ticket.adminUnread) {
      ticket.adminUnread = false;
      await this.tickets.save(ticket);
    }
    return {
      ...this.serializeTicket(ticket, { tenantName }),
      messages: messages.map((m) => this.serializeMessage(m)),
    };
  }

  async createTenantTicket(user: AuthUser, dto: CreateSupportTicketDto) {
    const tenantId = this.requireTenantId(user);
    const now = new Date();
    const ticket = await this.tickets.save(
      this.tickets.create({
        tenantId,
        createdByUserId: user.sub,
        subject: dto.subject.trim(),
        category: dto.category,
        priority: dto.priority ?? 'normal',
        status: 'awaiting_admin',
        lastMessageAt: now,
        tenantUnread: false,
        adminUnread: true,
      }),
    );

    const message = await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorRole: 'tenant',
        authorUserId: user.sub,
        authorName: user.name || user.email,
        body: dto.body.trim(),
      }),
    );

    const company = await this.tenantName(tenantId);
    await this.createNotification({
      audience: 'platform',
      tenantId,
      type: 'ticket_created',
      title: `Nuevo ticket: ${ticket.subject}`,
      body: `${company} abrió un ticket de soporte.`,
      link: `/admin/tickets/${ticket.id}`,
      meta: { ticketId: ticket.id, tenantId },
    });

    return {
      ...this.serializeTicket(ticket, { tenantName: company }),
      messages: [this.serializeMessage(message)],
    };
  }

  async addTenantMessage(
    user: AuthUser,
    ticketId: string,
    dto: CreateSupportMessageDto,
  ) {
    const tenantId = this.requireTenantId(user);
    const ticket = await this.tickets.findOne({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.status === 'closed') {
      throw new BadRequestException('El ticket está cerrado');
    }

    const message = await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorRole: 'tenant',
        authorUserId: user.sub,
        authorName: user.name || user.email,
        body: dto.body.trim(),
      }),
    );

    ticket.lastMessageAt = message.createdAt;
    ticket.adminUnread = true;
    ticket.tenantUnread = false;
    if (ticket.status !== 'resolved') {
      ticket.status = 'awaiting_admin';
    }
    await this.tickets.save(ticket);

    const company = await this.tenantName(tenantId);
    await this.createNotification({
      audience: 'platform',
      tenantId,
      type: 'ticket_reply',
      title: `Respuesta: ${ticket.subject}`,
      body: `${company} respondió en el ticket.`,
      link: `/admin/tickets/${ticket.id}`,
      meta: { ticketId: ticket.id, tenantId },
    });

    return this.serializeMessage(message);
  }

  async addAdminMessage(
    user: AuthUser,
    ticketId: string,
    dto: CreateSupportMessageDto,
  ) {
    const ticket = await this.tickets.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.status === 'closed') {
      throw new BadRequestException('El ticket está cerrado');
    }

    const message = await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorRole: 'admin',
        authorUserId: user.sub,
        authorName: user.name || user.email,
        body: dto.body.trim(),
      }),
    );

    ticket.lastMessageAt = message.createdAt;
    ticket.tenantUnread = true;
    ticket.adminUnread = false;
    if (ticket.status === 'open' || ticket.status === 'awaiting_admin') {
      ticket.status = 'awaiting_tenant';
    }
    await this.tickets.save(ticket);

    await this.createNotification({
      audience: 'tenant',
      tenantId: ticket.tenantId,
      type: 'ticket_reply',
      title: `Respuesta de soporte: ${ticket.subject}`,
      body: 'El equipo de plataforma respondió tu ticket.',
      link: `/app/support/${ticket.id}`,
      meta: { ticketId: ticket.id },
    });

    return this.serializeMessage(message);
  }

  async updateTenantTicket(
    user: AuthUser,
    ticketId: string,
    dto: UpdateSupportTicketDto,
  ) {
    const tenantId = this.requireTenantId(user);
    const ticket = await this.tickets.findOne({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');

    if (dto.status && dto.status !== 'closed' && dto.status !== 'resolved') {
      throw new BadRequestException(
        'La empresa solo puede cerrar o marcar resuelto',
      );
    }
    if (dto.status) ticket.status = dto.status;
    if (dto.priority) ticket.priority = dto.priority;
    await this.tickets.save(ticket);

    if (dto.status === 'closed' || dto.status === 'resolved') {
      await this.createNotification({
        audience: 'platform',
        tenantId,
        type: 'ticket_status',
        title: `Ticket ${STATUS_LABEL[dto.status]}: ${ticket.subject}`,
        body: `La empresa marcó el ticket como ${STATUS_LABEL[dto.status].toLowerCase()}.`,
        link: `/admin/tickets/${ticket.id}`,
        meta: { ticketId: ticket.id, status: dto.status },
      });
    }

    return this.serializeTicket(ticket);
  }

  async updateAdminTicket(ticketId: string, dto: UpdateSupportTicketDto) {
    const ticket = await this.tickets.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');

    const prev = ticket.status;
    if (dto.status) ticket.status = dto.status;
    if (dto.priority) ticket.priority = dto.priority;
    await this.tickets.save(ticket);

    if (dto.status && dto.status !== prev) {
      await this.createNotification({
        audience: 'tenant',
        tenantId: ticket.tenantId,
        type: 'ticket_status',
        title: `Estado actualizado: ${ticket.subject}`,
        body: `El ticket ahora está ${STATUS_LABEL[dto.status].toLowerCase()}.`,
        link: `/app/support/${ticket.id}`,
        meta: { ticketId: ticket.id, status: dto.status },
      });
      if (dto.status === 'awaiting_tenant' || dto.status === 'resolved') {
        ticket.tenantUnread = true;
        await this.tickets.save(ticket);
      }
    }

    return this.serializeTicket(ticket, {
      tenantName: await this.tenantName(ticket.tenantId),
    });
  }

  private notificationWhere(user: AuthUser) {
    if (isPlatformRole(user.role)) {
      return {
        audience: 'platform' as const,
      };
    }
    const tenantId = this.requireTenantId(user);
    // Broadcast (userId null) + notificaciones dirigidas al usuario.
    return [
      { audience: 'tenant' as const, tenantId, userId: IsNull() },
      { audience: 'tenant' as const, tenantId, userId: user.sub },
    ];
  }

  async listNotifications(user: AuthUser, limit = 30) {
    const where = this.notificationWhere(user);
    const rows = await this.notifications.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return rows.map((n) => this.serializeNotification(n));
  }

  async unreadCount(user: AuthUser) {
    const where = this.notificationWhere(user);
    if (Array.isArray(where)) {
      return this.notifications.count({
        where: where.map((w) => ({ ...w, readAt: IsNull() })),
      });
    }
    return this.notifications.count({
      where: { ...where, readAt: IsNull() },
    });
  }

  async ticketBadge(user: AuthUser) {
    if (isPlatformRole(user.role)) {
      return (
        (await this.tickets.count({ where: { adminUnread: true } })) > 0
      );
    }
    const tenantId = this.requireTenantId(user);
    return (
      (await this.tickets.count({
        where: { tenantId, tenantUnread: true },
      })) > 0
    );
  }

  async summary(user: AuthUser) {
    const [unreadCount, ticketBadge] = await Promise.all([
      this.unreadCount(user),
      this.ticketBadge(user),
    ]);
    return { unreadCount, ticketBadge };
  }

  async markRead(user: AuthUser, id: string) {
    const where = this.notificationWhere(user);
    const row = await this.notifications.findOne({
      where: Array.isArray(where)
        ? where.map((w) => ({ ...w, id }))
        : { id, ...where },
    });
    if (!row) throw new NotFoundException('Notificación no encontrada');
    if (!row.readAt) {
      row.readAt = new Date();
      await this.notifications.save(row);
    }
    return this.serializeNotification(row);
  }

  async markAllRead(user: AuthUser) {
    const where = this.notificationWhere(user);
    if (Array.isArray(where)) {
      await this.notifications.update(
        where.map((w) => ({ ...w, readAt: IsNull() })),
        { readAt: new Date() },
      );
    } else {
      await this.notifications.update(
        { ...where, readAt: IsNull() },
        { readAt: new Date() },
      );
    }
    return { ok: true };
  }
}

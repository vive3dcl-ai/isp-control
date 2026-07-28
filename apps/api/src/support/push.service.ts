import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import type { AuthUser } from '../auth/auth.types';
import { isPlatformRole } from '../auth/auth.types';
import type { AppNotification } from './entities/app-notification.entity';
import { PushSubscriptionEntity } from './entities/push-subscription.entity';

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;
  private publicKey = '';

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PushSubscriptionEntity)
    private readonly subscriptions: Repository<PushSubscriptionEntity>,
  ) {}

  onModuleInit() {
    const publicKey = (
      this.config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY') ?? ''
    ).trim();
    const privateKey = (
      this.config.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY') ?? ''
    ).trim();
    const subject = (
      this.config.get<string>('WEB_PUSH_SUBJECT') ??
      'mailto:soporte@localhost'
    ).trim();

    if (!publicKey || !privateKey) {
      this.logger.warn(
        'Web Push desactivado: define WEB_PUSH_VAPID_PUBLIC_KEY y WEB_PUSH_VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys)',
      );
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.publicKey = publicKey;
    this.enabled = true;
    this.logger.log('Web Push activado');
  }

  getPublicKey() {
    return {
      enabled: this.enabled,
      publicKey: this.publicKey || null,
    };
  }

  async upsertSubscription(
    user: AuthUser,
    input: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string;
    },
  ) {
    const audience = isPlatformRole(user.role) ? 'platform' : 'tenant';
    const tenantId = isPlatformRole(user.role) ? null : (user.tenantId ?? null);
    const existing = await this.subscriptions.findOne({
      where: { endpoint: input.endpoint },
    });
    if (existing) {
      existing.audience = audience;
      existing.tenantId = tenantId;
      existing.userId = user.sub;
      existing.p256dh = input.keys.p256dh;
      existing.auth = input.keys.auth;
      existing.userAgent = (input.userAgent ?? '').slice(0, 400);
      await this.subscriptions.save(existing);
      return { ok: true, id: existing.id };
    }
    const row = this.subscriptions.create({
      audience,
      tenantId,
      userId: user.sub,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: (input.userAgent ?? '').slice(0, 400),
    });
    const saved = await this.subscriptions.save(row);
    return { ok: true, id: saved.id };
  }

  async removeSubscription(user: AuthUser, endpoint: string) {
    await this.subscriptions.delete({ endpoint, userId: user.sub });
    return { ok: true };
  }

  /** Envía push a los dispositivos que deben ver esta notificación in-app. */
  async dispatchForNotification(n: AppNotification) {
    if (!this.enabled) return;

    let targets: PushSubscriptionEntity[] = [];
    if (n.audience === 'platform') {
      targets = await this.subscriptions.find({
        where: { audience: 'platform' },
      });
    } else if (n.userId && n.tenantId) {
      targets = await this.subscriptions.find({
        where: {
          audience: 'tenant',
          tenantId: n.tenantId,
          userId: n.userId,
        },
      });
    } else if (n.tenantId) {
      targets = await this.subscriptions.find({
        where: { audience: 'tenant', tenantId: n.tenantId },
      });
    }

    if (targets.length === 0) return;

    const payload = JSON.stringify({
      title: n.title,
      body: n.body || '',
      link: n.link || '/',
      tag: `notif-${n.id}`,
      notificationId: n.id,
    });

    await Promise.all(targets.map((sub) => this.sendOne(sub, payload)));
  }

  private async sendOne(sub: PushSubscriptionEntity, payload: string) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
        { TTL: 60 * 60 * 12, urgency: 'normal' },
      );
    } catch (err: unknown) {
      const status =
        err && typeof err === 'object' && 'statusCode' in err
          ? Number((err as { statusCode: number }).statusCode)
          : 0;
      if (status === 404 || status === 410) {
        await this.subscriptions.delete({ id: sub.id });
        this.logger.debug(`Suscripción push eliminada (${status})`);
        return;
      }
      this.logger.warn(
        `Fallo push a ${sub.endpoint.slice(0, 48)}…: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

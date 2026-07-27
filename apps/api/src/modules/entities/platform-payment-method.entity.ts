import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  MercadoPagoEnvironment,
  PlatformPaymentProviderId,
} from '../module-catalog';

/**
 * Métodos de pago de la **plataforma** (suscripciones ISP Control).
 * Independiente de los módulos Mercado Pago de cada tenant (cobro a sus clientes).
 */
@Entity({ name: 'platform_payment_methods', schema: 'public' })
export class PlatformPaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  provider: PlatformPaymentProviderId;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'varchar', length: 20, default: 'sandbox' })
  environment: MercadoPagoEnvironment;

  /** checkout_pro | … */
  @Column({ type: 'varchar', length: 40, default: 'checkout_pro' })
  integration: string;

  @Column({ type: 'jsonb', default: {} })
  config: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

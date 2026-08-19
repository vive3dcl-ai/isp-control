import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

/**
 * Plan de plataforma por cupo de ONUs («usuarios»).
 * `cycle` guarda el código del plan (users_15, users_50, …) por compatibilidad
 * con la columna existente (antes: monthly/quarterly/…).
 */
@Entity({ name: 'platform_system_plans', schema: 'public' })
@Unique(['cycle'])
export class PlatformSystemPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Código del plan: users_15 | users_50 | users_100 | users_200 | users_500 */
  @Column({ type: 'varchar', length: 20 })
  cycle: string;

  /** Siempre 1 (facturación mensual). */
  @Column({ type: 'int', default: 1 })
  months: number;

  @Column({ type: 'varchar', length: 40 })
  label: string;

  /** Cupo base de ONUs / usuarios incluidos. */
  @Column({ name: 'user_limit', type: 'int', default: 0 })
  userLimit: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** Precio USD mensual (catálogo; si isFree, el cobro efectivo es 0). */
  @Column({ name: 'price_usd', type: 'numeric', precision: 12, scale: 2 })
  priceUsd: string;

  /** Si true, el plan se muestra y cobra como gratis (landing + suscripción). */
  @Column({ name: 'is_free', type: 'boolean', default: false })
  isFree: boolean;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

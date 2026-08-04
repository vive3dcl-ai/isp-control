import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

/** Fila única: precio del bloque extra de usuarios. */
@Entity({ name: 'platform_billing_settings', schema: 'public' })
export class PlatformBillingSettings {
  @PrimaryColumn({ type: 'int' })
  id: number;

  /** Precio USD mensual por cada bloque extra de EXTRA_USER_BLOCK_SIZE ONUs. */
  @Column({
    name: 'extra_block_price_usd',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 40,
  })
  extraBlockPriceUsd: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

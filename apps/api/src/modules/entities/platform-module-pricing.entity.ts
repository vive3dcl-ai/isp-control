import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Precio editable de módulos de pago (plataforma).
 * El catálogo aporta el default; esta fila lo sobreescribe.
 */
@Entity({ name: 'platform_module_pricing', schema: 'public' })
export class PlatformModulePricing {
  @PrimaryColumn({ name: 'module_id', type: 'varchar', length: 64 })
  moduleId: string;

  @Column({
    name: 'price_monthly',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  priceMonthly: string | null;

  @Column({
    name: 'price_currency',
    type: 'varchar',
    length: 3,
    nullable: true,
  })
  priceCurrency: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

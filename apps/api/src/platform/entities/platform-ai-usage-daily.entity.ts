import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Consumo diario UTC por tenant cuando usa el proveedor interno. */
@Entity({ name: 'platform_ai_usage_daily', schema: 'public' })
export class PlatformAiUsageDaily {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** YYYY-MM-DD (UTC). */
  @PrimaryColumn({ name: 'usage_date', type: 'date' })
  usageDate: string;

  @Column({ name: 'request_count', type: 'int', default: 0 })
  requestCount: number;

  @Column({ name: 'token_count', type: 'int', default: 0 })
  tokenCount: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

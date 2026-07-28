import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'tenant_map_drafts', schema: 'public' })
export class TenantMapDraft {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  elements: unknown[];

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

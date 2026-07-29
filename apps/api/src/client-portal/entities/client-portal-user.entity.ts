import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

export const CLIENT_PORTAL_USER_STATUSES = [
  'stored',
  'invited',
  'active',
  'disabled',
] as const;
export type ClientPortalUserStatus =
  (typeof CLIENT_PORTAL_USER_STATUSES)[number];

@Entity({ name: 'client_portal_users', schema: 'public' })
@Index('uq_client_portal_users_tenant_email', ['tenantId', 'email'], {
  unique: true,
})
@Index('uq_client_portal_users_tenant_client', ['tenantId', 'clientId'], {
  unique: true,
})
export class ClientPortalUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  /** CRM client UUID in tenant schema (soft reference). */
  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  /** Nombre para mostrar / login (persona o empresa). */
  @Column({ type: 'varchar', length: 180, default: '' })
  name: string;

  @Column({ name: 'first_name', type: 'varchar', length: 120, default: '' })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 120, default: '' })
  lastName: string;

  @Column({ name: 'company_name', type: 'varchar', length: 180, default: '' })
  companyName: string;

  @Column({ name: 'document_type', type: 'varchar', length: 20, default: '' })
  documentType: string;

  @Column({ name: 'document_number', type: 'varchar', length: 40, default: '' })
  documentNumber: string;

  @Column({ name: 'is_company', type: 'boolean', default: false })
  isCompany: boolean;

  @Column({ name: 'company_tax_id', type: 'varchar', length: 40, default: '' })
  companyTaxId: string;

  @Column({ name: 'is_lead', type: 'boolean', default: false })
  isLead: boolean;

  @Column({ type: 'varchar', length: 40, default: '' })
  phone: string;

  @Column({ type: 'varchar', length: 180, default: '' })
  street: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  city: string;

  @Column({ name: 'zip_code', type: 'varchar', length: 20, default: '' })
  zipCode: string;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  passwordHash: string | null;

  @Column({ type: 'varchar', length: 20, default: 'stored' })
  status: ClientPortalUserStatus;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

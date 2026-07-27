import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Client } from './client.entity';
import { ServicePlan } from './service-plan.entity';

export type ClientServiceStatus =
  | 'prepared'
  | 'active'
  | 'suspended'
  | 'ended';

@Entity({ name: 'client_services' })
export class ClientService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @ManyToOne(() => Client, (c) => c.services, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @Column({ name: 'service_plan_id', type: 'uuid' })
  servicePlanId: string;

  @ManyToOne(() => ServicePlan, (p) => p.services, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_plan_id' })
  servicePlan: ServicePlan;

  @Column({ type: 'varchar', length: 180 })
  name: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  price: string;

  @Column({ name: 'active_from', type: 'date', nullable: true })
  activeFrom: string | null;

  @Column({ name: 'active_to', type: 'date', nullable: true })
  activeTo: string | null;

  @Column({ type: 'varchar', length: 20, default: 'prepared' })
  status: ClientServiceStatus;

  @Column({ type: 'varchar', length: 180, default: '' })
  street: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  city: string;

  @Column({ name: 'zip_code', type: 'varchar', length: 20, default: '' })
  zipCode: string;

  @Column({ type: 'text', default: '' })
  note: string;

  /** ONU provisioned for this service (topology.onus id, no FK across DDL blocks). */
  @Column({ name: 'onu_id', type: 'uuid', nullable: true })
  onuId: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ name: 'period_start', type: 'date', nullable: true })
  periodStart: string | null;

  @Column({ name: 'period_end', type: 'date', nullable: true })
  periodEnd: string | null;

  @Column({ name: 'next_billing_date', type: 'date', nullable: true })
  nextBillingDate: string | null;

  /** Installation fee waiting to be added to the first service invoice. */
  @Column({
    name: 'installation_fee_pending',
    type: 'boolean',
    default: false,
  })
  installationFeePending: boolean;

  @Column({
    name: 'installation_invoiced',
    type: 'boolean',
    default: false,
  })
  installationInvoiced: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

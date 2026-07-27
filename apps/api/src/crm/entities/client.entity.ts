import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ClientService } from './client-service.entity';

@Entity({ name: 'clients' })
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'first_name', type: 'varchar', length: 120, default: '' })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 120, default: '' })
  lastName: string;

  @Column({ name: 'company_name', type: 'varchar', length: 180, default: '' })
  companyName: string;

  /** Persona: tipo de documento según país del tenant (RUT, DNI, CPF…). */
  @Column({ name: 'document_type', type: 'varchar', length: 20, default: '' })
  documentType: string;

  @Column({ name: 'document_number', type: 'varchar', length: 40, default: '' })
  documentNumber: string;

  /** Cliente empresa: habilita razón social + documento fiscal de empresa. */
  @Column({ name: 'is_company', type: 'boolean', default: false })
  isCompany: boolean;

  /** Documento fiscal de la empresa (RUT empresa, CUIT, CNPJ, NIT…). */
  @Column({ name: 'company_tax_id', type: 'varchar', length: 40, default: '' })
  companyTaxId: string;

  @Column({ name: 'is_lead', type: 'boolean', default: false })
  isLead: boolean;

  @Column({ type: 'varchar', length: 255, default: '' })
  email: string;

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

  /** Zona CRM (catálogo de Ajustes → Zonas). Independiente del perímetro en el mapa. */
  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @OneToMany(() => ClientService, (s) => s.client)
  services: ClientService[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

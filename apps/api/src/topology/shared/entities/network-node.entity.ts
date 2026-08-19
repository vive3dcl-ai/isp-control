import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Nodo físico de red (sitio / rack / POP).
 * Agrupa activos de topología y tiene ubicación + contacto opcional (arriendo).
 */
@Entity({ name: 'network_nodes' })
export class NetworkNode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'text', default: '' })
  note: string;

  /** Si el sitio físico es arrendado (habilita datos de contacto del arrendador). */
  @Column({ name: 'is_rented', type: 'boolean', default: false })
  isRented: boolean;

  @Column({ name: 'contact_name', type: 'varchar', length: 160, default: '' })
  contactName: string;

  @Column({ name: 'contact_phone', type: 'varchar', length: 40, default: '' })
  contactPhone: string;

  @Column({ name: 'contact_email', type: 'varchar', length: 255, default: '' })
  contactEmail: string;

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

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

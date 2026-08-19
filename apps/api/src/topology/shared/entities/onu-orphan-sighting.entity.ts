import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persistencia de ONUs vistas en Huérfanas (uncfg).
 * first_seen_at = primera vez que apareció en esta “sesión” de uncfg;
 * last_seen_at se actualiza en cada refresh. Al salir de uncfg se borra la fila.
 */
@Entity({ name: 'onu_orphan_sightings' })
@Index('uq_onu_orphan_sightings_sn', ['sn'], { unique: true })
@Index('idx_onu_orphan_sightings_first_seen', ['firstSeenAt'])
export class OnuOrphanSighting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  sn: string;

  @Column({ name: 'olt_id', type: 'uuid', nullable: true })
  oltId: string | null;

  @Column({ name: 'olt_if', type: 'varchar', length: 80, nullable: true })
  oltIf: string | null;

  @Column({ name: 'olt_name', type: 'varchar', length: 120, nullable: true })
  oltName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  board: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  port: string | null;

  @Column({ name: 'pon_type', type: 'varchar', length: 20, nullable: true })
  ponType: string | null;

  /** Modelo ACS (ProductClass / ModelName), p. ej. HG6143D. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  model: string | null;

  /** Origen del modelo: acs | null. */
  @Column({ name: 'model_source', type: 'varchar', length: 20, nullable: true })
  modelSource: string | null;

  /** Driver ONU resuelto (library/generic) para el match de scripts. */
  @Column({ name: 'driver_id', type: 'varchar', length: 64, nullable: true })
  driverId: string | null;

  @Column({ name: 'first_seen_at', type: 'timestamptz' })
  firstSeenAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

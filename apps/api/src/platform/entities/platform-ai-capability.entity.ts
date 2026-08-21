import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type PlatformAiCapabilityKind = 'tool' | 'skill';

/**
 * Catálogo global de tools y skills del Asistente IA.
 * Solo las filas `enabled` se exponen a los agentes de los tenants.
 */
@Entity({ name: 'platform_ai_capabilities', schema: 'public' })
@Index(['kind', 'enabled'])
@Index(['slug'], { unique: true })
export class PlatformAiCapability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  kind: PlatformAiCapabilityKind;

  /** Identificador estable para el agente (snake_case). */
  @Column({ type: 'varchar', length: 80 })
  slug: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  /**
   * JSON Schema de parámetros (solo tools). null para skills.
   */
  @Column({ name: 'parameters_schema', type: 'jsonb', nullable: true })
  parametersSchema: Record<string, unknown> | null;

  /**
   * Código del tool (JS) o cuerpo/instrucciones del skill (markdown/texto).
   */
  @Column({ type: 'text', default: '' })
  code: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

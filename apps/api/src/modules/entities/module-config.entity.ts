import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Configuración por módulo dentro del schema del tenant.
 * `config` es JSON libre según el módulo (ver module-catalog + docs).
 */
@Entity({ name: 'module_configs' })
export class ModuleConfig {
  @PrimaryColumn({ name: 'module_id', type: 'varchar', length: 64 })
  moduleId: string;

  @Column({ type: 'jsonb', default: {} })
  config: Record<string, unknown>;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Snapshot de un cambio del agente para poder deshacerlo.
 * Se llena cuando corre una tool de escritura con «Punto de restauración» ON.
 */
@Entity({ name: 'platform_ai_restore_points', schema: 'public' })
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'sessionId'])
export class PlatformAiRestorePoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** Agrupa puntos de una conversación del Asistente. */
  @Column({ name: 'session_id', type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ name: 'tool_slug', type: 'varchar', length: 80, default: '' })
  toolSlug: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', default: '' })
  summary: string;

  /** Estado exacto antes del cambio (serializado). */
  @Column({ name: 'before_state', type: 'jsonb', nullable: true })
  beforeState: Record<string, unknown> | null;

  /** Estado después del cambio. */
  @Column({ name: 'after_state', type: 'jsonb', nullable: true })
  afterState: Record<string, unknown> | null;

  /**
   * Payload suficiente para revertir (tool + args de undo, o patch inverso).
   */
  @Column({ name: 'undo_payload', type: 'jsonb', nullable: true })
  undoPayload: Record<string, unknown> | null;

  /** active = se puede deshacer · restored = ya revertido · void = invalidado */
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'restored' | 'void';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

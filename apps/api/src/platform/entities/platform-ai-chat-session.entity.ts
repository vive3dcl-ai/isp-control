import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity({ name: 'platform_ai_chat_sessions', schema: 'public' })
@Index(['tenantId', 'userId', 'updatedAt'])
@Index(['tenantId', 'sessionId'], { unique: true })
export class PlatformAiChatSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** Id de sesión del frontend (agrupa restore points). */
  @Column({ name: 'session_id', type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  title: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  messages: Array<{
    role: string;
    content: string;
    id?: string;
    activities?: Array<Record<string, unknown>>;
  }>;

  /** Resumen acumulado cuando el historial se compacta. */
  @Column({ name: 'context_summary', type: 'text', default: '' })
  contextSummary: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

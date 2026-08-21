import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Fila única: proveedor/modelo/key globales + límites diarios del modo interno. */
@Entity({ name: 'platform_ai_settings', schema: 'public' })
export class PlatformAiSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /** openai | anthropic | grok | gemini | deepseek | latinrouter */
  @Column({ type: 'varchar', length: 40, default: 'openai' })
  provider: string;

  @Column({ type: 'varchar', length: 120, default: 'gpt-4.1-mini' })
  model: string;

  @Column({ name: 'api_key', type: 'text', default: '' })
  apiKey: string;

  @Column({ name: 'daily_request_limit', type: 'int', default: 100 })
  dailyRequestLimit: number;

  @Column({ name: 'daily_token_limit', type: 'int', default: 200_000 })
  dailyTokenLimit: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

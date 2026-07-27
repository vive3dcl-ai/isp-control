import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Fila única de SMTP de la plataforma (avisos a admins, etc.). */
@Entity({ name: 'platform_smtp_settings', schema: 'public' })
export class PlatformSmtpSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  host: string;

  @Column({ type: 'int', default: 587 })
  port: number;

  @Column({ type: 'boolean', default: false })
  secure: boolean;

  @Column({ type: 'varchar', length: 255, default: '' })
  username: string;

  @Column({ type: 'text', default: '' })
  password: string;

  @Column({ name: 'from_email', type: 'varchar', length: 255, default: '' })
  fromEmail: string;

  @Column({ name: 'from_name', type: 'varchar', length: 120, default: '' })
  fromName: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

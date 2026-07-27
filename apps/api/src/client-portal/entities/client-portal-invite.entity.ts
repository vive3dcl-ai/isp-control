import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ClientPortalUser } from './client-portal-user.entity';

@Entity({ name: 'client_portal_invites', schema: 'public' })
export class ClientPortalInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 128 })
  tokenHash: string;

  @Column({ name: 'portal_user_id', type: 'uuid' })
  portalUserId: string;

  @ManyToOne(() => ClientPortalUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portal_user_id' })
  portalUser: ClientPortalUser;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

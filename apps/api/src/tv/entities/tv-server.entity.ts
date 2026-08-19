import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TvServerStatus =
  | 'pending'
  | 'installing'
  | 'online'
  | 'error'
  | 'offline';

@Entity({ name: 'tv_servers' })
export class TvServer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'ssh_host', type: 'varchar', length: 255 })
  sshHost: string;

  @Column({ name: 'ssh_port', type: 'int', default: 22 })
  sshPort: number;

  @Column({ name: 'ssh_username', type: 'varchar', length: 120 })
  sshUsername: string;

  @Column({ name: 'ssh_password', type: 'text', nullable: true })
  sshPassword: string | null;

  @Column({ name: 'api_base_url', type: 'varchar', length: 512, nullable: true })
  apiBaseUrl: string | null;

  @Column({ name: 'api_token', type: 'text', nullable: true })
  apiToken: string | null;

  @Column({ name: 'api_listen', type: 'varchar', length: 64, default: ':8099' })
  apiListen: string;

  /** Multicast pool for channel outputs, e.g. 239.1.1.0/24 */
  @Column({ name: 'multicast_cidr', type: 'varchar', length: 64, nullable: true })
  multicastCidr: string | null;

  /** Shared UDP port for all channels in the pool (IP increments). */
  @Column({ name: 'multicast_port', type: 'int', default: 5000 })
  multicastPort: number;

  @Column({ name: 'agent_version', type: 'varchar', length: 40, nullable: true })
  agentVersion: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: TvServerStatus;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

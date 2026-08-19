import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cliente VPN dentro del segmento de un túnel (mismo /24).
 * Cada fila = un usuario OpenVPN / peer WireGuard con IP propia (.2, .3, …).
 */
@Entity({ name: 'vpn_tunnel_clients' })
export class VpnTunnelClient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_vpn_tunnel_clients_tunnel')
  @Column({ name: 'tunnel_id', type: 'uuid' })
  tunnelId: string;

  /** OpenVPN username / CN — único por tenant. */
  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** IP dentro del /24 del túnel, p.ej. 10.69.1.3 */
  @Column({ name: 'client_address', type: 'varchar', length: 64 })
  clientAddress: string;

  @Column({ type: 'text', nullable: true })
  password: string | null;

  @Column({ name: 'wg_private_key', type: 'text', nullable: true })
  wgPrivateKey: string | null;

  @Column({ name: 'wg_public_key', type: 'text', nullable: true })
  wgPublicKey: string | null;

  /** Activo (router/switch) al que se importó este cliente — 1:1. */
  @Column({ name: 'device_id', type: 'uuid', nullable: true })
  deviceId: string | null;

  @Column({ name: 'imported_at', type: 'timestamptz', nullable: true })
  importedAt: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  @Column({ name: 'setup_token', type: 'varchar', length: 64, nullable: true })
  setupToken: string | null;

  @Column({
    name: 'setup_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  setupTokenExpiresAt: Date | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type VpnTunnelProtocol = 'openvpn_tcp' | 'openvpn_udp' | 'wireguard';
export type VpnTunnelStatus = 'pending' | 'configured' | 'online' | 'offline';

@Entity({ name: 'vpn_tunnels' })
export class VpnTunnel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  /** openvpn_tcp | openvpn_udp | wireguard */
  @Column({ type: 'varchar', length: 20 })
  protocol: string;

  /** Always concentrator (MikroTik client → VPN_PUBLIC_HOST). Kept for DB compat. */
  @Column({ type: 'varchar', length: 20, default: 'outbound' })
  mode: string;

  /** Legacy column; unused (concentrador usa VPN_PUBLIC_HOST). */
  @Column({
    name: 'endpoint_host',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  endpointHost: string | null;

  /** Tunnel overlay subnet, e.g. 10.69.69.0/24 */
  @Column({ name: 'tunnel_subnet', type: 'varchar', length: 64 })
  tunnelSubnet: string;

  /** Client IP inside tunnel, e.g. 10.69.69.2 */
  @Column({ name: 'client_address', type: 'varchar', length: 64 })
  clientAddress: string;

  /** Server/peer IP inside tunnel, e.g. 10.69.69.1 */
  @Column({ name: 'server_address', type: 'varchar', length: 64 })
  serverAddress: string;

  /** OpenVPN password or WG pre-shared (optional) */
  @Column({ type: 'text', nullable: true })
  password: string | null;

  /** WireGuard client private key (base64) */
  @Column({ name: 'wg_private_key', type: 'text', nullable: true })
  wgPrivateKey: string | null;

  /** WireGuard client public key (base64) */
  @Column({ name: 'wg_public_key', type: 'text', nullable: true })
  wgPublicKey: string | null;

  /**
   * LAN routes pushed to MikroTik (newline-separated CIDRs).
   * Default: RFC1918 blocks like SmartOLT.
   */
  @Column({ name: 'tunnel_routes', type: 'text' })
  tunnelRoutes: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: string;

  /** Short-lived token for MikroTik /tool fetch bootstrap */
  @Column({ name: 'setup_token', type: 'varchar', length: 64, nullable: true })
  setupToken: string | null;

  @Column({
    name: 'setup_token_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  setupTokenExpiresAt: Date | null;

  @Column({ name: 'last_imported_device_id', type: 'uuid', nullable: true })
  lastImportedDeviceId: string | null;

  @Column({ name: 'last_imported_at', type: 'timestamptz', nullable: true })
  lastImportedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

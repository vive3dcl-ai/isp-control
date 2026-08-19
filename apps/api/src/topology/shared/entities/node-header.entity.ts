import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export const NODE_HEADER_PORT_COUNTS = [4, 8, 16, 32, 64, 128] as const;
export type NodeHeaderPortCount = (typeof NODE_HEADER_PORT_COUNTS)[number];

/** Puerto de una cabecera de fibra (ODF) dentro de un nodo. */
export interface NodeHeaderPort {
  index: number;
  /** Nombre opcional; si falta se usa el nombre del puerto de red enlazado. */
  name: string;
  description: string;
  /** Activo de topología (OLT / router) al que conecta el puerto. */
  deviceId: string | null;
  /** network_ports.id cuando el activo es un router/switch. */
  devicePortId: string | null;
  /** Nombre visible del puerto activo (p. ej. gpon_olt-1/2/3 o ether5). */
  devicePortName: string | null;
  /** Enlace de fibra del mapa (ids locales del tendido). */
  cableId: string | null;
  tubeId: string | null;
  fiberId: string | null;
}

/**
 * Cabecera de fibra (ODF / bandeja de distribución) instalada en un nodo.
 * Los puertos guardan el enlace a puertos PON/router y, opcionalmente,
 * el pelo del tendido del mapa que los alimenta.
 */
@Entity({ name: 'node_headers' })
export class NodeHeader {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'node_id', type: 'uuid' })
  nodeId: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'port_count', type: 'int', default: 8 })
  portCount: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  ports: NodeHeaderPort[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

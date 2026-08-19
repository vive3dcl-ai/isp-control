import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { NetworkPort } from './network-port.entity';

@Entity({ name: 'network_links' })
export class NetworkLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'port_a_id', type: 'uuid', unique: true })
  portAId: string;

  @ManyToOne(() => NetworkPort, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'port_a_id' })
  portA: NetworkPort;

  @Column({ name: 'port_b_id', type: 'uuid', unique: true })
  portBId: string;

  @ManyToOne(() => NetworkPort, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'port_b_id' })
  portB: NetworkPort;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'ip_pool_allocations' })
@Index('uq_ip_pool_allocations_pool_ip', ['poolId', 'ipAddress'], {
  unique: true,
})
@Index('uq_ip_pool_allocations_pool_onu', ['poolId', 'onuId'], {
  unique: true,
  where: '"onu_id" IS NOT NULL',
})
export class IpPoolAllocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'pool_id', type: 'uuid' })
  poolId: string;

  @Column({ name: 'ip_address', type: 'varchar', length: 45 })
  ipAddress: string;

  @Column({ name: 'onu_id', type: 'uuid', nullable: true })
  onuId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'tr069_profiles' })
export class Tr069Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Full ACS URL, e.g. http://10.69.69.1:14501 */
  @Column({ name: 'acs_url', type: 'varchar', length: 255 })
  acsUrl: string;

  @Column({ name: 'acs_port', type: 'int', default: 14501 })
  acsPort: number;

  @Column({ name: 'acs_username', type: 'varchar', length: 120 })
  acsUsername: string;

  @Column({ name: 'acs_password', type: 'varchar', length: 120 })
  acsPassword: string;

  @Column({
    name: 'connection_request_username',
    type: 'varchar',
    length: 120,
  })
  connectionRequestUsername: string;

  @Column({
    name: 'connection_request_password',
    type: 'varchar',
    length: 120,
  })
  connectionRequestPassword: string;

  @Column({ name: 'periodic_inform_enable', type: 'boolean', default: true })
  periodicInformEnable: boolean;

  @Column({ name: 'periodic_inform_interval', type: 'int', default: 300 })
  periodicInformInterval: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

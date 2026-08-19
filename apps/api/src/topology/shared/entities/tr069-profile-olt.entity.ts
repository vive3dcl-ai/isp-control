import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'tr069_profile_olts' })
export class Tr069ProfileOlt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId: string;
}

import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'onu_firmware_images' })
export class OnuFirmwareImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'model_key', type: 'varchar', length: 80 })
  modelKey: string;

  @Column({ type: 'varchar', length: 80 })
  version: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'file_path', type: 'varchar', length: 500 })
  filePath: string;

  @Column({ name: 'byte_size', type: 'bigint' })
  byteSize: string;

  @Column({ name: 'genie_file_id', type: 'varchar', length: 255, nullable: true })
  genieFileId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

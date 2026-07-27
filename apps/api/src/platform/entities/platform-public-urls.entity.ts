import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Fila única: URLs públicas del panel (producción).
 * Si están vacías, se usan PUBLIC_API_URL / PUBLIC_WEB_URL del entorno.
 */
@Entity({ name: 'platform_public_urls', schema: 'public' })
export class PlatformPublicUrls {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Base pública de la API (sin slash final), p. ej. https://panel.tuisp.com/api
   * Backend JSON, bootstrap VPN, etc. — no el portal cautivo.
   */
  @Column({ name: 'public_api_url', type: 'varchar', length: 500, default: '' })
  publicApiUrl: string;

  /**
   * Origen del panel web, p. ej. https://panel.tuisp.com
   * Portal cautivo: {publicWebUrl}/{slug}/suspension
   */
  @Column({ name: 'public_web_url', type: 'varchar', length: 500, default: '' })
  publicWebUrl: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Fila única: branding / SEO de la plataforma (panel admin + login).
 * Los logos de cada empresa (tenant) siguen en `tenants.logo_url`.
 */
@Entity({ name: 'platform_branding', schema: 'public' })
export class PlatformBranding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre del producto (sidebar, login). */
  @Column({ name: 'product_name', type: 'varchar', length: 120, default: '' })
  productName: string;

  /** Marca corta cuando no hay logo (badge). */
  @Column({ name: 'short_name', type: 'varchar', length: 24, default: '' })
  shortName: string;

  /** <title> del navegador. */
  @Column({ name: 'page_title', type: 'varchar', length: 180, default: '' })
  pageTitle: string;

  @Column({ name: 'meta_description', type: 'text', default: '' })
  metaDescription: string;

  @Column({ name: 'meta_keywords', type: 'varchar', length: 500, default: '' })
  metaKeywords: string;

  /** Logo principal (data URL o http). Sidebar / login. */
  @Column({ name: 'logo_url', type: 'text', default: '' })
  logoUrl: string;

  /** Favicon (data URL o http). */
  @Column({ name: 'favicon_url', type: 'text', default: '' })
  faviconUrl: string;

  /** Imagen Open Graph / redes. */
  @Column({ name: 'og_image_url', type: 'text', default: '' })
  ogImageUrl: string;

  /** Texto izquierdo del footer del panel. */
  @Column({ name: 'footer_text', type: 'varchar', length: 255, default: '' })
  footerText: string;

  /** Copyright del footer (editable; el año se añade solo). */
  @Column({
    name: 'footer_secondary',
    type: 'varchar',
    length: 255,
    default: '',
  })
  footerCopyright: string;

  /** Subtítulo bajo el título en la pantalla de login. */
  @Column({ name: 'login_tagline', type: 'varchar', length: 255, default: '' })
  loginTagline: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

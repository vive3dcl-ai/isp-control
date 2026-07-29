import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformBranding } from './entities/platform-branding.entity';
import { UpdatePlatformBrandingDto } from './dto/platform-branding.dto';

export const PLATFORM_BRANDING_DEFAULTS = {
  productName: 'ISP Control',
  shortName: 'ISP',
  pageTitle: 'ISP Control',
  metaDescription:
    'Plataforma multi-tenant para ISP: CRM, red, facturación y operaciones.',
  metaKeywords: 'ISP, CRM, fibra, OLT, facturación',
  logoUrl: '',
  faviconUrl: '',
  ogImageUrl: '',
  footerText: 'ISP Control · multi-tenant',
  footerCopyright: '© ISP Control',
  loginTagline: 'Acceso unificado para administradores y empresas',
} as const;

@Injectable()
export class PlatformBrandingService {
  constructor(
    @InjectRepository(PlatformBranding)
    private readonly repo: Repository<PlatformBranding>,
  ) {}

  async getOrCreate(): Promise<PlatformBranding> {
    const existing = await this.repo.find({
      take: 1,
      order: { createdAt: 'ASC' },
    });
    if (existing[0]) return existing[0];
    return this.repo.save(this.repo.create({}));
  }

  private pick(value: string | null | undefined, fallback: string) {
    const v = (value ?? '').trim();
    return v || fallback;
  }

  private sanitizeLogo(raw: string, field: string): string {
    const value = raw.trim();
    if (!value) return '';
    const ok =
      /^data:image\/(png|jpe?g|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/i.test(
        value,
      ) || /^https?:\/\//i.test(value);
    if (!ok) {
      throw new BadRequestException(
        `${field} inválido: usa una imagen (PNG/JPG/SVG/WebP/ICO) o una URL http(s)`,
      );
    }
    return value;
  }

  serialize(row: PlatformBranding) {
    const d = PLATFORM_BRANDING_DEFAULTS;
    return {
      productName: this.pick(row.productName, d.productName),
      shortName: this.pick(row.shortName, d.shortName),
      pageTitle: this.pick(row.pageTitle, d.pageTitle),
      metaDescription: this.pick(row.metaDescription, d.metaDescription),
      metaKeywords: this.pick(row.metaKeywords, d.metaKeywords),
      logoUrl: (row.logoUrl ?? '').trim(),
      faviconUrl: (row.faviconUrl ?? '').trim(),
      ogImageUrl: (row.ogImageUrl ?? '').trim(),
      footerText: this.pick(row.footerText, d.footerText),
      footerCopyright: this.pick(row.footerCopyright, d.footerCopyright),
      loginTagline: this.pick(row.loginTagline, d.loginTagline),
      /** Valores crudos en BD (para el formulario de admin). */
      raw: {
        productName: row.productName ?? '',
        shortName: row.shortName ?? '',
        pageTitle: row.pageTitle ?? '',
        metaDescription: row.metaDescription ?? '',
        metaKeywords: row.metaKeywords ?? '',
        logoUrl: row.logoUrl ?? '',
        faviconUrl: row.faviconUrl ?? '',
        ogImageUrl: row.ogImageUrl ?? '',
        footerText: row.footerText ?? '',
        footerCopyright: row.footerCopyright ?? '',
        loginTagline: row.loginTagline ?? '',
      },
    };
  }

  async getPublic() {
    const row = await this.getOrCreate();
    const full = this.serialize(row);
    const { raw, ...publicView } = full;
    void raw;
    return publicView;
  }

  async getAdmin() {
    return this.serialize(await this.getOrCreate());
  }

  async update(dto: UpdatePlatformBrandingDto) {
    const row = await this.getOrCreate();
    if (dto.productName !== undefined) row.productName = dto.productName.trim();
    if (dto.shortName !== undefined) row.shortName = dto.shortName.trim();
    if (dto.pageTitle !== undefined) row.pageTitle = dto.pageTitle.trim();
    if (dto.metaDescription !== undefined)
      row.metaDescription = dto.metaDescription.trim();
    if (dto.metaKeywords !== undefined)
      row.metaKeywords = dto.metaKeywords.trim();
    if (dto.footerText !== undefined) row.footerText = dto.footerText.trim();
    if (dto.footerCopyright !== undefined)
      row.footerCopyright = dto.footerCopyright.trim();
    if (dto.loginTagline !== undefined)
      row.loginTagline = dto.loginTagline.trim();
    if (dto.logoUrl !== undefined)
      row.logoUrl = this.sanitizeLogo(dto.logoUrl, 'Logo');
    if (dto.faviconUrl !== undefined)
      row.faviconUrl = this.sanitizeLogo(dto.faviconUrl, 'Favicon');
    if (dto.ogImageUrl !== undefined)
      row.ogImageUrl = this.sanitizeLogo(dto.ogImageUrl, 'Imagen OG');
    await this.repo.save(row);
    return this.getAdmin();
  }
}

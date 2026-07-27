import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformPublicUrls } from './entities/platform-public-urls.entity';
import { UpdatePlatformPublicUrlsDto } from './dto/platform-public-urls.dto';
import {
  envPublicApiBase,
  envPublicWebBase,
  normalizePortalUrl,
  parsePortalUrl,
  webBaseFromApiBase,
} from '../topology/suspension-portal-url';

@Injectable()
export class PlatformPublicUrlsService {
  constructor(
    @InjectRepository(PlatformPublicUrls)
    private readonly repo: Repository<PlatformPublicUrls>,
    private readonly config: ConfigService,
  ) {}

  async getOrCreate(): Promise<PlatformPublicUrls> {
    const existing = await this.repo.find({
      take: 1,
      order: { createdAt: 'ASC' },
    });
    if (existing[0]) return existing[0];
    return this.repo.save(this.repo.create({}));
  }

  /** Base API pública efectiva (BD → env → localhost). */
  async resolvePublicApiUrl(): Promise<string> {
    const row = await this.getOrCreate();
    const fromDb = row.publicApiUrl?.trim();
    if (fromDb) return normalizePortalUrl(fromDb);
    return envPublicApiBase(this.config);
  }

  /**
   * Origen del panel (sin /api). Portal cautivo, links de UI, etc.
   * BD → PUBLIC_WEB_URL → origin derivado de la API pública.
   */
  async resolvePublicWebUrl(): Promise<string> {
    const row = await this.getOrCreate();
    const fromDb = row.publicWebUrl?.trim();
    if (fromDb) return normalizePortalUrl(fromDb);
    const envWeb = envPublicWebBase(this.config);
    if (envWeb) return envWeb;
    return webBaseFromApiBase(await this.resolvePublicApiUrl());
  }

  async getPublic() {
    const row = await this.getOrCreate();
    const resolvedApiUrl = await this.resolvePublicApiUrl();
    const resolvedWebUrl = await this.resolvePublicWebUrl();
    const envWeb = envPublicWebBase(this.config);
    return {
      publicApiUrl: row.publicApiUrl ?? '',
      publicWebUrl: row.publicWebUrl ?? '',
      resolvedApiUrl,
      resolvedWebUrl,
      sourceApi: row.publicApiUrl?.trim() ? 'database' : 'env',
      sourceWeb: row.publicWebUrl?.trim()
        ? 'database'
        : envWeb
          ? 'env'
          : 'derived',
    };
  }

  async update(dto: UpdatePlatformPublicUrlsDto) {
    const row = await this.getOrCreate();
    if (dto.publicApiUrl !== undefined) {
      const raw = (dto.publicApiUrl ?? '').trim();
      if (raw) {
        try {
          const parsed = parsePortalUrl(raw);
          row.publicApiUrl = parsed.url;
        } catch (err) {
          throw new BadRequestException(
            err instanceof Error
              ? `URL API pública: ${err.message}`
              : 'URL API pública inválida',
          );
        }
      } else {
        row.publicApiUrl = '';
      }
    }
    if (dto.publicWebUrl !== undefined) {
      const raw = (dto.publicWebUrl ?? '').trim();
      if (raw) {
        try {
          const parsed = parsePortalUrl(raw);
          row.publicWebUrl = parsed.url;
        } catch (err) {
          throw new BadRequestException(
            err instanceof Error
              ? `URL web pública: ${err.message}`
              : 'URL web pública inválida',
          );
        }
      } else {
        row.publicWebUrl = '';
      }
    }
    await this.repo.save(row);
    return this.getPublic();
  }
}

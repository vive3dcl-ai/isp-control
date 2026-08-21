import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PlatformAiSettings } from '../platform/entities/platform-ai-settings.entity';
import { UpdatePlatformAiSettingsDto } from '../platform/dto/platform-ai-settings.dto';
import { AI_VENDORS, getAiVendor, isAiVendorId } from './ai-providers';
import { listAiModels } from './adapters/list-models';

@Injectable()
export class PlatformAiSettingsService {
  private readonly logger = new Logger(PlatformAiSettingsService.name);
  private ensured = false;

  constructor(
    @InjectRepository(PlatformAiSettings)
    private readonly repo: Repository<PlatformAiSettings>,
    private readonly dataSource: DataSource,
  ) {}

  private async ensureTable() {
    if (this.ensured) return;
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS public.platform_ai_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        enabled boolean NOT NULL DEFAULT false,
        provider varchar(40) NOT NULL DEFAULT 'openai',
        model varchar(120) NOT NULL DEFAULT 'gpt-4.1-mini',
        api_key text NOT NULL DEFAULT '',
        daily_request_limit int NOT NULL DEFAULT 100,
        daily_token_limit int NOT NULL DEFAULT 200000,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    this.ensured = true;
  }

  async getOrCreate(): Promise<PlatformAiSettings> {
    await this.ensureTable();
    const existing = await this.repo.find({
      take: 1,
      order: { createdAt: 'ASC' },
    });
    if (existing[0]) return existing[0];
    return this.repo.save(
      this.repo.create({
        enabled: false,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        apiKey: '',
        dailyRequestLimit: 100,
        dailyTokenLimit: 200_000,
      }),
    );
  }

  async getPublic() {
    const row = await this.getOrCreate();
    return {
      enabled: row.enabled,
      provider: row.provider,
      model: row.model,
      hasApiKey: !!row.apiKey?.trim(),
      apiKey: '',
      dailyRequestLimit: row.dailyRequestLimit,
      dailyTokenLimit: row.dailyTokenLimit,
      configured: !!(row.enabled && row.apiKey?.trim() && row.model?.trim()),
      vendors: AI_VENDORS.map((v) => ({
        id: v.id,
        label: v.label,
        models: v.models,
        defaultModel: v.defaultModel,
      })),
    };
  }

  /** Credenciales internas (solo servicios). */
  async getInternalCredentials(): Promise<{
    provider: string;
    model: string;
    apiKey: string;
    dailyRequestLimit: number;
    dailyTokenLimit: number;
  }> {
    const row = await this.getOrCreate();
    if (!row.enabled) {
      throw new ServiceUnavailableException(
        'El proveedor interno de IA está deshabilitado en la plataforma',
      );
    }
    if (!row.apiKey?.trim()) {
      throw new ServiceUnavailableException(
        'Falta la API key del proveedor interno (Admin → Ajustes → IA)',
      );
    }
    if (!isAiVendorId(row.provider)) {
      throw new ServiceUnavailableException(
        `Proveedor interno inválido: ${row.provider}`,
      );
    }
    return {
      provider: row.provider,
      model: row.model.trim() || getAiVendor(row.provider)!.defaultModel,
      apiKey: row.apiKey.trim(),
      dailyRequestLimit: row.dailyRequestLimit,
      dailyTokenLimit: row.dailyTokenLimit,
    };
  }

  async update(dto: UpdatePlatformAiSettingsDto) {
    if (!isAiVendorId(dto.provider)) {
      throw new BadRequestException(`Proveedor no soportado: ${dto.provider}`);
    }
    const row = await this.getOrCreate();
    row.enabled = dto.enabled;
    row.provider = dto.provider;
    row.model = dto.model.trim();
    if (dto.apiKey != null && dto.apiKey !== '') {
      row.apiKey = dto.apiKey.trim();
    }
    row.dailyRequestLimit = dto.dailyRequestLimit;
    row.dailyTokenLimit = dto.dailyTokenLimit;
    await this.repo.save(row);
    this.logger.log(
      `Platform AI settings updated provider=${row.provider} model=${row.model} enabled=${row.enabled}`,
    );
    return this.getPublic();
  }

  async listModels(opts: { provider?: string; apiKey?: string }) {
    const row = await this.getOrCreate();
    const provider = (opts.provider ?? row.provider).trim();
    if (!isAiVendorId(provider)) {
      throw new BadRequestException(`Proveedor no soportado: ${provider}`);
    }
    const apiKey = opts.apiKey?.trim() || row.apiKey;
    if (!apiKey?.trim()) {
      throw new BadRequestException(
        'Indica una API key (o guárdala primero) para listar modelos',
      );
    }
    return listAiModels(provider, apiKey);
  }
}

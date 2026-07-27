import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type BaileysSessionStatus = {
  tenantId: string;
  status: 'disconnected' | 'qr' | 'connected' | 'connecting';
  qrDataUrl?: string | null;
  reason?: string | null;
};

export type BaileysSendDocumentInput = {
  phone: string;
  fileName: string;
  mimeType: string;
  caption: string;
  contentBase64: string;
};

@Injectable()
export class WhatsAppBaileysClient {
  private readonly logger = new Logger(WhatsAppBaileysClient.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl() {
    return (
      this.config.get<string>('WHATSAPP_BAILEYS_URL') ||
      'http://whatsapp-baileys:3101'
    ).replace(/\/$/, '');
  }

  private secret() {
    return this.config.get<string>('WHATSAPP_BAILEYS_SECRET') || '';
  }

  isConfigured(): boolean {
    return !!this.baseUrl();
  }

  async start(tenantId: string): Promise<BaileysSessionStatus> {
    return this.request('POST', `/sessions/${encodeURIComponent(tenantId)}/start`);
  }

  async status(tenantId: string): Promise<BaileysSessionStatus> {
    return this.request('GET', `/sessions/${encodeURIComponent(tenantId)}/status`);
  }

  async logout(tenantId: string): Promise<BaileysSessionStatus> {
    return this.request(
      'POST',
      `/sessions/${encodeURIComponent(tenantId)}/logout`,
    );
  }

  async sendDocument(
    tenantId: string,
    input: BaileysSendDocumentInput,
  ): Promise<{ ok: boolean; messageId?: string }> {
    return this.requestJson(
      'POST',
      `/sessions/${encodeURIComponent(tenantId)}/send`,
      input,
    );
  }

  private async request(
    method: string,
    path: string,
  ): Promise<BaileysSessionStatus> {
    return this.requestJson(method, path);
  }

  private async requestJson<T>(
    method: string,
    path: string,
    requestBody?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl()}${path}`;
    const secret = this.secret();
    if (!secret) {
      throw new ServiceUnavailableException(
        'WhatsApp Baileys no configurado (WHATSAPP_BAILEYS_SECRET)',
      );
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-WA-INTERNAL-SECRET': secret,
        },
        body:
          requestBody === undefined ? undefined : JSON.stringify(requestBody),
      });
    } catch (err) {
      this.logger.warn(
        `Baileys unreachable ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Servicio WhatsApp Baileys no disponible. Revisa el contenedor whatsapp-baileys.',
      );
    }
    const text = await res.text();
    let responseBody: Record<string, unknown> = {};
    try {
      responseBody = text
        ? (JSON.parse(text) as Record<string, unknown>)
        : {};
    } catch {
      responseBody = { error: text };
    }
    if (!res.ok) {
      throw new BadRequestException(
        (responseBody.error as string) ||
          (responseBody.message as string) ||
          `Baileys error HTTP ${res.status}`,
      );
    }
    return responseBody as T;
  }
}

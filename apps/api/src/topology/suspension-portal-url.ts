import { ConfigService } from '@nestjs/config';

export type SuspensionPortalMode = 'internal' | 'external';

export type PortalTarget = {
  url: string;
  host: string;
  ip: string;
  port: number;
};

const RESERVED_TENANT_SLUGS = new Set([
  'app',
  'admin',
  'api',
  'login',
  'portal',
  'public',
  'internal',
  'health',
  'metrics',
  'docs',
  'swagger',
  'static',
  'assets',
]);

export function isReservedTenantSlug(slug: string): boolean {
  return RESERVED_TENANT_SLUGS.has(slug.trim().toLowerCase());
}

export function normalizePortalUrl(raw: string): string {
  return raw.trim().replace(/\/$/, '');
}

/** Fallback desde variables de entorno (sin slash final). */
export function envPublicApiBase(config: ConfigService): string {
  return normalizePortalUrl(
    config.get<string>('PUBLIC_API_URL') ||
      config.get<string>('API_PUBLIC_URL') ||
      `http://127.0.0.1:${config.get<string>('PORT') || '3000'}/api`,
  );
}

/** Web pública desde env; vacío si no está definida. */
export function envPublicWebBase(config: ConfigService): string {
  const raw = config.get<string>('PUBLIC_WEB_URL')?.trim();
  return raw ? normalizePortalUrl(raw) : '';
}

/**
 * @deprecated Prefer PlatformPublicUrlsService.resolvePublicApiUrl()
 * Kept for sync call sites that only have ConfigService.
 */
export function publicApiBase(config: ConfigService): string {
  return envPublicApiBase(config);
}

/** Unique per-tenant portal on the panel domain: /{slug}/suspension */
export function internalSuspensionPortalUrl(
  webBase: string,
  tenantSlug: string,
): string {
  const base = normalizePortalUrl(webBase);
  return `${base}/${encodeURIComponent(tenantSlug)}/suspension`;
}

/** Derive panel origin from API URL (strip trailing /api). */
export function webBaseFromApiBase(apiBase: string): string {
  return normalizePortalUrl(apiBase).replace(/\/api$/i, '');
}

export function parsePortalUrl(urlRaw: string): {
  url: string;
  host: string;
  port: number;
} {
  const url = normalizePortalUrl(urlRaw);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('URL de portal inválida');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('La URL del portal debe ser http:// o https://');
  }
  const host = parsed.hostname;
  const port =
    parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;
  return { url, host, port };
}

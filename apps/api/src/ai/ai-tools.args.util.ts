import { BadRequestException } from '@nestjs/common';

export function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Placeholders que el modelo copia de ejemplos (`<uuid>`, `uuid`, etc.). */
export function isPlaceholderId(value: string): boolean {
  const t = value.trim();
  if (!t) return true;
  if (/^<[^>]+>$/.test(t)) return true;
  if (
    /^(uuid|id|client[_-]?id|service[_-]?id|onu[_-]?id|device[_-]?id|olt[_-]?id|target[_-]?id|source[_-]?id)$/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(xxx+|test|example|sample|placeholder|null|undefined)$/i.test(t)) {
    return true;
  }
  return false;
}

export function requireUuid(label: string, v: unknown): string {
  const s = asString(v);
  if (!s || isPlaceholderId(s)) {
    throw new BadRequestException(
      `${label}: usa el UUID real del TOOL_RESULT (nunca placeholders como <uuid>). Primero busca con crm_search_clients.`,
    );
  }
  if (!UUID_RE.test(s)) {
    throw new BadRequestException(
      `${label} no es un UUID válido («${s.slice(0, 48)}»)`,
    );
  }
  return s;
}

export function isUuid(v: unknown): boolean {
  const s = asString(v);
  return !!s && !isPlaceholderId(s) && UUID_RE.test(s);
}

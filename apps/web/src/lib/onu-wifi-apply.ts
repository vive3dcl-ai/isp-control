import { apiFetch } from './api'
import type {
  ApplyTr069OnuConfigBody,
  ApplyTr069OnuConfigResponse,
  Tr069OnuConfig,
} from './onu-tr069-config'

export type WifiCreds = {
  ssid24: string
  key24: string
  ssid5: string
  key5: string
}

export function sanitizeSsid(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}

/** Radios de cliente (excluye EasyMesh/backhaul). Prefiere 1=2.4 y 5=5G Huawei. */
export function pickClientWifiRadios(cfg: Tr069OnuConfig) {
  const radios = (cfg.wifi ?? []).filter(
    (w) => !/easymesh|backhaul/i.test(w.ssid ?? ''),
  )
  const r24 = radios.find((r) => r.index === 1) ?? radios[0] ?? null
  const r5 =
    radios.find((r) => r.index === 5) ??
    radios.find((r) => r24 && r.index !== r24.index) ??
    null
  return { r24, r5 }
}

/** Valida el paso Wi‑Fi del wizard. `null` = OK. */
export function validateWifiCredsInput(opts: {
  skip: boolean
  ssid24: string
  ssid5: string
  key24: string
  key5: string
  sameKey: boolean
}): string | null {
  if (opts.skip) return null
  const s24 = opts.ssid24.trim()
  const s5 = opts.ssid5.trim()
  const k24 = opts.key24
  const k5 = opts.sameKey ? opts.key24 : opts.key5
  const anyFilled = !!(s24 || s5 || k24 || (!opts.sameKey && opts.key5))
  if (!anyFilled) return null
  if (!s24) return 'Indica el SSID 2.4 GHz (o marca «omitir Wi‑Fi»).'
  if (k24.length < 8)
    return 'La contraseña Wi‑Fi debe tener al menos 8 caracteres.'
  if (!s5 && !s24) return 'Indica el SSID 5 GHz.'
  if (!opts.sameKey && k5.length < 8)
    return 'La contraseña 5 GHz debe tener al menos 8 caracteres.'
  return null
}

export function buildWifiCredsOrNull(opts: {
  skip: boolean
  ssid24: string
  ssid5: string
  key24: string
  key5: string
  sameKey: boolean
}): WifiCreds | null {
  const key5 = opts.sameKey ? opts.key24 : opts.key5
  if (
    opts.skip ||
    (!opts.ssid24.trim() && !opts.ssid5.trim() && !opts.key24 && !key5)
  ) {
    return null
  }
  return {
    ssid24: opts.ssid24.trim(),
    key24: opts.key24,
    ssid5: opts.ssid5.trim() || `${opts.ssid24.trim()}-5G`,
    key5,
  }
}

/** Aplica SSID/clave al final del aprovisionamiento (ACS TR‑069). */
export async function applyWifiAfterProvision(
  onuId: string,
  creds: WifiCreds,
): Promise<string> {
  const ssid24 = creds.ssid24.trim()
  const key24 = creds.key24
  const ssid5 = creds.ssid5.trim()
  const key5 = creds.key5
  if (!ssid24 && !ssid5 && !key24 && !key5) {
    return 'Wi‑Fi omitido'
  }

  let cfg = await apiFetch<Tr069OnuConfig>(`/app/onus/${onuId}/tr069-config`)
  if (!cfg.inAcs) {
    throw new Error(
      'ONU aún no está en el ACS; espera el Inform TR‑069 y configura el Wi‑Fi desde Configurar ONU.',
    )
  }
  if (!cfg.wifi?.length) {
    await apiFetch<ApplyTr069OnuConfigResponse>(
      `/app/onus/${onuId}/tr069-config`,
      { method: 'POST', body: JSON.stringify({ refresh: true }) },
    )
    await new Promise((r) => window.setTimeout(r, 2_500))
    cfg = await apiFetch<Tr069OnuConfig>(`/app/onus/${onuId}/tr069-config`)
  }
  const { r24, r5 } = pickClientWifiRadios(cfg)
  if (!r24 && !r5) {
    throw new Error(
      'No hay radios Wi‑Fi en el árbol ACS. Pulsa Configurar ONU → Refrescar y reintenta.',
    )
  }

  const wifi: NonNullable<ApplyTr069OnuConfigBody['wifi']> = []
  if (r24 && (ssid24 || key24)) {
    const patch: (typeof wifi)[number] = { index: r24.index }
    if (ssid24) patch.ssid = ssid24
    if (key24) patch.key = key24
    wifi.push(patch)
  }
  if (r5 && (ssid5 || key5)) {
    const patch: (typeof wifi)[number] = { index: r5.index }
    if (ssid5) patch.ssid = ssid5
    if (key5) patch.key = key5
    wifi.push(patch)
  }
  if (!wifi.length) return 'Wi‑Fi omitido'

  const r = await apiFetch<ApplyTr069OnuConfigResponse>(
    `/app/onus/${onuId}/tr069-config`,
    { method: 'POST', body: JSON.stringify({ wifi }) },
  )
  if (!r.ok && !r.queued) {
    throw new Error(r.message || 'No se pudo aplicar el Wi‑Fi')
  }
  const bands = [
    r24 && (ssid24 || key24) ? '2.4 GHz' : null,
    r5 && (ssid5 || key5) ? '5 GHz' : null,
  ]
    .filter(Boolean)
    .join(' + ')
  return r.message || `Wi‑Fi aplicado (${bands})`
}

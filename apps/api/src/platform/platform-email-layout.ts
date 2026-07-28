/**
 * Layout HTML compartido para correos del sistema (tema plataforma).
 * Estilos inline + tablas para máxima compatibilidad con clientes de correo.
 */

export type PlatformEmailBrand = {
  productName: string
  logoUrl: string
  footerText: string
  footerCopyright: string
}

const ACCENT = '#2f9cff'
const ACCENT_DARK = '#1f8aeb'
const BG = '#eef2f7'
const CARD = '#ffffff'
const TEXT = '#0f172a'
const MUTED = '#64748b'
const BORDER = '#e2e8f0'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Convierte texto plano a párrafos HTML seguros. */
export function textToEmailHtml(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let buf: string[] = []
  const flush = () => {
    if (!buf.length) return
    blocks.push(
      `<p style="margin:0 0 14px;color:${TEXT};font-size:15px;line-height:1.55">${escapeHtml(buf.join(' '))}</p>`,
    )
    buf = []
  }
  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    buf.push(line.trim())
  }
  flush()
  return blocks.join('') || `<p style="margin:0;color:${TEXT}">&nbsp;</p>`
}

export function emailCtaButton(url: string, label: string): string {
  const safeUrl = escapeHtml(url)
  const safeLabel = escapeHtml(label)
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
  <tr>
    <td style="border-radius:10px;background:${ACCENT}">
      <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:10px">${safeLabel}</a>
    </td>
  </tr>
</table>`
}

function emailSafeLogoUrl(logoUrl: string): string {
  const u = (logoUrl || '').trim()
  if (/^https?:\/\//i.test(u)) return u
  return ''
}

/**
 * Envuelve el cuerpo HTML en el marco de marca de la plataforma.
 * @param skipOuter Si el cuerpo ya es un documento completo, aún se añade cabecera/pie de plataforma.
 */
export function buildPlatformEmailHtml(opts: {
  brand: PlatformEmailBrand
  bodyHtml: string
  title?: string
  preheader?: string
}): string {
  const product = escapeHtml(opts.brand.productName || 'ISP Control')
  const footerText = escapeHtml(opts.brand.footerText || '')
  const footerCopyright = escapeHtml(opts.brand.footerCopyright || '')
  const title = opts.title ? escapeHtml(opts.title) : ''
  const preheader = escapeHtml(opts.preheader || opts.title || '')
  const logoSrc = emailSafeLogoUrl(opts.brand.logoUrl)
  const logoBlock = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="${product}" width="140" style="display:block;max-width:140px;max-height:48px;height:auto;border:0;outline:none" />`
    : `<div style="font-size:18px;font-weight:700;color:${ACCENT};letter-spacing:0.04em">${product}</div>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title || product}</title>
</head>
<body style="margin:0;padding:0;background:${BG};font-family:'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${CARD};border-radius:14px;overflow:hidden;border:1px solid ${BORDER};box-shadow:0 8px 24px rgba(15,23,42,0.06)">
          <tr>
            <td style="height:4px;background:${ACCENT};font-size:0;line-height:0">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:22px 28px 8px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle">${logoBlock}</td>
                  <td align="right" style="vertical-align:middle;color:${MUTED};font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase">${product}</td>
                </tr>
              </table>
            </td>
          </tr>
          ${
            title
              ? `<tr><td style="padding:8px 28px 0"><h1 style="margin:0;font-size:20px;line-height:1.35;color:${TEXT};font-weight:700">${title}</h1></td></tr>`
              : ''
          }
          <tr>
            <td style="padding:18px 28px 28px;color:${TEXT};font-size:15px;line-height:1.55">
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;background:#f8fafc;border-top:1px solid ${BORDER}">
              ${
                footerText
                  ? `<p style="margin:0 0 4px;color:${MUTED};font-size:12px;line-height:1.45">${footerText}</p>`
                  : ''
              }
              ${
                footerCopyright
                  ? `<p style="margin:0;color:${MUTED};font-size:11px">${footerCopyright}</p>`
                  : `<p style="margin:0;color:${MUTED};font-size:11px">© ${product}</p>`
              }
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;color:${MUTED};font-size:11px">
          Enviado por <span style="color:${ACCENT_DARK}">${product}</span>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

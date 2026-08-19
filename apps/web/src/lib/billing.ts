import { formatMoney } from './currency'

export type InvoiceTemplateType =
  | 'service'
  | 'installation'
  | 'prorate'
  | 'credit_note'
  | 'manual'
  | 'custom'

export interface BillingProduct {
  id: string
  name: string
  description: string
  unitPrice: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type BillingJobKind = 'periods' | 'generate' | 'send'

export interface BillingSettings {
  id: string
  timezone: string
  invoicePrefix: string
  nextInvoiceNumber: number
  periodsEnabled: boolean
  periodsCron: string
  periodsLastRunAt: string | null
  generateEnabled: boolean
  generateCron: string
  generateLastRunAt: string | null
  sendEnabled: boolean
  sendCron: string
  sendLastRunAt: string | null
  defaultDueDays: number
  /** calendar_month = cobro fijo de calendario; from_install = ciclo desde el día de alta */
  billingRegime: 'calendar_month' | 'from_install'
  updatedAt: string
}

export interface InvoiceTemplate {
  id: string
  type: InvoiceTemplateType
  name: string
  subject: string
  bodyHtml: string
  isDefault: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface InvoiceItem {
  id: string
  description: string
  quantity: string
  unitPrice: string
  amount: string
  sortOrder: number
}

export interface Invoice {
  id: string
  number: string
  clientId: string
  clientServiceId: string | null
  type: string
  status: string
  currency: string
  subtotal: string
  tax: string
  total: string
  periodStart: string | null
  periodEnd: string | null
  issueDate: string
  dueDate: string | null
  sentAt: string | null
  notes: string
  items: InvoiceItem[]
  createdAt: string
  updatedAt: string
}

export const TEMPLATE_TYPE_LABELS: Record<InvoiceTemplateType, string> = {
  service: 'Servicio mensual',
  installation: 'Instalación',
  prorate: 'Prorrateo',
  credit_note: 'Nota de crédito',
  manual: 'Manual',
  custom: 'Personalizada',
}

export const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Cada día a las 00:05', value: '5 0 * * *' },
  { label: 'Cada día a las 06:00', value: '0 6 * * *' },
  { label: 'Cada día a las 08:00', value: '0 8 * * *' },
  { label: 'Cada hora', value: '0 * * * *' },
  { label: 'Lunes a viernes 07:00', value: '0 7 * * 1-5' },
]

export type TemplateCompanyVars = {
  name?: string
  legalName?: string
  phone?: string
  email?: string
  address?: string
  city?: string
  country?: string
  taxId?: string
  legalRepresentative?: string
  currency?: string
  logoUrl?: string
  invoiceFooter?: string
  invoiceDocLabel?: string
}

function logoImg(logoUrl?: string): string {
  if (!logoUrl) return ''
  return `<img src="${logoUrl}" alt="logo" style="max-height:56px;max-width:180px;margin-bottom:10px;object-fit:contain;" />`
}

function footerBlock(text?: string): string {
  if (!text || !text.trim()) return ''
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
  return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;">${safe}</div>`
}

function itemsRows(
  items: { description: string; quantity: string; unitPrice: string; amount: string }[],
): string {
  return items
    .map(
      (it) =>
        `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;">${it.description}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">${it.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">${it.unitPrice}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#111827;">${it.amount}</td>
    </tr>`,
    )
    .join('\n')
}

/** Sample values to preview templates without a real invoice. */
export function sampleTemplateVars(
  company?: TemplateCompanyVars,
): Record<string, string> {
  const currency = company?.currency || 'CLP'
  const money = (v: number) => formatMoney(v, currency)
  const sampleItems = [
    {
      description: 'Internet 100 Mbps — Julio 2026',
      quantity: '1',
      unitPrice: money(19990),
      amount: money(19990),
    },
  ]

  return {
    'invoice.number': 'F-00042',
    'invoice.type': 'service',
    'invoice.docLabel': company?.invoiceDocLabel || 'Factura',
    'invoice.status': 'Emitida',
    'invoice.total': money(19990),
    'invoice.subtotal': money(19990),
    'invoice.tax': money(0),
    'invoice.currency': currency,
    'invoice.periodStart': '2026-07-01',
    'invoice.periodEnd': '2026-07-31',
    'invoice.issueDate': '2026-07-01',
    'invoice.dueDate': '2026-07-11',
    'invoice.notes': 'Gracias por su preferencia.',
    'invoice.itemsTable': itemsRows(sampleItems),
    'client.name': 'Ana Pérez',
    'client.email': 'ana@ejemplo.local',
    'client.phone': '+56 9 1234 5678',
    'client.address': 'Av. Demo 123, Santiago',
    'service.name': 'Internet 100 Mbps',
    'company.name': company?.name || 'Mi ISP',
    'company.legalName': company?.legalName || company?.name || 'Mi ISP SpA',
    'company.phone': company?.phone || '',
    'company.email': company?.email || '',
    'company.address': company?.address || 'Av. Principal 100',
    'company.city': company?.city || 'Santiago',
    'company.country': company?.country || 'Chile',
    'company.taxId': company?.taxId || '76.000.000-0',
    'company.legalRepresentative': company?.legalRepresentative || '',
    'company.logo': logoImg(company?.logoUrl),
    'company.footer': footerBlock(company?.invoiceFooter),
  }
}

export function renderTemplatePlaceholders(
  source: string,
  vars: Record<string, string>,
): string {
  return source.replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (_, key: string) => vars[key] ?? '',
  )
}

export function isProfessionalTemplate(bodyHtml: string): boolean {
  return (
    bodyHtml.includes('{{invoice.itemsTable}}') &&
    bodyHtml.includes('{{company.logo}}')
  )
}

/** Same professional layout as the API defaults (for preview fallback). */
export function professionalInvoiceBodyHtml(opts?: {
  heading?: string
  badge?: string
  intro?: string
  detailLabel?: string
}): string {
  const heading = opts?.heading ?? '{{invoice.docLabel}}'
  const badge = opts?.badge ?? 'Servicio mensual'
  const intro = opts?.intro ?? 'Cargo recurrente del período.'
  const detailLabel = opts?.detailLabel ?? 'Servicio'
  return `<div style="max-width:720px;margin:0 auto;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2933;font-size:14px;line-height:1.5;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:3px solid #2563eb;padding-bottom:20px;">
    <div style="max-width:60%;">
      {{company.logo}}
      <div style="font-size:20px;font-weight:700;color:#111827;">{{company.name}}</div>
      <div style="color:#6b7280;font-size:12px;">{{company.legalName}}</div>
      <div style="color:#6b7280;font-size:12px;margin-top:6px;">{{company.address}}</div>
      <div style="color:#6b7280;font-size:12px;">{{company.city}} {{company.country}}</div>
      <div style="color:#6b7280;font-size:12px;">{{company.phone}} · {{company.email}}</div>
      <div style="color:#6b7280;font-size:12px;">ID fiscal: {{company.taxId}}</div>
    </div>
    <div style="text-align:right;">
      <div style="display:inline-block;background:#eff6ff;color:#2563eb;font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:999px;">${badge}</div>
      <div style="font-size:22px;font-weight:700;color:#111827;margin-top:10px;">${heading}</div>
      <div style="font-size:15px;font-weight:600;color:#2563eb;">{{invoice.number}}</div>
      <div style="color:#6b7280;font-size:12px;margin-top:8px;">Emisión: {{invoice.issueDate}}</div>
      <div style="color:#6b7280;font-size:12px;">Vencimiento: {{invoice.dueDate}}</div>
      <div style="color:#6b7280;font-size:12px;">Estado: {{invoice.status}}</div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;gap:24px;margin-top:24px;">
    <div>
      <div style="text-transform:uppercase;font-size:11px;letter-spacing:.06em;color:#9ca3af;margin-bottom:4px;">Facturar a</div>
      <div style="font-weight:600;color:#111827;">{{client.name}}</div>
      <div style="color:#6b7280;font-size:12px;">{{client.address}}</div>
      <div style="color:#6b7280;font-size:12px;">{{client.email}} · {{client.phone}}</div>
    </div>
    <div style="text-align:right;">
      <div style="text-transform:uppercase;font-size:11px;letter-spacing:.06em;color:#9ca3af;margin-bottom:4px;">${detailLabel}</div>
      <div style="font-weight:600;color:#111827;">{{service.name}}</div>
      <div style="color:#6b7280;font-size:12px;">${intro}</div>
      <div style="color:#6b7280;font-size:12px;">Período: {{invoice.periodStart}} — {{invoice.periodEnd}}</div>
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-top:24px;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:1px solid #e5e7eb;">Descripción</th>
        <th style="text-align:right;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:1px solid #e5e7eb;">Cant.</th>
        <th style="text-align:right;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:1px solid #e5e7eb;">P. unitario</th>
        <th style="text-align:right;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:1px solid #e5e7eb;">Importe</th>
      </tr>
    </thead>
    <tbody>
      {{invoice.itemsTable}}
    </tbody>
  </table>

  <div style="display:flex;justify-content:flex-end;margin-top:16px;">
    <table style="width:280px;border-collapse:collapse;">
      <tr>
        <td style="padding:6px 12px;color:#6b7280;">Subtotal</td>
        <td style="padding:6px 12px;text-align:right;color:#111827;">{{invoice.subtotal}}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px;color:#6b7280;">Impuestos</td>
        <td style="padding:6px 12px;text-align:right;color:#111827;">{{invoice.tax}}</td>
      </tr>
      <tr>
        <td style="padding:12px;font-weight:700;color:#111827;border-top:2px solid #e5e7eb;">Total</td>
        <td style="padding:12px;text-align:right;font-weight:700;font-size:16px;color:#2563eb;border-top:2px solid #e5e7eb;">{{invoice.total}}</td>
      </tr>
    </table>
  </div>

  <div style="margin-top:20px;padding:14px 16px;background:#f9fafb;border-radius:8px;color:#6b7280;font-size:12px;">
    <strong style="color:#374151;">Notas:</strong> {{invoice.notes}}
  </div>

  {{company.footer}}
</div>`
}

function escapeHtmlPreview(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Variables para preview de una factura manual (borrador en el cliente). */
export function buildManualInvoicePreview(
  input: {
    company?: TemplateCompanyVars
    clientName: string
    clientEmail: string
    clientPhone?: string
    clientAddress?: string
    notes?: string
    dueDays?: number
    items: Array<{ description: string; quantity: number; unitPrice: number }>
  },
): { subject: string; bodyHtml: string } {
  const currency = input.company?.currency || 'USD'
  const money = (v: number) => formatMoney(v, currency)
  const today = new Date()
  const issueDate = today.toISOString().slice(0, 10)
  const due = new Date(today)
  due.setUTCDate(due.getUTCDate() + (input.dueDays ?? 10))
  const dueDate = due.toISOString().slice(0, 10)

  let subtotal = 0
  const rows = input.items.map((it) => {
    const amount = Math.round(it.quantity * it.unitPrice * 100) / 100
    subtotal += amount
    return {
      description: escapeHtmlPreview(it.description),
      quantity: String(it.quantity),
      unitPrice: money(it.unitPrice),
      amount: money(amount),
    }
  })
  subtotal = Math.round(subtotal * 100) / 100

  const itemsTable = rows
    .map(
      (it) => `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;">${it.description}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">${it.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">${it.unitPrice}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#111827;">${it.amount}</td>
    </tr>`,
    )
    .join('\n')

  const company = input.company
  const logo = company?.logoUrl
    ? `<img src="${company.logoUrl.replace(/"/g, '&quot;')}" alt="logo" style="max-height:56px;max-width:180px;margin-bottom:10px;object-fit:contain;" />`
    : ''
  const footer = company?.invoiceFooter?.trim()
    ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;">${escapeHtmlPreview(company.invoiceFooter).replace(/\n/g, '<br/>')}</div>`
    : ''

  const vars: Record<string, string> = {
    'invoice.number': '(borrador)',
    'invoice.type': 'manual',
    'invoice.docLabel': company?.invoiceDocLabel || 'Factura',
    'invoice.status': 'Emitida',
    'invoice.total': money(subtotal),
    'invoice.subtotal': money(subtotal),
    'invoice.tax': money(0),
    'invoice.currency': currency,
    'invoice.periodStart': '',
    'invoice.periodEnd': '',
    'invoice.issueDate': issueDate,
    'invoice.dueDate': dueDate,
    'invoice.notes': input.notes?.trim() || '—',
    'invoice.itemsTable': itemsTable,
    'client.name': input.clientName,
    'client.email': input.clientEmail,
    'client.phone': input.clientPhone || '',
    'client.address': input.clientAddress || '',
    'service.name': 'Factura manual',
    'company.name': company?.name || 'Mi ISP',
    'company.legalName': company?.legalName || company?.name || 'Mi ISP',
    'company.phone': company?.phone || '',
    'company.email': company?.email || '',
    'company.address': company?.address || '',
    'company.city': company?.city || '',
    'company.country': company?.country || '',
    'company.taxId': company?.taxId || '',
    'company.legalRepresentative': company?.legalRepresentative || '',
    'company.logo': logo,
    'company.footer': footer,
  }

  const subjectTpl =
    '{{invoice.docLabel}} {{invoice.number}} — {{company.name}}'
  const bodyTpl = professionalInvoiceBodyHtml({
    heading: '{{invoice.docLabel}}',
    badge: 'Factura manual',
    intro: 'Conceptos facturados de forma puntual.',
    detailLabel: 'Detalle',
  })

  return {
    subject: renderTemplatePlaceholders(subjectTpl, vars),
    bodyHtml: renderTemplatePlaceholders(bodyTpl, vars),
  }
}

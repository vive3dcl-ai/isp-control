import type { InvoiceTemplateType } from './entities/invoice-template.entity';

export type DefaultTemplateSeed = {
  type: InvoiceTemplateType;
  name: string;
  subject: string;
  bodyHtml: string;
  isDefault: boolean;
};

/**
 * Professional, print/email-friendly invoice layout (table-based + inline CSS).
 * Placeholders are resolved by the renderer:
 *  - {{company.logo}}      → <img> (or empty)
 *  - {{company.footer}}    → legal disclaimers block
 *  - {{invoice.itemsTable}}→ <tr> rows for line items
 * `heading` and `intro` customize each document type.
 */
/** Bump when the layout changes so existing tenants get re-migrated. */
export const TEMPLATE_VERSION_TAG = '<!--tplv4-->';

function proInvoiceTemplate(opts: {
  heading: string;
  badge: string;
  intro: string;
  /** Etiqueta de la columna derecha (por defecto «Servicio»). */
  detailLabel?: string;
}): string {
  const detailLabel = opts.detailLabel ?? 'Servicio';
  return `${TEMPLATE_VERSION_TAG}<div style="max-width:720px;margin:0 auto;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2933;font-size:14px;line-height:1.5;">
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
      <div style="display:inline-block;background:#eff6ff;color:#2563eb;font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:999px;">${opts.badge}</div>
      <div style="font-size:22px;font-weight:700;color:#111827;margin-top:10px;">${opts.heading}</div>
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
      <div style="color:#6b7280;font-size:12px;">${opts.intro}</div>
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
</div>`;
}

export const DEFAULT_INVOICE_TEMPLATES: DefaultTemplateSeed[] = [
  {
    type: 'service',
    name: 'Documento de servicio (mensual)',
    subject: '{{invoice.docLabel}} {{invoice.number}} — {{company.name}}',
    isDefault: true,
    bodyHtml: proInvoiceTemplate({
      heading: '{{invoice.docLabel}}',
      badge: 'Servicio mensual',
      intro: 'Cargo recurrente del período.',
    }),
  },
  {
    type: 'installation',
    name: 'Documento de instalación',
    subject: 'Instalación {{invoice.number}} — {{company.name}}',
    isDefault: true,
    bodyHtml: proInvoiceTemplate({
      heading: '{{invoice.docLabel}}',
      badge: 'Instalación',
      intro: 'Cargo único por instalación del servicio.',
    }),
  },
  {
    type: 'prorate',
    name: 'Documento prorrateado (primer mes)',
    subject: 'Prorrateo {{invoice.number}} — {{company.name}}',
    isDefault: true,
    bodyHtml: proInvoiceTemplate({
      heading: '{{invoice.docLabel}}',
      badge: 'Prorrateo',
      intro: 'Prorrateo del primer período de servicio.',
    }),
  },
  {
    type: 'credit_note',
    name: 'Nota de crédito',
    subject: 'Nota de crédito {{invoice.number}} — {{company.name}}',
    isDefault: true,
    bodyHtml: proInvoiceTemplate({
      heading: 'Nota de crédito',
      badge: 'Crédito',
      intro: 'Documento de crédito a favor del cliente.',
    }),
  },
  {
    type: 'manual',
    name: 'Documento manual (profesional)',
    subject: '{{invoice.docLabel}} {{invoice.number}} — {{company.name}}',
    isDefault: true,
    bodyHtml: proInvoiceTemplate({
      heading: '{{invoice.docLabel}}',
      badge: 'Factura manual',
      intro: 'Conceptos facturados de forma puntual.',
      detailLabel: 'Detalle',
    }),
  },
  {
    type: 'custom',
    name: 'Plantilla personalizada',
    subject: 'Documento {{invoice.number}} — {{company.name}}',
    isDefault: false,
    bodyHtml: proInvoiceTemplate({
      heading: '{{invoice.docLabel}}',
      badge: 'Personalizado',
      intro: 'Documento personalizado.',
    }),
  },
];

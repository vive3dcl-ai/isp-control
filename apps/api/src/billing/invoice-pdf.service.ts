import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice } from './entities/invoice.entity';

@Injectable()
export class InvoicePdfService {
  async render(input: {
    invoice: Invoice;
    tenant: Tenant;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    clientAddress: string;
  }): Promise<Buffer> {
    const { invoice, tenant } = input;
    const currency = invoice.currency || tenant.currency || 'USD';
    const money = (value: string | number) =>
      new Intl.NumberFormat('es', {
        style: 'currency',
        currency,
        maximumFractionDigits: currency === 'CLP' ? 0 : 2,
      }).format(Number(value) || 0);

    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: {
        Title: `${tenant.invoiceDocLabel || 'Factura'} ${invoice.number}`,
        Author: tenant.name,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const completed = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.drawHeader(doc, tenant, invoice);
    this.drawParties(doc, input);
    this.drawItems(doc, invoice, money);
    this.drawTotals(doc, invoice, money);
    this.drawFooter(doc, tenant, invoice);

    doc.end();
    return completed;
  }

  private drawHeader(
    doc: PDFKit.PDFDocument,
    tenant: Tenant,
    invoice: Invoice,
  ) {
    const top = doc.y;
    const logo = this.logoBuffer(tenant.logoUrl);
    if (logo) {
      try {
        doc.image(logo, 48, top, { fit: [150, 52] });
      } catch {
        doc
          .font('Helvetica-Bold')
          .fontSize(18)
          .fillColor('#111827')
          .text(tenant.name, 48, top, { width: 260 });
      }
    } else {
      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor('#111827')
        .text(tenant.name, 48, top, { width: 260 });
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(19)
      .fillColor('#111827')
      .text(tenant.invoiceDocLabel || 'Factura', 340, top, {
        width: 207,
        align: 'right',
      })
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#4b5563')
      .text(invoice.number, 340, top + 27, { width: 207, align: 'right' })
      .text(`Emisión: ${invoice.issueDate}`, 340, top + 42, {
        width: 207,
        align: 'right',
      })
      .text(`Vence: ${invoice.dueDate || '—'}`, 340, top + 57, {
        width: 207,
        align: 'right',
      });

    doc.y = top + 88;
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#d1d5db').stroke();
    doc.moveDown(1.3);
  }

  private drawParties(
    doc: PDFKit.PDFDocument,
    input: {
      tenant: Tenant;
      clientName: string;
      clientEmail: string;
      clientPhone: string;
      clientAddress: string;
    },
  ) {
    const y = doc.y;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#6b7280')
      .text('EMISOR', 48, y, { width: 225 })
      .text('CLIENTE', 322, y, { width: 225 });

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text(input.tenant.legalName || input.tenant.name, 48, y + 17, {
        width: 225,
      })
      .text(input.clientName, 322, y + 17, { width: 225 });

    const company = [
      input.tenant.taxId,
      input.tenant.address,
      [input.tenant.city, input.tenant.country].filter(Boolean).join(', '),
      input.tenant.email,
      input.tenant.phone,
    ]
      .filter(Boolean)
      .join('\n');
    const client = [input.clientAddress, input.clientEmail, input.clientPhone]
      .filter(Boolean)
      .join('\n');
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#4b5563')
      .text(company, 48, y + 34, { width: 225, lineGap: 2 })
      .text(client, 322, y + 34, { width: 225, lineGap: 2 });

    doc.y = Math.max(doc.y, y + 100);
  }

  private drawItems(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    money: (value: string | number) => string,
  ) {
    const x = 48;
    const widths = [253, 65, 90, 91];
    let y = doc.y;
    doc.rect(x, y, 499, 25).fill('#111827');
    const headers = ['Descripción', 'Cant.', 'Precio', 'Importe'];
    let colX = x;
    headers.forEach((header, index) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor('#ffffff')
        .text(header, colX + 7, y + 8, {
          width: widths[index] - 14,
          align: index === 0 ? 'left' : 'right',
        });
      colX += widths[index];
    });
    y += 25;

    const items = (invoice.items ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (const item of items) {
      if (y > 690) {
        doc.addPage();
        y = 48;
      }
      const rowHeight = Math.max(
        29,
        doc.heightOfString(item.description, { width: widths[0] - 14 }) + 14,
      );
      doc.rect(x, y, 499, rowHeight).fill('#f9fafb');
      colX = x;
      const cells = [
        item.description,
        Number(item.quantity).toLocaleString('es'),
        money(item.unitPrice),
        money(item.amount),
      ];
      cells.forEach((cell, index) => {
        doc
          .font(index === 3 ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8.5)
          .fillColor(index === 0 ? '#374151' : '#111827')
          .text(cell, colX + 7, y + 9, {
            width: widths[index] - 14,
            align: index === 0 ? 'left' : 'right',
          });
        colX += widths[index];
      });
      doc
        .moveTo(x, y + rowHeight)
        .lineTo(x + 499, y + rowHeight)
        .strokeColor('#e5e7eb')
        .stroke();
      y += rowHeight;
    }
    doc.y = y + 12;
  }

  private drawTotals(
    doc: PDFKit.PDFDocument,
    invoice: Invoice,
    money: (value: string | number) => string,
  ) {
    const x = 350;
    const y = doc.y;
    const rows = [
      ['Subtotal', money(invoice.subtotal)],
      ['Impuestos', money(invoice.tax)],
      ['Total', money(invoice.total)],
    ];
    rows.forEach(([label, value], index) => {
      doc
        .font(index === 2 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(index === 2 ? 12 : 9)
        .fillColor('#111827')
        .text(label, x, y + index * 22, { width: 75 })
        .text(value, x + 75, y + index * 22, {
          width: 122,
          align: 'right',
        });
    });
    doc.y = y + 80;
  }

  private drawFooter(
    doc: PDFKit.PDFDocument,
    tenant: Tenant,
    invoice: Invoice,
  ) {
    if (invoice.notes?.trim()) {
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#374151')
        .text('Notas')
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#6b7280')
        .text(invoice.notes.trim(), { lineGap: 2 });
      doc.moveDown(1);
    }
    if (tenant.invoiceFooter?.trim()) {
      doc
        .moveTo(48, doc.y)
        .lineTo(547, doc.y)
        .strokeColor('#e5e7eb')
        .stroke()
        .moveDown(0.8)
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#9ca3af')
        .text(tenant.invoiceFooter.trim(), { align: 'center', lineGap: 2 });
    }
  }

  private logoBuffer(value: string | null | undefined): Buffer | null {
    if (!value?.startsWith('data:image/')) return null;
    const match = value.match(/^data:image\/(?:png|jpeg|jpg);base64,(.+)$/i);
    if (!match) return null;
    try {
      return Buffer.from(match[1], 'base64');
    } catch {
      return null;
    }
  }
}

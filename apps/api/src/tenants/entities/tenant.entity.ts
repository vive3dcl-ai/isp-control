import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TenantStatus = 'active' | 'inactive' | 'suspended';

@Entity({ name: 'tenants', schema: 'public' })
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Nombre comercial */
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** Razón social */
  @Column({ name: 'legal_name', type: 'varchar', length: 180, default: '' })
  legalName: string;

  @Column({ type: 'varchar', length: 40, default: '' })
  phone: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  email: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  address: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  city: string;

  @Column({ type: 'varchar', length: 80, default: '' })
  country: string;

  /** RUT / NIT / tax ID */
  @Column({ name: 'tax_id', type: 'varchar', length: 40, default: '' })
  taxId: string;

  @Column({
    name: 'legal_representative',
    type: 'varchar',
    length: 180,
    default: '',
  })
  legalRepresentative: string;

  /** ISO 4217 currency code */
  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  /** Company logo for invoices (data URL or absolute URL). */
  @Column({ name: 'logo_url', type: 'text', default: '' })
  logoUrl: string;

  /** Footer / legal disclaimers printed at the bottom of invoices. */
  @Column({ name: 'invoice_footer', type: 'text', default: '' })
  invoiceFooter: string;

  /** Term used on documents: "Factura" or "Boleta". */
  @Column({
    name: 'invoice_doc_label',
    type: 'varchar',
    length: 20,
    default: 'Factura',
  })
  invoiceDocLabel: string;

  /**
   * Si true, suspender servicio usa portal cautivo (MikroTik address-list).
   * Si false (default), se hace Disable de la ONU en la OLT.
   */
  @Column({
    name: 'suspension_portal_enabled',
    type: 'boolean',
    default: false,
  })
  suspensionPortalEnabled: boolean;

  /**
   * MikroTik(s) donde están instaladas las reglas del portal de suspensión.
   * Vacío = comportamiento previo (todos los routers elegibles).
   */
  @Column({
    name: 'suspension_portal_router_ids',
    type: 'jsonb',
    default: () => `'[]'`,
  })
  suspensionPortalRouterIds: string[];

  /** Plantilla HTML del portal cautivo (id de catálogo built-in). */
  @Column({
    name: 'suspension_portal_template_id',
    type: 'varchar',
    length: 40,
    default: 'midnight',
  })
  suspensionPortalTemplateId: string;

  /**
   * Logo del portal cautivo (data URL o http(s)).
   * Vacío = se usa el logo de la empresa.
   */
  @Column({
    name: 'suspension_portal_logo_url',
    type: 'text',
    default: '',
  })
  suspensionPortalLogoUrl: string;

  /** internal = plantillas ISP Control · external = URL propia */
  @Column({
    name: 'suspension_portal_mode',
    type: 'varchar',
    length: 20,
    default: 'internal',
  })
  suspensionPortalMode: 'internal' | 'external';

  /** URL del portal externo (solo si mode=external). */
  @Column({
    name: 'suspension_portal_external_url',
    type: 'varchar',
    length: 500,
    default: '',
  })
  suspensionPortalExternalUrl: string;

  /** Última URL aplicada a reglas MikroTik (para detectar reconfiguración). */
  @Column({
    name: 'suspension_portal_applied_url',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  suspensionPortalAppliedUrl: string | null;

  @Column({ type: 'varchar', length: 60, unique: true })
  slug: string;

  @Column({ name: 'schema_name', type: 'varchar', length: 80, unique: true })
  schemaName: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: TenantStatus;

  /**
   * IDs de módulos habilitados para este tenant.
   * Los alwaysEnabled (p. ej. smtp) se fuerzan al normalizar.
   */
  @Column({
    name: 'enabled_modules',
    type: 'jsonb',
    default: () => `'["smtp"]'`,
  })
  enabledModules: string[];

  /**
   * Ciclo de facturación prepago de la plataforma.
   * monthly | quarterly | semiannual | annual | null si aún no eligió.
   */
  @Column({
    name: 'billing_cycle',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  billingCycle: string | null;

  @Column({
    name: 'subscription_status',
    type: 'varchar',
    length: 20,
    default: 'none',
  })
  subscriptionStatus: string;

  @Column({
    name: 'subscription_period_start',
    type: 'timestamptz',
    nullable: true,
  })
  subscriptionPeriodStart: Date | null;

  @Column({
    name: 'subscription_period_end',
    type: 'timestamptz',
    nullable: true,
  })
  subscriptionPeriodEnd: Date | null;

  /** Precio USD pagado por el ciclo actual (para crédito al cambiar plan). */
  @Column({
    name: 'subscription_period_price_usd',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  subscriptionPeriodPriceUsd: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

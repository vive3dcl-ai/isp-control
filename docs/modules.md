# Sistema de módulos

Los módulos son capacidades de plataforma. Se habilitan por empresa desde Admin y se configuran en Ajustes → Empresa → Integraciones.

## Arquitectura

```
┌─────────────────────┐     enabled_modules[]      ┌──────────────────────┐
│  MODULE_CATALOG     │◄───────────────────────────│  public.tenants      │
│  (código)           │                            │  entitlements        │
└─────────┬───────────┘                            └──────────────────────┘
          │
          │  module_id (tenant)
          ▼
┌─────────────────────┐                            ┌──────────────────────┐
│  Integraciones UI   │◄── config JSON ────────────│  tenant_*.module_    │
│                     │                            │  configs             │
└─────────────────────┘                            └──────────────────────┘

┌─────────────────────┐                            ┌──────────────────────┐
│  Admin → Métodos    │◄── config JSON ────────────│  public.platform_    │
│  de pago            │                            │  payment_methods     │
└─────────────────────┘                            └──────────────────────┘
```

| Capa | Dónde | Responsabilidad |
|------|--------|-----------------|
| Catálogo | `module-catalog.ts` | Definición estática (+ precio de add-ons) |
| Entitlements | `tenants.enabled_modules` | Qué módulos puede usar la empresa |
| Config tenant | `{schema}.module_configs` | Ajustes del ISP (SMTP, MP de clientes) |
| Pagos plataforma | `platform_payment_methods` | Cobro de suscripciones ISP Control |

## Separación de pagos (obligatoria)

| Contexto | Quién cobra | Almacenamiento | UI |
|----------|-------------|----------------|-----|
| **Plataforma** | ISP Control → empresas | `public.platform_payment_methods` | Admin → Métodos de pago |
| **Tenant** | ISP → clientes finales | `{schema}.module_configs` (`mercadopago`) | Facturación → Métodos de pago / Integraciones |

**Nunca** se reutilizan access tokens ni public keys entre plataforma y un tenant.
Cada uno configura sandbox/producción y Checkout Pro con su propia aplicación Mercado Pago.

El **precio del módulo** (lo que la plataforma cobra al ISP por el add-on) es
independiente de las credenciales y se edita en Empresas → Módulos.

## Módulos actuales

### SMTP (`smtp`)

- Obligatorio (`alwaysEnabled`).
- Sin precio.
- Config: host, port, secure, username, password, fromEmail, fromName.

### Mercado Pago (`mercadopago`)

- Opcional, de pago (`billable: true`).
- **Checkout Pro multi-país** (`availableCountries`: AR, BR, CL, CO, MX, PE,
  UY). Se activa solo si `tenants.country` está en esa lista.
- Sandbox/producción: credenciales de la cuenta Mercado Pago del **país del
  tenant** (portal Developers de ese país).
- Precio del módulo en **USD** (editable); referencia CLP con dólar observado
  ([mindicador.cl](https://mindicador.cl)) para cobros de plataforma en Chile,
  cacheado en `platform_fx_rates`.
- Integración tenant: **Checkout Pro** (credenciales propias).
- Plataforma: cuenta Mercado Pago independiente en Admin → Métodos de pago.

```json
{
  "environment": "sandbox" | "production",
  "integration": "checkout_pro",
  "publicKey": "TEST-… / APP_USR-…",
  "accessToken": "***",
  "webhookSecret": "***"
}
```

Secretos no se exponen; se usan `hasAccessToken` / `hasWebhookSecret`.

### Mapa de red (`mapa_red`)

- Opcional, de pago (`billable: true`, precio por defecto USD 24.90).
- Sin restricción de país (`availableCountries: null`).
- Sin configuración (`hasConfig: false`): al contratar se habilita el menú
  **Mapa de red** (`/app/network-map`) con mapa OpenStreetMap.
- Si no está contratado, la página muestra un mensaje comercial con CTA a
  Integraciones.

### WhatsApp (`whatsapp`)

- Opcional, de pago (`billable: true`, precio por defecto USD 19.90).
- Sin restricción de país.
- Proveedores: **Cloud API** (oficial Meta) o **Baileys** (QR, no oficial).
- Cupo de plataforma: **30 sesiones Baileys** concurrentes. Cloud API **no**
  resta cupo.
- Config en `{schema}.module_configs` (`whatsapp`).
- Sidecar Compose `whatsapp-baileys` (1 contenedor, N sesiones por tenant).
- Si Baileys se desconecta o pide QR: modal en la app + correo al admin del
  tenant (SMTP de la empresa).
- Al enviar una factura, el correo siempre incluye el PDF. Si WhatsApp está
  habilitado y configurado, también se manda el mismo PDF al teléfono del
  cliente; un fallo de WhatsApp no bloquea el correo.
- Cloud API usa una plantilla Meta aprobada con encabezado `DOCUMENT`
  (`templateName` / `templateLanguage`) para funcionar fuera de la ventana de
  atención de 24 horas.

```json
{
  "provider": "cloud_api" | "baileys",
  "phoneNumberId": "…",
  "businessAccountId": "…",
  "accessToken": "***",
  "webhookVerifyToken": "…",
  "baileysStatus": "disconnected" | "qr" | "connected" | "connecting"
}
```

## Admin

- Menú → **Módulos**: precios globales de add-ons (sin SMTP). En WhatsApp se
  muestra el cupo Baileys usado/máximo.
- Menú → **Ajustes**: SMTP de plataforma + **Valor del sistema** (mensual /
  trimestral / semestral / anual).
- Empresas → Acciones → **Módulos**: activar/desactivar por empresa.
- Menú → **Métodos de pago** (credenciales de la plataforma).

## Tenant

- Ajustes → Empresa → **Suscripción**: plan prepago; al cambiar se cobra la
  diferencia (crédito del período residual).
- **15 días** antes del vencimiento se genera cobro `pending` (historial +
  botón **Pagar**).
- **5 y 2 días** antes: correo al admin del tenant (`tenants.email`) vía SMTP
  de plataforma.
- Ajustes → Empresa → **Integraciones**: todos los módulos; **Contratar**
  (pago único 1 mes independiente, o agregar al plan con prorrateo al
  fin del ciclo de suscripción).
  - Si **Admin** habilita el módulo → badge **Incluido** (sin cargo / no
    facturable al tenant).
  - Si el **tenant** lo compra → badge **Comprado** (contrato activo).
- Pago único de módulo: aviso al admin del tenant 5 y 2 días antes.

## Agregar un módulo

1. Entrada en `MODULE_CATALOG` + `ModuleId`.
2. Si requiere config: DTO, service, endpoint, tarjeta + modal.
3. Si es de pago: `billable: true` + `priceMonthly` / `priceCurrency`.
4. Actualizar este doc y `.cursor/rules/modules.mdc`.

## Archivos clave

- API: `apps/api/src/modules/`, `apps/api/src/platform/`
- Web: `lib/modules.ts`, `lib/platform.ts`, `AdminSettingsPage`, `AdminModulesPage`,
  `SuscripcionSettingsPanel`, `ContractModuleModal`, `IntegracionesSettingsPanel`
- Public: `platform_smtp_settings`, `platform_system_plans`,
  `platform_module_contracts`, `platform_charges`, `platform_payment_methods`

/** Currencies available for tenant billing / display. */
export const COMPANY_CURRENCIES = [
  { code: 'USD', label: 'Dólar estadounidense (USD)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'ARS', label: 'Peso argentino (ARS)' },
  { code: 'BOB', label: 'Boliviano (BOB)' },
  { code: 'BRL', label: 'Real brasileño (BRL)' },
  { code: 'CLP', label: 'Peso chileno (CLP)' },
  { code: 'COP', label: 'Peso colombiano (COP)' },
  { code: 'CRC', label: 'Colón costarricense (CRC)' },
  { code: 'CUP', label: 'Peso cubano (CUP)' },
  { code: 'DOP', label: 'Peso dominicano (DOP)' },
  { code: 'GTQ', label: 'Quetzal guatemalteco (GTQ)' },
  { code: 'HNL', label: 'Lempira hondureño (HNL)' },
  { code: 'MXN', label: 'Peso mexicano (MXN)' },
  { code: 'NIO', label: 'Córdoba nicaragüense (NIO)' },
  { code: 'PAB', label: 'Balboa panameño (PAB)' },
  { code: 'PEN', label: 'Sol peruano (PEN)' },
  { code: 'PYG', label: 'Guaraní paraguayo (PYG)' },
  { code: 'UYU', label: 'Peso uruguayo (UYU)' },
  { code: 'VES', label: 'Bolívar venezolano (VES)' },
] as const;

export type CompanyCurrencyCode = (typeof COMPANY_CURRENCIES)[number]['code'];

export const COMPANY_CURRENCY_CODES = COMPANY_CURRENCIES.map(
  (c) => c.code,
) as CompanyCurrencyCode[];

/**
 * Países disponibles en Ajustes → Empresa.
 * Derivados de las monedas soportadas + España, EE.UU. y Canadá.
 */
export const COMPANY_COUNTRIES = [
  { code: 'AR', label: 'Argentina' },
  { code: 'BO', label: 'Bolivia' },
  { code: 'BR', label: 'Brasil' },
  { code: 'CA', label: 'Canadá' },
  { code: 'CL', label: 'Chile' },
  { code: 'CO', label: 'Colombia' },
  { code: 'CR', label: 'Costa Rica' },
  { code: 'CU', label: 'Cuba' },
  { code: 'DO', label: 'República Dominicana' },
  { code: 'ES', label: 'España' },
  { code: 'GT', label: 'Guatemala' },
  { code: 'HN', label: 'Honduras' },
  { code: 'MX', label: 'México' },
  { code: 'NI', label: 'Nicaragua' },
  { code: 'PA', label: 'Panamá' },
  { code: 'PE', label: 'Perú' },
  { code: 'PY', label: 'Paraguay' },
  { code: 'US', label: 'Estados Unidos' },
  { code: 'UY', label: 'Uruguay' },
  { code: 'VE', label: 'Venezuela' },
] as const;

export type CompanyCountryCode = (typeof COMPANY_COUNTRIES)[number]['code'];

export const COMPANY_COUNTRY_CODES = COMPANY_COUNTRIES.map(
  (c) => c.code,
) as CompanyCountryCode[];

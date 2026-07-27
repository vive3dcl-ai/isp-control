/**
 * Tipos de documento de identidad / fiscales por país (país del tenant).
 * `personal`: opciones para personas (la primera es la sugerida).
 * `company`: documento fiscal para clientes empresa y para los datos del tenant.
 */

export type DocumentTypeDef = {
  id: string
  label: string
  placeholder: string
}

type CountryDocuments = {
  personal: DocumentTypeDef[]
  company: DocumentTypeDef
}

const FALLBACK: CountryDocuments = {
  personal: [
    { id: 'DOC', label: 'Documento de identidad', placeholder: 'Número de documento' },
  ],
  company: { id: 'TAX', label: 'ID fiscal', placeholder: 'Número fiscal' },
}

const DOCUMENTS_BY_COUNTRY: Record<string, CountryDocuments> = {
  AR: {
    personal: [
      { id: 'DNI', label: 'DNI', placeholder: '12.345.678' },
      { id: 'CUIT', label: 'CUIT', placeholder: '20-12345678-3' },
    ],
    company: { id: 'CUIT', label: 'CUIT', placeholder: '30-12345678-9' },
  },
  BO: {
    personal: [{ id: 'CI', label: 'CI', placeholder: '1234567 LP' }],
    company: { id: 'NIT', label: 'NIT', placeholder: '1234567013' },
  },
  BR: {
    personal: [{ id: 'CPF', label: 'CPF', placeholder: '123.456.789-09' }],
    company: { id: 'CNPJ', label: 'CNPJ', placeholder: '12.345.678/0001-95' },
  },
  CA: {
    personal: [{ id: 'ID', label: 'ID', placeholder: 'Número de identificación' }],
    company: { id: 'BN', label: 'Business Number (BN)', placeholder: '123456789' },
  },
  CL: {
    personal: [{ id: 'RUT', label: 'RUT', placeholder: '12.345.678-5' }],
    company: { id: 'RUT', label: 'RUT empresa', placeholder: '76.123.456-7' },
  },
  CO: {
    personal: [
      { id: 'CC', label: 'Cédula de ciudadanía', placeholder: '1.234.567.890' },
      { id: 'CE', label: 'Cédula de extranjería', placeholder: '123456' },
    ],
    company: { id: 'NIT', label: 'NIT', placeholder: '900.123.456-7' },
  },
  CR: {
    personal: [{ id: 'CI', label: 'Cédula', placeholder: '1-1234-5678' }],
    company: { id: 'CJ', label: 'Cédula jurídica', placeholder: '3-101-123456' },
  },
  CU: {
    personal: [{ id: 'CI', label: 'Carné de identidad', placeholder: '85010112345' }],
    company: { id: 'NIT', label: 'NIT', placeholder: 'Número fiscal' },
  },
  DO: {
    personal: [{ id: 'CEDULA', label: 'Cédula', placeholder: '001-1234567-8' }],
    company: { id: 'RNC', label: 'RNC', placeholder: '1-01-12345-6' },
  },
  ES: {
    personal: [
      { id: 'DNI', label: 'DNI', placeholder: '12345678Z' },
      { id: 'NIE', label: 'NIE', placeholder: 'X1234567L' },
    ],
    company: { id: 'NIF', label: 'NIF / CIF', placeholder: 'B12345678' },
  },
  GT: {
    personal: [{ id: 'DPI', label: 'DPI', placeholder: '1234 56789 0101' }],
    company: { id: 'NIT', label: 'NIT', placeholder: '1234567-8' },
  },
  HN: {
    personal: [{ id: 'DNI', label: 'DNI', placeholder: '0801-1990-12345' }],
    company: { id: 'RTN', label: 'RTN', placeholder: '08011990123456' },
  },
  MX: {
    personal: [
      { id: 'CURP', label: 'CURP', placeholder: 'GOMC900101HDFRRL09' },
      { id: 'RFC', label: 'RFC', placeholder: 'GOMC900101AB1' },
    ],
    company: { id: 'RFC', label: 'RFC', placeholder: 'ABC680524P76' },
  },
  NI: {
    personal: [{ id: 'CEDULA', label: 'Cédula', placeholder: '001-010190-0001A' }],
    company: { id: 'RUC', label: 'RUC', placeholder: 'J0310000000000' },
  },
  PA: {
    personal: [{ id: 'CEDULA', label: 'Cédula', placeholder: '8-123-4567' }],
    company: { id: 'RUC', label: 'RUC', placeholder: '12345678-1-123456' },
  },
  PE: {
    personal: [{ id: 'DNI', label: 'DNI', placeholder: '12345678' }],
    company: { id: 'RUC', label: 'RUC', placeholder: '20123456789' },
  },
  PY: {
    personal: [{ id: 'CI', label: 'CI', placeholder: '1.234.567' }],
    company: { id: 'RUC', label: 'RUC', placeholder: '80012345-6' },
  },
  US: {
    personal: [{ id: 'ID', label: 'ID', placeholder: 'Driver license / State ID' }],
    company: { id: 'EIN', label: 'EIN', placeholder: '12-3456789' },
  },
  UY: {
    personal: [{ id: 'CI', label: 'CI', placeholder: '1.234.567-8' }],
    company: { id: 'RUT', label: 'RUT', placeholder: '211234560012' },
  },
  VE: {
    personal: [{ id: 'CI', label: 'CI', placeholder: 'V-12.345.678' }],
    company: { id: 'RIF', label: 'RIF', placeholder: 'J-12345678-9' },
  },
}

export function personalDocumentTypes(country: string): DocumentTypeDef[] {
  return DOCUMENTS_BY_COUNTRY[country.toUpperCase()]?.personal ?? FALLBACK.personal
}

export function companyDocumentType(country: string): DocumentTypeDef {
  return DOCUMENTS_BY_COUNTRY[country.toUpperCase()]?.company ?? FALLBACK.company
}

/**
 * Formateo suave al salir del campo (no bloquea el tipeo).
 * Solo países con formato bien establecido; el resto se limpia/upper-case.
 */
export function formatDocument(
  country: string,
  typeId: string,
  raw: string,
): string {
  const value = raw.trim().toUpperCase()
  if (!value) return ''
  const c = country.toUpperCase()

  if (c === 'CL' && typeId === 'RUT') {
    const clean = value.replace(/[^0-9K]/g, '')
    if (clean.length < 2) return value
    const body = clean.slice(0, -1)
    const dv = clean.slice(-1)
    const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return `${grouped}-${dv}`
  }

  if (c === 'AR' && typeId === 'CUIT') {
    const digits = value.replace(/\D/g, '')
    if (digits.length !== 11) return value
    return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
  }

  if (c === 'BR' && typeId === 'CPF') {
    const digits = value.replace(/\D/g, '')
    if (digits.length !== 11) return value
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
  }

  if (c === 'BR' && typeId === 'CNPJ') {
    const digits = value.replace(/\D/g, '')
    if (digits.length !== 14) return value
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
  }

  return value
}

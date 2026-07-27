type TimezoneOption = {
  value: string
  label: string
}

const TIMEZONES_BY_COUNTRY: Record<string, string[]> = {
  AR: [
    'America/Argentina/Buenos_Aires',
    'America/Argentina/Catamarca',
    'America/Argentina/Cordoba',
    'America/Argentina/Jujuy',
    'America/Argentina/La_Rioja',
    'America/Argentina/Mendoza',
    'America/Argentina/Rio_Gallegos',
    'America/Argentina/Salta',
    'America/Argentina/San_Juan',
    'America/Argentina/San_Luis',
    'America/Argentina/Tucuman',
    'America/Argentina/Ushuaia',
  ],
  BO: ['America/La_Paz'],
  BR: [
    'America/Sao_Paulo',
    'America/Manaus',
    'America/Belem',
    'America/Fortaleza',
    'America/Recife',
    'America/Bahia',
    'America/Cuiaba',
    'America/Campo_Grande',
    'America/Porto_Velho',
    'America/Boa_Vista',
    'America/Rio_Branco',
    'America/Eirunepe',
    'America/Maceio',
    'America/Santarem',
    'America/Araguaina',
    'America/Noronha',
  ],
  CA: [
    'America/Vancouver',
    'America/Edmonton',
    'America/Regina',
    'America/Winnipeg',
    'America/Toronto',
    'America/Halifax',
    'America/St_Johns',
    'America/Whitehorse',
    'America/Iqaluit',
  ],
  CL: ['America/Santiago', 'America/Punta_Arenas', 'Pacific/Easter'],
  CO: ['America/Bogota'],
  CR: ['America/Costa_Rica'],
  CU: ['America/Havana'],
  DO: ['America/Santo_Domingo'],
  ES: ['Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta'],
  GT: ['America/Guatemala'],
  HN: ['America/Tegucigalpa'],
  MX: [
    'America/Mexico_City',
    'America/Cancun',
    'America/Merida',
    'America/Monterrey',
    'America/Matamoros',
    'America/Chihuahua',
    'America/Ojinaga',
    'America/Mazatlan',
    'America/Hermosillo',
    'America/Tijuana',
    'America/Bahia_Banderas',
  ],
  NI: ['America/Managua'],
  PA: ['America/Panama'],
  PE: ['America/Lima'],
  PY: ['America/Asuncion'],
  US: [
    'America/New_York',
    'America/Detroit',
    'America/Chicago',
    'America/Denver',
    'America/Phoenix',
    'America/Los_Angeles',
    'America/Anchorage',
    'America/Adak',
    'Pacific/Honolulu',
  ],
  UY: ['America/Montevideo'],
  VE: ['America/Caracas'],
}

function isSupportedTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('es', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}

function timezoneLabel(timezone: string): string {
  const city = timezone.split('/').at(-1)?.replaceAll('_', ' ') ?? timezone
  try {
    const parts = new Intl.DateTimeFormat('es', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    }).formatToParts(new Date())
    const offset =
      parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
    return offset ? `${city} · ${offset}` : city
  } catch {
    return city
  }
}

export function billingTimezonesForCountry(
  country: string | null | undefined,
): TimezoneOption[] {
  const code = country?.trim().toUpperCase() ?? ''
  return (TIMEZONES_BY_COUNTRY[code] ?? [])
    .filter(isSupportedTimezone)
    .map((value) => ({ value, label: timezoneLabel(value) }))
}

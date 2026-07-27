export type SpeedProfileOltStatus = {
  id: string
  name: string
  present: boolean | null
  error: string | null
  needsSync: boolean
}

export type SpeedProfile = {
  id: string
  name: string
  /** Nombre con que se crea en las OLT (prefijo TLG-, sufijos -UP/-DOWN) */
  oltProfileName?: string
  downloadMbps: number
  uploadMbps: number
  description: string
  isActive: boolean
  oltIds: string[]
  olts?: SpeedProfileOltStatus[]
  createdAt: string
  updatedAt: string
  syncMessage?: string
}

export type AiCapabilityKind = 'tool' | 'skill'

export type AiCapability = {
  id: string
  kind: AiCapabilityKind
  slug: string
  name: string
  description: string
  parametersSchema: Record<string, unknown> | null
  code: string
  enabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type AiAgentCapabilities = {
  tools: Array<{
    id: string
    slug: string
    name: string
    description: string
    parametersSchema: Record<string, unknown> | null
    code: string
  }>
  skills: Array<{
    id: string
    slug: string
    name: string
    description: string
    code: string
  }>
}

export type TenantStatus = 'active' | 'inactive' | 'suspended'

export interface Tenant {
  id: string
  name: string
  legalName: string
  phone: string
  address: string
  country?: string
  slug: string
  schemaName: string
  status: TenantStatus
  createdAt: string
  updatedAt: string
}

export interface TenantDirectoryUser {
  id: string
  email: string
  tenantId: string
  role: string
  createdAt: string
}

export interface TenantDetail extends Tenant {
  users: TenantDirectoryUser[]
}

export interface CreateTenantInput {
  name: string
  legalName: string
  phone: string
  address: string
  slug?: string
  ownerName: string
  ownerEmail: string
  ownerPassword: string
}

export interface UpdateTenantInput {
  name?: string
  legalName?: string
  phone?: string
  address?: string
  status?: TenantStatus
}

export interface CreateTenantResponse {
  tenant: Tenant
  owner: {
    id: string
    email: string
    name: string
    role: string
  }
}

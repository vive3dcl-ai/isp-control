export type SupportTicketCategory =
  | 'billing'
  | 'technical'
  | 'account'
  | 'other'

export type SupportTicketStatus =
  | 'open'
  | 'awaiting_tenant'
  | 'awaiting_admin'
  | 'resolved'
  | 'closed'

export type SupportTicketPriority = 'low' | 'normal' | 'high'

export type SupportTicket = {
  id: string
  tenantId: string
  tenantName?: string
  subject: string
  category: SupportTicketCategory
  status: SupportTicketStatus
  priority: SupportTicketPriority
  lastMessageAt: string
  tenantUnread: boolean
  adminUnread: boolean
  createdAt: string
  updatedAt: string
}

export type SupportMessage = {
  id: string
  ticketId: string
  authorRole: 'tenant' | 'admin'
  authorUserId: string
  authorName: string
  body: string
  createdAt: string
}

export type SupportTicketDetail = SupportTicket & {
  messages: SupportMessage[]
}

export const CATEGORY_LABEL: Record<SupportTicketCategory, string> = {
  billing: 'Facturación',
  technical: 'Técnico',
  account: 'Cuenta',
  other: 'Otro',
}

export const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: 'Abierto',
  awaiting_tenant: 'Espera empresa',
  awaiting_admin: 'Espera soporte',
  resolved: 'Resuelto',
  closed: 'Cerrado',
}

export const PRIORITY_LABEL: Record<SupportTicketPriority, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
}

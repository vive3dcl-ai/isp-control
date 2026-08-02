export type InventoryItemType = 'onu' | 'deco'

export type InventoryItem = {
  id: string
  type: InventoryItemType
  brand: string
  model: string
  quantity: number
  notes: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export function inventoryLabel(item: Pick<InventoryItem, 'brand' | 'model' | 'quantity'>) {
  return `${item.brand} ${item.model} (${item.quantity})`
}

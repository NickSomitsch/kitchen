export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Unit = 'g' | 'kg' | 'ml' | 'l' | 'piece' | 'package'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: { id: string; display_name: string; created_at?: string; updated_at?: string }
        Update: { display_name?: string; updated_at?: string }
        Relationships: []
      }
      households: {
        Row: Household
        Insert: {
          id?: string
          name: string
          join_code: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: { name?: string; join_code?: string; updated_at?: string }
        Relationships: []
      }
      household_members: {
        Row: HouseholdMemberRow
        Insert: { household_id: string; user_id: string; joined_at?: string }
        Update: never
        Relationships: []
      }
      categories: {
        Row: Category
        Insert: { id?: string; household_id: string; name: string }
        Update: { name?: string }
        Relationships: []
      }
      locations: {
        Row: StorageLocation
        Insert: { id?: string; household_id: string; name: string }
        Update: { name?: string }
        Relationships: []
      }
      inventory_items: {
        Row: InventoryItemRow
        Insert: {
          id?: string
          household_id: string
          name: string
          quantity: number
          unit: Unit
          category_id?: string | null
          location_id?: string | null
          notes?: string | null
          low_stock_threshold?: number | null
          created_by: string
        }
        Update: {
          name?: string
          quantity?: number
          unit?: Unit
          category_id?: string | null
          location_id?: string | null
          notes?: string | null
          low_stock_threshold?: number | null
        }
        Relationships: []
      }
      grocery_items: {
        Row: GroceryItemRow
        Insert: never
        Update: never
        Relationships: []
      }
      mutation_receipts: {
        Row: {
          household_id: string
          user_id: string
          operation_id: string
          command_type: string
          request: Json
          result: Json
          completed_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      current_household_id: { Args: Record<string, never>; Returns: string | null }
      create_household: {
        Args: { household_name: string }
        Returns: { household_id: string; join_code: string }[]
      }
      join_household: {
        Args: { code: string }
        Returns: { household_id: string }[]
      }
      rotate_household_join_code: {
        Args: Record<string, never>
        Returns: { join_code: string }[]
      }
      remove_household_member: {
        Args: { member_user_id: string }
        Returns: undefined
      }
      leave_household: { Args: Record<string, never>; Returns: undefined }
      delete_household: {
        Args: { confirmation_name: string }
        Returns: undefined
      }
      create_grocery_item: {
        Args: {
          linked_inventory_item_id?: string | null
          item_name?: string | null
          item_quantity?: number | null
          item_unit?: Unit | null
          item_category_id?: string | null
          item_notes?: string | null
        }
        Returns: { grocery_item_id: string; created: boolean }[]
      }
      update_grocery_item: {
        Args: {
          grocery_id: string
          expected_version: number
          linked_inventory_item_id?: string | null
          item_name?: string | null
          item_quantity?: number | null
          item_unit?: Unit | null
          item_category_id?: string | null
          item_notes?: string | null
        }
        Returns: undefined
      }
      delete_grocery_item: {
        Args: { grocery_id: string; expected_version: number }
        Returns: undefined
      }
      complete_grocery_item: {
        Args: {
          grocery_id: string
          expected_version: number
          stock_action: StockAction
          purchased_quantity?: number | null
          purchased_unit?: Unit | null
          target_inventory_item_id?: string | null
          new_location_id?: string | null
        }
        Returns: {
          completed_grocery_item_id: string
          stocked_inventory_item_id: string | null
        }[]
      }
      repeat_grocery_item: {
        Args: { grocery_id: string }
        Returns: { grocery_item_id: string; created: boolean }[]
      }
      clear_grocery_history: { Args: Record<string, never>; Returns: number }
      apply_kitchen_command: {
        Args: { operation_id: string; command_type: string; request: Json }
        Returns: Json
      }
      apply_kitchen_command_v2: {
        Args: { operation_id: string; command_type: string; request: Json }
        Returns: Json
      }
      shares_household: { Args: { other_user_id: string }; Returns: boolean }
    }
    Enums: {
      inventory_unit: Unit
      grocery_item_source: GroceryItemSource
      grocery_item_status: GroceryItemStatus
    }
    CompositeTypes: Record<string, never>
  }
}

export interface Profile {
  id: string
  display_name: string
  created_at: string
  updated_at: string
}

export interface Household {
  id: string
  name: string
  join_code: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface HouseholdMemberRow {
  household_id: string
  user_id: string
  joined_at: string
}

export interface HouseholdMember extends HouseholdMemberRow {
  profile: Pick<Profile, 'id' | 'display_name'> | null
}

export interface Category {
  id: string
  household_id: string
  name: string
  created_at: string
  updated_at: string
}

export interface StorageLocation {
  id: string
  household_id: string
  name: string
  created_at: string
  updated_at: string
}

export interface InventoryItemRow {
  id: string
  household_id: string
  name: string
  quantity: number
  unit: Unit
  category_id: string | null
  location_id: string | null
  notes: string | null
  low_stock_threshold: number | null
  created_by: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface InventoryItem extends InventoryItemRow {
  category: Pick<Category, 'id' | 'name'> | null
  location: Pick<StorageLocation, 'id' | 'name'> | null
  local_sync_status?: LocalSyncStatus
}

export type GroceryItemSource = 'manual' | 'low_stock'
export type GroceryItemStatus = 'active' | 'purchased'
export type StockAction = 'none' | 'existing' | 'new'

export interface GroceryItemRow {
  id: string
  household_id: string
  inventory_item_id: string | null
  name: string
  quantity: number | null
  unit: Unit | null
  category_id: string | null
  notes: string | null
  source: GroceryItemSource
  status: GroceryItemStatus
  stocked: boolean
  created_by: string | null
  completed_by: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface GroceryItem extends GroceryItemRow {
  category: Pick<Category, 'id' | 'name'> | null
  inventory_item: Pick<InventoryItemRow, 'id' | 'name' | 'quantity' | 'unit' | 'low_stock_threshold'> | null
  local_sync_status?: LocalSyncStatus
}

export interface GroceryItemInput {
  inventory_item_id: string | null
  name: string
  quantity: number | null
  unit: Unit | null
  category_id: string | null
  notes: string | null
}

export interface PurchaseInput {
  stock_action: StockAction
  quantity: number | null
  unit: Unit | null
  target_inventory_item_id: string | null
  new_location_id: string | null
}

export type StockFilter = 'all' | 'in-stock' | 'out-of-stock' | 'low-stock'
export type InventorySortField = 'name' | 'quantity' | 'category' | 'location' | 'updated_at'
export type SortDirection = 'asc' | 'desc'

export interface InventorySort {
  field: InventorySortField
  direction: SortDirection
}

export interface InventoryFilters {
  search: string
  categoryIds: string[]
  locationIds: string[]
  units: Unit[]
  stock: StockFilter
}

export interface HouseholdContext {
  household: Household
  profile: Profile
}

export interface ItemInput {
  name: string
  quantity: number
  unit: Unit
  category_id: string | null
  location_id: string | null
  notes: string | null
  low_stock_threshold: number | null
}

export type OfflineOperationKind =
  | 'inventory.create'
  | 'inventory.update'
  | 'inventory.delete'
  | 'grocery.create'
  | 'grocery.update'
  | 'grocery.delete'
  | 'grocery.complete'
  | 'grocery.repeat'

export type OfflineOperationStatus = 'pending' | 'syncing' | 'conflict' | 'failed'
export type LocalSyncStatus = 'pending' | 'conflict' | 'failed'
export type ConnectionState = 'online' | 'offline' | 'syncing' | 'needs-attention'

export interface OfflineOperation {
  id: string
  user_id: string
  household_id: string
  kind: OfflineOperationKind
  entity_type: 'inventory' | 'grocery'
  entity_id: string
  payload: Record<string, Json>
  status: OfflineOperationStatus
  created_at: string
  attempts: number
  error_code: string | null
  error_message: string | null
  latest: Record<string, Json> | null
}

export interface SyncConflict {
  operation: OfflineOperation
  latest: Record<string, Json> | null
}

export interface LocalRecordMeta {
  sync_status: LocalSyncStatus
  operation_id: string
}

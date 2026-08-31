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
          created_by: string
        }
        Update: {
          name?: string
          quantity?: number
          unit?: Unit
          category_id?: string | null
          location_id?: string | null
          notes?: string | null
        }
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
      shares_household: { Args: { other_user_id: string }; Returns: boolean }
    }
    Enums: { inventory_unit: Unit }
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
  created_by: string | null
  created_at: string
  updated_at: string
  version: number
}

export interface InventoryItem extends InventoryItemRow {
  category: Pick<Category, 'id' | 'name'> | null
  location: Pick<StorageLocation, 'id' | 'name'> | null
}

export type StockFilter = 'all' | 'in-stock' | 'out-of-stock'
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
}


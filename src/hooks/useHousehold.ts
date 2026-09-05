import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchHouseholdContext, queryKeys } from '../api/kitchen'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'

export function useHousehold() {
  const { user, signedOut } = useAuth()
  return useQuery({
    queryKey: queryKeys.context,
    queryFn: () => fetchHouseholdContext(user!.id),
    enabled: Boolean(user) && !signedOut,
  })
}

export function useHouseholdRealtime(householdId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!householdId) return

    const refreshHousehold = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.context })
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories(householdId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.locations(householdId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.members(householdId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.groceries(householdId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipes(householdId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.mealPlan(householdId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.products(householdId) })
    }

    const channel = supabase
      .channel(`household:${householdId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'grocery_items',
          filter: `household_id=eq.${householdId}`,
        },
        refreshHousehold,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'households', filter: `id=eq.${householdId}` },
        refreshHousehold,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'household_members',
          filter: `household_id=eq.${householdId}`,
        },
        refreshHousehold,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'categories',
          filter: `household_id=eq.${householdId}`,
        },
        refreshHousehold,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'locations',
          filter: `household_id=eq.${householdId}`,
        },
        refreshHousehold,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inventory_items',
          filter: `household_id=eq.${householdId}`,
        },
        refreshHousehold,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recipes',
          filter: `household_id=eq.${householdId}`,
        },
        refreshHousehold,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'recipe_ingredients',
          filter: `household_id=eq.${householdId}`,
        },
        refreshHousehold,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'meal_plan_entries',
          filter: `household_id=eq.${householdId}`,
        },
        refreshHousehold,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [householdId, queryClient])
}

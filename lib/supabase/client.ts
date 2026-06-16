import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  console.log("[v0] Creating Supabase client with:")
  console.log("[v0] URL:", url ? "SET" : "MISSING")
  console.log("[v0] KEY:", key ? "SET" : "MISSING")
  
  if (!url || !key) {
    console.log("[v0] ERROR: Missing Supabase credentials!")
    throw new Error("Supabase credentials not configured")
  }
  
  return createBrowserClient(url, key)
}

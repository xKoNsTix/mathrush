import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Singleton — created lazily so missing env vars don't crash the bundle
// on first import. Returns null when not configured; callers should treat
// "no client" as "stay offline / local only".

let cached: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}

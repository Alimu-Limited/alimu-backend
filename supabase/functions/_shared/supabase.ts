import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Service-role client for DB writes / admin ops. Bypasses RLS and powers every
 * purchase, expiry and router sync — same as the old Node backend's pg Pool.
 */
let _supabase: ReturnType<typeof createClient> | null = null;
export function getSupabase() {
  if (!_supabase) {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    _supabase = createClient(url, key);
  }
  return _supabase;
}

import "server-only";
import { createClient } from "@supabase/supabase-js";

// Client dengan service role — HANYA dipakai di server (halaman Admin)
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum di-set di environment variables.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

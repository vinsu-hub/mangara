import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client that bypasses RLS.
 *
 * The generation work runs in `waitUntil()` — after the HTTP response has been
 * sent — so the user's cookie session is no longer available to authorize
 * writes. This client is what the background task uses to move a generation
 * through its states. Never import it into a Client Component.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/assets/databaseTypes';

export function createAdminClient(): SupabaseClient<Database> {
  // The URL is the same value the browser sees, so it lives under
  // `NEXT_PUBLIC_SUPABASE_URL`; server code reads it directly.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // `sb_secret_*` key (new) or legacy `service_role` JWT — either form is
  // accepted by the client library. NEVER expose this value to the browser.
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL');
  if (!secretKey) throw new Error('Missing env var: SUPABASE_SECRET_KEY');

  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}


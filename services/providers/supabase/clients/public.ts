'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Public, read-only Supabase client with no cookies/session. Uses the
// publishable key, so RLS still applies.
export function createPublicClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL');
  if (!publishableKey) {
    throw new Error(
      'Missing env var: SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
  }

  return createClient(url, publishableKey, {
    auth: { persistSession: false },
  });
}


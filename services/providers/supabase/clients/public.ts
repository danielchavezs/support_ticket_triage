'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Public, read-only Supabase client with no cookies/session
export function createPublicClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url) throw new Error('Missing env var: SUPABASE_URL');
  if (!anonKey) throw new Error('Missing env var: SUPABASE_ANON_KEY');

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}


import { createBrowserClient as supabaseClient } from "@supabase/ssr";
import type { SupabaseClient } from '@supabase/supabase-js';

export const createBrowserClient = (): SupabaseClient => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL');
  if (!anonKey) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY');

  return supabaseClient(url, anonKey);
};


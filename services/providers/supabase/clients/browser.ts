import { createBrowserClient as supabaseClient } from "@supabase/ssr";
import type { SupabaseClient } from '@supabase/supabase-js';

// Browser-side Supabase client. Must use the NEXT_PUBLIC_ variant of the
// publishable key so Next.js inlines it into the client bundle at build time.
// The publishable key is safe to expose; it respects RLS.
export const createBrowserClient = (): SupabaseClient => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL');
  if (!publishableKey) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');

  return supabaseClient(url, publishableKey);
};


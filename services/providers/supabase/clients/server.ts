'server-only';
import { createServerClient as supabaseClient } from "@supabase/ssr";
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from "next/headers";

export const createServerClient = async (): Promise<SupabaseClient> => {
	const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Prefer the server-only var; fall back to the NEXT_PUBLIC_ mirror if the
  // browser-safe one is the only one set. Publishable keys are RLS-respecting
  // and safe to read on either side.
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) throw new Error('Missing env var: NEXT_PUBLIC_SUPABASE_URL');
  if (!publishableKey) {
    throw new Error(
      'Missing env var: SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    );
  }

	return supabaseClient(
		url,
		publishableKey,
		{
			cookies: {
				getAll() {
					return cookieStore.getAll();
				},
				setAll(cookiesToSet) {
					try {
						cookiesToSet.forEach(({ name, value, options }) => {
							cookieStore.set(name, value, options);
						});
					} catch {
						// The `set` method was called from a Server Component.
						// This can be ignored if you have middleware refreshing
						// user sessions.
					}
				},
			},
		},
	);
};

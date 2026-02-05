'server-only';
import { createServerClient as supabaseClient } from "@supabase/ssr";
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from "next/headers";

export const createServerClient = async (): Promise<SupabaseClient> => {
	const cookieStore = await cookies();

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url) throw new Error('Missing env var: SUPABASE_URL');
  if (!anonKey) throw new Error('Missing env var: SUPABASE_ANON_KEY');

	return supabaseClient(
		url,
		anonKey,
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

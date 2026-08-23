import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Admin client for privileged operations — inviting, listing, and
 * removing team members. Uses the Supabase *service role* key, which
 * bypasses Row Level Security entirely.
 *
 * SERVER-SIDE ONLY. Never import this file from a Client Component,
 * never log the key, and never prefix it with NEXT_PUBLIC_ — doing so
 * would ship it to every visitor's browser. It's read here from
 * `SUPABASE_SERVICE_ROLE_KEY`, which should be set as a secret
 * environment variable on your host (see SETUP.md).
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to your environment " +
        "variables to enable the Team page (see SETUP.md → " +
        "\"Invite teammates from the app\")."
    );
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

import type { User } from "@supabase/supabase-js";

/**
 * Two-tier role model, stored in Supabase Auth's `app_metadata` (never
 * `user_metadata` — that's user-editable, app_metadata can only be set by
 * an admin API call with the service role key). app_metadata rides along
 * inside the JWT automatically, so Postgres RLS policies can check it
 * directly via `auth.jwt() -> 'app_metadata' ->> 'role'` with no extra
 * table or query needed — see supabase/schema.sql for the policies that
 * lean on this.
 *
 * Anyone without an explicit "admin" role is treated as a regular member.
 * There is currently no persisted "member" value required — absence just
 * means "not admin" — but invites write "member" explicitly so the Team
 * page has something to display.
 */
export type Role = "admin" | "member";

/**
 * The one account that ever signs in with a password. The login page
 * checks the typed email against this, client-side, *before* anyone is
 * authenticated, purely to decide which UI to show (password field vs.
 * "we'll email you a link"). It grants nothing by itself — actual access
 * is still enforced server-side via app_metadata.role, same as always.
 */
export const ADMIN_EMAIL = "rutuja@arkpeoplesolutions.com";

export function roleOf(user: Pick<User, "app_metadata"> | null | undefined): Role {
  return user?.app_metadata?.role === "admin" ? "admin" : "member";
}

export function isAdmin(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return roleOf(user) === "admin";
}

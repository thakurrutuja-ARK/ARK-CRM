import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * OAuth callback (Google Sign-In).
 *
 * Unlike /auth/confirm (used for emailed invite/reset links, which email
 * security scanners can silently pre-visit and burn before a human clicks),
 * this route is only ever reached by a real, live browser bouncing straight
 * back from Google's consent screen. There's no emailed link for a scanner
 * to pre-fetch, so it's safe to complete the sign-in immediately here — no
 * "click to continue" step needed.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const email = (data.user.email ?? "").toLowerCase();
      // Belt-and-suspenders: the Google OAuth app is configured as
      // "Internal" (Google Workspace-only for arkpeoplesolutions.com), so
      // only company accounts can even complete Google's consent screen —
      // but double-check the email here too in case that setting ever
      // changes.
      const isCompanyAccount = email.endsWith("@arkpeoplesolutions.com");

      // Being on the company domain isn't enough on its own — Supabase
      // will happily auto-provision a brand-new CRM account for *any*
      // company Google account that clicks this button, bypassing the
      // Team page's "Invite teammate" step entirely. `invited_at` is only
      // ever set by that admin invite flow, so its absence here means
      // this account was just self-created by this very sign-in attempt,
      // not added by an admin.
      let wasInvited = false;
      try {
        const admin = createAdminClient();
        const { data: fullUser } = await admin.auth.admin.getUserById(data.user.id);
        wasInvited = Boolean(fullUser.user?.invited_at);
      } catch {
        wasInvited = false; // fail closed if we can't verify
      }

      if (isCompanyAccount && wasInvited) {
        return NextResponse.redirect(`${origin}${next}`);
      }

      await supabase.auth.signOut();

      // Only remove the account if this sign-in attempt is the one that
      // just created it — never delete a pre-existing user just because
      // the domain check above happened to fail.
      if (!wasInvited) {
        try {
          const admin = createAdminClient();
          await admin.auth.admin.deleteUser(data.user.id);
        } catch {
          // Best-effort cleanup — not worth failing the redirect over.
        }
      }

      const errorCode = !isCompanyAccount ? "not-company-account" : "not-invited";
      return NextResponse.redirect(`${origin}/login?error=${errorCode}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth-failed`);
}

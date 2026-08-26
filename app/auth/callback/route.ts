import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    if (!error) {
      // Belt-and-suspenders: the Google OAuth app is configured as
      // "Internal" (Google Workspace-only for arkpeoplesolutions.com), so
      // only company accounts can even complete Google's consent screen —
      // but double-check the email here too in case that setting ever
      // changes.
      const email = data.user?.email ?? "";
      if (email.toLowerCase().endsWith("@arkpeoplesolutions.com")) {
        return NextResponse.redirect(`${origin}${next}`);
      }
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=not-company-account`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=oauth-failed`);
}

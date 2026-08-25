import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for Supabase invite/recovery email links. This project
 * doesn't have custom SMTP configured, so Supabase sends its *default*
 * email templates — those use `{{ .ConfirmationURL }}`, which points at
 * Supabase's own hosted `/auth/v1/verify` endpoint. That endpoint verifies
 * the one-time token itself and then redirects the browser back here with
 * a PKCE `code` query param (this project's Supabase client uses the PKCE
 * flow by default) rather than the `token_hash`/`type` pair a *custom*
 * email template would send directly. We handle both shapes so this route
 * keeps working whether or not custom SMTP + templates get set up later.
 *
 * Either way, once the token/code checks out, it establishes a real
 * session and redirects into the app (by default to /set-password so a
 * newly invited teammate can pick a password).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/set-password";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=invite-link-expired`);
}

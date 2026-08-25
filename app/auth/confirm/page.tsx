"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Landing point for Supabase invite/recovery/magic-link email links.
 *
 * This used to be a GET route handler that completed sign-in the instant
 * the link was opened. That turned out to be a problem: Google Workspace
 * (and other corporate mail security features) automatically "pre-visits"
 * links inside emails to scan them for phishing/malware, *before* a human
 * ever clicks. Since these one-time codes are single-use, that silent
 * pre-visit burns the code — so by the time the real person clicks the
 * link, it's already "expired or already used," even though nothing went
 * wrong on our end.
 *
 * The fix: don't complete sign-in automatically on page load. Instead,
 * show a normal page with a button, and only exchange the code when a
 * real person clicks it. Security scanners fetch the page to check it's
 * safe, but they don't click buttons — so this can't be silently consumed
 * before a human gets to it.
 */
function ConfirmContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/set-password";

  const hasValidParams = Boolean(code) || Boolean(token_hash && type);

  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    // Nothing to exchange at all — this isn't a "click to continue" case,
    // it's just a broken/incomplete link. Send them straight to login.
    if (!hasValidParams) {
      router.replace("/login?error=invite-link-expired");
    }
  }, [hasValidParams, router]);

  async function handleContinue() {
    setStatus("loading");
    const supabase = createClient();

    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ type: type!, token_hash: token_hash! });

    if (error) {
      setStatus("error");
      router.replace("/login?error=invite-link-expired");
      return;
    }

    router.push(next);
    router.refresh();
  }

  if (!hasValidParams) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ark-logo.png"
            alt="ARK People Solutions"
            className="h-12 w-auto mx-auto mb-4"
          />
          <h1 className="font-display text-2xl font-extrabold text-brand-ink tracking-tight">
            Internal CRM
          </h1>
          <p className="text-sm text-slate-500 mt-1">One more step</p>
        </div>

        <div className="bg-white border border-black/10 rounded-2xl shadow-sm p-6 text-center space-y-4">
          <p className="text-sm text-slate-600">
            For your security, click below to finish signing in.
          </p>

          <button
            type="button"
            onClick={handleContinue}
            disabled={status === "loading"}
            className="w-full rounded-full bg-brand-ink text-white text-sm font-semibold py-2.5 hover:bg-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {status === "loading" ? "Signing you in…" : "Continue to sign in"}
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          Need access? Ask your admin to add you to the team.
        </p>
      </div>
    </div>
  );
}

export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmContent />
    </Suspense>
  );
}

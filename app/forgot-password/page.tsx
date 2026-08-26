"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: `${window.location.origin}/auth/confirm?next=/set-password`,
      }
    );

    setLoading(false);

    // Always show the same success message, whether or not the email
    // exists — this avoids leaking which addresses have accounts.
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
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
            Reset your password
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            We&apos;ll email you a link to set a new one
          </p>
        </div>

        <div className="bg-white border border-black/10 rounded-2xl shadow-sm p-6">
          {sent ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-3">
                If an account exists for <span className="font-semibold">{email}</span>,
                we&apos;ve sent a password reset link. Check your inbox (and spam
                folder) and click the link to choose a new password.
              </div>
              <Link
                href="/login"
                className="block text-center text-sm font-medium text-brand-ink hover:underline"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
                  {error}
                </div>
              )}

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
                  placeholder="you@arkpeoplesolutions.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full rounded-full bg-brand-ink text-white text-sm font-semibold py-2.5 hover:bg-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>

              <Link
                href="/login"
                className="block text-center text-sm text-slate-500 hover:text-brand-ink transition-colors"
              >
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

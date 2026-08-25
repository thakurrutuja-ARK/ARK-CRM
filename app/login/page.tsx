"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ADMIN_EMAIL } from "@/lib/auth/role";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<"email" | "password" | "link-sent">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const linkExpired = searchParams.get("error") === "invite-link-expired";
  const [error, setError] = useState<string | null>(
    linkExpired
      ? "That sign-in link expired or was already used. Enter your email below and we'll send you a fresh one."
      : null
  );
  const [loading, setLoading] = useState(false);

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    if (trimmed === ADMIN_EMAIL) {
      setStep("password");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/`,
      },
    });
    setLoading(false);

    if (error) {
      setError("Couldn't send the sign-in link. Please try again.");
      return;
    }

    setStep("link-sent");
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setLoading(false);

    if (error) {
      setError("Incorrect email or password. Please try again.");
      return;
    }

    const next = searchParams.get("next") || "/";
    router.push(next);
    router.refresh();
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
          <p className="text-sm text-slate-500 mt-1">
            Sign in with your ARK account
          </p>
        </div>

        {step === "link-sent" ? (
          <div className="bg-white border border-black/10 rounded-2xl shadow-sm p-6 text-center space-y-3">
            <p className="text-sm text-brand-ink font-medium">
              Check your email
            </p>
            <p className="text-sm text-slate-500">
              We sent a sign-in link to <strong>{email.trim()}</strong>. Open
              it on this device to get in — no password needed.
            </p>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
              className="text-xs font-medium text-brand-amber-dark hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form
            onSubmit={step === "password" ? handlePasswordSubmit : handleContinue}
            className="bg-white border border-black/10 rounded-2xl shadow-sm p-6 space-y-4"
          >
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
                autoComplete="email"
                autoFocus={step === "email"}
                disabled={step === "password"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500"
                placeholder="you@arkpeoplesolutions.com"
              />
            </div>

            {step === "password" && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-slate-700"
                  >
                    Password
                  </label>
                  <a
                    href="/forgot-password"
                    className="text-xs font-medium text-brand-amber-dark hover:underline"
                  >
                    Forgot password?
                  </a>
                </div>
                <input
                  id="password"
                  type="password"
                  required
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-brand-ink text-white text-sm font-semibold py-2.5 hover:bg-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading
                ? step === "password"
                  ? "Signing in…"
                  : "Sending link…"
                : step === "password"
                  ? "Sign in"
                  : "Continue"}
            </button>

            {step === "password" && (
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setPassword("");
                  setError(null);
                }}
                className="w-full text-center text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Use a different email
              </button>
            )}
          </form>
        )}

        <p className="text-center text-xs text-slate-400 mt-6">
          Need access? Ask your admin to add you to the team.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-black/5 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ark-logo.png" alt="ARK People Solutions" className="h-8 w-auto" />
              <span className="hidden sm:block h-6 w-px bg-black/10" />
              <span className="hidden sm:block font-semibold text-xs tracking-[0.18em] text-brand-ink uppercase">
                Resource Space
              </span>
            </Link>
            <nav className="hidden sm:flex items-center gap-1">
              <Link
                href="/"
                className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-600 hover:text-brand-ink hover:bg-slate-100 transition-colors"
              >
                Clients
              </Link>
              <Link
                href="/team"
                className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-600 hover:text-brand-ink hover:bg-slate-100 transition-colors"
              >
                Team
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {user?.email && (
              <span className="text-sm text-slate-500 hidden sm:inline">
                {user.email}
              </span>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-10">
        {children}
      </main>
    </div>
  );
}

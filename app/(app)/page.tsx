import { createClient } from "@/lib/supabase/server";
import { ClientsBoard } from "./clients-board";
import { DashboardBanner } from "@/components/dashboard-banner";
import { isAdmin } from "@/lib/auth/role";
import type { Client, Category, Document } from "@/types/db";

export default async function DashboardPage() {
  const supabase = await createClient();

  // These four queries don't depend on each other, so fire them all at
  // once instead of waiting for each one to finish in turn — on a
  // database that's geographically far from where this runs, each
  // round trip adds real latency, and there's no reason to pay for
  // four of them back-to-back when they can happen at the same time.
  //
  // The documents query pulls enough fields (but not the full
  // content_text, which can be up to 200KB per row) for the dashboard's
  // "which files match this tag/search" panel — see clients-board.tsx —
  // without shipping every document's extracted text to the browser.
  const [
    { data: clients, error },
    { data: docRows },
    { data: categories },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase.from("clients").select("*").order("created_at", { ascending: false }),
    supabase
      .from("documents")
      .select(
        "id, client_id, folder_id, file_name, storage_path, file_type, file_size, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase.from("categories").select("*").order("created_at", { ascending: true }),
    supabase.auth.getUser(),
  ]);

  const docCounts: Record<string, number> = {};
  (docRows || []).forEach((row) => {
    docCounts[row.client_id] = (docCounts[row.client_id] || 0) + 1;
  });

  return (
    <div>
      <DashboardBanner />

      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-brand-amber-dark uppercase mb-2">
            Client Directory
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-ink tracking-tight">
            Clients
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            Every ARK client and their document library, in one place.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 mb-6">
          Couldn&apos;t load clients: {error.message}
        </div>
      )}

      <ClientsBoard
        clients={(clients as Client[]) || []}
        docCounts={docCounts}
        documents={(docRows as Document[]) || []}
        initialCategories={(categories as Category[]) || []}
        isAdmin={isAdmin(user)}
      />
    </div>
  );
}

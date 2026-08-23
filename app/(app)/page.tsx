import { createClient } from "@/lib/supabase/server";
import { ClientsBoard } from "./clients-board";
import { DashboardBanner } from "@/components/dashboard-banner";
import type { Client, Category } from "@/types/db";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  const { data: docRows } = await supabase
    .from("documents")
    .select("client_id");

  const { data: categories } = await supabase
    .from("categories")
    .select("*")
    .order("created_at", { ascending: true });

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
        initialCategories={(categories as Category[]) || []}
      />
    </div>
  );
}

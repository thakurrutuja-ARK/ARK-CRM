import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DocumentLibrary } from "./document-library";
import { ClientBanner } from "@/components/client-banner";
import { ClientTags } from "@/components/client-tags";
import type { Client, Document, Folder, Category } from "@/types/db";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // None of these four queries depend on each other's results (documents
  // and folders only need the id from the URL, not the client record),
  // so run them all at once instead of one after another — each round
  // trip to the database costs real time, and there's no need to pay
  // for four of them in sequence.
  const [
    { data: client },
    { data: documents },
    { data: folders },
    { data: categories },
  ] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).single(),
    supabase
      .from("documents")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("folders")
      .select("*")
      .eq("client_id", id)
      .order("name", { ascending: true }),
    supabase.from("categories").select("*").order("created_at", { ascending: true }),
  ]);

  if (!client) {
    notFound();
  }

  return (
    <div>
      <Link
        href="/"
        className="text-sm font-medium text-slate-500 hover:text-brand-amber-dark transition-colors inline-flex items-center gap-1 mb-4"
      >
        ← All clients
      </Link>

      <ClientBanner
        clientId={id}
        name={(client as Client).name}
        documents={(documents as Document[]) || []}
        logoUrl={(client as Client).logo_url}
        location={(client as Client).location}
      />
      <ClientTags
        clientCategories={(client as Client).categories}
        keywords={(client as Client).keywords}
        categories={(categories as Category[]) || []}
      />

      <DocumentLibrary
        clientId={id}
        initialDocuments={(documents as Document[]) || []}
        initialFolders={(folders as Folder[]) || []}
      />
    </div>
  );
}

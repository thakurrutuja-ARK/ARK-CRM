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

  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) {
    notFound();
  }

  const { data: documents } = await supabase
    .from("documents")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  const { data: folders } = await supabase
    .from("folders")
    .select("*")
    .eq("client_id", id)
    .order("name", { ascending: true });

  const { data: categories } = await supabase
    .from("categories")
    .select("*")
    .order("created_at", { ascending: true });

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

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, MAX_CONTENT_LENGTH } from "./extract-text";

/**
 * Downloads a document's file from Storage, extracts its text (where
 * supported), and saves that text onto the document row so the client's
 * `content_tsv` generated column picks it up for search. Shared by the
 * per-upload extraction route and the older-documents backfill sweep so
 * both go through one code path.
 */
export async function indexDocument(
    supabase: SupabaseClient,
    documentId: string
  ): Promise<{ ok: boolean; extracted?: boolean; error?: string }> {
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, storage_path, file_type")
      .eq("id", documentId)
      .single();

  if (docError || !doc) {
        return { ok: false, error: "Document not found" };
  }

  const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("client-documents")
      .download(doc.storage_path);

  if (downloadError || !fileBlob) {
        return {
                ok: false,
                error: `Could not download file: ${downloadError?.message ?? "unknown error"}`,
        };
  }

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const rawText = await extractText(buffer, doc.file_type);
    const contentText = rawText ? rawText.slice(0, MAX_CONTENT_LENGTH) : null;

  const { error: updateError } = await supabase
      .from("documents")
      .update({
              content_text: contentText,
              content_indexed_at: new Date().toISOString(),
      })
      .eq("id", documentId);

  if (updateError) {
        return { ok: false, error: updateError.message };
  }

  return { ok: true, extracted: !!contentText };
}

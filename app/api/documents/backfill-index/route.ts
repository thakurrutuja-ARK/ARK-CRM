import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { indexDocument } from "@/lib/documents/index-document";

export const runtime = "nodejs";
export const maxDuration = 60;

// Downloading + parsing a handful of real-world PDFs/PPTX one after
// another can easily take longer than a serverless function is allowed
// to run (we saw 15-at-a-time time out with a 502, even with
// `maxDuration = 60` declared — some hosting tiers cap it lower in
// practice). A small batch keeps each call comfortably inside any tier's
// limit; the UI just calls this repeatedly (via `remaining`) until the
// whole backlog is done.
const BATCH_SIZE = 1;

// One specific document that's slow, huge, or trips up a parser (the
// hand-rolled legacy .ppt reader is the likeliest culprit) can hang
// rather than throw — a try/catch does nothing against a hang, only the
// platform's own gateway timeout eventually kills it with a 502, and
// because the batch always pulls the OLDEST still-unindexed row first,
// that one bad document blocks every client's indexing forever. A hard
// per-document timeout means a stuck document gets skipped instead of
// jamming the whole queue.
const PER_DOCUMENT_TIMEOUT_MS = 20_000;

async function indexWithTimeout(supabase: SupabaseClient, documentId: string) {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<{ ok: false; error: string }>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ ok: false, error: "Timed out extracting this file" }),
      PER_DOCUMENT_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([indexDocument(supabase, documentId), timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * One-off / re-runnable sweep that indexes any document uploaded before
 * search existed (content_indexed_at is still null). Safe to call
 * repeatedly — already-indexed rows are skipped. Processes a small batch
 * per call so it stays well under serverless time limits; the response's
 * `remaining` flag tells the caller whether to call again for the next
 * batch.
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: pending, error } = await supabase
    .from("documents")
    .select("id")
    .is("content_indexed_at", null)
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const row of pending ?? []) {
    // A single bad file (corrupt, unexpectedly huge, a network hiccup
    // downloading it) shouldn't take the whole batch down with it — log
    // it as a failure for that one document and keep going.
    let result: { ok: boolean; extracted?: boolean; error?: string };
    try {
      result = await indexWithTimeout(supabase, row.id);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
    results.push({ id: row.id, ok: result.ok, error: result.error });

    // indexDocument() only marks a row as indexed once it finishes
    // successfully — a row that timed out (or threw) is still null, so
    // it would be picked as the "oldest pending" row again on the very
    // next call and hang the queue on it forever. Mark it processed here
    // (with no extracted text) so the sweep can move past it; the file
    // stays searchable by name, it just won't have content search.
    if (!result.ok) {
      await supabase
        .from("documents")
        .update({ content_indexed_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("content_indexed_at", null);
    }
  }

  return NextResponse.json({
    processed: results.length,
    remaining: (pending ?? []).length === BATCH_SIZE,
    results,
  });
}

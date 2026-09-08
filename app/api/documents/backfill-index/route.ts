import { NextResponse } from "next/server";
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
const BATCH_SIZE = 3;

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
    try {
      const result = await indexDocument(supabase, row.id);
      results.push({ id: row.id, ok: result.ok, error: result.error });
    } catch (err) {
      results.push({
        id: row.id,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    processed: results.length,
    remaining: (pending ?? []).length === BATCH_SIZE,
    results,
  });
}

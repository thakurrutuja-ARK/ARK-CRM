import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Kicks off the older-documents indexing sweep. This route does none of
 * the actual work (downloading + extracting text from every unindexed
 * file) itself — that reliably outran what a normal serverless function
 * is allowed to run for, even at a batch size of one, and 502'd. Instead
 * this just authenticates the request and hands off to a Netlify
 * Background Function (netlify/functions/backfill-index-background.mts),
 * which gets up to 15 minutes and keeps running after this response is
 * already sent.
 *
 * The UI polls /api/documents/backfill-status to show progress, since a
 * background function has no way to return a result directly to the
 * caller.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const backgroundUrl = new URL(
    "/.netlify/functions/backfill-index-background",
    request.nextUrl.origin
  );

  try {
    // This only waits for Netlify to accept the job (a fast 202) — not for
    // the indexing itself to finish.
    await fetch(backgroundUrl, { method: "POST" });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Could not start indexing: " +
          (err instanceof Error ? err.message : "Unknown error"),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ started: true });
}

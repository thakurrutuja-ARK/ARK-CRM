import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { indexDocument } from "@/lib/documents/index-document";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Called right after a file finishes uploading. Extracts its text (PDF,
 * Word, PowerPoint) and saves it onto the document row so it becomes
 * searchable. Fire-and-forget from the client — a failure here just means
 * that one file stays searchable by name only, it never blocks the upload.
 */
export async function POST(request: NextRequest) {
    const { documentId } = await request.json();
    if (!documentId || typeof documentId !== "string") {
          return NextResponse.json({ error: "documentId is required" }, { status: 400 });
    }

  const supabase = await createClient();

  const {
        data: { user },
  } = await supabase.auth.getUser();
    if (!user) {
          return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

  const result = await indexDocument(supabase, documentId);
    if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
}

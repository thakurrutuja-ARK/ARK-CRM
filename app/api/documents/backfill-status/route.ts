import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Lightweight polling endpoint the document library page uses to show
 * progress after kicking off the background indexing sweep — just a
 * single fast count query, nowhere near the timeout that doing the actual
 * extraction work hits. Pass ?clientId= to count only that client's
 * pending documents.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const clientId = request.nextUrl.searchParams.get("clientId");

  let query = supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .is("content_indexed_at", null);

  if (clientId) {
    query = query.eq("client_id", clientId);
  }

  const { count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ pending: count ?? 0 });
}

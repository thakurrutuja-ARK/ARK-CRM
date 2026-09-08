import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Google's Gemini API has a genuinely free tier (generous daily quota, no
// billing required to start) — that's why this uses Gemini rather than a
// paid model provider.
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const MAX_DOCS = 8;
const MAX_EXCERPT_CHARS = 3000;
const MAX_HISTORY_MESSAGES = 6;

type ChatMessage = { role: "user" | "assistant"; content: string };

type DocMatch = {
  file_name: string;
  content_text: string | null;
  clients: { name: string } | { name: string }[] | null;
  folders: { name: string } | { name: string }[] | null;
};

function relatedName(rel: DocMatch["clients"]): string {
  if (!rel) return "Unknown client";
  if (Array.isArray(rel)) return rel[0]?.name || "Unknown client";
  return rel.name;
}

/**
 * Answers a question about anything in the CRM's document library — any
 * client, any folder, any file — by full-text searching every document's
 * extracted content, handing the best matches to Gemini as grounding
 * context, and asking it to answer strictly from that context (and to
 * flag gaps rather than guess).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        answer:
          "The chatbot isn't set up yet — an admin needs to add a GEMINI_API_KEY environment variable before I can answer questions.",
        configured: false,
      },
      { status: 200 }
    );
  }

  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const history: ChatMessage[] = Array.isArray(body?.history) ? body.history : [];

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  // Pull the strongest-matching documents across every client, using the
  // same content_tsv index the document search box already relies on —
  // "websearch" mode understands a natural-language question, not just
  // keywords.
  const { data: matches, error: searchError } = await supabase
    .from("documents")
    .select("file_name, content_text, clients ( name ), folders ( name )")
    .textSearch("content_tsv", question, { type: "websearch", config: "english" })
    .limit(MAX_DOCS);

  if (searchError) {
    return NextResponse.json(
      { error: "Search failed: " + searchError.message },
      { status: 500 }
    );
  }

  const docs = (matches || []) as DocMatch[];

  const context =
    docs.length === 0
      ? "(No documents in the library matched this question.)"
      : docs
          .map((d, i) => {
            const client = relatedName(d.clients);
            const folder = relatedName(d.folders) || "Unfiled";
            const excerpt = d.content_text
              ? d.content_text.slice(0, MAX_EXCERPT_CHARS)
              : "(no extracted text available for this file — matched by file name only)";
            return `[Document ${i + 1}]\nClient: ${client}\nFolder: ${folder}\nFile: ${d.file_name}\nExcerpt:\n${excerpt}`;
          })
          .join("\n\n---\n\n");

  const systemPrompt = `You are the document assistant inside ARK People Solutions' internal Resource Space CRM. Teammates ask you questions about clients and the documents stored in the CRM (contracts, decks, reports, media, etc.) instead of opening every folder themselves.

Answer using ONLY the document excerpts provided below — never invent facts, dates, names, or figures that aren't in them. Always say which client and file an answer came from.

If the excerpts don't fully answer the question, or you notice something a client's folder would typically have but doesn't seem to (e.g. no signed contract, no onboarding deck), say so plainly, then add a line starting with "Recommended:" suggesting what document or follow-up is needed. Never fabricate a recommendation that isn't grounded in an actual gap you can see.

If nothing relevant was found at all, say that clearly and don't guess.

Keep answers concise and conversational — this is a chat panel, not a report.

DOCUMENT EXCERPTS:
${context}`;

  // Gemini has no separate "assistant" role — prior turns are "model".
  const contents = [
    ...history
      .slice(-MAX_HISTORY_MESSAGES)
      .filter((m) => m && m.role && m.content)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    { role: "user", parts: [{ text: question }] },
  ];

  let geminiRes: Response;
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 1024 },
        }),
      }
    );
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach the AI service. Please try again." },
      { status: 502 }
    );
  }

  if (!geminiRes.ok) {
    const errText = await geminiRes.text().catch(() => "");
    return NextResponse.json(
      {
        error:
          geminiRes.status === 400 || geminiRes.status === 403
            ? "The AI service rejected the configured API key. Please check GEMINI_API_KEY."
            : geminiRes.status === 429
              ? "The free Gemini quota was hit — please try again in a moment."
              : `The AI service returned an error (${geminiRes.status}). ${errText.slice(0, 200)}`,
      },
      { status: 502 }
    );
  }

  const data = await geminiRes.json();
  const answer: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") ||
    "I couldn't generate an answer just now. Please try again.";

  return NextResponse.json({ answer, sources: docs.length, configured: true });
}

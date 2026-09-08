"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2, Sparkles } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What documents do we have for [client name]?",
  "Does [client name] have a signed contract on file?",
  "Summarize the latest deck uploaded for [client name].",
];

/**
 * Floating "ask about any client's documents" chatbot. Lives at the app
 * layout level so it's available on every authenticated page — it
 * searches across every client's documents, not just whichever one the
 * user happens to be viewing.
 */
export function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          history: messages.slice(-6),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Something went wrong. Please try again.");
        setMessages(nextMessages);
        return;
      }
      setMessages([...nextMessages, { role: "assistant", content: json.answer }]);
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setMessages(nextMessages);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-40 w-full max-w-sm h-[32rem] max-h-[70vh] flex flex-col rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 bg-brand-ink text-white">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-amber" />
              <div>
                <p className="text-sm font-semibold leading-tight">Document Assistant</p>
                <p className="text-[11px] text-white/60 leading-tight">
                  Ask about any client&apos;s documents
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  Ask a question about anything stored in the CRM — I&apos;ll search
                  every client&apos;s documents to answer.
                </p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="w-full text-left text-xs text-slate-500 bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "ml-auto bg-brand-ink text-white"
                    : "mr-auto bg-slate-100 text-brand-ink"
                }`}
              >
                {m.content}
              </div>
            ))}

            {loading && (
              <div className="mr-auto flex items-center gap-2 rounded-2xl bg-slate-100 px-3.5 py-2.5 text-sm text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Searching documents…
              </div>
            )}

            {error && (
              <div className="mr-auto rounded-2xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <div className="border-t border-black/5 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask a question…"
                className="flex-1 resize-none rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent max-h-24"
              />
              <button
                onClick={() => send(input)}
                disabled={loading || !input.trim()}
                title="Send"
                className="shrink-0 h-9 w-9 flex items-center justify-center rounded-full bg-brand-ink text-white hover:bg-black transition-colors disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        title="Ask about your documents"
        className="fixed bottom-6 right-6 z-40 h-14 w-14 flex items-center justify-center rounded-full bg-brand-ink text-white shadow-xl hover:bg-black hover:scale-105 transition-all"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </>
  );
}

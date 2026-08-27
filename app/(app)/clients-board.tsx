"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { styleForCategory, nextColorIndex, parseKeywords } from "@/lib/categories";
import type { Client, Category, Document } from "@/types/db";
import { FileIcon, fileExt } from "@/components/file-icon";
import { PreviewModal } from "@/components/preview-modal";
import {
  Search,
  Users,
  FileText,
  Tags,
  X,
  Settings,
  Pencil,
  Eye,
  Download,
  ExternalLink,
  Loader2,
  LayoutGrid,
  List,
  ChevronUp,
  ChevronDown,
  MapPin,
} from "lucide-react";

const VIEW_MODE_STORAGE_KEY = "ark-crm-clients-view-mode";

type SortKey = "name" | "documents" | "added";

const SEARCH_DEBOUNCE_MS = 300;

// Builds a Postgres prefix tsquery ("invoice:* & march:*") from whatever
// the user has typed so far, so results update as-you-type instead of only
// matching whole words. Mirrors the same helper in the per-client document
// library — kept small enough that duplicating it here beats introducing a
// shared-utility import for one function.
function toPrefixTsQuery(input: string) {
  return input
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
    .map((word) => `${word}:*`)
    .join(" & ");
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ClientsBoard({
  clients,
  docCounts,
  documents,
  initialCategories,
  isAdmin,
}: {
  clients: Client[];
  docCounts: Record<string, number>;
  documents: Document[];
  initialCategories: Category[];
  // Admins can delete clients and manage (create/rename/delete) categories;
  // everyone signed in can still add/edit clients and upload documents —
  // see lib/auth/role.ts and the matching RLS policies in schema.sql.
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [docSearchResults, setDocSearchResults] = useState<Document[] | null>(
    null
  );
  const [searchingDocs, setSearchingDocs] = useState(false);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(
    null
  );
  const [preview, setPreview] = useState<{ doc: Document; url: string } | null>(
    null
  );
  const [showAdd, setShowAdd] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [keywordsInput, setKeywordsInput] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [newLocationInput, setNewLocationInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(
    null
  );
  const [editingName, setEditingName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(
    null
  );
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Keep local state in sync whenever the server sends fresh categories
  // (e.g. after router.refresh() reloads the parent server component).
  useEffect(() => {
    setCategories(initialCategories);
  }, [initialCategories]);

  // Remember the user's preferred view (grid vs. list) across visits.
  useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === "grid" || stored === "list") setViewMode(stored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    clients.forEach((c) => {
      (c.categories || []).forEach((cat) => {
        counts[cat] = (counts[cat] || 0) + 1;
      });
    });
    return counts;
  }, [clients]);

  const presentCategories = useMemo(
    () =>
      categories
        .filter((cat) => categoryCounts[cat.name] > 0)
        .map((cat) => cat.name),
    [categories, categoryCounts]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (activeCategory && !(c.categories || []).includes(activeCategory))
        return false;
      if (!q) return true;
      const haystack = [
        c.name,
        ...(c.locations || []),
        ...(c.categories || []),
        ...(c.keywords || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [clients, query, activeCategory]);

  // Only used by the list view — the card grid keeps its existing
  // (unsorted) order via `filtered` so nothing changes there.
  const sortedFiltered = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "name") {
        return a.name.localeCompare(b.name) * dir;
      }
      if (sortKey === "documents") {
        return ((docCounts[a.id] || 0) - (docCounts[b.id] || 0)) * dir;
      }
      // sortKey === "added"
      return (
        (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
        dir
      );
    });
  }, [filtered, sortKey, sortDir, docCounts]);

  const clientById = useMemo(
    () => new Map(clients.map((c) => [c.id, c])),
    [clients]
  );

  // Which clients the active category pill (if any) restricts document
  // matches to — separate from `filtered` because a typed search query
  // shouldn't narrow which client IDs count as "in this category".
  const activeCategoryClientIds = useMemo(() => {
    if (!activeCategory) return null;
    return new Set(
      clients
        .filter((c) => (c.categories || []).includes(activeCategory))
        .map((c) => c.id)
    );
  }, [clients, activeCategory]);

  const filteredClientIds = useMemo(
    () => new Set(filtered.map((c) => c.id)),
    [filtered]
  );

  const showDocumentsSection = query.trim().length > 0 || activeCategory !== null;

  // Documents that belong to a client currently matched by name, category,
  // or keyword — this is what makes clicking a tag (or typing a client's
  // keyword) surface the actual files instead of just the client card.
  const tagMatchedDocuments = useMemo(() => {
    if (!showDocumentsSection) return [];
    return documents.filter((d) => filteredClientIds.has(d.client_id));
  }, [documents, filteredClientIds, showDocumentsSection]);

  // Runs a dashboard-wide (not scoped to one client) content + file-name
  // search as the user types, debounced so we're not firing a query on
  // every keystroke. This is what catches a match that lives inside a
  // document's extracted text even when no client's name/category/keyword
  // matches the typed query.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setDocSearchResults(null);
      setSearchingDocs(false);
      return;
    }
    const tsq = toPrefixTsQuery(q);
    if (!tsq) {
      setDocSearchResults([]);
      setSearchingDocs(false);
      return;
    }
    setSearchingDocs(true);
    const handle = setTimeout(async () => {
      const supabase = createClient();
      let req = supabase
        .from("documents")
        .select(
          "id, client_id, folder_id, file_name, storage_path, file_type, file_size, created_at"
        )
        .textSearch("content_tsv", tsq)
        .order("created_at", { ascending: false })
        .limit(50);
      if (activeCategoryClientIds) {
        req = req.in("client_id", Array.from(activeCategoryClientIds));
      }
      const { data, error } = await req;
      setDocSearchResults(error ? [] : (data as Document[]));
      setSearchingDocs(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, activeCategoryClientIds]);

  // Union of the two document-matching paths above, deduped by id and
  // shown newest-first.
  const matchedDocuments = useMemo(() => {
    const map = new Map<string, Document>();
    tagMatchedDocuments.forEach((d) => map.set(d.id, d));
    (docSearchResults || []).forEach((d) => map.set(d.id, d));
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [tagMatchedDocuments, docSearchResults]);

  async function getSignedUrl(doc: Document) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("client-documents")
      .createSignedUrl(doc.storage_path, 300);
    if (error || !data) return null;
    return data.signedUrl;
  }

  async function handleDownload(doc: Document) {
    const url = await getSignedUrl(doc);
    if (!url) {
      alert("Couldn't generate a download link. Please try again.");
      return;
    }
    window.open(url, "_blank");
  }

  async function handlePreviewDoc(doc: Document) {
    setPreviewLoadingId(doc.id);
    const url = await getSignedUrl(doc);
    setPreviewLoadingId(null);
    if (!url) {
      alert("Couldn't open a preview. Please try again.");
      return;
    }
    setPreview({ doc, url });
  }

  const totalDocuments = useMemo(
    () => Object.values(docCounts).reduce((sum, n) => sum + n, 0),
    [docCounts]
  );

  const newThisMonth = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return clients.filter((c) => new Date(c.created_at).getTime() >= cutoff)
      .length;
  }, [clients]);

  function toggleSelectedCategory(catName: string) {
    setSelectedCategories((cur) =>
      cur.includes(catName)
        ? cur.filter((c) => c !== catName)
        : [...cur, catName]
    );
  }

  async function handleAddNewCategoryInline(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    const existing = categories.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      setSelectedCategories((cur) =>
        cur.includes(existing.name) ? cur : [...cur, existing.name]
      );
      setNewCategoryInput("");
      return;
    }
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: inserted, error: catError } = await supabase
      .from("categories")
      .insert({
        name: trimmed,
        color_index: nextColorIndex(categories),
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    if (catError) {
      setError(catError.message);
      return;
    }
    setCategories((cats) => [...cats, inserted as Category]);
    setSelectedCategories((cur) => [...cur, trimmed]);
    setNewCategoryInput("");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);

    // Someone may have typed a location but never clicked "Add" or hit
    // Enter — fold it in here rather than silently losing it on save.
    const pendingLocation = newLocationInput.trim();
    const locationsToSave =
      pendingLocation &&
      !locations.some((l) => l.toLowerCase() === pendingLocation.toLowerCase())
        ? [...locations, pendingLocation]
        : locations;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { error } = editingClientId
      ? await supabase
          .from("clients")
          .update({
            name: name.trim(),
            categories: selectedCategories,
            keywords: parseKeywords(keywordsInput),
            locations: locationsToSave,
          })
          .eq("id", editingClientId)
      : await supabase.from("clients").insert({
          name: name.trim(),
          categories: selectedCategories,
          keywords: parseKeywords(keywordsInput),
          locations: locationsToSave,
          created_by: user?.id ?? null,
        });

    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setName("");
    setSelectedCategories([]);
    setNewCategoryInput("");
    setKeywordsInput("");
    setLocations([]);
    setNewLocationInput("");
    setShowAdd(false);
    setEditingClientId(null);
    router.refresh();
  }

  function addLocation(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = newLocationInput.trim();
    if (!trimmed) return;
    setLocations((cur) =>
      cur.some((l) => l.toLowerCase() === trimmed.toLowerCase())
        ? cur
        : [...cur, trimmed]
    );
    setNewLocationInput("");
  }

  function removeLocation(loc: string) {
    setLocations((cur) => cur.filter((l) => l !== loc));
  }

  function openEditModal(client: Client) {
    setEditingClientId(client.id);
    setName(client.name);
    setError(null);
    setSelectedCategories(client.categories || []);
    setNewCategoryInput("");
    setKeywordsInput((client.keywords || []).join(", "));
    setLocations(client.locations || []);
    setNewLocationInput("");
    setShowAdd(true);
  }

  function closeAddModal() {
    if (saving) return;
    setShowAdd(false);
    setEditingClientId(null);
    setName("");
    setSelectedCategories([]);
    setNewCategoryInput("");
    setKeywordsInput("");
    setLocations([]);
    setNewLocationInput("");
    setError(null);
  }

  async function handleDelete(id: string) {
    if (
      !confirm(
        "Delete this client and all of their uploaded documents? This can't be undone."
      )
    ) {
      return;
    }
    setDeletingId(id);
    const supabase = createClient();

    // Remove any files in storage under this client's folder first.
    const { data: files } = await supabase.storage
      .from("client-documents")
      .list(id);
    if (files && files.length > 0) {
      await supabase.storage
        .from("client-documents")
        .remove(files.map((f) => `${id}/${f.name}`));
    }

    await supabase.from("clients").delete().eq("id", id);
    setDeletingId(null);
    router.refresh();
  }

  async function commitRename(cat: Category) {
    const trimmed = editingName.trim();
    setEditingCategoryId(null);
    if (!trimmed || trimmed === cat.name) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("categories")
      .update({ name: trimmed })
      .eq("id", cat.id);
    if (error) {
      alert(error.message);
      return;
    }
    // Cascade: replace this category's name inside every client's
    // categories array (app-layer, since it's a text[] column).
    const { data: affected } = await supabase
      .from("clients")
      .select("id, categories")
      .contains("categories", [cat.name]);
    if (affected) {
      for (const row of affected as { id: string; categories: string[] }[]) {
        const updated = row.categories.map((n) =>
          n === cat.name ? trimmed : n
        );
        await supabase
          .from("clients")
          .update({ categories: updated })
          .eq("id", row.id);
      }
    }
    router.refresh();
  }

  async function handleDeleteCategory(cat: Category) {
    const count = categoryCounts[cat.name] || 0;
    const msg =
      count > 0
        ? `Delete "${cat.name}"? It will be removed from ${count} client${
            count === 1 ? "" : "s"
          }.`
        : `Delete "${cat.name}"?`;
    if (!confirm(msg)) return;
    setDeletingCategoryId(cat.id);
    const supabase = createClient();
    const { data: affected } = await supabase
      .from("clients")
      .select("id, categories")
      .contains("categories", [cat.name]);
    if (affected) {
      for (const row of affected as { id: string; categories: string[] }[]) {
        const updated = row.categories.filter((n) => n !== cat.name);
        await supabase
          .from("clients")
          .update({ categories: updated })
          .eq("id", row.id);
      }
    }
    await supabase.from("categories").delete().eq("id", cat.id);
    setDeletingCategoryId(null);
    if (activeCategory === cat.name) setActiveCategory(null);
    router.refresh();
  }

  async function handleAddCategoryInModal(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    const existing = categories.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      setNewCategoryName("");
      return;
    }
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: inserted, error } = await supabase
      .from("categories")
      .insert({
        name: trimmed,
        color_index: nextColorIndex(categories),
        created_by: user?.id ?? null,
      })
      .select()
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    setCategories((cats) => [...cats, inserted as Category]);
    setNewCategoryName("");
    router.refresh();
  }

  function closeManageCategories() {
    setShowManageCategories(false);
    setEditingCategoryId(null);
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-px rounded-2xl bg-black/[0.06] overflow-hidden mb-6 shadow-md ring-1 ring-black/[0.06]">
        <div className="bg-white px-4 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-amber/15 text-brand-amber-dark">
              <Users className="h-4 w-4" />
            </span>
            <p className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-slate-400">
              Clients
            </p>
          </div>
          <div className="flex items-baseline gap-2 mt-2.5">
            <p className="font-display text-2xl sm:text-3xl font-extrabold text-brand-ink">
              {clients.length}
            </p>
            {newThisMonth > 0 && (
              <span className="rounded-full bg-brand-amber/15 text-brand-amber-dark text-[10px] font-bold px-1.5 py-0.5">
                +{newThisMonth}
              </span>
            )}
          </div>
        </div>
        <div className="bg-white px-4 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <FileText className="h-4 w-4" />
            </span>
            <p className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-slate-400">
              Documents
            </p>
          </div>
          <p className="font-display text-2xl sm:text-3xl font-extrabold text-brand-ink mt-2.5">
            {totalDocuments}
          </p>
        </div>
        <div className="bg-white px-4 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
              <Tags className="h-4 w-4" />
            </span>
            <p className="text-[10px] sm:text-xs font-semibold tracking-wide uppercase text-slate-400">
              Categories
            </p>
          </div>
          <p className="font-display text-2xl sm:text-3xl font-extrabold text-brand-ink mt-2.5">
            {categories.length}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-4">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, location, category, or keyword…"
            className="w-full rounded-full border border-black/10 bg-white pl-10 pr-4 py-2.5 text-sm text-brand-ink shadow-md focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center rounded-full border border-black/10 bg-white p-1 shadow-md shrink-0">
            <button
              onClick={() => setViewMode("grid")}
              title="Grid view"
              className={`h-8 w-8 flex items-center justify-center rounded-full transition-colors ${
                viewMode === "grid"
                  ? "bg-brand-ink text-white"
                  : "text-slate-400 hover:text-brand-ink"
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              title="List view"
              className={`h-8 w-8 flex items-center justify-center rounded-full transition-colors ${
                viewMode === "list"
                  ? "bg-brand-ink text-white"
                  : "text-slate-400 hover:text-brand-ink"
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand-ink text-white text-sm font-semibold px-5 py-2.5 shadow-md hover:bg-black hover:shadow-lg transition-all whitespace-nowrap"
          >
            + Add client
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          onClick={() => setActiveCategory(null)}
          className={`rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
            activeCategory === null
              ? "bg-brand-ink text-white shadow-sm"
              : "bg-white border border-black/10 text-slate-600 shadow-sm hover:border-brand-amber"
          }`}
        >
          All ({clients.length})
        </button>
        {presentCategories.map((c) => {
          const style = styleForCategory(categories, c);
          return (
            <button
              key={c}
              onClick={() => setActiveCategory(activeCategory === c ? null : c)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                activeCategory === c
                  ? "bg-brand-ink text-white shadow-sm"
                  : "bg-white border border-black/10 text-slate-600 shadow-sm hover:border-brand-amber"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  activeCategory === c ? "bg-white" : style.dot
                }`}
              />
              {c} ({categoryCounts[c]})
            </button>
          );
        })}
        {isAdmin && (
          <button
            onClick={() => setShowManageCategories(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-black/15 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:border-brand-amber hover:text-brand-amber-dark transition-colors"
          >
            <Settings className="h-3 w-3" />
            Manage
          </button>
        )}
      </div>

      {showDocumentsSection && (
        <div className="mb-6">
          <p className="text-xs font-semibold tracking-wide uppercase text-slate-400 mb-2">
            Documents
            {searchingDocs
              ? " · searching…"
              : ` (${matchedDocuments.length})`}
          </p>
          {matchedDocuments.length > 0 ? (
            <ul className="divide-y divide-black/5 rounded-2xl bg-white shadow-md ring-1 ring-black/[0.06] overflow-hidden">
              {matchedDocuments.map((doc) => {
                const client = clientById.get(doc.client_id);
                return (
                  <li
                    key={doc.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-brand-amber/5 transition-colors"
                  >
                    <button
                      onClick={() => handlePreviewDoc(doc)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      title="Preview"
                    >
                      <FileIcon fileName={doc.file_name} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-brand-ink truncate">
                          {doc.file_name}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {formatBytes(doc.file_size)} · Uploaded{" "}
                          {formatDate(doc.created_at)}
                          {client ? ` · ${client.name}` : ""}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => router.push(`/clients/${doc.client_id}`)}
                      title={`Open ${client?.name ?? "client"}`}
                      className="p-2 text-slate-400 hover:text-brand-amber-dark transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handlePreviewDoc(doc)}
                      disabled={previewLoadingId === doc.id}
                      title="Preview"
                      className="p-2 text-slate-400 hover:text-brand-amber-dark transition-colors"
                    >
                      {previewLoadingId === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDownload(doc)}
                      title="Download"
                      className="p-2 text-slate-400 hover:text-brand-amber-dark transition-colors"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            !searchingDocs && (
              <p className="text-sm text-slate-500 py-6 text-center rounded-2xl bg-white shadow-md ring-1 ring-black/[0.06]">
                No documents match
                {query.trim() ? ` "${query.trim()}"` : " this filter"}.
              </p>
            )
          )}
        </div>
      )}

      {filtered.length === 0 && clients.length > 0 && (
        <p className="text-sm text-slate-500 py-12 text-center">
          No clients match your search.
        </p>
      )}

      {clients.length === 0 && (
        <div className="text-center py-16 border border-dashed border-black/15 rounded-2xl">
          <p className="text-brand-ink font-semibold">No clients yet</p>
          <p className="text-sm text-slate-500 mt-1">
            Add your first client to start uploading documents.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-full bg-brand-ink text-white text-sm font-semibold px-5 py-2.5 hover:bg-black transition-colors"
          >
            + Add client
          </button>
        </div>
      )}

      {viewMode === "grid" && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((client) => {
          const clientCats = client.categories || [];
          const accentStyle = styleForCategory(categories, clientCats[0]);
          const keywords = client.keywords || [];
          const docCount = docCounts[client.id] || 0;
          return (
            <div
              key={client.id}
              className="group relative overflow-hidden rounded-2xl bg-white p-5 pt-6 shadow-md ring-1 ring-black/[0.06] hover:shadow-xl hover:-translate-y-1 transition-all duration-200"
            >
              <span
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: accentStyle.dotHex }}
              />
              <div className="absolute top-4 right-4 flex items-center gap-1">
                <button
                  onClick={() => openEditModal(client)}
                  title="Edit client"
                  className="h-6 w-6 flex items-center justify-center rounded-full text-slate-400 bg-white/80 ring-1 ring-black/5 hover:text-brand-amber-dark hover:bg-brand-amber/10"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(client.id)}
                    disabled={deletingId === client.id}
                    title="Delete client"
                    className="h-6 w-6 flex items-center justify-center rounded-full text-slate-400 bg-white/80 ring-1 ring-black/5 hover:text-red-500 hover:bg-red-50"
                  >
                    {deletingId === client.id ? "…" : <X className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
              <Link href={`/clients/${client.id}`} className="block">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 shrink-0 rounded-full bg-brand-amber/15 text-brand-amber-dark font-display font-extrabold text-sm flex items-center justify-center ring-1 ring-black/5 overflow-hidden">
                    {client.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={client.logo_url}
                        alt=""
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      initials(client.name) || "?"
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-[15px] text-brand-ink tracking-tight truncate pr-4">
                      {client.name}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {docCount} document{docCount === 1 ? "" : "s"}
                    </p>
                    {(client.locations || []).length > 0 && (
                      <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {(client.locations || []).join(" · ")}
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                {clientCats.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mt-3.5">
                    {clientCats.map((cat) => {
                      const style = styleForCategory(categories, cat);
                      return (
                        <span
                          key={cat}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.fg}`}
                        >
                          {cat}
                        </span>
                      );
                    })}
                  </div>
                )}

                {keywords.length > 0 && (
                  <p className="text-xs text-slate-400 mt-1.5 truncate">
                    {keywords.slice(0, 3).join(" · ")}
                    {keywords.length > 3 ? ` +${keywords.length - 3}` : ""}
                  </p>
                )}

                <p className="text-[11px] text-slate-300 mt-4 pt-3 border-t border-black/5">
                  Added {formatDate(client.created_at)}
                </p>
              </Link>
            </div>
          );
        })}
      </div>
      )}

      {viewMode === "list" && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-md ring-1 ring-black/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-left">
                <th className="px-4 py-3">
                  <button
                    onClick={() => handleSort("name")}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-brand-ink transition-colors"
                  >
                    Name
                    {sortKey === "name" &&
                      (sortDir === "asc" ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      ))}
                  </button>
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Categories
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Location
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => handleSort("documents")}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-brand-ink transition-colors"
                  >
                    Documents
                    {sortKey === "documents" &&
                      (sortDir === "asc" ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      ))}
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => handleSort("added")}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-brand-ink transition-colors"
                  >
                    Added
                    {sortKey === "added" &&
                      (sortDir === "asc" ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      ))}
                  </button>
                </th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map((client) => {
                const clientCats = client.categories || [];
                const docCount = docCounts[client.id] || 0;
                return (
                  <tr
                    key={client.id}
                    className="group border-b border-black/5 last:border-0 hover:bg-brand-amber/5 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/clients/${client.id}`}
                        className="flex items-center gap-3 min-w-0"
                      >
                        <div className="h-9 w-9 shrink-0 rounded-full bg-brand-amber/15 text-brand-amber-dark font-display font-extrabold text-xs flex items-center justify-center ring-1 ring-black/5 overflow-hidden">
                          {client.logo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={client.logo_url}
                              alt=""
                              className="h-full w-full object-contain p-1"
                            />
                          ) : (
                            initials(client.name) || "?"
                          )}
                        </div>
                        <span className="font-semibold text-brand-ink truncate">
                          {client.name}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {clientCats.length > 0 ? (
                          clientCats.map((cat) => {
                            const style = styleForCategory(categories, cat);
                            return (
                              <span
                                key={cat}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.fg}`}
                              >
                                {cat}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {(client.locations || []).length > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0 text-slate-300" />
                          {(client.locations || []).join(", ")}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {docCount} document{docCount === 1 ? "" : "s"}
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {formatDate(client.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(client)}
                          title="Edit client"
                          className="h-7 w-7 flex items-center justify-center rounded-full text-slate-400 hover:text-brand-amber-dark hover:bg-brand-amber/10"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(client.id)}
                            disabled={deletingId === client.id}
                            title="Delete client"
                            className="h-7 w-7 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50"
                          >
                            {deletingId === client.id ? (
                              "…"
                            ) : (
                              <X className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div
          className="fixed inset-0 z-20 bg-brand-ink/50 flex items-center justify-center p-4"
          onClick={closeAddModal}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-bold text-brand-ink mb-4">
              {editingClientId ? "Edit client" : "Add a client"}
            </h2>
            <form onSubmit={handleAdd} className="space-y-4">
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
                  {error}
                </div>
              )}
              <div>
                <label
                  htmlFor="client-name"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Client name
                </label>
                <input
                  id="client-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
                  placeholder="e.g. Emirates Global Holdings"
                />
              </div>
              <div>
                <label
                  htmlFor="client-location"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Locations
                </label>
                <p className="text-xs text-slate-400 mb-2">
                  Add as many as apply — press Enter or click Add after each
                  one.
                </p>
                {locations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {locations.map((loc) => (
                      <span
                        key={loc}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-1"
                      >
                        {loc}
                        <button
                          type="button"
                          onClick={() => removeLocation(loc)}
                          title={`Remove ${loc}`}
                          className="text-slate-400 hover:text-red-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    id="client-location"
                    value={newLocationInput}
                    onChange={(e) => setNewLocationInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addLocation(e);
                    }}
                    className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
                    placeholder="e.g. Dubai, UAE"
                  />
                  <button
                    type="button"
                    onClick={addLocation}
                    disabled={!newLocationInput.trim()}
                    className="shrink-0 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold px-3 hover:bg-slate-200 transition-colors disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Categories
                </label>
                <p className="text-xs text-slate-400 mb-2">
                  Select any that apply — a client can belong to more than one.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((cat) => {
                    const style = styleForCategory(categories, cat.name);
                    const selected = selectedCategories.includes(cat.name);
                    return (
                      <button
                        type="button"
                        key={cat.id}
                        onClick={() => toggleSelectedCategory(cat.name)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                          selected
                            ? `${style.bg} ${style.fg} border-transparent`
                            : "bg-white text-slate-500 border-black/10 hover:border-brand-amber"
                        }`}
                      >
                        {cat.name}
                      </button>
                    );
                  })}
                  {categories.length === 0 && (
                    <p className="text-xs text-slate-400">
                      {isAdmin
                        ? "No categories yet — add one below."
                        : "No categories yet — ask an admin to add one."}
                    </p>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex gap-2 mt-2.5">
                    <input
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddNewCategoryInline(e);
                        }
                      }}
                      placeholder="+ Add new category…"
                      className="w-full rounded-xl border border-black/10 px-3 py-1.5 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={handleAddNewCategoryInline}
                      disabled={!newCategoryInput.trim()}
                      className="shrink-0 rounded-xl bg-slate-100 text-slate-600 text-sm font-semibold px-3 hover:bg-slate-200 transition-colors disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label
                  htmlFor="client-keywords"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Keywords
                </label>
                <input
                  id="client-keywords"
                  value={keywordsInput}
                  onChange={(e) => setKeywordsInput(e.target.value)}
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
                  placeholder="e.g. leadership, DISC, coaching"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Comma-separated — used for dashboard search &amp; filters.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeAddModal}
                  className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim()}
                  className="rounded-full bg-brand-ink text-white text-sm font-semibold px-5 py-2 hover:bg-black transition-colors disabled:opacity-60"
                >
                  {saving
                    ? editingClientId
                      ? "Saving…"
                      : "Adding…"
                    : editingClientId
                    ? "Save changes"
                    : "Add client"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showManageCategories && isAdmin && (
        <div
          className="fixed inset-0 z-20 bg-brand-ink/50 flex items-center justify-center p-4"
          onClick={closeManageCategories}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-bold text-brand-ink mb-4">
              Manage categories
            </h2>
            <div className="space-y-1 mb-4 overflow-y-auto">
              {categories.map((cat) => {
                const style = styleForCategory(categories, cat.name);
                const count = categoryCounts[cat.name] || 0;
                return (
                  <div
                    key={cat.id}
                    className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-slate-50"
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: style.dotHex }}
                    />
                    {editingCategoryId === cat.id ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(cat);
                          if (e.key === "Escape") setEditingCategoryId(null);
                        }}
                        onBlur={() => commitRename(cat)}
                        className="flex-1 min-w-0 rounded-lg border border-black/10 px-2 py-1 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          setEditingCategoryId(cat.id);
                          setEditingName(cat.name);
                        }}
                        title="Click to rename"
                        className="flex-1 min-w-0 text-left text-sm text-brand-ink truncate"
                      >
                        {cat.name}
                      </button>
                    )}
                    <span className="text-xs text-slate-400 shrink-0">
                      {count}
                    </span>
                    <button
                      onClick={() => handleDeleteCategory(cat)}
                      disabled={deletingCategoryId === cat.id}
                      title="Delete category"
                      className="h-6 w-6 shrink-0 flex items-center justify-center rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      {deletingCategoryId === cat.id ? (
                        "…"
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}
              {categories.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">
                  No categories yet.
                </p>
              )}
            </div>
            <form
              onSubmit={handleAddCategoryInModal}
              className="flex gap-2 pt-3 border-t border-black/5"
            >
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name"
                className="flex-1 min-w-0 rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
              />
              <button
                type="submit"
                disabled={!newCategoryName.trim()}
                className="shrink-0 rounded-xl bg-brand-ink text-white text-sm font-semibold px-4 py-2 hover:bg-black transition-colors disabled:opacity-60"
              >
                Add
              </button>
            </form>
            <div className="flex justify-end pt-4">
              <button
                onClick={closeManageCategories}
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <PreviewModal
          fileName={preview.doc.file_name}
          fileType={preview.doc.file_type || fileExt(preview.doc.file_name)}
          fileSize={preview.doc.file_size}
          url={preview.url}
          onClose={() => setPreview(null)}
          onDownload={() => handleDownload(preview.doc)}
        />
      )}
    </div>
  );
}

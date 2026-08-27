"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FileIcon, fileExt } from "@/components/file-icon";
import { PreviewModal } from "@/components/preview-modal";
import type { Document, Folder } from "@/types/db";
import {
  Upload,
  Download,
  Trash2,
  Loader2,
  Eye,
  Folder as FolderIcon,
  FolderPlus,
  FolderInput,
  Search,
  X,
  ChevronRight,
} from "lucide-react";

const ALLOWED_EXTENSIONS = [
  "pdf",
  "ppt",
  "pptx",
  "doc",
  "docx",
  "jpg",
  "jpeg",
  "png",
];
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB — raised after upgrading to Supabase Pro
const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");
const SEARCH_DEBOUNCE_MS = 300;

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

// Builds a Postgres prefix tsquery ("invoice:* & march:*") from whatever
// the user has typed so far, so results update as-you-type instead of only
// matching whole words.
function toPrefixTsQuery(input: string) {
  return input
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean)
    .map((word) => `${word}:*`)
    .join(" & ");
}

type PendingUpload = {
  key: string;
  name: string;
  status: "uploading" | "error";
  error?: string;
};

export function DocumentLibrary({
  clientId,
  initialDocuments,
  initialFolders,
}: {
  clientId: string;
  initialDocuments: Document[];
  initialFolders: Folder[];
}) {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>(initialDocuments);
  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(
    null
  );
  const [preview, setPreview] = useState<{ doc: Document; url: string } | null>(
    null
  );
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(
    null
  );
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Document[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [indexingIds, setIndexingIds] = useState<Set<string>>(new Set());
  const [backfilling, setBackfilling] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);

  const currentFolder = folders.find((f) => f.id === currentFolderId) || null;
  const visibleDocs = documents.filter(
    (d) => (d.folder_id ?? null) === currentFolderId
  );
  const isSearchActive = searchQuery.trim().length > 0;

  useEffect(() => {
    if (!moveMenuFor) return;
    function handleClick(e: MouseEvent) {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) {
        setMoveMenuFor(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moveMenuFor]);

  // Runs the content + file-name search as the user types, debounced so
  // we're not firing a query on every keystroke.
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const tsq = toPrefixTsQuery(query);
    if (!tsq) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("client_id", clientId)
        .textSearch("content_tsv", tsq)
        .order("created_at", { ascending: false })
        .limit(50);
      setSearchResults(error ? [] : (data as Document[]));
      setSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery, clientId]);

  // Fire-and-forget: kicks off text extraction right after a file
  // finishes uploading so it becomes searchable within a few seconds.
  // A failure here never blocks the upload — the file just stays
  // searchable by name only until someone retries indexing.
  const indexDocumentAsync = useCallback(
    (documentId: string) => {
      setIndexingIds((s) => new Set(s).add(documentId));
      fetch("/api/documents/extract-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId }),
      })
        .catch(() => {})
        .finally(() => {
          setIndexingIds((s) => {
            const next = new Set(s);
            next.delete(documentId);
            return next;
          });
          router.refresh();
        });
    },
    [router]
  );

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Names already present in the destination folder — checked up
      // front so an obvious duplicate never even starts uploading.
      // Names get added to this set as each upload succeeds, so
      // dropping two files with the same name in one go correctly
      // blocks the second one too.
      const existingNames = new Set(
        documents
          .filter((d) => (d.folder_id ?? null) === currentFolderId)
          .map((d) => d.file_name.toLowerCase())
      );

      for (const file of files) {
        const ext = fileExt(file.name);
        const key = `${file.name}-${file.size}-${Date.now()}`;
        const nameKey = file.name.toLowerCase();

        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          setPending((p) => [
            ...p,
            {
              key,
              name: file.name,
              status: "error",
              error: "Unsupported file type",
            },
          ]);
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          setPending((p) => [
            ...p,
            {
              key,
              name: file.name,
              status: "error",
              error: "File is larger than 1GB",
            },
          ]);
          continue;
        }
        if (existingNames.has(nameKey)) {
          setPending((p) => [
            ...p,
            {
              key,
              name: file.name,
              status: "error",
              error: "A file with this name already exists in this folder",
            },
          ]);
          continue;
        }

        setPending((p) => [...p, { key, name: file.name, status: "uploading" }]);

        const path = `${clientId}/${crypto.randomUUID()}-${sanitizeFileName(
          file.name
        )}`;

        const { error: uploadError } = await supabase.storage
          .from("client-documents")
          .upload(path, file, {
            upsert: false,
            contentType: file.type || undefined,
          });

        if (uploadError) {
          setPending((p) =>
            p.map((u) =>
              u.key === key
                ? { ...u, status: "error", error: uploadError.message }
                : u
            )
          );
          continue;
        }

        const { data: inserted, error: insertError } = await supabase
          .from("documents")
          .insert({
            client_id: clientId,
            folder_id: currentFolderId,
            file_name: file.name,
            storage_path: path,
            file_type: ext,
            file_size: file.size,
            uploaded_by: user?.id ?? null,
          })
          .select()
          .single();

        if (insertError) {
          // Someone may have uploaded the same name a split-second
          // before us, or two tabs raced each other — the database's
          // unique index is the final word beyond our up-front check
          // above. Clean up the now-orphaned storage blob either way.
          await supabase.storage.from("client-documents").remove([path]);
          setPending((p) =>
            p.map((u) =>
              u.key === key
                ? {
                    ...u,
                    status: "error",
                    error:
                      insertError.code === "23505"
                        ? "A file with this name already exists in this folder"
                        : insertError.message,
                  }
                : u
            )
          );
          continue;
        }

        existingNames.add(nameKey);
        setDocuments((docs) => [inserted as Document, ...docs]);
        setPending((p) => p.filter((u) => u.key !== key));
        indexDocumentAsync((inserted as Document).id);
      }

      router.refresh();
    },
    [clientId, currentFolderId, router, indexDocumentAsync, documents]
  );

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      e.target.value = "";
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  }

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

  async function handlePreview(doc: Document) {
    setPreviewLoadingId(doc.id);
    const url = await getSignedUrl(doc);
    setPreviewLoadingId(null);
    if (!url) {
      alert("Couldn't open a preview. Please try again.");
      return;
    }
    setPreview({ doc, url });
  }

  async function handleDelete(doc: Document) {
    if (!confirm(`Delete "${doc.file_name}"? This can't be undone.`)) return;
    setDeletingId(doc.id);
    const supabase = createClient();
    await supabase.storage.from("client-documents").remove([doc.storage_path]);
    await supabase.from("documents").delete().eq("id", doc.id);
    setDocuments((docs) => docs.filter((d) => d.id !== doc.id));
    setSearchResults((docs) =>
      docs ? docs.filter((d) => d.id !== doc.id) : docs
    );
    setDeletingId(null);
    router.refresh();
  }

  async function handleMove(doc: Document, folderId: string | null) {
    setMovingId(doc.id);
    setMoveMenuFor(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("documents")
      .update({ folder_id: folderId })
      .eq("id", doc.id);
    if (!error) {
      setDocuments((docs) =>
        docs.map((d) => (d.id === doc.id ? { ...d, folder_id: folderId } : d))
      );
      setSearchResults((docs) =>
        docs
          ? docs.map((d) => (d.id === doc.id ? { ...d, folder_id: folderId } : d))
          : docs
      );
      router.refresh();
    } else {
      alert(
        error.code === "23505"
          ? `A file named "${doc.file_name}" already exists in that folder.`
          : "Couldn't move the file. Please try again."
      );
    }
    setMovingId(null);
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;

    // Checked up front so an obvious duplicate never even hits the
    // database — the unique index below is just the safety net for a
    // race (e.g. two tabs creating the same folder at once).
    const nameKey = name.toLowerCase();
    if (folders.some((f) => f.name.toLowerCase() === nameKey)) {
      setFolderError("A folder with this name already exists.");
      return;
    }

    setFolderError(null);
    setCreatingFolder(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: inserted, error } = await supabase
      .from("folders")
      .insert({ client_id: clientId, name, created_by: user?.id ?? null })
      .select()
      .single();
    setCreatingFolder(false);
    if (error) {
      setFolderError(
        error.code === "23505"
          ? "A folder with this name already exists."
          : error.message
      );
      return;
    }
    setFolders((f) => [...f, inserted as Folder]);
    setNewFolderName("");
    setFolderError(null);
    setShowNewFolder(false);
    router.refresh();
  }

  async function handleDeleteFolder(folder: Folder) {
    if (
      !confirm(
        `Delete the "${folder.name}" folder? Documents inside will move back to All documents.`
      )
    )
      return;
    setDeletingFolderId(folder.id);
    const supabase = createClient();
    await supabase
      .from("documents")
      .update({ folder_id: null })
      .eq("folder_id", folder.id);
    await supabase.from("folders").delete().eq("id", folder.id);
    setDocuments((docs) =>
      docs.map((d) =>
        d.folder_id === folder.id ? { ...d, folder_id: null } : d
      )
    );
    setFolders((f) => f.filter((fo) => fo.id !== folder.id));
    if (currentFolderId === folder.id) setCurrentFolderId(null);
    setDeletingFolderId(null);
    router.refresh();
  }

  async function handleBackfillIndex() {
    setBackfilling(true);
    setBackfillStatus("Indexing older documents for search…");
    let processedTotal = 0;
    try {
      // Loops the batch endpoint until it reports nothing left — each
      // call only indexes ~15 documents so it stays fast, so a client
      // with a big backlog just makes a few more round trips here.
      for (let guard = 0; guard < 50; guard++) {
        const res = await fetch("/api/documents/backfill-index", {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) {
          setBackfillStatus(json.error || "Something went wrong.");
          break;
        }
        processedTotal += json.processed;
        if (!json.remaining) {
          setBackfillStatus(
            processedTotal > 0
              ? `Done — indexed ${processedTotal} document${
                  processedTotal === 1 ? "" : "s"
                } for search.`
              : "Everything is already indexed for search."
          );
          break;
        }
      }
    } catch {
      setBackfillStatus("Something went wrong. Please try again.");
    }
    setBackfilling(false);
    router.refresh();
  }

  function docCountInFolder(folderId: string) {
    return documents.filter((d) => (d.folder_id ?? null) === folderId).length;
  }

  function renderDocRow(doc: Document, opts?: { showFolder?: boolean }) {
    const folderName = doc.folder_id
      ? folders.find((f) => f.id === doc.folder_id)?.name
      : null;
    return (
      <li
        key={doc.id}
        className="flex items-center gap-3 px-4 py-3 hover:bg-brand-amber/5 transition-colors"
      >
        <button
          onClick={() => handlePreview(doc)}
          className="flex items-center gap-3 min-w-0 flex-1 text-left"
          title="Preview"
        >
          <FileIcon fileName={doc.file_name} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-brand-ink truncate">
              {doc.file_name}
            </p>
            <p className="text-xs text-slate-500">
              {formatBytes(doc.file_size)} · Uploaded{" "}
              {formatDate(doc.created_at)}
              {opts?.showFolder && folderName ? ` · in ${folderName}` : ""}
              {indexingIds.has(doc.id) ? " · Indexing for search…" : ""}
            </p>
          </div>
        </button>
        <div className="relative">
          <button
            onClick={() =>
              setMoveMenuFor(moveMenuFor === doc.id ? null : doc.id)
            }
            disabled={movingId === doc.id}
            title="Move to folder"
            className="p-2 text-slate-400 hover:text-brand-amber-dark transition-colors"
          >
            {movingId === doc.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FolderInput className="h-4 w-4" />
            )}
          </button>
          {moveMenuFor === doc.id && (
            <div
              ref={moveMenuRef}
              className="absolute right-0 top-full mt-1 z-10 w-48 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-black/10"
            >
              <button
                onClick={() => handleMove(doc, null)}
                disabled={!doc.folder_id}
                className="w-full text-left rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              >
                No folder
              </button>
              {folders.length > 0 && (
                <div className="my-1 border-t border-black/5" />
              )}
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => handleMove(doc, folder.id)}
                  disabled={doc.folder_id === folder.id}
                  className="w-full flex items-center gap-2 text-left rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                >
                  <FolderIcon className="h-3.5 w-3.5 shrink-0 text-brand-amber-dark" />
                  <span className="truncate">{folder.name}</span>
                </button>
              ))}
              {folders.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">
                  Create a folder first.
                </p>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => handlePreview(doc)}
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
        <button
          onClick={() => handleDelete(doc)}
          disabled={deletingId === doc.id}
          title="Delete"
          className="p-2 text-slate-400 hover:text-red-500 transition-colors"
        >
          {deletingId === doc.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </li>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1.5 text-sm">
          <button
            onClick={() => setCurrentFolderId(null)}
            className={`font-medium transition-colors ${
              currentFolder
                ? "text-slate-500 hover:text-brand-amber-dark"
                : "text-brand-ink font-semibold"
            }`}
          >
            All documents
          </button>
          {currentFolder && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
              <span className="font-semibold text-brand-ink">
                {currentFolder.name}
              </span>
            </>
          )}
        </div>
        {!currentFolder && (
          <button
            onClick={() => {
              setFolderError(null);
              setShowNewFolder(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:border-brand-amber hover:text-brand-amber-dark transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New folder
          </button>
        )}
      </div>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search this client's documents by name or content…"
          className="w-full rounded-full border border-black/10 bg-white pl-10 pr-9 py-2.5 text-sm text-brand-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            title="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-ink transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!isSearchActive && (
        <div className="flex items-center justify-between -mt-2 mb-4">
          <button
            onClick={handleBackfillIndex}
            disabled={backfilling}
            className="text-xs font-medium text-slate-400 hover:text-brand-amber-dark transition-colors disabled:opacity-60"
          >
            {backfilling ? "Indexing…" : "Index older documents for search"}
          </button>
          {backfillStatus && (
            <span className="text-xs text-slate-400">{backfillStatus}</span>
          )}
        </div>
      )}

      {!isSearchActive && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging
              ? "border-brand-amber bg-brand-amber/10"
              : "border-black/15 bg-white hover:border-brand-amber/60"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            onChange={handleFileInput}
            className="hidden"
          />
          <Upload className="mx-auto h-6 w-6 text-brand-amber-dark mb-2" />
          <p className="text-sm font-semibold text-brand-ink">
            Drag files here, or click to browse
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {currentFolder
              ? `Uploads here go into "${currentFolder.name}" — `
              : ""}
            PDF, Word, PowerPoint, JPEG, PNG — up to 1GB each
          </p>
        </div>
      )}

      {!isSearchActive && pending.length > 0 && (
        <div className="mt-4 space-y-2">
          {pending.map((u) => (
            <div
              key={u.key}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                u.status === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              {u.status === "uploading" ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              ) : (
                <span className="shrink-0">⚠</span>
              )}
              <span className="truncate flex-1">{u.name}</span>
              {u.status === "error" && (
                <span className="text-xs shrink-0">{u.error}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {isSearchActive ? (
        <div className="mt-2">
          {searching ? (
            <p className="text-sm text-slate-500 text-center py-10 flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </p>
          ) : searchResults && searchResults.length > 0 ? (
            <>
              <p className="text-xs text-slate-400 mb-2">
                {searchResults.length} result
                {searchResults.length === 1 ? "" : "s"} — searches file names
                and, where indexed, the text inside PDFs, Word, and
                PowerPoint files.
              </p>
              <ul className="divide-y divide-black/5 border border-black/10 rounded-2xl overflow-hidden bg-white">
                {searchResults.map((doc) => renderDocRow(doc, { showFolder: true }))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-slate-500 text-center py-10">
              No documents match &quot;{searchQuery.trim()}&quot;.
            </p>
          )}
        </div>
      ) : (
        <>
          {!currentFolder && folders.length > 0 && (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  onClick={() => setCurrentFolderId(folder.id)}
                  className="group relative cursor-pointer rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/[0.06] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFolder(folder);
                    }}
                    disabled={deletingFolderId === folder.id}
                    title="Delete folder"
                    className="absolute top-3 right-3 h-6 w-6 flex items-center justify-center rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    {deletingFolderId === folder.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-amber/15 text-brand-amber-dark">
                    <FolderIcon className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-brand-ink truncate pr-4">
                    {folder.name}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {docCountInFolder(folder.id)} document
                    {docCountInFolder(folder.id) === 1 ? "" : "s"}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6">
            {visibleDocs.length === 0 && pending.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-10">
                {currentFolder
                  ? "No documents in this folder yet."
                  : folders.length > 0
                  ? "No unfiled documents."
                  : "No documents uploaded yet."}
              </p>
            ) : (
              <ul className="divide-y divide-black/5 border border-black/10 rounded-2xl overflow-hidden bg-white">
                {visibleDocs.map((doc) => renderDocRow(doc))}
              </ul>
            )}
          </div>
        </>
      )}

      {showNewFolder && (
        <div
          className="fixed inset-0 z-20 bg-brand-ink/50 flex items-center justify-center p-4"
          onClick={() => {
            if (creatingFolder) return;
            setShowNewFolder(false);
            setFolderError(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-bold text-brand-ink mb-4">
              New folder
            </h2>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              {folderError && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
                  {folderError}
                </div>
              )}
              <div>
                <label
                  htmlFor="folder-name"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Folder name
                </label>
                <input
                  id="folder-name"
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => {
                    setNewFolderName(e.target.value);
                    if (folderError) setFolderError(null);
                  }}
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
                  placeholder="e.g. Contracts"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewFolder(false);
                    setFolderError(null);
                  }}
                  className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingFolder || !newFolderName.trim()}
                  className="rounded-full bg-brand-ink text-white text-sm font-semibold px-5 py-2 hover:bg-black transition-colors disabled:opacity-60"
                >
                  {creatingFolder ? "Creating…" : "Create folder"}
                </button>
              </div>
            </form>
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

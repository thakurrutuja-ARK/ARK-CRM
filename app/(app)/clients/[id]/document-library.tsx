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
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — Supabase free-tier per-file limit
const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

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
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(
    null
  );
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);

  const currentFolder = folders.find((f) => f.id === currentFolderId) || null;
  const visibleDocs = documents.filter(
    (d) => (d.folder_id ?? null) === currentFolderId
  );

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

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      for (const file of files) {
        const ext = fileExt(file.name);
        const key = `${file.name}-${file.size}-${Date.now()}`;

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
              error: "File is larger than 50MB",
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
          setPending((p) =>
            p.map((u) =>
              u.key === key
                ? { ...u, status: "error", error: insertError.message }
                : u
            )
          );
          continue;
        }

        setDocuments((docs) => [inserted as Document, ...docs]);
        setPending((p) => p.filter((u) => u.key !== key));
      }

      router.refresh();
    },
    [clientId, currentFolderId, router]
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
      router.refresh();
    }
    setMovingId(null);
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
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
      alert(error.message);
      return;
    }
    setFolders((f) => [...f, inserted as Folder]);
    setNewFolderName("");
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

  function docCountInFolder(folderId: string) {
    return documents.filter((d) => (d.folder_id ?? null) === folderId).length;
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
            onClick={() => setShowNewFolder(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:border-brand-amber hover:text-brand-amber-dark transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New folder
          </button>
        )}
      </div>

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
          PDF, Word, PowerPoint, JPEG, PNG — up to 50MB each
        </p>
      </div>

      {pending.length > 0 && (
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
            {visibleDocs.map((doc) => (
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
            ))}
          </ul>
        )}
      </div>

      {showNewFolder && (
        <div
          className="fixed inset-0 z-20 bg-brand-ink/50 flex items-center justify-center p-4"
          onClick={() => !creatingFolder && setShowNewFolder(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-bold text-brand-ink mb-4">
              New folder
            </h2>
            <form onSubmit={handleCreateFolder} className="space-y-4">
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
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand-amber focus:border-transparent"
                  placeholder="e.g. Contracts"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFolder(false)}
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
          url={preview.url}
          onClose={() => setPreview(null)}
          onDownload={() => handleDownload(preview.doc)}
        />
      )}
    </div>
  );
}

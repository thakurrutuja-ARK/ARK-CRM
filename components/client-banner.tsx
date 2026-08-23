"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Document } from "@/types/db";
import { Camera, X } from "lucide-react";

const LOGO_MAX_SIZE = 5 * 1024 * 1024;
const LOGO_ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

const EXT_COLORS: Record<string, string> = {
  pdf: "bg-red-500",
  doc: "bg-blue-500",
  docx: "bg-blue-500",
  ppt: "bg-orange-500",
  pptx: "bg-orange-500",
  jpg: "bg-emerald-500",
  jpeg: "bg-emerald-500",
  png: "bg-emerald-500",
};

const IMAGE_EXTS = ["jpg", "jpeg", "png"];
const MAX_TILES = 9;

// Deterministic scatter — cycles by index so server/client render match (no Math.random()).
const ROTATIONS = [-6, 4, -3, 7, -8, 2, -5, 6, -2];
const SIZES = [
  "h-16 w-16 sm:h-20 sm:w-20",
  "h-14 w-14 sm:h-16 sm:w-16",
  "h-16 w-16 sm:h-20 sm:w-20",
  "h-14 w-14 sm:h-16 sm:w-16",
];

function ext(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export function ClientBanner({
  clientId,
  name,
  documents,
  logoUrl,
}: {
  clientId: string;
  name: string;
  documents: Document[];
  logoUrl: string | null;
}) {
  const router = useRouter();
  const hasDocs = documents.length > 0;
  const tiles = documents.slice(0, MAX_TILES);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<string | null>(logoUrl);
  const [uploading, setUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLogo(logoUrl);
  }, [logoUrl]);

  async function handleLogoFile(file: File) {
    setLogoError(null);
    if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
      setLogoError("Use a PNG, JPG, WebP, or SVG image.");
      return;
    }
    if (file.size > LOGO_MAX_SIZE) {
      setLogoError("Image is larger than 5MB.");
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const ext = file.name.includes(".")
      ? file.name.split(".").pop()!.toLowerCase()
      : "png";
    const path = `${clientId}/logo-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("client-logos")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      setUploading(false);
      setLogoError(uploadError.message);
      return;
    }
    const { data } = supabase.storage.from("client-logos").getPublicUrl(path);
    const publicUrl = data.publicUrl;
    const { error: updateError } = await supabase
      .from("clients")
      .update({ logo_url: publicUrl })
      .eq("id", clientId);
    setUploading(false);
    if (updateError) {
      setLogoError(updateError.message);
      return;
    }
    setLogo(publicUrl);
    router.refresh();
  }

  async function handleRemoveLogo() {
    if (!confirm("Remove this client's logo?")) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("clients")
      .update({ logo_url: null })
      .eq("id", clientId);
    if (error) {
      setLogoError(error.message);
      return;
    }
    setLogo(null);
    router.refresh();
  }

  useEffect(() => {
    let cancelled = false;
    const imageDocs = tiles.filter((doc) =>
      IMAGE_EXTS.includes(doc.file_type || ext(doc.file_name))
    );
    if (imageDocs.length === 0) return;

    (async () => {
      const supabase = createClient();
      const entries = await Promise.all(
        imageDocs.map(async (doc) => {
          const { data } = await supabase.storage
            .from("client-documents")
            .createSignedUrl(doc.storage_path, 300);
          return [doc.id, data?.signedUrl || ""] as const;
        })
      );
      if (!cancelled) {
        setThumbUrls(Object.fromEntries(entries.filter(([, u]) => u)));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents.map((d) => d.id).join(",")]);

  return (
    <div className="mb-10">
      <div
        className={`relative h-44 sm:h-56 rounded-3xl overflow-hidden ${
          hasDocs
            ? "bg-[#f2efe8]"
            : "bg-gradient-to-br from-brand-amber via-brand-amber to-brand-amber-dark"
        }`}
      >
        {hasDocs ? (
          <>
            {/* photo-wall strip of uploaded documents — a single row, never touches the name/avatar */}
            <div className="absolute inset-x-0 top-0 h-24 sm:h-28 overflow-hidden">
              <div className="flex flex-nowrap items-start gap-2.5 sm:gap-3 p-4 sm:p-5">
                {tiles.map((doc, i) => {
                  const e = doc.file_type || ext(doc.file_name);
                  const isImage = IMAGE_EXTS.includes(e) && !!thumbUrls[doc.id];
                  const rotation = ROTATIONS[i % ROTATIONS.length];
                  const size = SIZES[i % SIZES.length];
                  return (
                    <div
                      key={doc.id}
                      className={`${size} shrink-0 bg-white p-1 rounded-lg shadow-md`}
                      style={{ transform: `rotate(${rotation}deg)` }}
                      title={doc.file_name}
                    >
                      <div className="h-full w-full rounded-md overflow-hidden bg-slate-100">
                        {isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbUrls[doc.id]}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div
                            className={`h-full w-full flex items-center justify-center text-white text-[9px] sm:text-[10px] font-bold ${
                              EXT_COLORS[e] || "bg-slate-400"
                            }`}
                          >
                            {e ? e.toUpperCase() : "FILE"}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* scrim so the name stays legible over the collage */}
            <div className="absolute inset-x-0 bottom-0 h-24 sm:h-28 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />
          </>
        ) : (
          <>
            {/* decorative blobs, echoing ARK's hero pattern */}
            <div className="absolute -top-10 -right-6 h-36 w-36 rounded-full bg-white/15" />
            <div className="absolute -bottom-10 left-16 h-28 w-28 rounded-full bg-black/5" />
            <div className="absolute top-2 left-1/3 h-14 w-14 rounded-full bg-white/10" />
          </>
        )}

        {/* avatar + name, overlaid bottom-left */}
        <div className="absolute bottom-4 left-4 sm:left-5 right-4 flex items-center gap-3">
          <div
            className={`group/avatar relative h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-2xl font-display font-extrabold text-lg flex items-center justify-center shadow-lg overflow-hidden ${
              logo
                ? "bg-white ring-4 ring-white/10"
                : hasDocs
                ? "bg-brand-amber text-brand-ink ring-4 ring-white/10"
                : "bg-white text-brand-amber-dark ring-4 ring-[var(--background)]"
            }`}
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo}
                alt={`${name} logo`}
                className="h-full w-full object-contain p-1.5"
              />
            ) : (
              initials(name) || "?"
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title={logo ? "Change logo" : "Add logo"}
              className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover/avatar:opacity-100 transition-opacity disabled:opacity-100 disabled:cursor-wait"
            >
              {uploading ? (
                <span className="text-[10px] font-semibold">…</span>
              ) : (
                <Camera className="h-5 w-5" />
              )}
            </button>
            {logo && !uploading && (
              <button
                type="button"
                onClick={handleRemoveLogo}
                title="Remove logo"
                className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity hover:bg-red-500"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleLogoFile(file);
                e.target.value = "";
              }}
            />
          </div>
          <div className="min-w-0">
            <h1
              className={`font-display text-xl sm:text-2xl font-extrabold tracking-tight truncate ${
                hasDocs ? "text-white drop-shadow-sm" : "text-brand-ink"
              }`}
            >
              {name}
            </h1>
            <p
              className={`text-xs sm:text-sm mt-0.5 ${
                hasDocs ? "text-white/80" : "text-slate-500"
              }`}
            >
              {documents.length} document{documents.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>
      {logoError && (
        <p className="text-xs text-red-600 mt-2">{logoError}</p>
      )}
    </div>
  );
}

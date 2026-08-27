"use client";

import { Download, X } from "lucide-react";

const INLINE_PREVIEWABLE = ["pdf", "jpg", "jpeg", "png"];
const IMAGE_TYPES = ["jpg", "jpeg", "png"];
// Browsers can't render these natively — Microsoft's free Office Online
// Viewer renders them in an iframe instead, given a URL it can fetch the
// file from (our signed URLs work fine for this, they're just temporary
// public links).
const OFFICE_PREVIEWABLE = ["ppt", "pptx", "doc", "docx"];
// Microsoft's free Office Online Viewer refuses to open anything past this
// size (it shows its own "File too large" error page inside the iframe) —
// checking up front lets us show our own message instead of that.
const OFFICE_VIEWER_MAX_BYTES = 10 * 1024 * 1024; // 10MB

export function PreviewModal({
  fileName,
  fileType,
  fileSize,
  url,
  onClose,
  onDownload,
}: {
  fileName: string;
  fileType: string;
  fileSize?: number | null;
  url: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const isOffice = OFFICE_PREVIEWABLE.includes(fileType);
  const tooLargeForOfficeViewer =
    isOffice && !!fileSize && fileSize > OFFICE_VIEWER_MAX_BYTES;
  const canPreview =
    (INLINE_PREVIEWABLE.includes(fileType) || isOffice) &&
    !tooLargeForOfficeViewer;
  const isImage = IMAGE_TYPES.includes(fileType);
  const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(
    url
  )}`;

  return (
    <div
      className="fixed inset-0 z-30 bg-brand-ink/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl h-[85vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 shrink-0">
          <p className="text-sm font-semibold text-brand-ink truncate pr-4">
            {fileName}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onDownload}
              title="Download"
              className="p-2 text-slate-400 hover:text-brand-amber-dark transition-colors"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              title="Close"
              className="p-2 text-slate-400 hover:text-brand-ink transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 bg-[#faf9f7] flex items-center justify-center overflow-auto">
          {canPreview ? (
            isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={fileName}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <iframe
                src={isOffice ? officeViewerUrl : url}
                title={fileName}
                className="w-full h-full"
              />
            )
          ) : (
            <div className="text-center px-6">
              <p className="text-sm text-slate-600">
                {tooLargeForOfficeViewer
                  ? "This file is too large to preview online (the viewer supports files up to 10MB)."
                  : "Preview isn't available for this file type."}
              </p>
              <button
                onClick={onDownload}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-ink text-white text-sm font-semibold px-5 py-2 hover:bg-black transition-colors"
              >
                Download to view
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

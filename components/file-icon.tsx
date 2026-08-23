import { FileText, FileImage, FileSpreadsheet, File } from "lucide-react";

const EXT_STYLES: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; bg: string; fg: string; label: string }
> = {
  pdf: { icon: FileText, bg: "bg-red-50", fg: "text-red-600", label: "PDF" },
  doc: { icon: FileText, bg: "bg-blue-50", fg: "text-blue-600", label: "DOC" },
  docx: { icon: FileText, bg: "bg-blue-50", fg: "text-blue-600", label: "DOC" },
  ppt: {
    icon: FileSpreadsheet,
    bg: "bg-orange-50",
    fg: "text-orange-600",
    label: "PPT",
  },
  pptx: {
    icon: FileSpreadsheet,
    bg: "bg-orange-50",
    fg: "text-orange-600",
    label: "PPT",
  },
  jpg: { icon: FileImage, bg: "bg-emerald-50", fg: "text-emerald-600", label: "JPG" },
  jpeg: { icon: FileImage, bg: "bg-emerald-50", fg: "text-emerald-600", label: "JPG" },
  png: { icon: FileImage, bg: "bg-emerald-50", fg: "text-emerald-600", label: "PNG" },
};

export function fileExt(fileName: string) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export function FileIcon({ fileName }: { fileName: string }) {
  const ext = fileExt(fileName);
  const style = EXT_STYLES[ext] || {
    icon: File,
    bg: "bg-slate-100",
    fg: "text-slate-500",
    label: ext ? ext.toUpperCase() : "FILE",
  };
  const Icon = style.icon;
  return (
    <div
      className={`h-10 w-10 shrink-0 rounded-lg ${style.bg} ${style.fg} flex items-center justify-center`}
    >
      <Icon className="h-5 w-5" />
    </div>
  );
}

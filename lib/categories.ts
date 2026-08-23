export type CategoryStyle = {
  bg: string;
  fg: string;
  border: string;
  dot: string;
  dotHex: string;
};

// A rotating palette — each managed category is assigned the next color
// in this list when it's created, so colors stay visually distinct
// without anyone having to pick one by hand.
export const CATEGORY_PALETTE: CategoryStyle[] = [
  { bg: "bg-rose-50", fg: "text-rose-700", border: "border-rose-200", dot: "bg-rose-400", dotHex: "#fb7185" },
  { bg: "bg-blue-50", fg: "text-blue-700", border: "border-blue-200", dot: "bg-blue-400", dotHex: "#60a5fa" },
  { bg: "bg-slate-100", fg: "text-slate-700", border: "border-slate-300", dot: "bg-slate-400", dotHex: "#94a3b8" },
  { bg: "bg-emerald-50", fg: "text-emerald-700", border: "border-emerald-200", dot: "bg-emerald-400", dotHex: "#34d399" },
  { bg: "bg-amber-50", fg: "text-amber-800", border: "border-amber-200", dot: "bg-amber-400", dotHex: "#fbbf24" },
  { bg: "bg-indigo-50", fg: "text-indigo-700", border: "border-indigo-200", dot: "bg-indigo-400", dotHex: "#818cf8" },
  { bg: "bg-orange-50", fg: "text-orange-700", border: "border-orange-200", dot: "bg-orange-400", dotHex: "#fb923c" },
  { bg: "bg-cyan-50", fg: "text-cyan-700", border: "border-cyan-200", dot: "bg-cyan-400", dotHex: "#22d3ee" },
  { bg: "bg-violet-50", fg: "text-violet-700", border: "border-violet-200", dot: "bg-violet-400", dotHex: "#a78bfa" },
  { bg: "bg-teal-50", fg: "text-teal-700", border: "border-teal-200", dot: "bg-teal-400", dotHex: "#2dd4bf" },
  { bg: "bg-fuchsia-50", fg: "text-fuchsia-700", border: "border-fuchsia-200", dot: "bg-fuchsia-400", dotHex: "#e879f9" },
  { bg: "bg-lime-50", fg: "text-lime-700", border: "border-lime-200", dot: "bg-lime-400", dotHex: "#a3e635" },
];

export const DEFAULT_CATEGORY_STYLE: CategoryStyle = {
  bg: "bg-slate-50",
  fg: "text-slate-500",
  border: "border-slate-200",
  dot: "bg-slate-400",
  dotHex: "#94a3b8",
};

// Used only to seed a brand-new workspace. After that, categories are a
// fully managed list that teammates can rename or delete from the
// dashboard — this is no longer a fixed set.
export const DEFAULT_CATEGORY_NAMES = [
  "Retail & Hospitality",
  "Financial Services",
  "Government & Public Sector",
  "Healthcare",
  "Real Estate & Construction",
  "Technology & Telecom",
  "Oil & Gas / Energy",
  "Manufacturing & Industrial",
  "Other",
];

export function styleForCategory(
  categories: { name: string; color_index: number }[],
  name?: string | null
): CategoryStyle {
  if (!name) return DEFAULT_CATEGORY_STYLE;
  const cat = categories.find((c) => c.name === name);
  if (!cat) return DEFAULT_CATEGORY_STYLE;
  return CATEGORY_PALETTE[cat.color_index % CATEGORY_PALETTE.length];
}

export function nextColorIndex(categories: { color_index: number }[]): number {
  return categories.length % CATEGORY_PALETTE.length;
}

export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

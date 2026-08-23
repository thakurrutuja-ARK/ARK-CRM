import { styleForCategory } from "@/lib/categories";
import type { Category } from "@/types/db";

export function ClientTags({
  clientCategories,
  keywords,
  categories,
}: {
  clientCategories?: string[] | null;
  keywords?: string[] | null;
  categories: Pick<Category, "name" | "color_index">[];
}) {
  const cats = clientCategories || [];
  const kws = keywords || [];
  if (cats.length === 0 && kws.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      {cats.map((cat) => {
        const style = styleForCategory(categories, cat);
        return (
          <span
            key={cat}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${style.bg} ${style.fg}`}
          >
            {cat}
          </span>
        );
      })}
      {kws.map((k) => (
        <span
          key={k}
          className="rounded-full bg-slate-100 text-slate-500 text-xs px-3 py-1"
        >
          {k}
        </span>
      ))}
    </div>
  );
}

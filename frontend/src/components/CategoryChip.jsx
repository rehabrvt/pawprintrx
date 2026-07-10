import { getCategoryColor, colorWithAlpha } from "../lib/categoryColors";

/**
 * Tinted pill that shows a category name. Background = 14% alpha of the
 * category color; text + the leading dot use the full saturated color.
 */
export function CategoryChip({ name, size = "sm", className = "", testid }) {
  if (!name) return null;
  const color = getCategoryColor(name);
  const padding = size === "xs" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs";
  return (
    <span
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-widest ${padding} ${className}`}
      style={{ backgroundColor: colorWithAlpha(color, 0.14), color }}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}

/**
 * Solid filled pill, used for the active filter state.
 */
export function CategoryChipSolid({ name, className = "", testid, children }) {
  const color = getCategoryColor(name);
  return (
    <span
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold text-xs px-3 py-1 ${className}`}
      style={{ backgroundColor: color, color: "#fff" }}
    >
      {children ?? name}
    </span>
  );
}

// Map of category name -> hex color, kept in module scope and lazily populated.
// Callers should invoke setCategoryColors() with the items[] from /api/exercises/categories.
let CACHE = {};

const FALLBACK = "#787672"; // muted neutral

export function setCategoryColors(items) {
  if (!Array.isArray(items)) return;
  const next = {};
  items.forEach((c) => {
    if (c && c.name) next[c.name] = c.color || FALLBACK;
  });
  CACHE = next;
}

export function getCategoryColor(name) {
  if (!name) return FALLBACK;
  return CACHE[name] || FALLBACK;
}

// Hex helpers — produce a soft tinted background paired with the bold text color
// (e.g. CategoryChip uses bg = colorWithAlpha(color, 0.14) and color = color itself).
export function colorWithAlpha(hex, alpha = 1) {
  if (!hex || hex[0] !== "#") return `rgba(120,118,114,${alpha})`;
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Pick a readable text color (black/white) over a given hex background.
export function contrastText(hex) {
  if (!hex || hex[0] !== "#") return "#fff";
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1a1a1a" : "#fff";
}

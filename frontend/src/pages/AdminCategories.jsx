import { useEffect, useState } from "react";
import { api, formatError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { useAuth } from "../contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Tags, Check, X } from "lucide-react";
import { colorWithAlpha } from "../lib/categoryColors";

// Curated palette of category colors. Keep them desaturated enough to stay
// legible on the cream app background.
const PALETTE = [
  "#C96A52", // terracotta
  "#7C6EAE", // iris
  "#3F7CAC", // ocean blue
  "#D8A14A", // honey amber
  "#5B7566", // forest moss
  "#B9577A", // rose
  "#46998B", // teal
  "#2C312E", // ink charcoal
  "#A65D44", // copper
  "#6E8FB8", // sky
  "#9F7AAE", // lavender
  "#787672", // muted neutral (default)
];

const DEFAULT_COLOR = "#787672";

function Swatch({ color, selected, onSelect, label }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(color)}
      title={label || color}
      aria-label={`Pick color ${color}`}
      className={`h-7 w-7 rounded-full transition flex items-center justify-center ${selected ? "ring-2 ring-offset-2 ring-[#1a1a1a]" : "hover:scale-110"}`}
      style={{ backgroundColor: color }}
    >
      {selected ? <Check size={14} className="text-white drop-shadow" /> : null}
    </button>
  );
}

function ColorRow({ value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PALETTE.map((c) => (
        <Swatch key={c} color={c} selected={(value || "").toLowerCase() === c.toLowerCase()} onSelect={onChange} />
      ))}
      <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-[#E2DFD8]">
        <span className="text-xs text-[#787672]">More colors</span>
        <input
          type="color"
          value={value || DEFAULT_COLOR}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-7 rounded-full border border-[#E2DFD8] cursor-pointer bg-transparent p-0"
          data-testid="category-color-wheel"
          title="Pick any color"
        />
      </div>
    </div>
  );
}

export default function AdminCategories() {
  const { user } = useAuth();
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(DEFAULT_COLOR);

  async function load() {
    try {
      const { data } = await api.get("/exercises/categories");
      setCats(data.items || []);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Could not load categories");
    }
  }
  useEffect(() => { load(); }, []);

  if (!user?.is_admin) return <Navigate to={user?.role === "owner" ? "/owner" : "/clinician"} replace />;

  async function addCategory() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.post("/exercise-categories", { name, color: newColor });
      toast.success(`Added "${name}"`);
      setNewName("");
      setNewColor(PALETTE[(cats.length + 1) % PALETTE.length]);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not add"); }
    finally { setBusy(false); }
  }

  function startEdit(c) { setEditingId(c.category_id); setDraftName(c.name); setDraftColor(c.color || DEFAULT_COLOR); }
  function cancelEdit() { setEditingId(null); setDraftName(""); setDraftColor(DEFAULT_COLOR); }
  async function saveEdit() {
    const name = draftName.trim();
    if (!name) return;
    try {
      const { data } = await api.put(`/exercise-categories/${editingId}`, { name, color: draftColor });
      toast.success(`Saved${data.exercises_migrated ? ` (migrated ${data.exercises_migrated} exercise${data.exercises_migrated === 1 ? "" : "s"})` : ""}`);
      cancelEdit();
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not save"); }
  }

  async function deleteCategory(c) {
    if (!window.confirm(`Delete "${c.name}"? Exercises using this category must be reassigned first.`)) return;
    try {
      await api.delete(`/exercise-categories/${c.category_id}`);
      toast.success(`Deleted "${c.name}"`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not delete"); }
  }

  return (
    <div className="space-y-8" data-testid="admin-categories">
      <div>
        <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Admin</p>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mt-1">Exercise categories</h1>
        <p className="text-[#787672] mt-2">
          Manage category names and chip colors. Colors appear on cards, filter chips, and plan items across the app.
        </p>
      </div>

      <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6 max-w-2xl space-y-4">
        <div>
          <Label>New category name</Label>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Aquatic, Cognitive…"
            data-testid="new-category-input"
            className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1"
            onKeyDown={(e) => e.key === "Enter" && addCategory()}
          />
        </div>
        <div>
          <Label>Chip color</Label>
          <div className="mt-2"><ColorRow value={newColor} onChange={setNewColor} /></div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-[#787672]">Preview:</span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-widest px-2.5 py-1 text-xs"
              style={{ backgroundColor: colorWithAlpha(newColor, 0.14), color: newColor }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: newColor }} />
              {newName || "Category"}
            </span>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={addCategory}
            disabled={busy || !newName.trim()}
            className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]"
            data-testid="add-category-btn"
          >
            <Plus size={16} /> Add category
          </Button>
        </div>
      </div>

      <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6 max-w-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Tags size={18} className="text-[#C96A52]" />
          <h3 className="font-display text-xl font-semibold">All categories</h3>
          <span className="text-xs text-[#787672]">· {cats.length} total</span>
        </div>
        {cats.length === 0 ? (
          <p className="text-sm text-[#787672] py-4">No categories yet. Add the first one above.</p>
        ) : (
          <ul className="divide-y divide-[#E2DFD8]" data-testid="category-list">
            {cats.map((c) => {
              const color = c.color || DEFAULT_COLOR;
              const isEditing = editingId === c.category_id;
              return (
                <li key={c.category_id} className="py-3 space-y-2" data-testid={`category-row-${c.category_id}`}>
                  <div className="flex items-center gap-3">
                    <span className="inline-block w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    {isEditing ? (
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        className="flex-1 bg-[#F3F0EB] border-transparent"
                        data-testid={`category-rename-input-${c.category_id}`}
                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                        autoFocus
                      />
                    ) : (
                      <p className="font-semibold flex-1">{c.name}</p>
                    )}
                    {isEditing ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={saveEdit} className="text-[#5B7566]" data-testid={`category-save-${c.category_id}`}><Check size={14} /></Button>
                        <Button variant="ghost" size="sm" onClick={cancelEdit} className="text-[#787672]"><X size={14} /></Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => startEdit(c)} className="text-[#787672] hover:text-[#C96A52]" data-testid={`category-edit-${c.category_id}`}>
                          <Pencil size={14} /> Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteCategory(c)} className="text-destructive" data-testid={`category-delete-${c.category_id}`}>
                          <Trash2 size={14} />
                        </Button>
                      </>
                    )}
                  </div>
                  {isEditing && (
                    <div className="pl-7"><ColorRow value={draftColor} onChange={setDraftColor} /></div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

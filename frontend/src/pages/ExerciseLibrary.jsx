import { useEffect, useMemo, useRef, useState } from "react";
import { api, fileSrc, formatError, uploadFile } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { toast } from "sonner";
import { setCategoryColors, getCategoryColor, colorWithAlpha } from "../lib/categoryColors";
import { CategoryChip } from "../components/CategoryChip";
import { Dumbbell, Plus, Pencil, Trash2, Image as ImageIcon, Search, X, Repeat, TrendingUp, Copy } from "lucide-react";

const empty = { name: "", categories: ["Strength"], description: "", instructions: "", default_sets: "3", default_reps: "10", default_duration: "", default_frequency: "Daily", media_url: "", media_type: "", media: [], video_url: "", variations: [], progressions: [] };

const FALLBACK_CATEGORIES = ["Strength", "Neurologic", "Posture", "Balance", "Conditioning", "Forelimb", "Hindlimb", "Pain Relief"];

export function exCats(ex) {
  if (Array.isArray(ex?.categories) && ex.categories.length > 0) return ex.categories;
  return ex?.category ? [ex.category] : [];
}

// Turns a YouTube (or youtu.be) watch link into an embeddable player URL.
// Returns null if the link isn't a recognizable YouTube URL (e.g. Vimeo,
// or empty) — callers fall back to the uploaded media in that case.
export function youtubeEmbedUrl(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

function RelatedExercisePicker({ label, helpText, field, form, onToggle, allExercises, editingId }) {
  const [query, setQuery] = useState("");
  const selectedIds = Array.isArray(form[field]) ? form[field] : [];
  const candidates = allExercises.filter((e) => e.exercise_id !== editingId);
  const matched = query.trim()
    ? candidates.filter((e) => (e.name || "").toLowerCase().includes(query.trim().toLowerCase()))
    : [];
  const selectedExs = selectedIds.map((id) => allExercises.find((e) => e.exercise_id === id)).filter(Boolean);
  return (
    <div className="col-span-2" data-testid={`related-${field}`}>
      <Label>{label}</Label>
      <p className="text-xs text-[#787672] mt-0.5">{helpText}</p>
      {selectedExs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`${field}-selected`}>
          {selectedExs.map((ex) => (
            <span key={ex.exercise_id} className="inline-flex items-center gap-1.5 bg-[#F3F0EB] rounded-full pl-3 pr-1 py-0.5 text-xs font-semibold">
              {ex.name}
              <button
                type="button"
                onClick={() => onToggle(field, ex.exercise_id)}
                className="h-5 w-5 rounded-full text-[#787672] hover:text-destructive hover:bg-white inline-flex items-center justify-center"
                data-testid={`${field}-remove-${ex.exercise_id}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative mt-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#787672]" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search to add ${label.toLowerCase()}…`}
          className="bg-[#F3F0EB] border-transparent pl-9 h-9 text-sm"
          data-testid={`${field}-search`}
        />
      </div>
      {query.trim() && (
        <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-[#E2DFD8] bg-white" data-testid={`${field}-results`}>
          {matched.length === 0 ? (
            <p className="text-xs text-[#787672] p-3">No matching exercises.</p>
          ) : matched.slice(0, 12).map((ex) => {
            const already = selectedIds.includes(ex.exercise_id);
            return (
              <button
                key={ex.exercise_id}
                type="button"
                onClick={() => { onToggle(field, ex.exercise_id); setQuery(""); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#F3F0EB] flex items-center justify-between"
                data-testid={`${field}-add-${ex.exercise_id}`}
                disabled={already}
              >
                <span className={already ? "line-through text-[#787672]" : ""}>{ex.name}</span>
                {already ? <span className="text-xs text-[#787672]">Added</span> : <Plus size={14} className="text-[#5B7566]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ExerciseLibrary() {
  const [exercises, setExercises] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [query, setQuery] = useState("");
  const [activeCategories, setActiveCategories] = useState([]); // empty = "All"
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [categoryList, setCategoryList] = useState(FALLBACK_CATEGORIES);
  const savedScrollY = useRef(0);

  function openDialog() {
    savedScrollY.current = window.scrollY;
    setOpen(true);
  }
  function closeDialog() {
    const y = savedScrollY.current;
    setOpen(false);
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
      requestAnimationFrame(() => window.scrollTo(0, y));
    });
  }

  const categories = useMemo(() => {
    const set = new Set(categoryList);
    exercises.forEach((e) => exCats(e).forEach((c) => set.add(c)));
    return ["All", ...categoryList, ...Array.from(set).filter((c) => !categoryList.includes(c)).sort()];
  }, [exercises, categoryList]);

  const counts = useMemo(() => {
    const m = { All: exercises.length };
    exercises.forEach((e) => {
      const cats = exCats(e);
      if (cats.length === 0) m["general"] = (m["general"] || 0) + 1;
      cats.forEach((c) => { m[c] = (m[c] || 0) + 1; });
    });
    return m;
  }, [exercises]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((ex) => {
      if (activeCategories.length > 0) {
        const cats = exCats(ex);
        if (!activeCategories.every((c) => cats.includes(c))) return false;
      }
      if (!q) return true;
      return (
        (ex.name || "").toLowerCase().includes(q) ||
        (ex.description || "").toLowerCase().includes(q) ||
        (ex.instructions || "").toLowerCase().includes(q)
      );
    });
  }, [exercises, query, activeCategories]);

  async function load() {
    try {
      const { data } = await api.get("/exercises");
      setExercises(data);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  }
  async function loadCategories() {
    try {
      const { data } = await api.get("/exercises/categories");
      if (Array.isArray(data.categories) && data.categories.length > 0) setCategoryList(data.categories);
      if (Array.isArray(data.items)) setCategoryColors(data.items);
    } catch (_e) { /* fallback already set */ }
  }
  useEffect(() => { load(); loadCategories(); }, []);

  function reset() { setForm(empty); setEditingId(null); }

  async function save() {
    setBusy(true);
    try {
      const payload = {
        ...form,
        categories: Array.isArray(form.categories) ? form.categories.filter(Boolean) : [],
        default_sets: (form.default_sets || "").toString().trim(),
        default_reps: (form.default_reps || "").toString().trim(),
        default_duration: (form.default_duration || "").trim(),
        variations: form.variations || [],
        progressions: form.progressions || [],
      };
      delete payload.default_duration_seconds;
      delete payload.category;
      if (editingId) {
        const { data: updated } = await api.put(`/exercises/${editingId}`, payload);
        setExercises((prev) => prev.map((e) => (e.exercise_id === editingId ? updated : e)).sort((a, b) => (a.name || "").localeCompare(b.name || "")));
        toast.success("Exercise updated");
      } else {
        const { data: created } = await api.post("/exercises", payload);
        setExercises((prev) => [...prev, created].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
        toast.success("Exercise added");
      }
      reset();
      closeDialog();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
    finally { setBusy(false); }
  }

  async function onMedia(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const existing = form.media || [];
    const room = 3 - existing.length;
    if (room <= 0) {
      toast.error("You can only have up to 3 media files per exercise");
      e.target.value = "";
      return;
    }
    const toUpload = files.slice(0, room);
    if (files.length > room) {
      toast.info(`Only uploading ${room} file${room === 1 ? "" : "s"} — 3 max per exercise`);
    }
    try {
      const uploaded = [];
      for (const f of toUpload) {
        const r = await uploadFile(f);
        uploaded.push({ url: r.url, type: r.content_type?.startsWith("video") ? "video" : "image" });
      }
      setForm((s) => ({ ...s, media: [...(s.media || []), ...uploaded] }));
      toast.success(uploaded.length === 1 ? "Media uploaded" : `${uploaded.length} files uploaded`);
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail) || "Upload failed");
    } finally {
      e.target.value = "";
    }
  }

  function removeMedia(index) {
    setForm((s) => ({ ...s, media: (s.media || []).filter((_, i) => i !== index) }));
  }

  async function confirmDeleteNow() {
    const ex = confirmDelete;
    if (!ex) return;
    try {
      await api.delete(`/exercises/${ex.exercise_id}`);
      toast.success(`Deleted "${ex.name}"`);
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Could not delete exercise");
    }
  }

  function startEdit(ex) {
    setForm({
      name: ex.name,
      categories: exCats(ex),
      description: ex.description,
      instructions: ex.instructions,
      default_sets: ex.default_sets != null ? String(ex.default_sets) : "",
      default_reps: ex.default_reps != null ? String(ex.default_reps) : "",
      default_duration: ex.default_duration || (ex.default_duration_seconds ? `${ex.default_duration_seconds} sec` : ""),
      default_frequency: ex.default_frequency || "Daily",
      media_url: ex.media_url || "", media_type: ex.media_type || "",
      media: Array.isArray(ex.media) ? ex.media : (ex.media_url ? [{ url: ex.media_url, type: ex.media_type || "image" }] : []),
      video_url: ex.video_url || "",
      variations: Array.isArray(ex.variations) ? ex.variations : [],
      progressions: Array.isArray(ex.progressions) ? ex.progressions : [],
    });
    setEditingId(ex.exercise_id);
    openDialog();
  }

  function duplicateExercise(ex) {
    setForm({
      name: `${ex.name} (Copy)`,
      categories: exCats(ex),
      description: ex.description,
      instructions: ex.instructions,
      default_sets: ex.default_sets != null ? String(ex.default_sets) : "",
      default_reps: ex.default_reps != null ? String(ex.default_reps) : "",
      default_duration: ex.default_duration || (ex.default_duration_seconds ? `${ex.default_duration_seconds} sec` : ""),
      default_frequency: ex.default_frequency || "Daily",
      media_url: ex.media_url || "", media_type: ex.media_type || "",
      media: Array.isArray(ex.media) ? ex.media : (ex.media_url ? [{ url: ex.media_url, type: ex.media_type || "image" }] : []),
      video_url: ex.video_url || "",
      variations: [],
      progressions: [],
    });
    setEditingId(null);
    openDialog();
    toast.info("Duplicated — edit the name and save to create a new exercise");
  }

  function toggleActiveCategory(name) {
    setActiveCategories((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
  }
  function toggleFormCategory(name) {
    setForm((s) => {
      const list = Array.isArray(s.categories) ? s.categories : [];
      const idx = list.indexOf(name);
      return { ...s, categories: idx >= 0 ? list.filter((c) => c !== name) : [...list, name] };
    });
  }
  function toggleRelated(field, exId) {
    setForm((s) => {
      const list = Array.isArray(s[field]) ? s[field] : [];
      const idx = list.indexOf(exId);
      return { ...s, [field]: idx >= 0 ? list.filter((x) => x !== exId) : [...list, exId] };
    });
  }
  const exerciseById = useMemo(() => {
    const m = {};
    exercises.forEach((e) => { m[e.exercise_id] = e; });
    return m;
  }, [exercises]);

  return (
    <div className="space-y-8" data-testid="exercise-library">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Library</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mt-1">Exercises</h1>
          <p className="text-[#787672] mt-2">{exercises.length} exercises · including custom additions </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => {
          if (v) {
            openDialog();
          } else {
            reset();
            closeDialog();
          }
        }}>
          <DialogTrigger asChild>
            <Button className="rounded-full bg-[#C96A52] hover:bg-[#B35A44] h-11 px-6" data-testid="add-exercise-btn">
              <Plus size={16} /> New exercise
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl max-w-xl max-h-[85vh] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader><DialogTitle className="font-display text-2xl">{editingId ? "Edit exercise" : "New exercise"}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="ex-name" className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1" /></div>
              <div className="col-span-2">
                <Label>Categories <span className="text-xs text-[#787672] font-normal">· tap to toggle</span></Label>
                <div className="mt-2 flex flex-wrap gap-2" data-testid="ex-categories">
                  {categoryList.map((c) => {
                    const selected = (form.categories || []).includes(c);
                    const color = getCategoryColor(c);
                    const style = selected
                      ? { backgroundColor: color, borderColor: color, color: "#fff" }
                      : { backgroundColor: colorWithAlpha(color, 0.10), borderColor: colorWithAlpha(color, 0.30), color };
                    return (
                      <button
                        type="button"
                        key={c}
                        onClick={() => toggleFormCategory(c)}
                        className="rounded-full px-3 py-1 text-xs font-semibold transition border"
                        style={style}
                        data-testid={`ex-cat-toggle-${c}`}
                      >
                        {selected ? "✓ " : ""}{c}
                      </button>
                    );
                  })}
                </div>
                {(form.categories || []).length === 0 && (
                  <p className="text-xs text-destructive mt-1">Pick at least one category</p>
                )}
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <div>
                  <Label>Sets</Label>
                  <Input
                    type="text"
                    value={form.default_sets}
                    onChange={(e) => setForm({ ...form, default_sets: e.target.value })}
                    placeholder="e.g. 3 or 3-5"
                    data-testid="ex-sets"
                    className="bg-[#F3F0EB] border-transparent mt-1"
                  />
                </div>
                <div>
                  <Label>Reps</Label>
                  <Input
                    type="text"
                    value={form.default_reps}
                    onChange={(e) => setForm({ ...form, default_reps: e.target.value })}
                    placeholder="e.g. 10 or 5-10"
                    data-testid="ex-reps"
                    className="bg-[#F3F0EB] border-transparent mt-1"
                  />
                </div>
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <div>
                  <Label>Hold duration</Label>
                  <Input
                    type="text"
                    value={form.default_duration}
                    onChange={(e) => setForm({ ...form, default_duration: e.target.value })}
                    placeholder="e.g. 15-30 sec, 1-2 min"
                    data-testid="ex-duration"
                    className="bg-[#F3F0EB] border-transparent mt-1"
                  />
                </div>
                <div><Label>Frequency</Label>
                  <select value={form.default_frequency} onChange={(e) => setForm({ ...form, default_frequency: e.target.value })} data-testid="ex-frequency" className="mt-1 w-full h-10 rounded-md bg-[#F3F0EB] border border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] px-3 text-sm outline-none">
                    {["Daily", "2× daily", "3× daily", "Every other day", "3× weekly", "Weekly", "As tolerated"].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
              <div className="col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="ex-description" className="bg-[#F3F0EB] border-transparent mt-1" /></div>
              <div className="col-span-2"><Label>Instructions</Label><Textarea rows={3} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} data-testid="ex-instructions" className="bg-[#F3F0EB] border-transparent mt-1" /></div>
              <div className="col-span-2">
                <Label>Demo images / videos <span className="text-xs text-[#787672] font-normal">· up to 3</span></Label>
                <Input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={onMedia}
                  data-testid="ex-media"
                  className="mt-1"
                  disabled={(form.media || []).length >= 3}
                />
                {(form.media || []).length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2" data-testid="ex-media-preview">
                    {form.media.map((m, i) => (
                      <div key={i} className="relative rounded-lg overflow-hidden border border-[#E2DFD8] aspect-square bg-[#F3F0EB]">
                        {m.type === "video" ? (
                          <video src={fileSrc(m.url)} className="h-full w-full object-cover" />
                        ) : (
                          <img src={fileSrc(m.url)} alt="" className="h-full w-full object-cover" />
                        )}
                        <button
                          type="button"
                          onClick={() => removeMedia(i)}
                          className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                          data-testid={`ex-media-remove-${i}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-span-2">
                <Label>Or video link (YouTube / Vimeo)</Label>
                <Input
                  type="url"
                  placeholder="https://youtube.com/watch?v=..."
                  value={form.video_url}
                  onChange={(e) => setForm({ ...form, video_url: e.target.value })}
                  data-testid="ex-video-url"
                  className="bg-[#F3F0EB] border-transparent mt-1"
                />
                <p className="text-xs text-[#787672] mt-1">Shown in the exercise library and used for the QR code in printed plans.</p>
              </div>
              <RelatedExercisePicker
                label="Variations"
                helpText="Same-difficulty alternatives. Shown beside this exercise in plans."
                field="variations"
                form={form}
                onToggle={toggleRelated}
                allExercises={exercises}
                editingId={editingId}
              />
              <RelatedExercisePicker
                label="Progressions"
                helpText="Harder next-step exercises. Suggested when this one becomes easy."
                field="progressions"
                form={form}
                onToggle={toggleRelated}
                allExercises={exercises}
                editingId={editingId}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => { closeDialog(); reset(); }}>Cancel</Button>
              <Button onClick={save} disabled={busy || !form.name || (form.categories || []).length === 0} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]" data-testid="ex-save">
                {busy ? "Saving…" : editingId ? "Save" : "Add exercise"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-white border border-[#E2DFD8] rounded-3xl p-5 space-y-4" data-testid="exercise-filters">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#787672]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises by name, description, or how-to…"
            data-testid="ex-search"
            className="pl-10 pr-10 h-11 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52]"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#787672] hover:text-[#1a1a1a]" data-testid="ex-search-clear">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const active = c === "All" ? activeCategories.length === 0 : activeCategories.includes(c);
            const color = c === "All" ? "#C96A52" : getCategoryColor(c);
            const style = active
              ? { backgroundColor: color, borderColor: color, color: "#fff" }
              : { backgroundColor: colorWithAlpha(color, 0.10), borderColor: colorWithAlpha(color, 0.30), color };
            return (
              <button
                key={c}
                onClick={() => (c === "All" ? setActiveCategories([]) : toggleActiveCategory(c))}
                data-testid={`ex-cat-${c}`}
                className="rounded-full px-4 py-1.5 text-sm font-semibold transition border hover:shadow-sm"
                style={style}
              >
                {active && c !== "All" ? "✓ " : ""}{c}
                <span className="ml-1.5 text-xs opacity-80">{counts[c] || 0}</span>
              </button>
            );
          })}
        </div>
        {(query || activeCategories.length > 0) && (
          <div className="flex items-center gap-3 pt-1 text-xs text-[#787672]">
            <span>Showing <b className="text-[#1a1a1a]">{filtered.length}</b> of {exercises.length}</span>
            <button onClick={() => { setQuery(""); setActiveCategories([]); }} className="text-[#C96A52] font-semibold hover:underline" data-testid="ex-clear-filters">
              Clear filters
            </button>
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.length === 0 ? (
          <div className="col-span-full bg-white border border-[#E2DFD8] rounded-3xl p-12 text-center" data-testid="ex-empty">
            <Search size={36} className="mx-auto text-[#C96A52]" />
            <p className="font-display text-xl font-semibold mt-3">No exercises match these filters</p>
            <p className="text-[#787672] mt-2 text-sm">Try a different category or clear the search.</p>
            <Button variant="ghost" onClick={() => { setQuery(""); setActiveCategories([]); }} className="mt-3 text-[#C96A52]">Clear filters</Button>
          </div>
        ) : filtered.map((ex) => (
          <div key={ex.exercise_id} className="bg-white border border-[#E2DFD8] rounded-3xl overflow-hidden flex flex-col" data-testid={`ex-card-${ex.exercise_id}`}>
            {youtubeEmbedUrl(ex.video_url) ? (
              <div className="aspect-video bg-[#E8E2D9] overflow-hidden">
                <iframe
                  src={youtubeEmbedUrl(ex.video_url)}
                  title={ex.name}
                  className="h-full w-full"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (ex.media || []).length > 1 ? (
              <div className="grid grid-cols-3 gap-0.5 bg-[#E8E2D9]">
                {ex.media.map((m, i) => (
                  <div key={i} className="aspect-square overflow-hidden">
                    {m.type === "video" ? (
                      <video src={fileSrc(m.url)} className="h-full w-full object-cover" controls />
                    ) : (
                      <img src={fileSrc(m.url)} alt={`${ex.name} ${i + 1}`} className="h-full w-full object-cover" />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="aspect-video bg-[#E8E2D9] flex items-center justify-center overflow-hidden">
                {ex.media_url ? (
                  ex.media_type === "video" ? (
                    <video src={fileSrc(ex.media_url)} className="h-full w-full object-cover" controls />
                  ) : (
                    <img src={fileSrc(ex.media_url)} alt={ex.name} className="h-full w-full object-cover" />
                  )
                ) : (
                  <ImageIcon className="text-[#C96A52]" size={28} />
                )}
              </div>
            )}
            <div className="p-5 flex-1 flex flex-col">
              <div className="flex flex-wrap gap-1.5" data-testid={`ex-card-categories-${ex.exercise_id}`}>
                {exCats(ex).map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setActiveCategories([c])}
                    className="transition hover:opacity-80"
                    title={`Filter by ${c}`}
                  >
                    <CategoryChip name={c} />
                  </button>
                ))}
              </div>
              <h3 className="font-display text-lg font-semibold mt-2">{ex.name}</h3>
              <p className="text-sm text-[#3a3a36] mt-2 line-clamp-2">{ex.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {(ex.default_sets || "") && (ex.default_reps || "") && (
                  <span className="bg-[#F3F0EB] px-2.5 py-1 rounded-full font-semibold">{ex.default_sets} × {ex.default_reps}</span>
                )}
                {(ex.default_duration || ex.default_duration_seconds > 0) && (
                  <span className="bg-[#F3F0EB] px-2.5 py-1 rounded-full font-semibold">
                    {ex.default_duration || (ex.default_duration_seconds >= 60 ? `${Math.round(ex.default_duration_seconds/60)} min` : `${ex.default_duration_seconds}s`)} hold
                  </span>
                )}
                {(ex.default_frequency || "Daily") && (
                  <span className="text-[#787672]">· {ex.default_frequency || "Daily"}</span>
                )}
              </div>
              {((ex.variations || []).length > 0 || (ex.progressions || []).length > 0) && (
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#787672]" data-testid={`ex-related-${ex.exercise_id}`}>
                  {(ex.variations || []).length > 0 && (
                    <span className="inline-flex items-center gap-1 bg-[#F3F0EB] px-2 py-0.5 rounded-full">
                      <Repeat size={11} /> {ex.variations.length} variation{ex.variations.length === 1 ? "" : "s"}
                    </span>
                  )}
                  {(ex.progressions || []).length > 0 && (
                    <span className="inline-flex items-center gap-1 bg-[#F3F0EB] px-2 py-0.5 rounded-full">
                      <TrendingUp size={11} /> {ex.progressions.length} progression{ex.progressions.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[#E2DFD8]">
                <Button variant="ghost" size="sm" onClick={() => startEdit(ex)} data-testid={`ex-edit-${ex.exercise_id}`}><Pencil size={14} /> Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => duplicateExercise(ex)} data-testid={`ex-duplicate-${ex.exercise_id}`}><Copy size={14} /> Duplicate</Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(ex)} data-testid={`ex-delete-${ex.exercise_id}`}><Trash2 size={14} /> Delete</Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent data-testid="ex-delete-confirm" onCloseAutoFocus={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">Delete exercise?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete ? (
                <>This will permanently remove <b className="text-[#1a1a1a]">{confirmDelete.name}</b> from your library. Patient plans that already reference it will keep their copy.</>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="ex-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="ex-delete-confirm-btn"
              onClick={confirmDeleteNow}
              className="bg-[#C96A52] hover:bg-[#B35A44]"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, formatError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { toast } from "sonner";
import { Layers, Plus, Pencil, Trash2, Share2, X, Globe, Users, Search } from "lucide-react";
import { Textarea } from "../components/ui/textarea";
import { exCats } from "./ExerciseLibrary";

export default function Templates() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [exercises, setExercises] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPublic, setNewPublic] = useState(false);
  const [newItems, setNewItems] = useState([]);
  const [exQuery, setExQuery] = useState("");
  const [editItems, setEditItems] = useState([]);
  const [editExQuery, setEditExQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPublic, setEditPublic] = useState(false);
  const [shareEmail, setShareEmail] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/plan-templates");
      setTemplates(data);
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not load templates"); }
  }
  async function loadExercises() {
    try {
      const { data } = await api.get("/exercises");
      setExercises(data);
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not load exercises"); }
  }
  useEffect(() => { load(); loadExercises(); }, []);

  function openCreate() {
    setNewName(""); setNewDesc(""); setNewPublic(false); setNewItems([]); setExQuery("");
    setCreateOpen(true);
  }
  function addNewItem(ex) {
    if (newItems.find((i) => i.exercise_id === ex.exercise_id)) return;
    setNewItems((prev) => [...prev, {
      exercise_id: ex.exercise_id,
      sets: ex.default_sets != null ? String(ex.default_sets) : "3",
      reps: ex.default_reps != null ? String(ex.default_reps) : "10",
      duration: ex.default_duration || "",
      frequency: ex.default_frequency || "Daily",
      notes: "",
    }]);
  }
  function removeNewItem(exId) { setNewItems((prev) => prev.filter((i) => i.exercise_id !== exId)); }
  function updateNewItem(exId, patch) { setNewItems((prev) => prev.map((i) => i.exercise_id === exId ? { ...i, ...patch } : i)); }

  async function createTemplate() {
    const name = newName.trim();
    if (!name || newItems.length === 0) return;
    setCreateBusy(true);
    try {
      await api.post("/plan-templates", { name, description: newDesc.trim(), is_public: newPublic, items: newItems });
      toast.success(`Created "${name}"`);
      setCreateOpen(false);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not create template"); }
    finally { setCreateBusy(false); }
  }

  const exerciseById = Object.fromEntries(exercises.map((e) => [e.exercise_id, e]));
  const filteredExercises = exercises.filter((ex) => {
    const q = exQuery.trim().toLowerCase();
    if (!q) return true;
    return (ex.name || "").toLowerCase().includes(q) || exCats(ex).some((c) => c.toLowerCase().includes(q));
  });

  function openEdit(tpl) {
    setEditing(tpl);
    setEditName(tpl.name || "");
    setEditDesc(tpl.description || "");
    setEditPublic(!!tpl.is_public);
    setShareEmail("");
    setEditItems(tpl.items || []);
    setEditExQuery("");
  }
  function addEditItem(ex) {
    if (editItems.find((i) => i.exercise_id === ex.exercise_id)) return;
    setEditItems((prev) => [...prev, {
      exercise_id: ex.exercise_id,
      sets: ex.default_sets != null ? String(ex.default_sets) : "3",
      reps: ex.default_reps != null ? String(ex.default_reps) : "10",
      duration: ex.default_duration || "",
      frequency: ex.default_frequency || "Daily",
      notes: "",
    }]);
  }
  function removeEditItem(exId) { setEditItems((prev) => prev.filter((i) => i.exercise_id !== exId)); }
  function updateEditItem(exId, patch) { setEditItems((prev) => prev.map((i) => i.exercise_id === exId ? { ...i, ...patch } : i)); }

  async function saveEdit() {
    if (!editing) return;
    try {
      const { data } = await api.put(`/plan-templates/${editing.template_id}`, {
        name: editName.trim(),
        description: editDesc.trim(),
        is_public: editPublic,
        items: editItems,
      });
      toast.success("Template updated");
      setTemplates((prev) => prev.map((t) => t.template_id === data.template_id ? { ...data, _relation: "owned" } : t));
      setEditing({ ...editing, ...data });
      setEditItems(data.items || []);
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not save"); }
  }

  async function addShare() {
    if (!editing || !shareEmail.trim()) return;
    try {
      const { data } = await api.post(`/plan-templates/${editing.template_id}/share`, { email: shareEmail.trim() });
      setEditing({ ...editing, ...data });
      setTemplates((prev) => prev.map((t) => t.template_id === data.template_id ? { ...data, _relation: "owned" } : t));
      setShareEmail("");
      toast.success(`Shared with ${data.shared_with[data.shared_with.length - 1]}`);
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not share"); }
  }

  async function removeShare(email) {
    try {
      const { data } = await api.post(`/plan-templates/${editing.template_id}/unshare`, { email });
      setEditing({ ...editing, ...data });
      setTemplates((prev) => prev.map((t) => t.template_id === data.template_id ? { ...data, _relation: "owned" } : t));
      toast.success(`Removed ${email}`);
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not remove"); }
  }

  async function deleteTpl(tpl) {
    if (!window.confirm(`Delete "${tpl.name}"? This can't be undone.`)) return;
    try {
      await api.delete(`/plan-templates/${tpl.template_id}`);
      toast.success("Template deleted");
      setTemplates((prev) => prev.filter((t) => t.template_id !== tpl.template_id));
      if (editing?.template_id === tpl.template_id) setEditing(null);
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not delete"); }
  }

  const owned = templates.filter((t) => t._relation === "owned");
  const shared = templates.filter((t) => t._relation !== "owned");

  if (user?.role !== "clinician") return <Navigate to={user?.role === "owner" ? "/owner" : "/login"} replace />;

  return (
    <div className="space-y-10" data-testid="templates-page">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Clinician</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mt-1">Plan templates</h1>
          <p className="text-[#787672] mt-2 max-w-xl">
            Build a reusable set of exercises here, or save any patient's plan as a template. Load one onto a
            new patient in one click. Share by email with colleagues, or make it public to every clinician.
          </p>
        </div>
        <Button onClick={openCreate} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44] h-11 px-6" data-testid="create-template-btn">
          <Plus size={16} /> New template
        </Button>
      </div>

      <Section title="My templates" count={owned.length} icon={<Layers size={18} />}>
        {owned.length === 0 ? (
          <Empty msg="No templates yet. Click &apos;New template&apos; above to build one." />
        ) : (
          <TemplateGrid tpls={owned} onEdit={openEdit} onDelete={deleteTpl} canEdit />
        )}
      </Section>

      <Section title="Shared with me / public" count={shared.length} icon={<Users size={18} />}>
        {shared.length === 0 ? (
          <Empty msg="Colleagues can share templates with your email, and public templates appear here." />
        ) : (
          <TemplateGrid tpls={shared} onEdit={openEdit} onDelete={deleteTpl} />
        )}
      </Section>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="rounded-2xl max-w-lg max-h-[85vh] overflow-y-auto" data-testid="edit-template-dialog">
          <DialogHeader><DialogTitle className="font-display text-2xl">{editing?._relation === "owned" ? "Edit template" : "Template details"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input disabled={editing._relation !== "owned"} value={editName} onChange={(e) => setEditName(e.target.value)} className="bg-[#F3F0EB] border-transparent mt-1" data-testid="edit-tpl-name" />
              </div>
              <div>
                <Label>Description</Label>
                <Input disabled={editing._relation !== "owned"} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="bg-[#F3F0EB] border-transparent mt-1" />
              </div>
              {editing._relation === "owned" && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={editPublic} onChange={(e) => setEditPublic(e.target.checked)} className="rounded" data-testid="edit-tpl-public" />
                  <Globe size={14} /> Share publicly with every clinician
                </label>
              )}

              <div>
                <p className="text-xs text-[#787672] uppercase tracking-widest font-bold">Exercises ({editItems.length})</p>
                {editing._relation !== "owned" ? (
                  <ul className="mt-2 text-sm space-y-0.5 max-h-40 overflow-y-auto">
                    {editItems.map((it, i) => (<li key={i} className="text-[#3a3a36]">· {it.sets || "?"}×{it.reps || "?"} {it.duration ? `· ${it.duration} hold` : ""} · {it.frequency || "Daily"}</li>))}
                  </ul>
                ) : (
                  <>
                    {editItems.length === 0 ? (
                      <p className="text-sm text-[#787672] mt-2">No exercises yet — search below to add some.</p>
                    ) : (
                      <div className="space-y-2 mt-2 max-h-56 overflow-y-auto pr-1">
                        {editItems.map((it) => {
                          const ex = exerciseById[it.exercise_id];
                          return (
                            <div key={it.exercise_id} className="p-3 bg-[#F3F0EB] rounded-xl space-y-2">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold flex-1 truncate text-sm">{ex?.name || it.exercise_id}</p>
                                <Button variant="ghost" size="sm" onClick={() => removeEditItem(it.exercise_id)}><X size={14} /></Button>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-[#787672]">Sets</span>
                                <Input type="text" value={it.sets} onChange={(e) => updateEditItem(it.exercise_id, { sets: e.target.value })} className="w-16 h-7 bg-white text-xs" />
                                <span className="text-[#787672]">×</span>
                                <Input type="text" value={it.reps} onChange={(e) => updateEditItem(it.exercise_id, { reps: e.target.value })} className="w-16 h-7 bg-white text-xs" />
                                <select value={it.frequency} onChange={(e) => updateEditItem(it.exercise_id, { frequency: e.target.value })} className="h-7 rounded-md border border-[#E2DFD8] bg-white px-2 text-xs">
                                  {["Daily", "2× daily", "3× daily", "Every other day", "3× weekly", "Weekly", "As tolerated"].map((f) => <option key={f} value={f}>{f}</option>)}
                                </select>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="mt-3">
                      <Label className="text-xs">Add more exercises</Label>
                      <div className="relative mt-1">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#787672]" />
                        <Input value={editExQuery} onChange={(e) => setEditExQuery(e.target.value)} placeholder="Search exercises…" data-testid="edit-tpl-ex-search" className="bg-[#F3F0EB] border-transparent pl-9 h-9 text-sm" />
                      </div>
                      {editExQuery.trim() && (
                        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-[#E2DFD8] bg-white">
                          {exercises.filter((ex) => (ex.name || "").toLowerCase().includes(editExQuery.trim().toLowerCase())).slice(0, 12).map((ex) => {
                            const already = editItems.some((i) => i.exercise_id === ex.exercise_id);
                            return (
                              <button
                                key={ex.exercise_id}
                                type="button"
                                onClick={() => { if (!already) { addEditItem(ex); setEditExQuery(""); } }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-[#F3F0EB] flex items-center justify-between"
                                data-testid={`edit-tpl-add-${ex.exercise_id}`}
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
                  </>
                )}
              </div>

              {editing._relation === "owned" && (
                <div>
                  <Label><Share2 size={12} className="inline mr-1" /> Share by email</Label>
                  <div className="flex gap-2 mt-1">
                    <Input value={shareEmail} onChange={(e) => setShareEmail(e.target.value)} placeholder="colleague@clinic.com" className="bg-[#F3F0EB] border-transparent" data-testid="edit-tpl-share-email" onKeyDown={(e) => e.key === "Enter" && addShare()} />
                    <Button onClick={addShare} disabled={!shareEmail.trim()} className="rounded-full bg-[#5B7566] hover:bg-[#3a4f44]" data-testid="edit-tpl-share-btn"><Plus size={14} /></Button>
                  </div>
                  {(editing.shared_with || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {editing.shared_with.map((em) => (
                        <span key={em} className="inline-flex items-center gap-1 bg-[#F3F0EB] rounded-full pl-3 pr-1 py-0.5 text-xs" data-testid={`shared-${em}`}>
                          {em}
                          <button onClick={() => removeShare(em)} className="h-5 w-5 rounded-full text-[#787672] hover:text-destructive hover:bg-white inline-flex items-center justify-center"><X size={11} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {editing?._relation === "owned" && <Button variant="ghost" className="text-destructive mr-auto" onClick={() => deleteTpl(editing)}><Trash2 size={14} /> Delete</Button>}
            <Button variant="ghost" onClick={() => setEditing(null)}>Close</Button>
            {editing?._relation === "owned" && <Button onClick={saveEdit} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]" data-testid="edit-tpl-save">Save</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl max-w-3xl max-h-[85vh] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="create-template-dialog">
          <DialogHeader><DialogTitle className="font-display text-2xl">New template</DialogTitle></DialogHeader>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div>
                <Label>Template name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Carpal Flexion" data-testid="new-tpl-name" className="bg-[#F3F0EB] border-transparent mt-1" />
              </div>
              <div>
                <Label>Description <span className="text-xs text-[#787672] font-normal">(optional)</span></Label>
                <Textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} data-testid="new-tpl-desc" className="bg-[#F3F0EB] border-transparent mt-1" />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={newPublic} onChange={(e) => setNewPublic(e.target.checked)} className="rounded" data-testid="new-tpl-public" />
                <Globe size={14} /> Share publicly with every clinician
              </label>

              <p className="text-xs uppercase tracking-widest font-bold text-[#787672] pt-2">Selected exercises ({newItems.length})</p>
              {newItems.length === 0 ? (
                <p className="text-sm text-[#787672]">Search and add exercises from the right →</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {newItems.map((it) => {
                    const ex = exerciseById[it.exercise_id];
                    return (
                      <div key={it.exercise_id} className="p-3 bg-[#F3F0EB] rounded-xl space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold flex-1 truncate text-sm">{ex?.name || "?"}</p>
                          <Button variant="ghost" size="sm" onClick={() => removeNewItem(it.exercise_id)}><X size={14} /></Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-[#787672]">Sets</span>
                          <Input type="text" value={it.sets} onChange={(e) => updateNewItem(it.exercise_id, { sets: e.target.value })} className="w-16 h-7 bg-white text-xs" />
                          <span className="text-[#787672]">×</span>
                          <Input type="text" value={it.reps} onChange={(e) => updateNewItem(it.exercise_id, { reps: e.target.value })} className="w-16 h-7 bg-white text-xs" />
                          <select value={it.frequency} onChange={(e) => updateNewItem(it.exercise_id, { frequency: e.target.value })} className="h-7 rounded-md border border-[#E2DFD8] bg-white px-2 text-xs">
                            {["Daily", "2× daily", "3× daily", "Every other day", "3× weekly", "Weekly", "As tolerated"].map((f) => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <Label>Add exercises</Label>
              <div className="relative mt-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#787672]" />
                <Input value={exQuery} onChange={(e) => setExQuery(e.target.value)} placeholder="Search exercises…" data-testid="new-tpl-ex-search" className="bg-[#F3F0EB] border-transparent pl-9 h-10" />
              </div>
              <div className="grid gap-2 mt-3 max-h-96 overflow-y-auto pr-1">
                {filteredExercises.length === 0 ? (
                  <p className="text-sm text-[#787672] text-center py-6">No matching exercises.</p>
                ) : filteredExercises.map((ex) => (
                  <button key={ex.exercise_id} type="button" onClick={() => addNewItem(ex)} data-testid={`new-tpl-add-${ex.exercise_id}`} className="text-left p-3 rounded-xl border border-[#E2DFD8] hover:border-[#C96A52] hover:bg-[#C96A52]/5 transition">
                    <p className="font-semibold text-sm truncate">{ex.name}</p>
                    <p className="text-xs text-[#787672] mt-0.5">{exCats(ex).join(", ") || "Uncategorized"}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createTemplate} disabled={createBusy || !newName.trim() || newItems.length === 0} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]" data-testid="new-tpl-save">
              {createBusy ? "Creating…" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, count, icon, children }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="font-display text-2xl font-semibold">{title}</h2>
        <span className="text-xs text-[#787672]">· {count}</span>
      </div>
      {children}
    </section>
  );
}
function Empty({ msg }) {
  return <div className="bg-white border border-dashed border-[#E2DFD8] rounded-3xl p-8 text-center text-sm text-[#787672]">{msg}</div>;
}
function TemplateGrid({ tpls, onEdit, onDelete, canEdit }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {tpls.map((t) => (
        <div key={t.template_id} className="bg-white border border-[#E2DFD8] rounded-3xl p-5" data-testid={`tpl-card-${t.template_id}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="font-display text-lg font-semibold flex-1 truncate">{t.name}</p>
            <span className={`shrink-0 text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-full ${t._relation === "owned" ? "bg-[#C96A52]/10 text-[#C96A52]" : t._relation === "shared" ? "bg-[#5B7566]/10 text-[#5B7566]" : "bg-[#787672]/10 text-[#787672]"}`}>
              {t._relation === "owned" ? "Owned" : t._relation === "shared" ? "Shared" : "Public"}
            </span>
          </div>
          {t.description && <p className="text-sm text-[#787672] mt-1 line-clamp-2">{t.description}</p>}
          <p className="text-xs text-[#787672] mt-3">{(t.items || []).length} exercise{(t.items || []).length === 1 ? "" : "s"} · by {t.created_by_name || t.created_by_email}</p>
          <div className="mt-4 flex items-center gap-2 pt-4 border-t border-[#E2DFD8]">
            <Button variant="ghost" size="sm" onClick={() => onEdit(t)} data-testid={`tpl-edit-${t.template_id}`}><Pencil size={13} /> {canEdit ? "Edit" : "View"}</Button>
            {canEdit && <Button variant="ghost" size="sm" className="text-destructive ml-auto" onClick={() => onDelete(t)} data-testid={`tpl-delete-${t.template_id}`}><Trash2 size={13} /></Button>}
          </div>
        </div>
      ))}
    </div>
  );
}

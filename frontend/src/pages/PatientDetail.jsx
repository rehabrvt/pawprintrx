import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatError, fileSrc } from "../lib/api";
import { setCategoryColors, getCategoryColor, colorWithAlpha } from "../lib/categoryColors";
import { CategoryChip } from "../components/CategoryChip";
import { exCats } from "./ExerciseLibrary";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, X, Download, Mail, Video, ExternalLink, Edit3, Users, Archive, ArchiveRestore, Repeat, TrendingUp, FolderOpen, BookmarkPlus, Copy, Share2, Star } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
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
import { API } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";

function SwapPanel({ currentExId, variations, progressions, allExercises, onSwap }) {
  const [open, setOpen] = useState(false);
  const byId = useMemo(() => {
    const m = {};
    allExercises.forEach((e) => { m[e.exercise_id] = e; });
    return m;
  }, [allExercises]);
  const varExs = variations.map((id) => byId[id]).filter(Boolean);
  const progExs = progressions.map((id) => byId[id]).filter(Boolean);
  if (varExs.length === 0 && progExs.length === 0) return null;
  return (
    <div className="border-t border-[#E2DFD8] pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[10px] uppercase tracking-widest font-bold text-[#787672] hover:text-[#C96A52] inline-flex items-center gap-1"
        data-testid={`swap-toggle-${currentExId}`}
      >
        <Repeat size={11} /> Swap to a {open ? "—" : ""}{varExs.length > 0 ? `variation (${varExs.length})` : ""}{varExs.length > 0 && progExs.length > 0 ? " · " : ""}{progExs.length > 0 ? `progression (${progExs.length})` : ""}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5" data-testid={`swap-panel-${currentExId}`}>
          {varExs.map((ex) => (
            <button
              key={`v-${ex.exercise_id}`}
              type="button"
              onClick={() => onSwap(ex)}
              className="w-full flex items-center justify-between gap-2 text-left text-xs bg-white px-3 py-2 rounded-lg border border-[#E2DFD8] hover:border-[#C96A52]/40 transition"
              data-testid={`swap-variation-${currentExId}-${ex.exercise_id}`}
            >
              <span className="flex items-center gap-2">
                <Repeat size={11} className="text-[#5B7566]" />
                <span className="font-semibold">{ex.name}</span>
              </span>
              <span className="text-[10px] text-[#787672] uppercase tracking-widest">Variation</span>
            </button>
          ))}
          {progExs.map((ex) => (
            <button
              key={`p-${ex.exercise_id}`}
              type="button"
              onClick={() => onSwap(ex)}
              className="w-full flex items-center justify-between gap-2 text-left text-xs bg-white px-3 py-2 rounded-lg border border-[#E2DFD8] hover:border-[#C96A52]/40 transition"
              data-testid={`swap-progression-${currentExId}-${ex.exercise_id}`}
            >
              <span className="flex items-center gap-2">
                <TrendingUp size={11} className="text-[#C96A52]" />
                <span className="font-semibold">{ex.name}</span>
              </span>
              <span className="text-[10px] text-[#787672] uppercase tracking-widest">Progression</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PatientDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [patient, setPatient] = useState(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [exercises, setExercises] = useState([]);
  const [plans, setPlans] = useState([]);
  const [diary, setDiary] = useState([]);
  const [videos, setVideos] = useState([]);
  const [planTitle, setPlanTitle] = useState("Rehab Plan");
  const [planNotes, setPlanNotes] = useState("");
  const [items, setItems] = useState([]);
  const [editingPlanId, setEditingPlanId] = useState(null);

  async function loadAll() {
    try {
      const [p, ex, pl, d, v] = await Promise.all([
        api.get(`/patients/${id}`),
        api.get(`/exercises`),
        api.get(`/plans`, { params: { patient_id: id } }),
        api.get(`/diary`, { params: { patient_id: id } }),
        api.get(`/owner-videos`, { params: { patient_id: id } }),
      ]);
      setPatient(p.data); setExercises(ex.data); setPlans(pl.data); setDiary(d.data); setVideos(v.data || []);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  }
  useEffect(() => { loadAll(); }, [id]);

  useEffect(() => {
    api.get("/exercises/categories").then(({ data }) => {
      if (Array.isArray(data.items)) setCategoryColors(data.items);
    }).catch(() => {});
  }, []);

  async function deleteVideo(vid) {
    if (!window.confirm("Remove this video from review queue?")) return;
    try { await api.delete(`/owner-videos/${vid}`); loadAll(); }
    catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  }

  const photoRef = useRef(null);
  const [siblings, setSiblings] = useState([]);
  const [siblingsBump, setSiblingsBump] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", last_name: "" });
  const [editBusy, setEditBusy] = useState(false);
  const [hhBusy, setHhBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'archive' | 'permanent' | null
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templatePicker, setTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplPublic, setTplPublic] = useState(false);
  const [tplBusy, setTplBusy] = useState(false);

  async function loadTemplates() {
    try {
      const { data } = await api.get("/plan-templates");
      setTemplates(data);
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not load templates"); }
  }
  async function saveAsTemplate() {
    const name = tplName.trim();
    if (!name) return;
    setTplBusy(true);
    try {
      await api.post("/plan-templates", { name, description: tplDesc.trim(), is_public: tplPublic, items });
      toast.success(`Saved "${name}" as a template`);
      setSaveTemplateOpen(false);
      setTplName(""); setTplDesc(""); setTplPublic(false);
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not save template"); }
    finally { setTplBusy(false); }
  }
  function applyTemplate(tpl) {
    if (items.length > 0 && !window.confirm("Replace the current draft with this template's exercises?")) return;
    setItems((tpl.items || []).map((it) => ({ ...it, notes: it.notes || "" })));
    setTemplatePicker(false);
    toast.success(`Loaded "${tpl.name}" (${(tpl.items || []).length} exercises)`);
  }

  useEffect(() => {
    if (!patient?.owner_email) { setSiblings([]); return; }
    api.get("/patients").then((r) => {
      setSiblings((r.data || []).filter((p) => p.owner_email === patient.owner_email && p.patient_id !== patient.patient_id));
    }).catch(() => setSiblings([]));
  }, [patient?.owner_email, patient?.patient_id, siblingsBump]);

  function openEdit() {
    setEditForm({ name: patient.name || "", last_name: patient.last_name || "" });
    setEditOpen(true);
  }
  async function saveEdit() {
    setEditBusy(true);
    try {
      const payload = {
        name: editForm.name,
        last_name: editForm.last_name,
        breed: patient.breed || "",
        age_years: patient.age_years ?? null,
        weight_kg: patient.weight_kg ?? null,
        condition: patient.condition || "",
        notes: patient.notes || "",
        owner_email: patient.owner_email || "",
      };
      const { data } = await api.put(`/patients/${id}`, payload);
      setPatient(data);
      setEditOpen(false);
      toast.success("Saved");
      // Offer to propagate last_name to household if it differs from any sibling
      const newLast = (editForm.last_name || "").trim();
      if (newLast) {
        const siblingsToUpdate = siblings.filter((s) => (s.last_name || "") !== newLast);
        if (siblingsToUpdate.length > 0) {
          const ok = window.confirm(`Apply "${newLast}" as the last name to ${siblingsToUpdate.length} other pet${siblingsToUpdate.length === 1 ? "" : "s"} in this household (${siblingsToUpdate.map(s => s.name).join(", ")})?`);
          if (ok) {
            try {
              const r = await api.post(`/patients/${id}/apply-last-name-to-household`);
              toast.success(`Updated ${r.data.updated_count} household pet${r.data.updated_count === 1 ? "" : "s"}`);
              setSiblingsBump((n) => n + 1);
              loadAll();
              maybeOfferOwnerRename(r.data);
            } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not update household"); }
          }
        }
      }
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Save failed"); }
    finally { setEditBusy(false); }
  }

  async function applyHouseholdLastName() {
    if (!patient.last_name) {
      toast.error("Set a last name first using Edit");
      return;
    }
    setHhBusy(true);
    try {
      const { data } = await api.post(`/patients/${id}/apply-last-name-to-household`);
      toast.success(`Updated ${data.updated_count} household pet${data.updated_count === 1 ? "" : "s"}`);
      setSiblingsBump((n) => n + 1);
      loadAll();
      maybeOfferOwnerRename(data);
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Update failed"); }
    finally { setHhBusy(false); }
  }

  async function maybeOfferOwnerRename(data) {
    const owner = data?.owner;
    const suggested = data?.suggested_owner_name;
    if (!owner || !suggested) return;
    if ((owner.name || "").trim().toLowerCase() === suggested.toLowerCase()) return;
    const ok = window.confirm(`Also rename the owner profile from "${owner.name || owner.email}" to "${suggested}"? It updates how their emails and admin records read.`);
    if (!ok) return;
    try {
      await api.post(`/owners/${encodeURIComponent(owner.email)}/rename`, { name: suggested });
      toast.success(`Owner profile renamed to "${suggested}"`);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Rename failed");
    }
  }

  async function onPhotoChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append("file", f);
      const { data } = await api.post(`/patients/${id}/photo`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setPatient({ ...patient, photo_url: data.photo_url });
      toast.success("Photo updated");
    } catch (err) { toast.error(formatError(err.response?.data?.detail) || "Upload failed"); }
    finally { if (photoRef.current) photoRef.current.value = ""; }
  }

  function addItem(ex) {
    if (items.find((i) => i.exercise_id === ex.exercise_id)) return;
    setItems([...items, {
      exercise_id: ex.exercise_id,
      sets: ex.default_sets != null ? String(ex.default_sets) : "3",
      reps: ex.default_reps != null ? String(ex.default_reps) : "10",
      duration: ex.default_duration || (ex.default_duration_seconds ? `${ex.default_duration_seconds} sec` : ""),
      frequency: ex.default_frequency || "Daily",
      notes: "",
    }]);
  }
  function swapItem(oldExerciseId, newEx) {
    if (!newEx) return;
    setItems((prev) => prev.map((i) => i.exercise_id === oldExerciseId ? {
      exercise_id: newEx.exercise_id,
      sets: newEx.default_sets != null ? String(newEx.default_sets) : i.sets,
      reps: newEx.default_reps != null ? String(newEx.default_reps) : i.reps,
      duration: newEx.default_duration || (newEx.default_duration_seconds ? `${newEx.default_duration_seconds} sec` : i.duration),
      frequency: newEx.default_frequency || i.frequency,
      notes: i.notes,
    } : i));
    toast.success(`Swapped to "${newEx.name}"`);
  }
  function removeItem(eid) { setItems(items.filter((i) => i.exercise_id !== eid)); }
  function updateItem(eid, patch) { setItems(items.map((i) => i.exercise_id === eid ? { ...i, ...patch } : i)); }

  function startEditPlan(pl) {
    setEditingPlanId(pl.plan_id);
    setPlanTitle(pl.title);
    setPlanNotes(pl.notes || "");
    setItems(pl.items || []);
  }
  function resetPlanForm() { setEditingPlanId(null); setPlanTitle("Rehab Plan"); setPlanNotes(""); setItems([]); }

  async function savePlan() {
    if (items.length === 0) { toast.error("Add at least one exercise"); return; }
    try {
      const payload = { patient_id: id, title: planTitle, items, notes: planNotes };
      if (editingPlanId) await api.put(`/plans/${editingPlanId}`, payload);
      else await api.post(`/plans`, payload);
      toast.success("Plan saved");
      resetPlanForm();
      loadAll();
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  }

  async function delPlan(pid) {
    if (!window.confirm("Delete plan?")) return;
    try { await api.delete(`/plans/${pid}`); loadAll(); } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  }

  function downloadPdf(pid, title) {
    const url = `${API}/plans/${pid}/pdf`;
    // Use a hidden anchor with credentials → fetch + blob to bypass cookie issues
    fetch(url, { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error("PDF failed"); return r.blob(); })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${(title || "rehab-plan").replace(/[^a-z0-9-_]/gi, "_")}.pdf`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      })
      .catch(() => toast.error("Could not download PDF"));
  }

  async function emailPlan(pid) {
    const defaultTo = patient?.owner_email || "";
    const to = window.prompt("Send PDF to which email?", defaultTo);
    if (!to) return;
    try {
      await api.post(`/plans/${pid}/email`, { to });
      toast.success(`Plan sent to ${to}`);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Email failed");
    }
  }

  async function toggleMine() {
    setPinBusy(true);
    try {
      const { data } = await api.post(`/patients/${id}/toggle-mine`);
      setPatient((p) => ({
        ...p,
        pinned_by: data.is_mine
          ? [...(p.pinned_by || []), user.user_id]
          : (p.pinned_by || []).filter((uid) => uid !== user.user_id),
      }));
      toast.success(data.is_mine ? `${patient.name} added to My Patients` : `${patient.name} removed from My Patients`);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Could not update");
    } finally {
      setPinBusy(false);
    }
  }

  const isMine = (patient?.pinned_by || []).includes(user?.user_id);

  async function doArchive() {
    try {
      await api.delete(`/patients/${id}`);
      toast.success(`${patient.name} archived`);
      setPatient((p) => ({ ...p, archived: true, archived_at: new Date().toISOString() }));
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not archive"); }
    finally { setConfirmAction(null); }
  }

  async function unarchivePatient() {
    try {
      await api.post(`/patients/${id}/unarchive`);
      toast.success(`${patient.name} restored`);
      setPatient((p) => ({ ...p, archived: false, archived_at: null }));
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not restore"); }
  }

  async function doPermanentDelete() {
    try {
      await api.delete(`/patients/${id}/permanent`);
      toast.success(`${patient.name} permanently deleted`);
      window.location.href = "/clinician";
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Could not delete");
      setConfirmAction(null);
    }
  }

  const [planExQuery, setPlanExQuery] = useState("");
  const [planExCategory, setPlanExCategory] = useState("All");
  const planExCategories = useMemo(() => {
    const set = new Set();
    exercises.forEach((e) => exCats(e).forEach((c) => set.add(c)));
    return ["All", ...Array.from(set).sort()];
  }, [exercises]);
  const planExFiltered = useMemo(() => {
    const q = planExQuery.trim().toLowerCase();
    return exercises.filter((ex) => {
      if (planExCategory !== "All" && !exCats(ex).includes(planExCategory)) return false;
      if (!q) return true;
      return (ex.name || "").toLowerCase().includes(q) || (ex.description || "").toLowerCase().includes(q);
    });
  }, [exercises, planExQuery, planExCategory]);

  const exMap = useMemo(() => Object.fromEntries(exercises.map((e) => [e.exercise_id, e])), [exercises]);

  // pain trend data: oldest first
  const painData = useMemo(() => {
    return [...diary].reverse().map((d) => ({
      date: new Date(d.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      pain: d.pain_score,
    }));
  }, [diary]);

  if (!patient) return <p className="text-[#787672]">Loading…</p>;

  return (
    <div className="space-y-8">
      <Link to="/clinician" className="inline-flex items-center gap-2 text-sm text-[#787672] hover:text-[#C96A52]" data-testid="back-to-patients">
        <ArrowLeft size={14} /> All patients
      </Link>

      <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6 md:p-8 flex flex-wrap gap-6 items-center">
        <button
          type="button"
          onClick={() => photoRef.current?.click()}
          data-testid="patient-photo-trigger"
          className="group relative h-20 w-20 rounded-3xl bg-[#E8E2D9] overflow-hidden border border-[#E2DFD8] hover:border-[#C96A52] transition"
          title="Change photo"
        >
          {patient.photo_url ? (
            <img src={fileSrc(patient.photo_url)} alt={patient.name} className="h-full w-full object-cover" />
          ) : (
            <span className="grid place-items-center h-full w-full text-3xl font-display font-bold text-[#C96A52]">
              {patient.name?.[0]?.toUpperCase()}
            </span>
          )}
          <span className="absolute inset-0 bg-black/40 grid place-items-center opacity-0 group-hover:opacity-100 transition text-white text-[10px] uppercase tracking-widest font-bold">
            {patient.photo_url ? "Change" : "Add photo"}
          </span>
        </button>
        <input ref={photoRef} type="file" accept="image/*" onChange={onPhotoChange} data-testid="patient-photo-input" className="hidden" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">{patient.name}{patient.last_name ? ` ${patient.last_name}` : ""}</h1>
            <Button variant="ghost" size="sm" onClick={openEdit} data-testid="patient-edit-btn" className="text-[#787672] hover:text-[#C96A52]"><Edit3 size={14} /> Edit</Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleMine}
              disabled={pinBusy}
              data-testid="patient-toggle-mine-btn"
              className={isMine ? "text-[#C96A52]" : "text-[#787672] hover:text-[#C96A52]"}
            >
              <Star size={14} fill={isMine ? "#C96A52" : "none"} /> {isMine ? "My Patient" : "Mark as mine"}
            </Button>
            {patient.archived ? (
              <>
                <span className="text-[10px] uppercase tracking-widest font-bold text-[#787672] bg-[#F3F0EB] px-2 py-1 rounded-full" data-testid="archived-badge">Archived</span>
                <Button variant="ghost" size="sm" onClick={unarchivePatient} data-testid="patient-unarchive-btn" className="text-[#5B7566] hover:text-[#3a4f44]"><ArchiveRestore size={14} /> Restore</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmAction("permanent")} data-testid="patient-permanent-delete-btn" className="text-destructive hover:text-destructive"><Trash2 size={14} /> Delete permanently</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction("archive")} data-testid="patient-archive-btn" className="text-[#787672] hover:text-[#C96A52]"><Archive size={14} /> Archive</Button>
            )}
          </div>
          <p className="text-[#787672]">{patient.breed || "Mixed breed"} · {patient.age_years ?? "—"} yrs · {patient.weight_kg ?? "—"} kg</p>
          {patient.condition && <span className="inline-block mt-2 text-xs bg-[#E8E2D9] text-[#2C312E] px-3 py-1 rounded-full font-semibold">{patient.condition}</span>}
          {patient.owner_email && <p className="text-xs mt-2 text-[#787672]">Owner: {patient.owner_email}</p>}
        </div>
      </div>

      {siblings.length > 0 && (
        <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6" data-testid="household-card">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <div>
              <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Household</p>
              <h3 className="font-display text-xl font-semibold mt-1">{patient.name} is one of {siblings.length + 1} pet{siblings.length === 0 ? "" : "s"} in this household</h3>
            </div>
            <span className="text-xs text-[#787672]">Shared owner: {patient.owner_email}</span>
          </div>
          {patient.last_name && siblings.some((s) => (s.last_name || "") !== patient.last_name) && (
            <div className="mt-3 p-3 rounded-2xl bg-[#5B7566]/5 border border-[#5B7566]/20 flex items-center gap-3 flex-wrap" data-testid="household-lastname-prompt">
              <Users size={16} className="text-[#5B7566]" />
              <p className="text-sm text-[#3a3a36] flex-1 min-w-[200px]">Apply <b>"{patient.last_name}"</b> as the last name to {siblings.filter(s => (s.last_name || "") !== patient.last_name).length} other pet{siblings.filter(s => (s.last_name || "") !== patient.last_name).length === 1 ? "" : "s"} in this household?</p>
              <Button size="sm" disabled={hhBusy} onClick={applyHouseholdLastName} className="rounded-full bg-[#5B7566] hover:bg-[#4a6354]" data-testid="apply-household-lastname">
                {hhBusy ? "Applying…" : "Apply to all"}
              </Button>
            </div>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
            {siblings.map((s) => (
              <Link
                key={s.patient_id}
                to={`/clinician/patients/${s.patient_id}`}
                data-testid={`sibling-${s.patient_id}`}
                className="flex items-center gap-3 p-3 rounded-2xl border border-[#E2DFD8] bg-[#FAF9F6] hover:border-[#C96A52]/40 hover:-translate-y-0.5 transition"
              >
                <div className="h-12 w-12 rounded-xl bg-[#E8E2D9] overflow-hidden flex items-center justify-center font-display font-bold text-[#C96A52]">
                  {s.photo_url ? <img src={fileSrc(s.photo_url)} alt={s.name} className="h-full w-full object-cover" /> : (s.name?.[0]?.toUpperCase() || "D")}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">{s.name}{s.last_name ? ` ${s.last_name}` : ""}</p>
                  <p className="text-xs text-[#787672] truncate">{s.breed || "Mixed breed"}{s.condition ? ` · ${s.condition}` : ""}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Tabs defaultValue="plan" className="w-full">
        <TabsList className="bg-[#F3F0EB] rounded-full p-1">
          <TabsTrigger value="plan" data-testid="tab-plan" className="rounded-full data-[state=active]:bg-white data-[state=active]:shadow-sm">Plans</TabsTrigger>
          <TabsTrigger value="tracking" data-testid="tab-tracking" className="rounded-full data-[state=active]:bg-white data-[state=active]:shadow-sm">Tracking</TabsTrigger>
          <TabsTrigger value="videos" data-testid="tab-videos" className="rounded-full data-[state=active]:bg-white data-[state=active]:shadow-sm">
            Videos {videos.length > 0 && <span className="ml-1.5 bg-[#C96A52] text-white text-[10px] rounded-full h-4 min-w-4 px-1 inline-flex items-center justify-center">{videos.length}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="plan" className="space-y-6 pt-6">
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6">
              <h3 className="font-display text-xl font-semibold">Build {editingPlanId ? "edit" : "new"} plan</h3>
              <div className="mt-4 space-y-3">
                <div><Label>Plan title</Label><Input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} data-testid="plan-title" className="bg-[#F3F0EB] border-transparent mt-1" /></div>
                <div><Label>Notes</Label><Textarea rows={2} value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} data-testid="plan-notes" className="bg-[#F3F0EB] border-transparent mt-1" /></div>
              </div>
              <p className="text-xs uppercase tracking-widest font-bold text-[#787672] mt-6">Selected exercises</p>
              {items.length === 0 ? (
                <p className="text-sm text-[#787672] mt-2">Pick exercises from the right →</p>
              ) : (
                <div className="space-y-2 mt-2">
                  {items.map((it) => {
                    const ex = exMap[it.exercise_id];
                    return (
                      <div key={it.exercise_id} className="p-3 bg-[#F3F0EB] rounded-xl space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold flex-1 truncate text-sm">{ex?.name || "?"}</p>
                          <Button variant="ghost" size="sm" onClick={() => removeItem(it.exercise_id)}><X size={14} /></Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-[#787672]">Sets</span>
                          <Input
                            type="text"
                            value={it.sets ?? ""}
                            onChange={(e) => updateItem(it.exercise_id, { sets: e.target.value })}
                            placeholder="3 or 3-5"
                            className="w-20 h-7 bg-white text-xs"
                            data-testid={`plan-item-sets-${it.exercise_id}`}
                          />
                          <span className="text-[#787672]">×</span>
                          <Input
                            type="text"
                            value={it.reps ?? ""}
                            onChange={(e) => updateItem(it.exercise_id, { reps: e.target.value })}
                            placeholder="10 or 5-10"
                            className="w-20 h-7 bg-white text-xs"
                            data-testid={`plan-item-reps-${it.exercise_id}`}
                          />
                          <span className="text-[#787672] ml-1">Hold</span>
                          <Input
                            type="text"
                            value={it.duration || ""}
                            onChange={(e) => updateItem(it.exercise_id, { duration: e.target.value })}
                            placeholder="e.g. 15-30 sec"
                            className="w-32 h-7 bg-white text-xs"
                            data-testid={`plan-item-duration-${it.exercise_id}`}
                          />
                          <select value={it.frequency} onChange={(e) => updateItem(it.exercise_id, { frequency: e.target.value })} className="h-7 rounded-md border border-[#E2DFD8] bg-white px-2 text-xs">
                            {["Daily", "2× daily", "3× daily", "Every other day", "3× weekly", "Weekly", "As tolerated"].map((f) => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                        {ex && ((ex.variations || []).length > 0 || (ex.progressions || []).length > 0) && (
                          <SwapPanel
                            currentExId={it.exercise_id}
                            variations={ex.variations || []}
                            progressions={ex.progressions || []}
                            allExercises={exercises}
                            onSwap={(newEx) => swapItem(it.exercise_id, newEx)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                <Button onClick={savePlan} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]" data-testid="save-plan-btn">{editingPlanId ? "Update plan" : "Save plan"}</Button>
                {editingPlanId && <Button variant="ghost" onClick={resetPlanForm}>Cancel</Button>}
                <Button variant="outline" onClick={() => setTemplatePicker(true)} data-testid="load-template-btn" className="rounded-full border-[#E2DFD8]"><FolderOpen size={14} /> Load template</Button>
                <Button variant="outline" onClick={() => setSaveTemplateOpen(true)} disabled={items.length === 0} data-testid="save-template-btn" className="rounded-full border-[#E2DFD8]"><BookmarkPlus size={14} /> Save as template</Button>
              </div>
            </div>

            <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6">
              <h3 className="font-display text-xl font-semibold">Add exercises</h3>
              <div className="mt-3 space-y-3">
                <Input
                  value={planExQuery}
                  onChange={(e) => setPlanExQuery(e.target.value)}
                  placeholder="Search exercises…"
                  data-testid="plan-ex-search"
                  className="bg-[#F3F0EB] border-transparent h-10"
                />
                <div className="flex flex-wrap gap-1.5">
                  {planExCategories.map((c) => {
                    const active = planExCategory === c;
                    const color = c === "All" ? "#C96A52" : getCategoryColor(c);
                    const style = active
                      ? { backgroundColor: color, borderColor: color, color: "#fff" }
                      : { backgroundColor: colorWithAlpha(color, 0.10), borderColor: colorWithAlpha(color, 0.30), color };
                    return (
                      <button
                        key={c}
                        onClick={() => setPlanExCategory(c)}
                        data-testid={`plan-cat-${c}`}
                        className="rounded-full px-3 py-1 text-xs font-semibold transition border"
                        style={style}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 mt-4 max-h-[420px] overflow-y-auto pr-2">
                {planExFiltered.length === 0 ? (
                  <p className="col-span-2 text-sm text-[#787672] text-center py-6">No matching exercises.</p>
                ) : planExFiltered.map((ex) => (
                  <button key={ex.exercise_id} onClick={() => addItem(ex)} data-testid={`add-ex-${ex.exercise_id}`} className="text-left p-3 rounded-xl border border-[#E2DFD8] hover:border-[#C96A52] hover:bg-[#C96A52]/5 transition">
                    <p className="font-semibold text-sm truncate">{ex.name}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {exCats(ex).map((c) => <CategoryChip key={c} name={c} size="xs" />)}
                      <span className="text-xs text-[#787672]">{ex.default_sets ?? ""}×{ex.default_reps ?? ""}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-display text-xl font-semibold mb-3">Saved plans ({plans.length})</h3>
            {plans.length === 0 ? (
              <p className="text-[#787672] text-sm">No plans yet for {patient.name}.</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {plans.map((pl) => (
                  <div key={pl.plan_id} className="bg-white border border-[#E2DFD8] rounded-2xl p-5" data-testid={`plan-${pl.plan_id}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-display text-lg font-semibold">{pl.title}</p><p className="text-xs text-[#787672]">{pl.items?.length || 0} exercises</p></div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => startEditPlan(pl)}>Edit</Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => delPlan(pl.plan_id)}><Trash2 size={14} /></Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1 text-sm">
                      {pl.items?.slice(0, 4).map((it) => (
                        <div key={it.exercise_id} className="flex justify-between text-[#3a3a36]">
                          <span className="truncate">{exMap[it.exercise_id]?.name || it.exercise_id}</span>
                          <span className="text-[#787672]">{it.sets}×{it.reps} · {it.frequency}</span>
                        </div>
                      ))}
                      {pl.items?.length > 4 && <p className="text-xs text-[#787672]">+ {pl.items.length - 4} more</p>}
                    </div>
                    <div className="flex gap-2 mt-4 pt-4 border-t border-[#E2DFD8]">
                      <Button size="sm" variant="outline" onClick={() => downloadPdf(pl.plan_id, `${patient.name}-${pl.title}`)} data-testid={`pdf-download-${pl.plan_id}`} className="rounded-full border-[#E2DFD8]">
                        <Download size={14} /> PDF
                      </Button>
                      <Button size="sm" onClick={() => emailPlan(pl.plan_id)} data-testid={`pdf-email-${pl.plan_id}`} className="rounded-full bg-[#5B7566] hover:bg-[#4a6354]">
                        <Mail size={14} /> Email to owner
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tracking" className="space-y-6 pt-6">
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6">
              <p className="text-xs uppercase tracking-widest font-bold text-[#787672]">Logs</p>
              <p className="font-display text-4xl font-bold mt-1">{diary.length}</p>
              <p className="text-sm text-[#787672]">Entries</p>
            </div>
            <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6">
              <p className="text-xs uppercase tracking-widest font-bold text-[#787672]">Avg pain</p>
              <p className="font-display text-4xl font-bold mt-1 text-[#C96A52]">
                {diary.length ? (diary.reduce((s, d) => s + d.pain_score, 0) / diary.length).toFixed(1) : "—"}
              </p>
              <p className="text-sm text-[#787672]">Across all entries</p>
            </div>
            <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6">
              <p className="text-xs uppercase tracking-widest font-bold text-[#787672]">Completion</p>
              <p className="font-display text-4xl font-bold mt-1 text-[#5B7566]">
                {diary.length ? Math.round((diary.filter((d) => d.completed).length / diary.length) * 100) : 0}%
              </p>
              <p className="text-sm text-[#787672]">Sessions completed</p>
            </div>
          </div>

          <div className="bg-white border border-[#E2DFD8] rounded-3xl p-6">
            <p className="text-xs uppercase tracking-widest font-bold text-[#787672]">Pain trend</p>
            <div className="h-64 mt-4">
              {painData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={painData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2DFD8" />
                    <XAxis dataKey="date" stroke="#787672" />
                    <YAxis domain={[0, 10]} stroke="#787672" />
                    <Tooltip />
                    <Line type="monotone" dataKey="pain" stroke="#C96A52" strokeWidth={3} dot={{ fill: "#C96A52" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="grid place-items-center h-full text-[#787672] text-sm">No data yet</div>
              )}
            </div>
          </div>

          <div>
            <h3 className="font-display text-xl font-semibold mb-3">Recent diary entries</h3>
            {diary.length === 0 ? (
              <p className="text-[#787672] text-sm">No entries yet.</p>
            ) : (
              <div className="space-y-3">
                {diary.slice(0, 20).map((d) => (
                  <div key={d.diary_id} className="bg-white border border-[#E2DFD8] rounded-2xl p-4 flex items-start gap-4" data-testid={`diary-${d.diary_id}`}>
                    <div className="text-xs text-[#787672] w-24 flex-shrink-0">{new Date(d.created_at).toLocaleDateString()}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{exMap[d.exercise_id]?.name || d.exercise_id}</p>
                      <p className="text-xs text-[#787672]">{d.completed ? "✓ Completed" : "Not done"} · Pain {d.pain_score}/10 · {d.actual_reps ?? "—"} reps</p>
                      {d.notes && <p className="text-sm mt-1 text-[#3a3a36]">{d.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="videos" className="space-y-4 pt-6">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-2xl font-semibold">Owner videos for review</h3>
            <p className="text-xs text-[#787672]">{videos.length} clip{videos.length === 1 ? "" : "s"}</p>
          </div>
          {videos.length === 0 ? (
            <div className="bg-white border border-[#E2DFD8] rounded-3xl p-12 text-center">
              <Video size={42} className="mx-auto text-[#5B7566]" />
              <p className="font-display text-xl mt-4 font-semibold">No videos yet</p>
              <p className="text-[#787672] mt-2 text-sm">When the owner uploads a video, it'll appear here and an email will go to your rehab inbox.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {videos.map((v) => (
                <div key={v.video_id} className="bg-white border border-[#E2DFD8] rounded-2xl p-5" data-testid={`video-${v.video_id}`}>
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#5B7566]/10 text-[#5B7566] flex-shrink-0">
                      <Video size={18} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{v.filename || "video"}</p>
                      <p className="text-xs text-[#787672]">
                        {new Date(v.created_at).toLocaleString()} · {(v.size / (1024 * 1024)).toFixed(1)} MB
                        {" · "}
                        <span className={v.storage_provider === "sharepoint" ? "text-[#5B7566] font-semibold" : ""}>
                          {v.storage_provider === "sharepoint" ? "SharePoint" : "Local storage"}
                        </span>
                      </p>
                      {v.uploader_name && <p className="text-xs text-[#787672]">From {v.uploader_name}</p>}
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive flex-shrink-0" onClick={() => deleteVideo(v.video_id)} data-testid={`video-delete-${v.video_id}`}><Trash2 size={14} /></Button>
                  </div>
                  {v.notes && <p className="text-sm mt-3 p-3 bg-[#F3F0EB] rounded-xl">"{v.notes}"</p>}
                  {v.video_link && (
                    <div className="mt-3 pt-3 border-t border-[#E2DFD8]">
                      {v.storage_provider === "object-storage" ? (
                        <video src={`${process.env.REACT_APP_BACKEND_URL}${v.video_link}`} controls className="w-full rounded-xl max-h-64 bg-[#1a1a1a]" />
                      ) : (
                        <a href={v.video_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[#C96A52] font-semibold text-sm">
                          <ExternalLink size={14} /> Open in SharePoint
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="font-display text-2xl">Edit patient</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Dog's name</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} data-testid="edit-name" className="bg-[#F3F0EB] border-transparent mt-1" />
            </div>
            <div>
              <Label>Last name (family / owner surname)</Label>
              <Input value={editForm.last_name} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} data-testid="edit-last-name" placeholder="e.g. Smith" className="bg-[#F3F0EB] border-transparent mt-1" />
              {siblings.length > 0 && editForm.last_name && (
                <p className="text-xs text-[#787672] mt-1">You'll be asked if you want to apply this last name to {siblings.length} other pet{siblings.length === 1 ? "" : "s"} in this household.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editBusy || !editForm.name} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]" data-testid="edit-save">
              {editBusy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmAction} onOpenChange={(o) => { if (!o) setConfirmAction(null); }}>
        <AlertDialogContent data-testid="patient-confirm-dialog" onCloseAutoFocus={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl">
              {confirmAction === "permanent" ? "Permanently delete this patient?" : "Archive this patient?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "permanent" ? (
                <>This will permanently remove <b className="text-[#1a1a1a]">{patient?.name}</b> and all of their plans, diary entries, and uploaded videos. This cannot be undone.</>
              ) : (
                <>We&apos;ll move <b className="text-[#1a1a1a]">{patient?.name}</b> to the archived list. Their plans and tracking are preserved — you can restore them any time.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="patient-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="patient-confirm-action"
              onClick={confirmAction === "permanent" ? doPermanentDelete : doArchive}
              className={confirmAction === "permanent" ? "bg-destructive hover:bg-destructive/90" : "bg-[#C96A52] hover:bg-[#B35A44]"}
            >
              {confirmAction === "permanent" ? "Delete permanently" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={saveTemplateOpen} onOpenChange={(o) => { setSaveTemplateOpen(o); if (!o) { setTplName(""); setTplDesc(""); setTplPublic(false); } }}>
        <DialogContent className="rounded-2xl max-w-md" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="save-template-dialog">
          <DialogHeader><DialogTitle className="font-display text-2xl">Save as template</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Template name</Label>
              <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="e.g. Post-TPLO Week 1" data-testid="tpl-name" className="bg-[#F3F0EB] border-transparent mt-1" />
            </div>
            <div>
              <Label>Description <span className="text-xs text-[#787672] font-normal">(optional)</span></Label>
              <Input value={tplDesc} onChange={(e) => setTplDesc(e.target.value)} placeholder="Early recovery, ROM + gentle NMES" data-testid="tpl-desc" className="bg-[#F3F0EB] border-transparent mt-1" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={tplPublic} onChange={(e) => setTplPublic(e.target.checked)} data-testid="tpl-public" className="rounded" />
              Share publicly with every clinician
            </label>
            <p className="text-xs text-[#787672]">This template will save {items.length} exercise{items.length === 1 ? "" : "s"}.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveTemplateOpen(false)}>Cancel</Button>
            <Button onClick={saveAsTemplate} disabled={tplBusy || !tplName.trim()} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]" data-testid="tpl-save-confirm">
              {tplBusy ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templatePicker} onOpenChange={(o) => { setTemplatePicker(o); if (o) loadTemplates(); }}>
        <DialogContent className="rounded-2xl max-w-2xl max-h-[85vh] overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()} data-testid="template-picker">
          <DialogHeader><DialogTitle className="font-display text-2xl">Load from template</DialogTitle></DialogHeader>
          {templates.length === 0 ? (
            <p className="text-sm text-[#787672] py-6 text-center">No templates yet. Build a plan and click "Save as template".</p>
          ) : (
            <ul className="space-y-2">
              {templates.map((tpl) => (
                <li key={tpl.template_id}>
                  <button
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="w-full text-left p-4 rounded-2xl border border-[#E2DFD8] hover:border-[#C96A52] hover:bg-[#C96A52]/5 transition"
                    data-testid={`apply-tpl-${tpl.template_id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{tpl.name}</p>
                        {tpl.description && <p className="text-xs text-[#787672] mt-1 line-clamp-2">{tpl.description}</p>}
                      </div>
                      <span className={`shrink-0 text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-full ${tpl._relation === "owned" ? "bg-[#C96A52]/10 text-[#C96A52]" : tpl._relation === "shared" ? "bg-[#5B7566]/10 text-[#5B7566]" : "bg-[#787672]/10 text-[#787672]"}`}>
                        {tpl._relation === "owned" ? "Owned" : tpl._relation === "shared" ? "Shared" : "Public"}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-[#787672] flex items-center gap-2">
                      <span>{(tpl.items || []).length} exercise{(tpl.items || []).length === 1 ? "" : "s"}</span>
                      <span>·</span>
                      <span>by {tpl.created_by_name || tpl.created_by_email}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

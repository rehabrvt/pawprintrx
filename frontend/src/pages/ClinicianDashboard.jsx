import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatError, fileSrc } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import { Plus, Dog, Search, Download, ArchiveRestore, Archive } from "lucide-react";

const empty = { name: "", last_name: "", breed: "", age_years: "", weight_kg: "", condition: "", notes: "", owner_email: "" };

export default function ClinicianDashboard() {
  const [patients, setPatients] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState(0);
  // ezyVet
  const [ezyOpen, setEzyOpen] = useState(false);
  const [ezyQuery, setEzyQuery] = useState("");
  const [ezyBusy, setEzyBusy] = useState(false);
  const [ezyResults, setEzyResults] = useState([]);
  const [ezyImporting, setEzyImporting] = useState("");

  async function load() {
    try {
      const params = showArchived ? { archived: "true" } : {};
      const [{ data: rows }, { data: arch }] = await Promise.all([
        api.get("/patients", { params }),
        // Always fetch archived count to drive the toggle badge.
        api.get("/patients", { params: { archived: "true" } }),
      ]);
      setPatients(rows);
      setArchivedCount(arch.length);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    }
  }
  useEffect(() => { load(); }, [showArchived]); // eslint-disable-line react-hooks/exhaustive-deps

  async function unarchivePatient(e, p) {
    e.preventDefault(); e.stopPropagation();
    try {
      await api.post(`/patients/${p.patient_id}/unarchive`);
      toast.success(`${p.name} restored`);
      load();
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail) || "Could not unarchive");
    }
  }

  async function create() {
    setBusy(true);
    try {
      const payload = {
        ...form,
        age_years: form.age_years ? Number(form.age_years) : null,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      };
      await api.post("/patients", payload);
      toast.success("Patient added");
      setForm(empty);
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail));
    } finally { setBusy(false); }
  }

  async function ezySearch() {
    if (!ezyQuery.trim()) return;
    setEzyBusy(true);
    try {
      const { data } = await api.get("/ezyvet/search", { params: { q: ezyQuery.trim() } });
      setEzyResults(data.results || []);
      if (!data.results?.length) toast.info("No matches in ezyVet");
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "ezyVet search failed");
    } finally { setEzyBusy(false); }
  }

  async function ezyImport(r) {
    setEzyImporting(r.ezyvet_animal_id);
    try {
      const ageYears = (() => {
        if (!r.date_of_birth) return null;
        const t = Date.parse(r.date_of_birth);
        if (Number.isNaN(t)) return null;
        return Math.round(((Date.now() - t) / (365.25 * 24 * 3600 * 1000)) * 10) / 10;
      })();
      const payload = {
        ezyvet_animal_id: r.ezyvet_animal_id,
        ezyvet_contact_id: r.owner?.ezyvet_contact_id || "",
        name: r.name,
        last_name: r.owner?.last_name || "",
        breed: r.breed || r.species || "",
        age_years: ageYears,
        weight_kg: r.weight ? Number(r.weight) : null,
        condition: "",
        notes: r.color ? `Color: ${r.color}` : "",
        owner_email: r.owner?.email || "",
      };
      await api.post("/ezyvet/import", payload);
      toast.success(`${r.name} imported`);
      setEzyOpen(false);
      setEzyQuery(""); setEzyResults([]);
      load();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Import failed");
    } finally { setEzyImporting(""); }
  }

  return (
    <div className="space-y-8" data-testid="clinician-dashboard">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Clinician</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mt-1">Patients</h1>
          <p className="text-[#787672] mt-2">{patients.length} dog{patients.length === 1 ? "" : "s"} {showArchived ? "archived" : "in your care"}</p>
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            data-testid="toggle-archived-btn"
            className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-[#C96A52] hover:underline"
          >
            {showArchived ? (<><ArchiveRestore size={14} /> Back to active patients</>) : (<><Archive size={14} /> View archived ({archivedCount})</>)}
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Dialog open={ezyOpen} onOpenChange={(v) => { setEzyOpen(v); if (!v) { setEzyQuery(""); setEzyResults([]); } }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="rounded-full border-[#E2DFD8] h-11 px-5" data-testid="ezyvet-import-btn">
                <Download size={16} /> Import from ezyVet
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-2xl">
              <DialogHeader><DialogTitle className="font-display text-2xl">Import patient from ezyVet</DialogTitle></DialogHeader>
              <div className="flex gap-2">
                <Input
                  value={ezyQuery}
                  onChange={(e) => setEzyQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") ezySearch(); }}
                  placeholder="Search by dog's name…"
                  data-testid="ezyvet-query"
                  className="bg-[#F3F0EB] border-transparent h-11"
                />
                <Button onClick={ezySearch} disabled={ezyBusy || !ezyQuery.trim()} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44] h-11 px-5" data-testid="ezyvet-search-btn">
                  <Search size={16} /> {ezyBusy ? "Searching…" : "Search"}
                </Button>
              </div>
              <div className="max-h-[420px] overflow-y-auto space-y-2 mt-2">
                {ezyResults.length === 0 ? (
                  <p className="text-sm text-[#787672] text-center py-8">Search ezyVet by name to see matches.</p>
                ) : ezyResults.map((r) => (
                  <div key={r.ezyvet_animal_id} className="border border-[#E2DFD8] rounded-xl p-4 flex gap-3 items-start" data-testid={`ezy-result-${r.ezyvet_animal_id}`}>
                    <div className="h-12 w-12 rounded-xl bg-[#E8E2D9] flex items-center justify-center font-display font-bold text-[#C96A52]">
                      {r.name?.[0]?.toUpperCase() || "D"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-[#787672]">{[r.breed, r.species, r.sex].filter(Boolean).join(" · ") || "—"}</p>
                      {r.owner?.email && <p className="text-xs text-[#787672] mt-0.5">Owner: {r.owner.first_name} {r.owner.last_name} · {r.owner.email}</p>}
                    </div>
                    <Button size="sm" onClick={() => ezyImport(r)} disabled={ezyImporting === r.ezyvet_animal_id} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]" data-testid={`ezy-import-${r.ezyvet_animal_id}`}>
                      {ezyImporting === r.ezyvet_animal_id ? "Importing…" : "Import"}
                    </Button>
                  </div>
                ))}
              </div>
            </DialogContent>
          </Dialog>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-full bg-[#C96A52] hover:bg-[#B35A44] h-11 px-6" data-testid="add-patient-btn">
              <Plus size={16} /> New patient
            </Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl">
            <DialogHeader><DialogTitle className="font-display text-2xl">New patient</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Dog's name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="patient-name" className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1" />
              </div>
              <div className="col-span-2">
                <Label>Last name (family / owner surname)</Label>
                <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} data-testid="patient-last-name" className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1" placeholder="e.g. Smith" />
              </div>
              <div>
                <Label>Breed</Label>
                <Input value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} data-testid="patient-breed" className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1" />
              </div>
              <div>
                <Label>Condition</Label>
                <Input value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} data-testid="patient-condition" className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1" />
              </div>
              <div>
                <Label>Age (years)</Label>
                <Input type="number" step="0.1" value={form.age_years} onChange={(e) => setForm({ ...form, age_years: e.target.value })} data-testid="patient-age" className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1" />
              </div>
              <div>
                <Label>Weight (kg)</Label>
                <Input type="number" step="0.1" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} data-testid="patient-weight" className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1" />
              </div>
              <div className="col-span-2">
                <Label>Owner email (for tracking access)</Label>
                <Input type="email" value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} data-testid="patient-owner-email" className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1" />
                <p className="text-xs text-[#787672] mt-1">If this owner already has another pet here, just re-use the same email — they'll see all their pets in one account.</p>
              </div>
              <div className="col-span-2">
                <Label>Clinician notes</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="patient-notes" className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={create} disabled={busy || !form.name} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]" data-testid="patient-create-submit">
                {busy ? "Saving…" : "Add patient"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {patients.length === 0 ? (
        <div className="bg-white border border-[#E2DFD8] rounded-3xl p-12 text-center">
          <Dog size={42} className="mx-auto text-[#C96A52]" />
          <h3 className="font-display text-2xl mt-4 font-semibold">
            {showArchived ? "No archived patients" : "No patients yet"}
          </h3>
          <p className="text-[#787672] mt-2">
            {showArchived
              ? "Archived patients will appear here. They keep their plans and tracking until permanently deleted."
              : "Add your first canine patient to begin building plans."}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {patients.map((p) => (
            <Link key={p.patient_id} to={`/clinician/patients/${p.patient_id}`} data-testid={`patient-card-${p.patient_id}`} className={`block bg-white border border-[#E2DFD8] rounded-3xl p-6 transition hover:-translate-y-1 hover:shadow-lg duration-200 ${p.archived ? "opacity-75" : ""}`}>
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-[#E8E2D9] flex items-center justify-center text-2xl font-display font-bold text-[#C96A52] overflow-hidden">
                  {p.photo_url ? (
                    <img src={fileSrc(p.photo_url)} alt={p.name} className="h-full w-full object-cover" />
                  ) : (
                    p.name?.[0]?.toUpperCase() || "D"
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xl font-semibold truncate">{p.name}{p.last_name ? ` ${p.last_name}` : ""}</p>
                  <p className="text-sm text-[#787672] truncate">{p.breed || "Mixed breed"}</p>
                </div>
                {p.archived && (
                  <span className="text-[10px] uppercase tracking-widest font-bold text-[#787672] bg-[#F3F0EB] px-2 py-1 rounded-full">Archived</span>
                )}
              </div>
              {p.condition && (
                <span className="inline-block mt-4 text-xs bg-[#E8E2D9] text-[#2C312E] px-3 py-1 rounded-full font-semibold">
                  {p.condition}
                </span>
              )}
              <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                <div><p className="text-xs text-[#787672] uppercase tracking-widest">Age</p><p className="font-semibold">{p.age_years ?? "—"} yrs</p></div>
                <div><p className="text-xs text-[#787672] uppercase tracking-widest">Weight</p><p className="font-semibold">{p.weight_kg ?? "—"} kg</p></div>
              </div>
              {p.archived && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => unarchivePatient(e, p)}
                  className="mt-4 w-full justify-center text-[#5B7566] hover:text-[#3a4f44] hover:bg-[#5B7566]/10"
                  data-testid={`unarchive-${p.patient_id}`}
                >
                  <ArchiveRestore size={14} /> Restore patient
                </Button>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

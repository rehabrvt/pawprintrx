import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fileSrc, formatError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { Users, UserPlus, Heart, X, Save } from "lucide-react";

export default function FamilySettings() {
  const { user, refresh } = useAuth();
  const [familyName, setFamilyName] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);

  const [patients, setPatients] = useState([]);
  const [coparents, setCoparents] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState("");

  async function load() {
    try {
      const [pat, cps] = await Promise.all([
        api.get("/patients"),
        api.get("/owner/coparents"),
      ]);
      setPatients(pat.data || []);
      setCoparents(cps.data?.coparents || []);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { setFamilyName(user?.name || ""); }, [user?.name]);

  async function saveFamilyName() {
    if (!familyName.trim()) return;
    setSavingName(true);
    try {
      await api.put("/owner/family-name", { name: familyName.trim() });
      await refresh();
      toast.success("Family name updated");
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Save failed"); }
    finally { setSavingName(false); }
  }

  async function invite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviting(true);
    try {
      const { data } = await api.post("/owner/coparents", { email });
      const msg = data.invite_sent
        ? `${email} now has access — invite email sent`
        : `${email} now has access to your ${data.patients_updated} pet${data.patients_updated === 1 ? "" : "s"}`;
      toast.success(msg);
      setInviteEmail("");
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Invite failed"); }
    finally { setInviting(false); }
  }

  async function remove(email) {
    if (!window.confirm(`Remove access for ${email}?`)) return;
    setRemoving(email);
    try {
      await api.delete(`/owner/coparents/${encodeURIComponent(email)}`);
      toast.success("Access removed");
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Remove failed"); }
    finally { setRemoving(""); }
  }

  return (
    <div className="space-y-8 max-w-3xl" data-testid="family-settings">
      <div>
        <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Family settings</p>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mt-1">Your household</h1>
        <p className="text-[#787672] mt-2">Manage your family name, pets, and shared access.</p>
      </div>

      <section className="bg-white border border-[#E2DFD8] rounded-3xl p-6 md:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-11 w-11 rounded-full bg-[#C96A52]/10 text-[#C96A52] items-center justify-center flex-shrink-0">
            <Users size={20} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl font-semibold">Family display name</h2>
            <p className="text-sm text-[#787672] mt-1">How your household appears on emails and in the clinic's records.</p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
              <div>
                <Label htmlFor="family-name-input" className="text-xs uppercase tracking-widest font-bold text-[#787672]">Display name</Label>
                <Input
                  id="family-name-input"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  placeholder="The Smith family"
                  data-testid="family-name-input"
                  className="mt-1 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11"
                />
              </div>
              <div className="self-end">
                <Button onClick={saveFamilyName} disabled={savingName || !familyName.trim() || familyName.trim() === user?.name} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44] h-11 px-6" data-testid="family-name-save">
                  <Save size={14} /> {savingName ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white border border-[#E2DFD8] rounded-3xl p-6 md:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-11 w-11 rounded-full bg-[#5B7566]/10 text-[#5B7566] items-center justify-center flex-shrink-0">
            <Heart size={20} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl font-semibold">Pets in your household ({patients.length})</h2>
            <p className="text-sm text-[#787672] mt-1">To add a new pet, ask your clinician — they'll link it to your email.</p>
            {patients.length === 0 ? (
              <p className="text-sm text-[#787672] mt-4">No pets yet.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                {patients.map((p) => (
                  <Link key={p.patient_id} to="/owner" data-testid={`family-pet-${p.patient_id}`} className="flex items-center gap-3 p-3 rounded-2xl border border-[#E2DFD8] bg-[#FAF9F6] hover:border-[#C96A52]/40 transition">
                    <div className="h-12 w-12 rounded-xl bg-[#E8E2D9] overflow-hidden flex items-center justify-center font-display font-bold text-[#C96A52]">
                      {p.photo_url ? <img src={fileSrc(p.photo_url)} alt={p.name} className="h-full w-full object-cover" /> : (p.name?.[0]?.toUpperCase() || "D")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{p.name}{p.last_name ? ` ${p.last_name}` : ""}</p>
                      <p className="text-xs text-[#787672] truncate">{p.breed || "Mixed breed"}{p.condition ? ` · ${p.condition}` : ""}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="bg-white border border-[#E2DFD8] rounded-3xl p-6 md:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-11 w-11 rounded-full bg-[#C96A52]/10 text-[#C96A52] items-center justify-center flex-shrink-0">
            <UserPlus size={20} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl font-semibold">Co-parents & shared access</h2>
            <p className="text-sm text-[#787672] mt-1">Invite a partner, family member, or sitter. They'll be able to view plans and log exercises for every pet in your household using their own email.</p>
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
              <div>
                <Label htmlFor="coparent-email-input" className="text-xs uppercase tracking-widest font-bold text-[#787672]">Email address</Label>
                <Input
                  id="coparent-email-input"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") invite(); }}
                  placeholder="partner@example.com"
                  data-testid="coparent-email-input"
                  className="mt-1 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11"
                />
              </div>
              <div className="self-end">
                <Button onClick={invite} disabled={inviting || !inviteEmail.trim()} className="rounded-full bg-[#C96A52] hover:bg-[#B35A44] h-11 px-6" data-testid="coparent-invite-btn">
                  <UserPlus size={14} /> {inviting ? "Inviting…" : "Invite"}
                </Button>
              </div>
            </div>

            {coparents.length > 0 && (
              <div className="mt-6 pt-5 border-t border-[#E2DFD8] space-y-2">
                <p className="text-xs uppercase tracking-widest font-bold text-[#787672]">With access ({coparents.length})</p>
                {coparents.map((email) => (
                  <div key={email} className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F3F0EB]" data-testid={`coparent-${email}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-[#E8E2D9] grid place-items-center font-display font-bold text-[#C96A52] text-sm">
                        {email[0]?.toUpperCase()}
                      </div>
                      <p className="text-sm truncate">{email}</p>
                    </div>
                    <Button size="sm" variant="ghost" disabled={removing === email} onClick={() => remove(email)} className="text-destructive flex-shrink-0" data-testid={`coparent-remove-${email}`}>
                      <X size={14} /> Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, formatError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { Mail, Plus, Trash2, CheckCircle2, XCircle } from "lucide-react";

export default function AdminClinicianInvites() {
  const { user } = useAuth();
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const { data } = await api.get("/admin/clinician-invites");
      setInvites(data);
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || "Could not load invites");
    }
  }
  useEffect(() => { load(); }, []);

  if (!user?.is_admin) return <Navigate to={user?.role === "owner" ? "/owner" : "/clinician"} replace />;

  async function addInvite() {
    const em = email.trim().toLowerCase();
    if (!em) return;
    setBusy(true);
    try {
      await api.post("/admin/clinician-invites", { email: em });
      toast.success(`${em} can now add the Clinician role from their Settings.`);
      setEmail("");
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not invite"); }
    finally { setBusy(false); }
  }

  async function revoke(em) {
    if (!window.confirm(`Revoke clinician invite for ${em}? They won't be able to add the Clinician role. (Existing clinicians are not affected.)`)) return;
    try {
      await api.delete(`/admin/clinician-invites/${encodeURIComponent(em)}`);
      toast.success(`Revoked ${em}`);
      load();
    } catch (e) { toast.error(formatError(e.response?.data?.detail) || "Could not revoke"); }
  }

  return (
    <div className="space-y-8" data-testid="admin-clinician-invites">
      <div>
        <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Admin</p>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mt-1">Clinician invites</h1>
        <p className="text-[#787672] mt-2 max-w-xl">
          Only the emails on this list can request the Clinician role — either at signup or by adding it from their Settings. This prevents random pet parents from asking to become a clinician.
        </p>
      </div>

      <section className="bg-white border border-[#E2DFD8] rounded-3xl p-6 max-w-2xl">
        <Label>Invite a new clinician</Label>
        <div className="mt-2 flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="drjones@yourclinic.com"
            data-testid="new-invite-email"
            className="bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52]"
            onKeyDown={(e) => e.key === "Enter" && addInvite()}
          />
          <Button
            onClick={addInvite}
            disabled={busy || !email.trim()}
            className="rounded-full bg-[#C96A52] hover:bg-[#B35A44]"
            data-testid="add-invite-btn"
          >
            <Plus size={16} /> Invite
          </Button>
        </div>
        <p className="text-xs text-[#787672] mt-2">
          The invitee still needs to sign up (or log in) and click "Add role" in their Settings. You'll then approve them in the <b>Approvals</b> tab.
        </p>
      </section>

      <section className="bg-white border border-[#E2DFD8] rounded-3xl p-6 max-w-2xl">
        <div className="flex items-center gap-2 mb-4">
          <Mail size={18} className="text-[#C96A52]" />
          <h3 className="font-display text-xl font-semibold">All invites</h3>
          <span className="text-xs text-[#787672]">· {invites.filter((i) => !i.revoked).length} active</span>
        </div>
        {invites.length === 0 ? (
          <p className="text-sm text-[#787672] py-4">No invites yet. Add the first email above.</p>
        ) : (
          <ul className="divide-y divide-[#E2DFD8]" data-testid="invite-list">
            {invites.map((inv) => (
              <li key={inv.email} className="py-3 flex items-center gap-3" data-testid={`invite-row-${inv.email}`}>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{inv.email}</p>
                  <p className="text-xs text-[#787672] mt-0.5">Invited by {inv.invited_by}</p>
                </div>
                {inv.revoked ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[#787672] uppercase tracking-widest font-bold"><XCircle size={12} /> Revoked</span>
                ) : inv.used ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[#5B7566] uppercase tracking-widest font-bold"><CheckCircle2 size={12} /> Claimed</span>
                ) : (
                  <span className="text-xs text-[#787672] uppercase tracking-widest font-bold">Pending</span>
                )}
                {!inv.revoked && (
                  <Button variant="ghost" size="sm" onClick={() => revoke(inv.email)} className="text-destructive" data-testid={`invite-revoke-${inv.email}`}>
                    <Trash2 size={14} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

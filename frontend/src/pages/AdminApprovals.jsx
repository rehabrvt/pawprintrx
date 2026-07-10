import { useEffect, useState } from "react";
import { api, formatError } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, Check, X, Clock, UserCheck } from "lucide-react";

function fmt(date) { try { return new Date(date).toLocaleString(); } catch { return date; } }

export default function AdminApprovals() {
  const { user } = useAuth();
  const [tab, setTab] = useState("pending");
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/admin/clinicians", { params: { status: tab } });
      setItems(data);
    } catch (e) { toast.error(formatError(e.response?.data?.detail)); }
  }
  useEffect(() => { load(); }, [tab]);

  async function decide(uid, action) {
    setBusy(uid);
    try {
      await api.post(`/admin/clinicians/${uid}/${action}`);
      toast.success(action === "approve" ? "Clinician approved" : "Clinician rejected");
      load();
    } catch (e) {
      toast.error(formatError(e.response?.data?.detail) || `Could not ${action}`);
    } finally { setBusy(""); }
  }

  if (!user?.is_admin) {
    return (
      <div className="bg-white border border-[#E2DFD8] rounded-3xl p-12 text-center">
        <ShieldCheck size={42} className="mx-auto text-[#C96A52]" />
        <h3 className="font-display text-2xl mt-4 font-semibold">Admin only</h3>
        <p className="text-[#787672] mt-2">This page is restricted to clinic administrators.</p>
      </div>
    );
  }

  const tabs = [
    { v: "pending", label: "Pending", icon: <Clock size={14} /> },
    { v: "approved", label: "Approved", icon: <UserCheck size={14} /> },
    { v: "rejected", label: "Rejected", icon: <X size={14} /> },
  ];

  return (
    <div className="space-y-8" data-testid="admin-approvals">
      <div>
        <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Admin</p>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mt-1">Clinician approvals</h1>
        <p className="text-[#787672] mt-2">Approve new clinicians to give them full access to the platform.</p>
      </div>

      <div className="flex gap-1 bg-[#F3F0EB] rounded-full p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.v}
            onClick={() => setTab(t.v)}
            data-testid={`tab-${t.v}`}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${tab === t.v ? "bg-white shadow-sm" : "text-[#787672] hover:text-[#1A1A1A]"}`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="bg-white border border-[#E2DFD8] rounded-3xl p-12 text-center">
          <Clock size={42} className="mx-auto text-[#C96A52]" />
          <p className="font-display text-xl mt-4 font-semibold">Nothing here</p>
          <p className="text-[#787672] mt-2 text-sm">No clinicians in the {tab} list.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {items.map((c) => (
            <div key={c.user_id} className="bg-white border border-[#E2DFD8] rounded-2xl p-5" data-testid={`clinician-${c.user_id}`}>
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-full bg-[#E8E2D9] flex items-center justify-center font-display font-bold text-[#C96A52]">
                  {(c.name || c.email || "?")[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{c.name || "—"}</p>
                  <p className="text-sm text-[#787672] truncate">{c.email}</p>
                  <p className="text-xs text-[#787672] mt-1">Signed up {fmt(c.created_at)}</p>
                  {c.approved_at && <p className="text-xs text-[#5B7566] mt-1">Approved {fmt(c.approved_at)}</p>}
                  {c.rejected_at && <p className="text-xs text-destructive mt-1">Rejected {fmt(c.rejected_at)}</p>}
                </div>
              </div>
              {tab !== "approved" && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-[#E2DFD8]">
                  {tab !== "approved" && (
                    <Button size="sm" onClick={() => decide(c.user_id, "approve")} disabled={busy === c.user_id} className="rounded-full bg-[#5B7566] hover:bg-[#4a6354]" data-testid={`approve-${c.user_id}`}>
                      <Check size={14} /> Approve
                    </Button>
                  )}
                  {tab !== "rejected" && (
                    <Button size="sm" variant="outline" onClick={() => decide(c.user_id, "reject")} disabled={busy === c.user_id} className="rounded-full border-[#E2DFD8] text-destructive hover:bg-destructive/5" data-testid={`reject-${c.user_id}`}>
                      <X size={14} /> Reject
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

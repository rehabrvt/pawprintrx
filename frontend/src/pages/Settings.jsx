import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Heart, Stethoscope, Check, User, ArrowLeftRight, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Settings() {
  const { user, addRole, switchRole } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [clinicianAllowed, setClinicianAllowed] = useState(false);
  const roles = Array.isArray(user?.roles) && user.roles.length > 0 ? user.roles : (user?.role ? [user.role] : []);
  const hasClinician = roles.includes("clinician");
  const hasOwner = roles.includes("owner");
  const missing = !hasClinician ? "clinician" : !hasOwner ? "owner" : null;

  useEffect(() => {
    api.get("/auth/can-add-clinician").then(({ data }) => setClinicianAllowed(!!data.allowed)).catch(() => {});
  }, [user?.email]);

  async function onAddRole(role) {
    setBusy(true);
    try {
      const updated = await addRole(role);
      toast.success(role === "clinician"
        ? "Clinician role added. It needs admin approval before you can use it."
        : "Pet-parent role added — you can switch to it anytime."
      );
      nav(updated.role === "clinician" ? "/clinician" : "/owner");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not add role");
    } finally {
      setBusy(false);
    }
  }

  async function onSwitchRole(role) {
    if (role === user?.role) return;
    try {
      const updated = await switchRole(role);
      toast.success(`Switched to ${role === "clinician" ? "Clinician" : "Pet parent"} view`);
      nav(updated.role === "clinician" ? "/clinician" : "/owner");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not switch role");
    }
  }

  return (
    <div className="space-y-10 max-w-2xl" data-testid="settings-page">
      <div>
        <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Account</p>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight mt-1">Settings</h1>
      </div>

      <section className="bg-white border border-[#E2DFD8] rounded-3xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <User size={18} className="text-[#C96A52]" />
          <h2 className="font-display text-xl font-semibold">Profile</h2>
        </div>
        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          <dt className="text-[#787672]">Name</dt><dd className="col-span-2 font-semibold">{user?.name || "—"}</dd>
          <dt className="text-[#787672]">Email</dt><dd className="col-span-2 font-semibold">{user?.email}</dd>
          {user?.is_admin && (<>
            <dt className="text-[#787672]">Admin</dt><dd className="col-span-2 font-semibold text-[#5B7566]">Yes</dd>
          </>)}
        </dl>
      </section>

      <section className="bg-white border border-[#E2DFD8] rounded-3xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <ArrowLeftRight size={18} className="text-[#C96A52]" />
          <h2 className="font-display text-xl font-semibold">Roles on this account</h2>
        </div>
        <p className="text-sm text-[#787672] mb-4">
          One account can hold both roles. Switch anytime from the sidebar without signing out.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <RoleCard
            active={user?.role === "clinician"}
            enabled={hasClinician}
            title="Clinician"
            subtitle="Manage patients, build plans, track diaries"
            icon={<Stethoscope size={20} />}
            onSwitch={() => onSwitchRole("clinician")}
            approvalStatus={hasClinician ? user?.approval_status : null}
          />
          <RoleCard
            active={user?.role === "owner"}
            enabled={hasOwner}
            title="Pet parent"
            subtitle="Log your dog's daily sessions and share videos"
            icon={<Heart size={20} />}
            onSwitch={() => onSwitchRole("owner")}
          />
        </div>

        {missing && (
          missing === "clinician" && !clinicianAllowed ? (
            <div className="mt-6 border border-dashed border-[#787672]/30 rounded-2xl p-4 bg-[#F3F0EB]/40 flex items-center gap-4" data-testid="clinician-locked-panel">
              <Lock size={18} className="text-[#787672] flex-shrink-0" />
              <div>
                <p className="font-semibold text-sm">Clinician access is invite-only</p>
                <p className="text-xs text-[#787672] mt-0.5">
                  Ask an admin to add your email ({user?.email}) to the clinician invite list. Once added, you&apos;ll be able to add the Clinician role here.
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-6 border border-dashed border-[#C96A52]/40 rounded-2xl p-4 bg-[#C96A52]/5 flex items-center gap-4" data-testid="add-role-panel">
              <div>
                <p className="font-semibold">Add {missing === "clinician" ? "Clinician" : "Pet parent"} role</p>
                <p className="text-xs text-[#787672] mt-0.5">
                  {missing === "clinician"
                    ? "You'll be able to manage patients once an admin approves your clinician access."
                    : "Instantly available — no approval needed."}
                </p>
              </div>
              <Button
                onClick={() => onAddRole(missing)}
                disabled={busy}
                className="rounded-full bg-[#C96A52] hover:bg-[#B35A44] ml-auto"
                data-testid={`add-role-${missing}-btn`}
              >
                Add role
              </Button>
            </div>
          )
        )}
      </section>
    </div>
  );
}

function RoleCard({ active, enabled, title, subtitle, icon, onSwitch, approvalStatus }) {
  if (!enabled) {
    return (
      <div className="rounded-2xl border border-dashed border-[#E2DFD8] p-4 opacity-60">
        <div className="flex items-center gap-2">{icon}<span className="font-semibold">{title}</span></div>
        <p className="text-xs text-[#787672] mt-1">{subtitle}</p>
        <p className="text-xs text-[#787672] mt-3">Not enabled — add it below.</p>
      </div>
    );
  }
  const pending = approvalStatus === "pending";
  return (
    <button
      type="button"
      onClick={onSwitch}
      disabled={active}
      data-testid={`role-card-${title.toLowerCase().replace(/\s+/g, "-")}`}
      className={`text-left rounded-2xl p-4 border transition ${active ? "border-[#C96A52] bg-[#C96A52]/5" : "border-[#E2DFD8] hover:border-[#C96A52]/40"}`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-semibold">{title}</span>
        {active && <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-[#5B7566] font-bold"><Check size={10}/> Active</span>}
      </div>
      <p className="text-xs text-[#787672] mt-1">{subtitle}</p>
      {pending && (
        <p className="text-xs text-[#C96A52] mt-2 font-semibold">Pending admin approval</p>
      )}
    </button>
  );
}

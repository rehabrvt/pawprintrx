import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PawPrint, LayoutGrid, Dumbbell, LogOut, Heart, ShieldCheck, Users, Tags, ArrowLeftRight, Settings, UserPlus, Layers } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "sonner";

export default function AppShell({ children }) {
  const { user, logout, switchRole } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const roles = Array.isArray(user?.roles) && user.roles.length > 0 ? user.roles : (user?.role ? [user.role] : []);
  const hasMultipleRoles = roles.length > 1;

  const clinicianLinks = [
    { to: "/clinician", label: "Patients", icon: <LayoutGrid size={18} /> },
    { to: "/clinician/exercises", label: "Exercise Library", icon: <Dumbbell size={18} /> },
    { to: "/clinician/templates", label: "Templates", icon: <Layers size={18} /> },
  ];
  if (user?.is_admin) {
    clinicianLinks.push({ to: "/admin/approvals", label: "Approvals", icon: <ShieldCheck size={18} /> });
    clinicianLinks.push({ to: "/admin/clinician-invites", label: "Clinician invites", icon: <UserPlus size={18} /> });
    clinicianLinks.push({ to: "/admin/categories", label: "Categories", icon: <Tags size={18} /> });
  }
  const ownerLinks = [
    { to: "/owner", label: "My Dog", icon: <Heart size={18} /> },
    { to: "/owner/family", label: "Family", icon: <Users size={18} /> },
  ];
  const links = user?.role === "clinician" ? clinicianLinks : ownerLinks;
  // Every logged-in user gets the Settings link so they can add their second role.
  const settingsLink = { to: "/settings", label: "Settings", icon: <Settings size={18} /> };

  async function onLogout() {
    await logout();
    nav("/login");
  }

  async function onSwitchRole(nextRole) {
    if (nextRole === user?.role) return;
    try {
      const updated = await switchRole(nextRole);
      toast.success(`Switched to ${nextRole === "clinician" ? "Clinician" : "Pet parent"} view`);
      nav(updated.role === "clinician" ? "/clinician" : "/owner");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not switch role");
    }
  }

  return (
    <div className="min-h-screen flex bg-bone">
      <aside className="hidden md:flex w-64 flex-col border-r border-[#E2DFD8] bg-white p-6 sticky top-0 h-screen">
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg" data-testid="sidebar-brand">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#C96A52] text-white"><PawPrint size={18} /></span>
          PawPrint Rx
        </Link>
        <nav className="mt-10 space-y-1 flex-1">
          {links.map((l) => {
            const active = loc.pathname === l.to;
            return (
              <Link
                key={l.to}
                to={l.to}
                data-testid={`nav-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${active ? "bg-[#C96A52] text-white" : "text-[#3a3a36] hover:bg-[#F3F0EB]"}`}
              >
                {l.icon}
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-[#E2DFD8] pt-4 space-y-2">
          {hasMultipleRoles && (
            <div className="rounded-xl bg-[#F3F0EB] p-2 flex items-center gap-1" data-testid="role-switcher">
              {roles.map((r) => {
                const active = r === user?.role;
                return (
                  <button
                    key={r}
                    onClick={() => onSwitchRole(r)}
                    data-testid={`role-switch-${r}`}
                    className={`flex-1 rounded-lg text-xs font-semibold py-1.5 transition ${active ? "bg-white text-[#1a1a1a] shadow-sm" : "text-[#787672] hover:text-[#1a1a1a]"}`}
                  >
                    {r === "clinician" ? "🩺 Clinician" : "🐾 Pet parent"}
                  </button>
                );
              })}
            </div>
          )}
          <Link
            to="/settings"
            data-testid="nav-settings"
            className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition ${loc.pathname === "/settings" ? "bg-[#F3F0EB] text-[#1a1a1a]" : "text-[#787672] hover:bg-[#F3F0EB]"}`}
          >
            {settingsLink.icon}
            {settingsLink.label}
          </Link>
          <div className="flex items-center gap-3" data-testid="sidebar-user">
            <div className="h-9 w-9 rounded-full bg-[#E8E2D9] flex items-center justify-center font-display font-semibold text-[#C96A52]">
              {(user?.name || user?.email || "?")[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{user?.name || user?.email}</p>
              <p className="text-xs text-[#787672] capitalize">{user?.role}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-[#787672]" onClick={onLogout} data-testid="logout-btn">
            <LogOut size={16} /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <header className="md:hidden flex items-center justify-between p-4 border-b border-[#E2DFD8] bg-white">
          <Link to="/" className="flex items-center gap-2 font-display font-bold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#C96A52] text-white"><PawPrint size={16} /></span>
            PawPrint Rx
          </Link>
          <Button variant="ghost" size="sm" onClick={onLogout}><LogOut size={16} /></Button>
        </header>
        <div className="p-6 md:p-12 max-w-7xl">{children}</div>
      </main>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { Stethoscope, Heart } from "lucide-react";

export default function RoleSelect() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();

  async function pick(role) {
    try {
      const fd = new FormData();
      fd.append("role", role);
      await api.patch("/auth/role", fd);
      const u = await refresh();
      toast.success("Role set");
      nav(u.role === "clinician" ? "/clinician" : "/owner");
    } catch {
      toast.error("Could not save role");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bone p-6">
      <div className="w-full max-w-2xl">
        <p className="text-xs tracking-[0.2em] uppercase text-[#787672] font-bold">Welcome {user?.name?.split(" ")[0]}</p>
        <h1 className="font-display text-4xl mt-2 font-bold">How will you use PawPrint Rx?</h1>
        <p className="text-[#787672] mt-2">You can change this anytime.</p>
        <div className="grid sm:grid-cols-2 gap-4 mt-8">
          <button onClick={() => pick("clinician")} data-testid="select-clinician" className="text-left bg-white border border-[#E2DFD8] rounded-3xl p-6 hover:border-[#C96A52] transition">
            <Stethoscope className="text-[#C96A52]" />
            <h3 className="font-display text-2xl font-semibold mt-4">I'm a clinician</h3>
            <p className="text-[#787672] mt-2 text-sm">Manage patients, custom exercise library, and assign rehab plans.</p>
          </button>
          <button onClick={() => pick("owner")} data-testid="select-owner" className="text-left bg-white border border-[#E2DFD8] rounded-3xl p-6 hover:border-[#C96A52] transition">
            <Heart className="text-[#C96A52]" />
            <h3 className="font-display text-2xl font-semibold mt-4">I'm a pet parent</h3>
            <p className="text-[#787672] mt-2 text-sm">Track my dog's daily exercises, log pain scores and photos.</p>
          </button>
        </div>
        <Button variant="ghost" className="mt-6" onClick={() => pick("owner")}>Skip for now</Button>
      </div>
    </div>
  );
}

import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Clock, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function PendingApproval() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="min-h-screen grid place-items-center bg-bone p-6" data-testid="pending-screen">
      <div className="max-w-md w-full bg-white border border-[#E2DFD8] rounded-3xl p-8 text-center">
        <span className="inline-flex h-14 w-14 rounded-full bg-[#E8E2D9] text-[#C96A52] items-center justify-center mx-auto">
          <Clock size={26} />
        </span>
        <h1 className="font-display text-3xl font-bold mt-5">Awaiting approval</h1>
        <p className="text-[#787672] mt-3 leading-relaxed">
          Hi {user?.name?.split(" ")[0] || "there"} — your clinician account is in the admin's queue.
          You'll get an email once it's approved.
        </p>
        <p className="text-xs text-[#787672] mt-3">Signed in as {user?.email}</p>
        <Button onClick={async () => { await logout(); nav("/login"); }} variant="outline" className="rounded-full mt-6 border-[#E2DFD8]" data-testid="pending-logout">
          <LogOut size={14} /> Sign out
        </Button>
      </div>
    </div>
  );
}

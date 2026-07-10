import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { formatError } from "../lib/api";
import { PawPrint } from "lucide-react";
import { renderGoogleButton, isGoogleSignInConfigured } from "../lib/googleAuth";

export default function Signup() {
  const { register, loginWithGoogle } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const invitedEmail = params.get("email") || "";
  const invitedBy = params.get("invited_by") || "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(params.get("role") === "clinician" ? "clinician" : "owner");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await register({ email, password, name, role });
      toast.success("Account created");
      nav(u.role === "clinician" ? "/clinician" : "/owner");
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail) || "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    renderGoogleButton("google-signin-signup", async (credential) => {
      try {
        const u = await loginWithGoogle(credential);
        toast.success("Account created");
        nav(u.role === "clinician" ? "/clinician" : "/owner");
      } catch (err) {
        toast.error(formatError(err.response?.data?.detail) || "Google sign-in failed");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bone p-6">
      <div className="w-full max-w-md space-y-7">
        <Link to="/" className="inline-flex items-center gap-2 font-display font-bold text-xl">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#C96A52] text-white"><PawPrint size={18} /></span>
          PawPrint Rx
        </Link>
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Create your account</h1>
          <p className="text-[#787672] mt-2">Choose how you'll use PawPrint Rx.</p>
        </div>

        {invitedBy && invitedEmail && (
          <div className="bg-[#C96A52]/5 border border-[#C96A52]/30 rounded-2xl p-4" data-testid="invite-banner">
            <p className="text-sm">
              <span className="font-display font-bold text-[#C96A52]">{invitedBy}</span> invited you to PawPrint Rx.
              Finish creating your account with <b>{invitedEmail}</b> and you'll instantly see their pets.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {["clinician", "owner"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              data-testid={`role-${r}`}
              className={`rounded-2xl border p-4 text-left transition ${role === r ? "border-[#C96A52] bg-[#C96A52]/5" : "border-[#E2DFD8] bg-white hover:border-[#C96A52]/40"}`}
            >
              <p className="font-display text-lg font-semibold capitalize">{r === "clinician" ? "Clinician" : "Pet parent"}</p>
              <p className="text-xs text-[#787672] mt-1">{r === "clinician" ? "Build plans, manage patients" : "Track my dog's recovery"}</p>
            </button>
          ))}
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} data-testid="signup-name" className="mt-1.5 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11" />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="signup-email" className="mt-1.5 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11" />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="signup-password" className="mt-1.5 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11" />
          </div>
          <Button type="submit" disabled={busy} data-testid="signup-submit" className="w-full h-11 rounded-full bg-[#C96A52] hover:bg-[#B35A44]">
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
        <div className="relative">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#E2DFD8]" /></div>
          <div className="relative flex justify-center text-xs uppercase tracking-[0.2em] text-[#787672]"><span className="bg-bone px-3">or</span></div>
        </div>
        {isGoogleSignInConfigured() && (
          <div id="google-signin-signup" data-testid="signup-google" className="flex justify-center" />
        )}
        <p className="text-sm text-[#787672] text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-[#C96A52] font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

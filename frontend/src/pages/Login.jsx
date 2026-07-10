import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { formatError } from "../lib/api";
import { PawPrint } from "lucide-react";
import { renderGoogleButton, isGoogleSignInConfigured } from "../lib/googleAuth";

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(email, password);
      toast.success(`Welcome back, ${u.name?.split(" ")[0] || "friend"}`);
      nav(u.role === "clinician" ? "/clinician" : "/owner");
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail) || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    renderGoogleButton("google-signin-login", async (credential) => {
      try {
        const u = await loginWithGoogle(credential);
        toast.success(`Welcome back, ${u.name?.split(" ")[0] || "friend"}`);
        nav(u.role === "clinician" ? "/clinician" : "/owner");
      } catch (err) {
        toast.error(formatError(err.response?.data?.detail) || "Google sign-in failed");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block relative">
        <img src="/login-hero.jpg"
             alt="Dog running through a sunlit field" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-black/25" />
        <div className="absolute bottom-10 left-10 right-10 text-white">
          <p className="text-xs tracking-[0.3em] uppercase">PawPrint Rx</p>
          <h2 className="font-display text-4xl mt-2 max-w-md">Better recovery, one walk at a time.</h2>
        </div>
      </div>
      <div className="flex items-center justify-center p-8 bg-bone">
        <div className="w-full max-w-md space-y-7">
          <Link to="/" className="inline-flex items-center gap-2 font-display font-bold text-xl">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#C96A52] text-white"><PawPrint size={18} /></span>
            PawPrint Rx
          </Link>
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Welcome back</h1>
            <p className="text-[#787672] mt-2">Sign in to continue your rehab work.</p>
          </div>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" className="mt-1.5 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" className="mt-1.5 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11" />
            </div>
            <Button type="submit" disabled={busy} data-testid="login-submit" className="w-full h-11 rounded-full bg-[#C96A52] hover:bg-[#B35A44]">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#E2DFD8]" /></div>
            <div className="relative flex justify-center text-xs uppercase tracking-[0.2em] text-[#787672]"><span className="bg-bone px-3">or</span></div>
          </div>
          {isGoogleSignInConfigured() && (
            <div id="google-signin-login" data-testid="login-google" className="flex justify-center" />
          )}
          <p className="text-sm text-[#787672] text-center">
            New here?{" "}
            <Link to="/signup" className="text-[#C96A52] font-semibold" data-testid="link-signup">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

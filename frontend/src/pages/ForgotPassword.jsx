import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { formatError } from "../lib/api";
import { PawPrint } from "lucide-react";

export default function ForgotPassword() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail) || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bone p-8">
      <div className="w-full max-w-md space-y-7">
        <Link to="/" className="inline-flex items-center gap-2 font-display font-bold text-xl">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#C96A52] text-white"><PawPrint size={18} /></span>
          PawPrint Rx
        </Link>

        {sent ? (
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Check your email</h1>
            <p className="text-[#787672] mt-2">
              If an account exists for <b>{email}</b>, we've sent a link to reset your password.
              The link expires in 30 minutes.
            </p>
            <Link to="/login" className="text-[#C96A52] font-semibold mt-6 inline-block">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight">Forgot your password?</h1>
              <p className="text-[#787672] mt-2">Enter your email and we'll send you a reset link.</p>
            </div>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11"
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full h-11 rounded-full bg-[#C96A52] hover:bg-[#B35A44]">
                {busy ? "Sending…" : "Send reset link"}
              </Button>
            </form>
            <p className="text-sm text-[#787672] text-center">
              Remembered it?{" "}
              <Link to="/login" className="text-[#C96A52] font-semibold">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

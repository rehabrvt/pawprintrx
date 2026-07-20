import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { formatError } from "../lib/api";
import { PawPrint } from "lucide-react";

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      toast.success("Password updated. Please sign in.");
      nav("/login");
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail) || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen grid place-items-center bg-bone p-8">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight">Invalid link</h1>
          <p className="text-[#787672]">This reset link is missing its token. Please request a new one.</p>
          <Link to="/forgot-password" className="text-[#C96A52] font-semibold">Request a new link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bone p-8">
      <div className="w-full max-w-md space-y-7">
        <Link to="/" className="inline-flex items-center gap-2 font-display font-bold text-xl">

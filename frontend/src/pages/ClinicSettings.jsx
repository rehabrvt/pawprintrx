import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api, formatError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";

const PRESET_COLORS = ["#C96A52", "#3F7CAC", "#5B7566", "#7C6EAE", "#B9577A", "#D8A14A"];

export default function ClinicSettings() {
  const { user } = useAuth();
  const [clinic, setClinic] = useState(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#C96A52");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/clinic/me");
        setClinic(data);
        setName(data.name || "");
        setColor(data.brand_color || "#C96A52");
      } catch (err) {
        toast.error(formatError(err.response?.data?.detail) || "Could not load clinic");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.put("/clinic/me", { name, brand_color: color });
      setClinic(data);
      toast.success("Clinic settings saved");
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail) || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!user?.is_admin) {
    return (
      <div className="p-8">
        <p className="text-[#787672]">You don't have access to this page.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-[#787672]">Loading…</div>;
  }

  return (
    <div className="p-8 max-w-xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Clinic settings</h1>
        <p className="text-[#787672] mt-2">Manage your clinic's name and accent color.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6 border border-[#E2DFD8] rounded-2xl p-6 bg-white">
        <div>
          <Label htmlFor="clinic_name">Clinic name</Label>
          <Input
            id="clinic_name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1.5 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11"
          />
        </div>

        <div>
          <Label>Accent color</Label>
          <div className="flex items-center gap-3 mt-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-9 w-9 rounded-full border-2 transition"
                style={{
                  backgroundColor: c,
                  borderColor: color === c ? "#1a1a1a" : "transparent",
                }}
                aria-label={c}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-9 rounded-full border border-[#E2DFD8] cursor-pointer bg-transparent"
            />
          </div>
        </div>

        <div className="rounded-xl p-4 flex items-center justify-between" style={{ backgroundColor: "#F3F0EB" }}>
          <span className="text-sm text-[#787672]">Preview</span>
          <span
            className="px-4 py-2 rounded-full text-white text-sm font-semibold"
            style={{ backgroundColor: color }}
          >
            {name || "Your Clinic"}
          </span>
        </div>

        <Button type="submit" disabled={busy} className="w-full h-11 rounded-full" style={{ backgroundColor: color }}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </form>

      {clinic && (
        <p className="text-xs text-[#787672] text-center">Clinic ID: {clinic.clinic_id}</p>
      )}
    </div>
  );
}

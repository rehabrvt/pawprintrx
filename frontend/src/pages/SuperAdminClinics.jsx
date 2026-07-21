import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { api, formatError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";

export default function SuperAdminClinics() {
  const { user } = useAuth();
  const [clinics, setClinics] = useState([]);
  const [clinicName, setClinicName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadClinics = async () => {
    try {
      const { data } = await api.get("/superadmin/clinics");
      setClinics(data);
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail) || "Could not load clinics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClinics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/superadmin/clinics", {
        clinic_name: clinicName,
        admin_email: adminEmail,
      });
      toast.success(`Clinic "${clinicName}" created — invite sent to ${adminEmail}`);
      setClinicName("");
      setAdminEmail("");
      loadClinics();
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail) || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!user?.is_super_admin) {
    return (
      <div className="p-8">
        <p className="text-[#787672]">You don't have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Clinics</h1>
        <p className="text-[#787672] mt-2">Create a new clinic and invite its first admin.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 border border-[#E2DFD8] rounded-2xl p-6 bg-white">
        <div>
          <Label htmlFor="clinic_name">Clinic name</Label>
          <Input
            id="clinic_name"
            required
            value={clinicName}
            onChange={(e) => setClinicName(e.target.value)}
            placeholder="e.g. Maple Street Animal Rehab"
            className="mt-1.5 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11"
          />
        </div>
        <div>
          <Label htmlFor="admin_email">Clinic admin's email</Label>
          <Input
            id="admin_email"
            type="email"
            required
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="admin@clinic.com"
            className="mt-1.5 bg-[#F3F0EB] border-transparent focus-visible:border-[#C96A52] focus-visible:ring-1 focus-visible:ring-[#C96A52] h-11"
          />
        </div>
        <Button type="submit" disabled={busy} className="w-full h-11 rounded-full bg-[#C96A52] hover:bg-[#B35A44]">
          {busy ? "Creating…" : "Create clinic & send invite"}
        </Button>
      </form>

      <div>
        <h2 className="font-display text-xl font-bold mb-3">Existing clinics</h2>
        {loading ? (
          <p className="text-[#787672]">Loading…</p>
        ) : clinics.length === 0 ? (
          <p className="text-[#787672]">No clinics yet.</p>
        ) : (
          <div className="space-y-2">
            {clinics.map((c) => (
              <div key={c.clinic_id} className="border border-[#E2DFD8] rounded-xl p-4 bg-white flex justify-between items-center">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-[#787672]">{c.clinic_id}</p>
                </div>
                {c.is_default && (
                  <span className="text-xs bg-[#F3F0EB] text-[#787672] px-2 py-1 rounded-full">Default</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

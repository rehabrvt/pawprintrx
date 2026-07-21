import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { Toaster } from "sonner";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Signup from "./pages/Signup";
import ClinicianDashboard from "./pages/ClinicianDashboard";
import ExerciseLibrary from "./pages/ExerciseLibrary";
import PatientDetail from "./pages/PatientDetail";
import OwnerPortal from "./pages/OwnerPortal";
import FamilySettings from "./pages/FamilySettings";
import RoleSelect from "./pages/RoleSelect";
import AdminApprovals from "./pages/AdminApprovals";
import AdminCategories from "./pages/AdminCategories";
import Templates from "./pages/Templates";
import AdminClinicianInvites from "./pages/AdminClinicianInvites";
import SuperAdminClinics from "./pages/SuperAdminClinics";
import ClinicSettings from "./pages/ClinicSettings";
import Settings from "./pages/Settings";
import PendingApproval from "./pages/PendingApproval";
import AppShell from "./components/AppShell";

function Protected({ children, requireApproved = true }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (requireApproved && user.role === "clinician" && !user.is_admin && user.approval_status === "pending") {
    return <PendingApproval />;
  }
  if (requireApproved && user.role === "clinician" && !user.is_admin && user.approval_status === "rejected") {
    return <PendingApproval />;
  }
  return children;
}

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  if (!user) return <Landing />;
  if (!user.role) return <Navigate to="/role" replace />;
  return <Navigate to={user.role === "clinician" ? "/clinician" : "/owner"} replace />;
}

function RouterShell() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/role" element={<Protected><RoleSelect /></Protected>} />
      <Route path="/clinician" element={<Protected><AppShell><ClinicianDashboard /></AppShell></Protected>} />
      <Route path="/clinician/exercises" element={<Protected><AppShell><ExerciseLibrary /></AppShell></Protected>} />
      <Route path="/clinician/templates" element={<Protected><AppShell><Templates /></AppShell></Protected>} />
      <Route path="/clinician/patients/:id" element={<Protected><AppShell><PatientDetail /></AppShell></Protected>} />
      <Route path="/admin/approvals" element={<Protected><AppShell><AdminApprovals /></AppShell></Protected>} />
      <Route path="/admin/categories" element={<Protected><AppShell><AdminCategories /></AppShell></Protected>} />
      <Route path="/admin/clinician-invites" element={<Protected><AppShell><AdminClinicianInvites /></AppShell></Protected>} />
      <Route path="/superadmin/clinics" element={<Protected><AppShell><SuperAdminClinics /></AppShell></Protected>} />
      <Route path="/clinic-settings" element={<Protected><AppShell><ClinicSettings /></AppShell></Protected>} />
      <Route path="/settings" element={<Protected><AppShell><Settings /></AppShell></Protected>} />
      <Route path="/owner" element={<Protected><AppShell><OwnerPortal /></AppShell></Protected>} />
      <Route path="/owner/family" element={<Protected><AppShell><FamilySettings /></AppShell></Protected>} />
      <Route path="/dashboard" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <RouterShell />
        <Toaster richColors position="top-right" />
      </BrowserRouter>
    </AuthProvider>
  );
}

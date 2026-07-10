import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      return data;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    setUser(data);
    return data;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    setUser(data);
    return data;
  };

  // credential is the Google Identity Services ID token (JWT) from the
  // Google Sign-In button's callback response, i.e. response.credential
  const loginWithGoogle = async (credential) => {
    const { data } = await api.post("/auth/google", { credential });
    setUser(data);
    return data;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(null);
  };

  const switchRole = async (role) => {
    const { data } = await api.post("/auth/switch-role", { role });
    setUser(data);
    return data;
  };

  const addRole = async (role) => {
    const { data } = await api.post("/auth/add-role", { role });
    setUser(data);
    return data;
  };

  return (
    <AuthCtx.Provider value={{ user, setUser, loading, login, register, loginWithGoogle, logout, refresh, switchRole, addRole }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}

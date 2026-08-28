import axios from "axios";

const BASE = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
export const API = `${BASE}/api`;

// Auth tokens are stored in localStorage as a fallback for browsers (notably
// iPhone/Mac Safari) that block or purge cross-domain cookies via Intelligent
// Tracking Prevention. Cookies still work where allowed; this just ensures
// login survives when they don't.
const TOKEN_KEY = "pawprintrx_access_token";

export function saveTokens(data) {
  if (data && data.access_token) {
    localStorage.setItem(TOKEN_KEY, data.access_token);
  }
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

// Attach the saved token to every request as a backup to the cookie. If the
// cookie works, the backend just ignores this header's duplicate identity.
// If the cookie was blocked (Safari), this header is what saves the session.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function formatError(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await api.post("/upload", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data; // { file_id, url, content_type }
}

export function fileSrc(urlOrId) {
  if (!urlOrId) return "";
  if (urlOrId.startsWith("http")) return urlOrId;
  if (urlOrId.startsWith("/api/")) return

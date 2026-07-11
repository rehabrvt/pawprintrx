import axios from "axios";

const BASE = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
export const API = `${BASE}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
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
  if (urlOrId.startsWith("/api/")) return `${BASE}${urlOrId}`;
  return `${API}/files/${urlOrId}`;
}

"""SharePoint / OneDrive upload via Microsoft Graph (app-only, client_credentials).

Gracefully no-ops if credentials are not configured — caller should treat
`upload_video()` returning `None` as 'sharepoint not configured, skip'.
"""
import os
import time
import logging
from typing import Optional, Dict, Any
from urllib.parse import quote
import requests

log = logging.getLogger(__name__)

_token_cache: Dict[str, Any] = {"token": None, "expires_at": 0}
_site_cache: Dict[str, str] = {}


def is_configured() -> bool:
    return all(os.environ.get(k) for k in ("MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "SP_HOSTNAME", "SP_SITE_PATH"))


def _get_token() -> str:
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] - 60 > now:
        return _token_cache["token"]
    tid = os.environ["MS_TENANT_ID"]
    r = requests.post(
        f"https://login.microsoftonline.com/{tid}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": os.environ["MS_CLIENT_ID"],
            "client_secret": os.environ["MS_CLIENT_SECRET"],
            "scope": "https://graph.microsoft.com/.default",
        },
        timeout=20,
    )
    r.raise_for_status()
    j = r.json()
    _token_cache["token"] = j["access_token"]
    _token_cache["expires_at"] = now + int(j.get("expires_in", 3600))
    return _token_cache["token"]


def _site_id() -> str:
    if _site_cache.get("id"):
        return _site_cache["id"]
    host = os.environ["SP_HOSTNAME"]
    path = os.environ["SP_SITE_PATH"]
    if not path.startswith("/"):
        path = "/" + path
    r = requests.get(
        f"https://graph.microsoft.com/v1.0/sites/{host}:{path}",
        headers={"Authorization": f"Bearer {_get_token()}"},
        timeout=20,
    )
    r.raise_for_status()
    sid = r.json()["id"]
    _site_cache["id"] = sid
    return sid


def upload_video(folder_subpath: str, filename: str, data: bytes, content_type: str = "video/mp4") -> Optional[Dict[str, Any]]:
    """Upload bytes to SharePoint. Returns {web_url, drive_path} or None if not configured.

    folder_subpath: e.g. "Buddy/2026-02-04" — appended to SP_BASE_FOLDER
    filename: e.g. "20260204-walking.mp4"
    """
    if not is_configured():
        return None
    base = os.environ.get("SP_BASE_FOLDER", "PawPrint Rx/Owner Videos").strip("/")
    full_path = f"{base}/{folder_subpath.strip('/')}/{filename}".replace("//", "/")
    encoded = quote(full_path)
    site_id = _site_id()
    headers = {"Authorization": f"Bearer {_get_token()}"}

    # < 4MB: simple PUT. >= 4MB: upload session.
    size = len(data)
    if size < 4 * 1024 * 1024:
        r = requests.put(
            f"https://graph.microsoft.com/v1.0/sites/{site_id}/drive/root:/{encoded}:/content",
            headers={**headers, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
        r.raise_for_status()
        item = r.json()
    else:
        sess = requests.post(
            f"https://graph.microsoft.com/v1.0/sites/{site_id}/drive/root:/{encoded}:/createUploadSession",
            headers={**headers, "Content-Type": "application/json"},
            json={"item": {"@microsoft.graph.conflictBehavior": "rename"}},
            timeout=30,
        )
        sess.raise_for_status()
        upload_url = sess.json()["uploadUrl"]
        chunk_size = 5 * 1024 * 1024  # 5 MiB
        item = None
        for i in range(0, size, chunk_size):
            chunk = data[i : i + chunk_size]
            end = i + len(chunk) - 1
            r = requests.put(
                upload_url,
                headers={"Content-Length": str(len(chunk)), "Content-Range": f"bytes {i}-{end}/{size}"},
                data=chunk,
                timeout=300,
            )
            if r.status_code in (200, 201):
                item = r.json()
                break
            r.raise_for_status()
    return {
        "web_url": item.get("webUrl"),
        "drive_path": full_path,
        "size": item.get("size", size),
        "id": item.get("id"),
    }

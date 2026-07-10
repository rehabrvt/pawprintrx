"""ezyVet API client (OAuth2 client_credentials)."""
import os
import time
from typing import Optional, List, Dict, Any
import requests

_token_cache: Dict[str, Any] = {"token": None, "expires_at": 0}


def _base() -> str:
    return os.environ.get("EZYVET_API_BASE", "https://api.us.ezyvet.com/v1").rstrip("/")


def _creds():
    cid = os.environ.get("EZYVET_CLIENT_ID")
    sec = os.environ.get("EZYVET_CLIENT_SECRET")
    if not cid or not sec:
        raise RuntimeError("ezyVet credentials missing")
    return cid, sec, os.environ.get("EZYVET_PARTNER_ID") or ""


def get_token() -> str:
    now = time.time()
    if _token_cache["token"] and _token_cache["expires_at"] - 60 > now:
        return _token_cache["token"]
    cid, sec, partner = _creds()
    body = {"grant_type": "client_credentials", "client_id": cid, "client_secret": sec, "scope": "read,write"}
    if partner:
        body["partner_id"] = partner
    r = requests.post(f"{_base()}/oauth/access_token", data=body, timeout=20)
    r.raise_for_status()
    j = r.json()
    tok = j.get("access_token")
    if not tok:
        raise RuntimeError(f"No access_token in ezyVet response: {j}")
    _token_cache["token"] = tok
    _token_cache["expires_at"] = now + int(j.get("expires_in", 3600))
    return tok


def _get(path: str, params: Optional[dict] = None) -> Any:
    r = requests.get(
        f"{_base()}{path}",
        params=params or {},
        headers={"Authorization": f"Bearer {get_token()}", "Accept": "application/json"},
        timeout=25,
    )
    r.raise_for_status()
    return r.json()


def _flatten(records: Any, kind: str) -> List[dict]:
    """ezyVet wraps responses as [{kind: {...}}, ...]."""
    out: List[dict] = []
    if isinstance(records, dict):
        if "items" in records:
            records = records["items"]
        elif kind in records:
            return [records[kind]]
    if isinstance(records, list):
        for r in records:
            if isinstance(r, dict) and kind in r and isinstance(r[kind], dict):
                out.append(r[kind])
            elif isinstance(r, dict):
                out.append(r)
    return out


def search_animals(query: str, limit: int = 20) -> List[dict]:
    if not query:
        return []
    data = _get("/animal", {"name": query, "limit": limit})
    items = _flatten(data, "animal")
    results: List[dict] = []
    for a in items[:limit]:
        contact_id = a.get("contact_id")
        owner = {}
        if contact_id:
            try:
                cd = _get(f"/contact/{contact_id}")
                owner_items = _flatten(cd, "contact")
                if owner_items:
                    owner = owner_items[0]
            except Exception:
                owner = {}
        results.append({
            "ezyvet_animal_id": str(a.get("id", "")),
            "name": a.get("name", ""),
            "breed": a.get("breed_name") or a.get("breed") or "",
            "species": a.get("species_name") or a.get("species") or "",
            "sex": a.get("sex_name") or a.get("sex") or "",
            "date_of_birth": a.get("date_of_birth", ""),
            "weight": a.get("weight", ""),
            "color": a.get("color_name") or a.get("colour_name") or "",
            "owner": {
                "ezyvet_contact_id": str(owner.get("id", "")) if owner else "",
                "first_name": owner.get("first_name", "") if owner else "",
                "last_name": owner.get("last_name", "") if owner else "",
                "email": (owner.get("email") or owner.get("email_address") or "").lower() if owner else "",
                "phone": owner.get("phone") or owner.get("business_phone") or "" if owner else "",
            },
        })
    return results

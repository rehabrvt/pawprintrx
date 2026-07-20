from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal, Dict

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form, Header, Query
from fastapi.responses import Response as FastResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, field_validator

from ezyvet import search_animals as ezy_search_animals
from pdf_plan import build_plan_pdf
import sharepoint as sp
from storage import init_storage, put_object, get_object

# ---------- Config ----------
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"
APP_NAME = os.environ.get('APP_NAME', 'canine-rehab')
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Canine Rehab Studio")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------- Auth helpers ----------
def hash_pw(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_pw(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False

def make_token(user_id: str, kind: str = "access") -> str:
    delta = timedelta(days=7) if kind == "refresh" else timedelta(hours=12)
    payload = {"sub": user_id, "type": kind, "exp": datetime.now(timezone.utc) + delta}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=12*3600, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=7*86400, path="/")

def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    response.delete_cookie("session_token", path="/")  # clears any leftover cookie from the old Emergent auth flow

async def get_current_user(request: Request) -> dict:
    # 1) JWT via cookie or bearer
    token = request.cookies.get("access_token")
    if not token:
        h = request.headers.get("Authorization", "")
        if h.startswith("Bearer "):
            token = h[7:]
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
            if payload.get("type") == "access":
                user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return user
        except Exception:
            pass
    raise HTTPException(status_code=401, detail="Not authenticated")

async def require_clinician(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "clinician":
        raise HTTPException(status_code=403, detail="Clinician access required")
    if user.get("approval_status") not in ("approved", None) and not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Account pending admin approval")
    return user

async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _owner_filter(email: str) -> dict:
    """Mongo filter: patients where this email is owner OR co-parent."""
    return {"$or": [{"owner_email": email}, {"coparent_emails": email}]}


def _owner_can_access(user_email: str, patient: dict) -> bool:
    if not patient:
        return False
    return patient.get("owner_email") == user_email or user_email in (patient.get("coparent_emails") or [])

# ---------- Models ----------
class SwitchRoleIn(BaseModel):
    role: str

class ClinicianInviteIn(BaseModel):
    email: EmailStr

class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: Literal["clinician", "owner"] = "owner"

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class GoogleAuthIn(BaseModel):
    credential: str  # Google Identity Services ID token (JWT)

class PatientIn(BaseModel):
    name: str
    last_name: Optional[str] = ""
    breed: Optional[str] = ""
    age_years: Optional[float] = None
    weight_kg: Optional[float] = None
    condition: Optional[str] = ""
    notes: Optional[str] = ""
    owner_email: Optional[str] = ""
    coparent_emails: Optional[List[str]] = []

class ExerciseIn(BaseModel):
    name: str
    # Modern multi-category field; legacy single `category` kept for backward-compat.
    categories: List[str] = Field(default_factory=list)
    category: Optional[str] = ""
    description: str = ""
    instructions: str = ""
    # Sets/reps accept free-text RANGES like "3-5" or "5-10".
    default_sets: Optional[str] = "3"
    default_reps: Optional[str] = "10"
    # Hold duration accepts free-text ranges (e.g. "15-30 sec", "1-2 min").
    default_duration: Optional[str] = ""
    # Deprecated numeric field kept for backward compatibility.
    default_duration_seconds: Optional[int] = 0
    default_frequency: Optional[str] = "Daily"
    media_url: Optional[str] = ""
    media_type: Optional[str] = ""
    video_url: Optional[str] = ""
    # Related exercise IDs.
    variations: List[str] = Field(default_factory=list)
    progressions: List[str] = Field(default_factory=list)

    @field_validator("default_sets", "default_reps", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        if v is None:
            return ""
        return str(v).strip()

class PlanItem(BaseModel):
    exercise_id: str
    # Sets/reps may be ranges like "3-5".
    sets: Optional[str] = "3"
    reps: Optional[str] = "10"
    duration: Optional[str] = ""  # free-text hold duration
    duration_seconds: Optional[int] = 0  # deprecated
    frequency: str = "Daily"
    notes: str = ""

    @field_validator("sets", "reps", mode="before")
    @classmethod
    def _coerce_str(cls, v):
        if v is None:
            return ""
        return str(v).strip()

class CategoryIn(BaseModel):
    name: str
    color: Optional[str] = ""

class CategoryRenameIn(BaseModel):
    name: str
    color: Optional[str] = None  # if provided, update color too

class PlanIn(BaseModel):
    patient_id: str
    title: str = "Rehab Plan"
    items: List[PlanItem] = []
    notes: str = ""

class TemplateIn(BaseModel):
    name: str
    description: Optional[str] = ""
    items: List[PlanItem] = Field(default_factory=list)
    is_public: bool = False

class TemplateShareIn(BaseModel):
    email: EmailStr

class DiaryIn(BaseModel):
    plan_id: str
    exercise_id: str
    completed: bool = True
    actual_reps: Optional[int] = None
    pain_score: int = Field(ge=0, le=10)
    notes: str = ""
    photo_url: Optional[str] = ""

# ---------- Auth endpoints ----------
def _admin_email_set() -> set[str]:
    """Lowercased emails granted admin privileges. Sources: ADMIN_EMAIL (single) +
    ADMIN_EMAILS (comma-separated). Always includes the primary admin email."""
    out: set[str] = set()
    primary = os.environ.get("ADMIN_EMAIL")
    if primary:
        out.add(primary.lower().strip())
    extra = os.environ.get("ADMIN_EMAILS", "")
    for e in extra.split(","):
        e = e.strip().lower()
        if e:
            out.add(e)
    return out

def _notify_admin_new_clinician(user_doc: dict):
    api_key = os.environ.get("RESEND_API_KEY")
    admin_to = os.environ.get("ADMIN_EMAIL") or os.environ.get("REHAB_NOTIFY_EMAIL")
    if not api_key or not admin_to:
        return False
    body_html = (
        f"<div style='font-family:Manrope,Arial,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px;margin:0 auto'>"
        f"<h2 style='font-size:20px;color:#C96A52;margin:0 0 8px'>New clinician awaiting approval</h2>"
        f"<p><b>{user_doc.get('name','')}</b> just signed up as a clinician.</p>"
        f"<table style='border-collapse:collapse;font-size:14px'>"
        f"<tr><td style='padding:4px 12px 4px 0;color:#787672'>Email</td><td>{user_doc.get('email','')}</td></tr>"
        f"<tr><td style='padding:4px 12px 4px 0;color:#787672'>Name</td><td>{user_doc.get('name','')}</td></tr>"
        f"</table>"
        f"<p style='margin-top:14px'>Sign in as admin and head to <b>Approvals</b> to grant access.</p>"
        f"<p style='color:#787672;font-size:12px;border-top:1px solid #E2DFD8;padding-top:10px;margin-top:20px'>PawPrint Rx</p>"
        f"</div>"
    )
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": os.environ.get("RESEND_FROM_EMAIL", "PawPrint Rx <onboarding@resend.dev>"),
                "to": [admin_to],
                "subject": "New clinician sign-up — approval required",
                "html": body_html,
            },
            timeout=15,
        )
        return r.status_code < 400
    except Exception:
        return False


@api.post("/auth/register")
async def register(payload: RegisterIn, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    is_clinician = payload.role == "clinician"
    is_admin_email = email in _admin_email_set()
    # Non-admin clinician sign-ups are gated by the clinician invite list.
    if is_clinician and not is_admin_email:
        invite = await db.clinician_invites.find_one({"email": email, "revoked": {"$ne": True}})
        if not invite:
            raise HTTPException(status_code=403, detail="Clinician access is invite-only. Please ask an admin to add your email to the invite list, or sign up as a pet parent instead.")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    initial_role = "clinician" if is_admin_email else payload.role
    doc = {
        "user_id": user_id,
        "email": email,
        "name": payload.name,
        "role": initial_role,
        "roles": [initial_role],
        # Admins (from ADMIN_EMAILS) are auto-approved as clinicians regardless of role chosen.
        "approval_status": "approved" if (is_admin_email or not is_clinician) else "pending",
        "is_admin": is_admin_email,
        "password_hash": hash_pw(payload.password),
        "auth_provider": "password",
        "picture": "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    access = make_token(user_id, "access")
    refresh = make_token(user_id, "refresh")
    set_auth_cookies(response, access, refresh)
    if is_clinician and not is_admin_email:
        _notify_admin_new_clinician(doc)
    doc.pop("password_hash", None)
    doc.pop("_id", None)
    doc["access_token"] = access
    doc["refresh_token"] = refresh
    doc["token_type"] = "Bearer"
    return doc

@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_pw(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access = make_token(user["user_id"], "access")
    refresh = make_token(user["user_id"], "refresh")
    set_auth_cookies(response, access, refresh)
    user.pop("password_hash", None)
    user.pop("_id", None)
    # Tokens included so non-cookie clients (e.g. the Expo mobile app) can authenticate
    # via Authorization: Bearer <access_token> on subsequent requests.
    user["access_token"] = access
    user["refresh_token"] = refresh
    user["token_type"] = "Bearer"
    return user

@api.post("/auth/google")
async def google_auth(payload: GoogleAuthIn, response: Response):
    """Verify a Google Identity Services ID token and log the user in.

    Requires GOOGLE_CLIENT_ID to be set to the OAuth client ID configured in
    Google Cloud Console (the same ID the frontend uses to render the button).
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in is not configured on this server")
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_auth_requests
        data = google_id_token.verify_oauth2_token(
            payload.credential, google_auth_requests.Request(), GOOGLE_CLIENT_ID
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google session")

    email = data["email"].lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name", existing.get("name")), "picture": data.get("picture", "")}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        is_admin_email = email in _admin_email_set()
        initial_role = "clinician" if is_admin_email else "owner"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name", ""),
            "picture": data.get("picture", ""),
            "role": initial_role,
            "roles": [initial_role],
            "approval_status": "approved",
            "is_admin": is_admin_email,
            "auth_provider": "google",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    access = make_token(user_id, "access")
    refresh = make_token(user_id, "refresh")
    set_auth_cookies(response, access, refresh)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    user["access_token"] = access
    user["refresh_token"] = refresh
    user["token_type"] = "Bearer"
    return user

@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    clear_auth_cookies(response)
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

class ForgotPasswordIn(BaseModel):
    email: EmailStr

class ResetPasswordIn(BaseModel):
    token: str
    new_password: str = Field(min_length=6)


def _send_password_reset_email(to_email: str, reset_link: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        return False
    body_html = (
        "<div style='font-family:Manrope,Arial,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px;margin:0 auto'>"
        "<h2 style='font-size:20px;color:#C96A52;margin:0 0 8px'>Reset your password</h2>"
        "<p>Click the button below to choose a new password. This link expires in 30 minutes.</p>"
        f"<p style='margin:20px 0'><a href='{reset_link}' style='background:#C96A52;color:white;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block'>Reset password</a></p>"
        "<p style='color:#787672;font-size:13px'>If you didn't request this, you can safely ignore this email.</p>"
        "</div>"
    )
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": os.environ.get("RESEND_FROM_EMAIL", "PawPrint Rx <onboarding@resend.dev>"),
                "to": [to_email],
                "subject": "Reset your PawPrint Rx password",
                "html": body_html,
            },
            timeout=15,
        )
        return r.status_code < 400
    except Exception:
        return False


@api.post("/auth/forgot-password")
async def forgot_password(payload: ForgotPasswordIn, request: Request):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if user:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": user["user_id"],
            "expires_at": expires_at.isoformat(),
            "used": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        frontend = (os.environ.get("FRONTEND_URL") or str(request.base_url)).split(",")[0].rstrip("/")
        reset_link = f"{frontend}/reset-password?token={token}"
        _send_password_reset_email(email, reset_link)
    return {"ok": True, "message": "If that email exists, a reset link has been sent."}


@api.post("/auth/reset-password")
@api.post("/auth/reset-password")
async def reset_password(payload: ResetPasswordIn):
    record = await db.password_reset_tokens.find_one(
        {"token": payload.token, "used": False}
    )

    if not record:
        raise HTTPException(
            status_code=400,
            detail="This reset link is invalid or has already been used.",
        )

    expires_at = datetime.fromisoformat(record["expires_at"])

    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=400,
            detail="This reset link has expired. Please request a new one.",
        )

    await db.users.update_one(
        {"user_id": record["user_id"]},
        {"$set": {"password_hash": hash_pw(payload.new_password)}},
    )

    await db.password_reset_tokens.update_one(
        {"token": payload.token},
        {"$set": {"used": True}},
    )

    return {
        "ok": True,
        "message": "Password updated. You can now log in.",
    }


async def _is_clinician_role_allowed(user: dict) -> bool:
    """
    Non-admins can only upgrade themselves to clinician if their email has
    been pre-invited by an admin.
    """

    if user.get("is_admin"):
        return True

    invite = await db.clinician_invites.find_one(
        {
            "email": (user.get("email") or "").lower(),
            "revoked": {"$ne": True},
        }
    )

    return invite is not None
@api.post("/auth/add-role")
async def add_role(payload: SwitchRoleIn, user: dict = Depends(get_current_user)):
    """Add a role (clinician or owner) to the current user's `roles[]` and immediately switch to it."""
    role = payload.role
    if role not in ("clinician", "owner"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if role == "clinician" and not await _is_clinician_role_allowed(user):
        raise HTTPException(status_code=403, detail="Clinician access is invite-only. Ask an admin to add your email to the clinician invite list.")
    roles = list(user.get("roles") or [user.get("role")])
    roles = [r for r in roles if r]
    if role not in roles:
        roles.append(role)
    update = {"roles": roles, "role": role}
    # Clinician role needs admin approval unless the user is already an admin.
    if role == "clinician" and not user.get("is_admin"):
        update["approval_status"] = "pending"
        _notify_admin_new_clinician({**user, "role": "clinician"})
        # Mark the invite as used so it can't be reused (but leave the record for audit).
        await db.clinician_invites.update_one(
            {"email": (user.get("email") or "").lower()},
            {"$set": {"used": True, "used_at": datetime.now(timezone.utc).isoformat()}},
        )
    elif role == "owner":
        update["approval_status"] = user.get("approval_status") or "approved"
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    return await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})

@api.get("/auth/can-add-clinician")
async def can_add_clinician(user: dict = Depends(get_current_user)):
    return {"allowed": await _is_clinician_role_allowed(user)}

@api.post("/auth/switch-role")
async def switch_role(payload: SwitchRoleIn, user: dict = Depends(get_current_user)):
    """Switch the ACTIVE role for the current user. Must already exist in their `roles[]`."""
    role = payload.role
    roles = list(user.get("roles") or [user.get("role")])
    if role not in roles:
        raise HTTPException(status_code=400, detail=f"You don't have the '{role}' role. Add it first from Settings.")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"role": role}})
    return await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})

@api.patch("/auth/role")
async def set_role(role: str = Form(...), user: dict = Depends(get_current_user)):
    if role not in ("clinician", "owner"):
        raise HTTPException(status_code=400, detail="Invalid role")
    # When choosing clinician, set pending unless already admin
    update = {"role": role}
    if role == "clinician" and not user.get("is_admin"):
        update["approval_status"] = "pending"
    elif role == "owner":
        update["approval_status"] = "approved"
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    if role == "clinician" and not user.get("is_admin"):
        fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
        _notify_admin_new_clinician(fresh or {})
    return {"ok": True, "role": role, "approval_status": update.get("approval_status", "approved")}


# ---------- Admin: clinician approvals ----------
@api.get("/admin/clinicians")
async def list_clinicians(status: Optional[str] = None, user: dict = Depends(require_admin)):
    q: dict = {"role": "clinician"}
    if status in ("pending", "approved", "rejected"):
        q["approval_status"] = status
    docs = await db.users.find(q, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return docs


@api.post("/admin/clinicians/{target_user_id}/approve")
async def approve_clinician(target_user_id: str, user: dict = Depends(require_admin)):
    res = await db.users.update_one(
        {"user_id": target_user_id, "role": "clinician"},
        {"$set": {"approval_status": "approved", "approved_at": datetime.now(timezone.utc).isoformat(), "approved_by": user["user_id"]}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Clinician not found")
    return {"ok": True}


@api.post("/admin/clinicians/{target_user_id}/reject")
async def reject_clinician(target_user_id: str, user: dict = Depends(require_admin)):
    res = await db.users.update_one(
        {"user_id": target_user_id, "role": "clinician"},
        {"$set": {"approval_status": "rejected", "rejected_at": datetime.now(timezone.utc).isoformat(), "rejected_by": user["user_id"]}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Clinician not found")
    return {"ok": True}

# ---------- Clinician invites (admin-only allowlist) ----------
@api.get("/admin/clinician-invites")
async def list_clinician_invites(user: dict = Depends(require_admin)):
    docs = await db.clinician_invites.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs

def _send_clinician_invite_email(recipient: str, inviter_name: str, signup_url_base: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        return False
    frontend = (os.environ.get("FRONTEND_URL") or signup_url_base or "").split(",")[0].rstrip("/")
    if frontend.endswith("/api"):
        frontend = frontend[:-4]
    signup_link = f"{frontend}/signup?email={requests.utils.quote(recipient)}&role=clinician"
    body_html = (
        "<div style='font-family:Manrope,Arial,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px;margin:0 auto'>"
        "<h1 style='font-size:22px;color:#C96A52;margin:0 0 8px'>You're invited to PawPrint Rx</h1>"
        f"<p><b>{inviter_name}</b> has invited you to join PawPrint Rx as a clinician.</p>"
        f"<p style='margin:20px 0'><a href='{signup_link}' style='background:#C96A52;color:white;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block'>Create your account</a></p>"
        f"<p style='color:#787672;font-size:13px'>Use this same email address ({recipient}) when you sign up — your clinician access is already linked to it.</p>"
        "<p style='color:#787672;font-size:12px;border-top:1px solid #E2DFD8;padding-top:10px;margin-top:24px'>PawPrint Rx</p>"
        "</div>"
    )
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": os.environ.get("RESEND_FROM_EMAIL", "PawPrint Rx <onboarding@resend.dev>"),
                "to": [recipient],
                "subject": f"{inviter_name} invited you to join PawPrint Rx",
                "html": body_html,
            },
            timeout=15,
        )
        return r.status_code < 400
    except Exception:
        return False


@api.post("/admin/clinician-invites")
async def add_clinician_invite(payload: ClinicianInviteIn, request: Request, user: dict = Depends(require_admin)):
    email = payload.email.lower()
    existing = await db.clinician_invites.find_one({"email": email})
    if existing and not existing.get("revoked"):
        raise HTTPException(400, f"{email} is already on the invite list")
    doc = {
        "invite_id": f"inv_{uuid.uuid4().hex[:10]}",
        "email": email,
        "invited_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "used": False,
        "revoked": False,
    }
    if existing:
        # Revive a previously-revoked invite by upserting.
        await db.clinician_invites.update_one({"email": email}, {"$set": doc})
    else:
        await db.clinician_invites.insert_one(doc)
    invite_sent = _send_clinician_invite_email(
        recipient=email,
        inviter_name=user.get("name") or user["email"],
        signup_url_base=str(request.base_url),
    )
    doc.pop("_id", None)
    doc["invite_sent"] = invite_sent
    return doc

@api.delete("/admin/clinician-invites/{email}")
async def revoke_clinician_invite(email: str, user: dict = Depends(require_admin)):
    res = await db.clinician_invites.update_one(
        {"email": email.lower()},
        {"$set": {"revoked": True, "revoked_at": datetime.now(timezone.utc).isoformat(), "revoked_by": user["email"]}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Invite not found")
    return {"ok": True}

# ---------- Patients ----------
@api.get("/patients")
async def list_patients(
    archived: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """archived = 'true' (only archived), 'all' (both), default = exclude archived."""
    if user["role"] == "clinician":
        q: dict = {}
        if archived == "true":
            q["archived"] = True
        elif archived == "all":
            pass
        else:
            q["$or"] = [{"archived": {"$exists": False}}, {"archived": False}]
        docs = await db.patients.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    else:
        # Owners always see all their pets (archived or not — they shouldn't be surprised).
        docs = await db.patients.find(_owner_filter(user["email"]), {"_id": 0}).to_list(500)
    return docs

@api.post("/patients")
async def create_patient(payload: PatientIn, user: dict = Depends(require_clinician)):
    pid = f"pat_{uuid.uuid4().hex[:12]}"
    doc = payload.model_dump()
    doc.update({
        "patient_id": pid,
        "clinician_id": user["user_id"],
        "owner_email": (doc.get("owner_email") or "").lower(),
        "photo_url": "",
        "archived": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.patients.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/patients/{patient_id}")
async def get_patient(patient_id: str, user: dict = Depends(get_current_user)):
    p = await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Patient not found")
    if user["role"] == "owner" and not _owner_can_access(user["email"], p):
        raise HTTPException(403, "Not your patient")
    return p

@api.put("/patients/{patient_id}")
async def update_patient(patient_id: str, payload: PatientIn, user: dict = Depends(require_clinician)):
    upd = payload.model_dump()
    upd["owner_email"] = (upd.get("owner_email") or "").lower()
    res = await db.patients.update_one({"patient_id": patient_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Patient not found")
    return await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})

@api.delete("/patients/{patient_id}")
async def archive_patient(patient_id: str, user: dict = Depends(require_clinician)):
    """Soft-archive a patient. Their plans/diary remain intact. Use /permanent for hard delete."""
    res = await db.patients.update_one(
        {"patient_id": patient_id},
        {"$set": {"archived": True, "archived_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Patient not found")
    return {"ok": True, "archived": True}

@api.post("/patients/{patient_id}/unarchive")
async def unarchive_patient(patient_id: str, user: dict = Depends(require_clinician)):
    res = await db.patients.update_one(
        {"patient_id": patient_id},
        {"$set": {"archived": False}, "$unset": {"archived_at": ""}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Patient not found")
    return {"ok": True, "archived": False}

@api.delete("/patients/{patient_id}/permanent")
async def permanently_delete_patient(patient_id: str, user: dict = Depends(require_clinician)):
    """Hard-delete: removes the patient and all related plans/diary. Only allowed on archived patients."""
    p = await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Patient not found")
    if not p.get("archived"):
        raise HTTPException(400, "Archive the patient before permanently deleting.")
    await db.patients.delete_one({"patient_id": patient_id})
    await db.plans.delete_many({"patient_id": patient_id})
    await db.diary.delete_many({"patient_id": patient_id})
    return {"ok": True}


@api.post("/patients/{patient_id}/apply-last-name-to-household")
async def apply_last_name_to_household(patient_id: str, user: dict = Depends(require_clinician)):
    p = await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Patient not found")
    last_name = (p.get("last_name") or "").strip()
    owner_email = (p.get("owner_email") or "").strip().lower()
    if not last_name:
        raise HTTPException(400, "This pet has no last name set yet.")
    if not owner_email:
        raise HTTPException(400, "This pet has no owner email — cannot identify household.")
    res = await db.patients.update_many(
        {"owner_email": owner_email, "patient_id": {"$ne": patient_id}, "last_name": {"$ne": last_name}},
        {"$set": {"last_name": last_name}},
    )
    owner_user = await db.users.find_one(
        {"email": owner_email, "role": "owner"},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "picture": 1},
    )
    suggested_name = f"The {last_name} family"
    return {
        "ok": True,
        "updated_count": res.modified_count,
        "last_name": last_name,
        "owner": owner_user,
        "suggested_owner_name": suggested_name,
    }


class OwnerRenameIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@api.post("/owners/{owner_email}/rename")
async def rename_owner(owner_email: str, payload: OwnerRenameIn, user: dict = Depends(require_clinician)):
    email = owner_email.strip().lower()
    res = await db.users.update_one(
        {"email": email, "role": "owner"},
        {"$set": {"name": payload.name.strip()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Owner not found")
    updated = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})
    return {"ok": True, "owner": updated}


@api.post("/patients/{patient_id}/photo")
async def upload_patient_photo(patient_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    p = await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Patient not found")
    if user["role"] == "owner" and not _owner_can_access(user["email"], p):
        raise HTTPException(403, "Not your patient")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    ct = file.content_type or "image/jpeg"
    if not ct.startswith("image/"):
        raise HTTPException(400, "File must be an image")
    ext = (file.filename or "img.jpg").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    safe_ext = ext if len(ext) <= 5 else "jpg"
    fid = uuid.uuid4().hex
    path = f"{APP_NAME}/patient-photos/{patient_id}/{fid}.{safe_ext}"
    result = put_object(path, data, ct)
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    await db.files.insert_one({
        "file_id": file_id,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": ct,
        "size": result.get("size", len(data)),
        "owner_id": user["user_id"],
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    photo_url = f"/api/files/{file_id}"
    await db.patients.update_one({"patient_id": patient_id}, {"$set": {"photo_url": photo_url}})
    return {"photo_url": photo_url, "file_id": file_id}

# ---------- Exercises ----------
@api.get("/exercises")
async def list_exercises(user: dict = Depends(get_current_user)):
    return await db.exercises.find({}, {"_id": 0}).sort("name", 1).to_list(500)

def _normalize_exercise_doc(doc: dict) -> dict:
    """Reconcile legacy single `category` ↔ new multi `categories[]`. Frontend may send either
    (or both); we persist `categories[]` as the source of truth and keep `category` mirroring
    the first item so old clients keep rendering."""
    cats = doc.get("categories") or []
    if not isinstance(cats, list):
        cats = []
    legacy = (doc.get("category") or "").strip()
    if not cats and legacy:
        cats = [legacy]
    cats = [c.strip() for c in cats if c and c.strip()]
    # Deduplicate while preserving order.
    seen, deduped = set(), []
    for c in cats:
        if c.lower() not in seen:
            seen.add(c.lower())
            deduped.append(c)
    doc["categories"] = deduped
    doc["category"] = deduped[0] if deduped else legacy
    return doc

@api.post("/exercises")
async def create_exercise(payload: ExerciseIn, user: dict = Depends(require_clinician)):
    eid = f"ex_{uuid.uuid4().hex[:10]}"
    doc = _normalize_exercise_doc(payload.model_dump())
    doc.update({"exercise_id": eid, "created_by": user["user_id"], "created_at": datetime.now(timezone.utc).isoformat()})
    await db.exercises.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/exercises/{exercise_id}")
async def update_exercise(exercise_id: str, payload: ExerciseIn, user: dict = Depends(require_clinician)):
    doc = _normalize_exercise_doc(payload.model_dump())
    res = await db.exercises.update_one({"exercise_id": exercise_id}, {"$set": doc})
    if res.matched_count == 0:
        raise HTTPException(404, "Exercise not found")
    return await db.exercises.find_one({"exercise_id": exercise_id}, {"_id": 0})

@api.delete("/exercises/{exercise_id}")
async def delete_exercise(exercise_id: str, user: dict = Depends(require_clinician)):
    await db.exercises.delete_one({"exercise_id": exercise_id})
    return {"ok": True}

# ---------- Plans ----------
@api.get("/plans")
async def list_plans(patient_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q: dict = {}
    if patient_id:
        q["patient_id"] = patient_id
    if user["role"] == "owner":
        my = await db.patients.find(_owner_filter(user["email"]), {"_id": 0, "patient_id": 1}).to_list(500)
        ids = [p["patient_id"] for p in my]
        q["patient_id"] = patient_id if patient_id and patient_id in ids else {"$in": ids}
    return await db.plans.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)

@api.post("/plans")
async def create_plan(payload: PlanIn, user: dict = Depends(require_clinician)):
    pid = f"pln_{uuid.uuid4().hex[:12]}"
    doc = payload.model_dump()
    doc.update({"plan_id": pid, "clinician_id": user["user_id"], "created_at": datetime.now(timezone.utc).isoformat()})
    await db.plans.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/plans/{plan_id}")
async def update_plan(plan_id: str, payload: PlanIn, user: dict = Depends(require_clinician)):
    res = await db.plans.update_one({"plan_id": plan_id}, {"$set": payload.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(404, "Plan not found")
    return await db.plans.find_one({"plan_id": plan_id}, {"_id": 0})

@api.delete("/plans/{plan_id}")
async def delete_plan(plan_id: str, user: dict = Depends(require_clinician)):
    await db.plans.delete_one({"plan_id": plan_id})
    return {"ok": True}

# ---------- Plan Templates ----------
def _template_visibility_filter(email: str) -> dict:
    """Templates the given user should see: owned, explicitly shared with them, or public."""
    return {"$or": [
        {"created_by_email": email},
        {"shared_with": email},
        {"is_public": True},
    ]}

@api.get("/plan-templates")
async def list_templates(user: dict = Depends(require_clinician)):
    email = user["email"].lower()
    docs = await db.plan_templates.find(_template_visibility_filter(email), {"_id": 0}).sort("updated_at", -1).to_list(500)
    for d in docs:
        d["_relation"] = "owned" if d.get("created_by_email") == email else ("shared" if email in (d.get("shared_with") or []) else "public")
    return docs

@api.post("/plan-templates")
async def create_template(payload: TemplateIn, user: dict = Depends(require_clinician)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(400, "Template name is required")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "template_id": f"tpl_{uuid.uuid4().hex[:10]}",
        "name": name,
        "description": (payload.description or "").strip(),
        "items": [it.model_dump() for it in payload.items],
        "is_public": bool(payload.is_public),
        "shared_with": [],
        "created_by": user["user_id"],
        "created_by_email": user["email"].lower(),
        "created_by_name": user.get("name") or user["email"],
        "created_at": now,
        "updated_at": now,
    }
    await db.plan_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/plan-templates/{template_id}")
async def get_template(template_id: str, user: dict = Depends(require_clinician)):
    email = user["email"].lower()
    doc = await db.plan_templates.find_one({"template_id": template_id, **_template_visibility_filter(email)}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Template not found")
    return doc

@api.put("/plan-templates/{template_id}")
async def update_template(template_id: str, payload: TemplateIn, user: dict = Depends(require_clinician)):
    email = user["email"].lower()
    tpl = await db.plan_templates.find_one({"template_id": template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    if tpl.get("created_by_email") != email:
        raise HTTPException(403, "Only the template owner can edit it")
    update = {
        "name": (payload.name or "").strip() or tpl["name"],
        "description": (payload.description or "").strip(),
        "items": [it.model_dump() for it in payload.items],
        "is_public": bool(payload.is_public),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.plan_templates.update_one({"template_id": template_id}, {"$set": update})
    return await db.plan_templates.find_one({"template_id": template_id}, {"_id": 0})

@api.delete("/plan-templates/{template_id}")
async def delete_template(template_id: str, user: dict = Depends(require_clinician)):
    email = user["email"].lower()
    tpl = await db.plan_templates.find_one({"template_id": template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    if tpl.get("created_by_email") != email:
        raise HTTPException(403, "Only the template owner can delete it")
    await db.plan_templates.delete_one({"template_id": template_id})
    return {"ok": True}

@api.post("/plan-templates/{template_id}/share")
async def share_template(template_id: str, payload: TemplateShareIn, user: dict = Depends(require_clinician)):
    email = user["email"].lower()
    tpl = await db.plan_templates.find_one({"template_id": template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    if tpl.get("created_by_email") != email:
        raise HTTPException(403, "Only the template owner can change its sharing")
    share_email = payload.email.lower()
    if share_email == email:
        raise HTTPException(400, "You already own this template")
    await db.plan_templates.update_one({"template_id": template_id}, {"$addToSet": {"shared_with": share_email}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}})
    return await db.plan_templates.find_one({"template_id": template_id}, {"_id": 0})

@api.post("/plan-templates/{template_id}/unshare")
async def unshare_template(template_id: str, payload: TemplateShareIn, user: dict = Depends(require_clinician)):
    email = user["email"].lower()
    tpl = await db.plan_templates.find_one({"template_id": template_id}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    if tpl.get("created_by_email") != email:
        raise HTTPException(403, "Only the template owner can change its sharing")
    await db.plan_templates.update_one({"template_id": template_id}, {"$pull": {"shared_with": payload.email.lower()}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}})
    return await db.plan_templates.find_one({"template_id": template_id}, {"_id": 0})

# ---------- Diary ----------
@api.get("/diary")
async def list_diary(plan_id: Optional[str] = None, patient_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q: dict = {}
    if plan_id:
        q["plan_id"] = plan_id
    if patient_id:
        q["patient_id"] = patient_id
    if user["role"] == "owner":
        my = await db.patients.find(_owner_filter(user["email"]), {"_id": 0, "patient_id": 1}).to_list(500)
        ids = [p["patient_id"] for p in my]
        if patient_id:
            if patient_id not in ids:
                return []
        else:
            q["patient_id"] = {"$in": ids}
    return await db.diary.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.post("/diary")
async def add_diary(payload: DiaryIn, user: dict = Depends(get_current_user)):
    plan = await db.plans.find_one({"plan_id": payload.plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plan not found")
    patient = await db.patients.find_one({"patient_id": plan["patient_id"]}, {"_id": 0})
    if not patient:
        raise HTTPException(404, "Patient not found")
    if user["role"] == "owner" and not _owner_can_access(user["email"], patient):
        raise HTTPException(403, "Not your plan")
    did = f"dia_{uuid.uuid4().hex[:12]}"
    doc = payload.model_dump()
    doc.update({
        "diary_id": did,
        "patient_id": plan["patient_id"],
        "owner_email": patient.get("owner_email", ""),
        "logged_by": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.diary.insert_one(doc)
    doc.pop("_id", None)
    return doc

# ---------- Uploads ----------
@api.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = (file.filename or "bin").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    safe_ext = ext if len(ext) <= 5 else "bin"
    fid = uuid.uuid4().hex
    path = f"{APP_NAME}/uploads/{user['user_id']}/{fid}.{safe_ext}"
    data = await file.read()
    ct = file.content_type or "application/octet-stream"
    result = put_object(path, data, ct)
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    await db.files.insert_one({
        "file_id": file_id,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": ct,
        "size": result.get("size", len(data)),
        "owner_id": user["user_id"],
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"file_id": file_id, "url": f"/api/files/{file_id}", "content_type": ct}

@api.get("/files/{file_id}")
async def download_file(file_id: str):
    rec = await db.files.find_one({"file_id": file_id, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "File not found")
    data, ct = get_object(rec["storage_path"])
    return FastResponse(content=data, media_type=rec.get("content_type") or ct)

# ---------- ezyVet integration ----------
class EzyVetImportIn(BaseModel):
    ezyvet_animal_id: str
    name: str
    last_name: Optional[str] = ""
    breed: Optional[str] = ""
    age_years: Optional[float] = None
    weight_kg: Optional[float] = None
    condition: Optional[str] = ""
    notes: Optional[str] = ""
    owner_email: Optional[str] = ""
    ezyvet_contact_id: Optional[str] = ""

@api.get("/ezyvet/search")
async def ezyvet_search(q: str = Query(..., min_length=1), user: dict = Depends(require_clinician)):
    try:
        return {"results": ezy_search_animals(q, limit=20)}
    except requests.HTTPError as e:
        body = ""
        try:
            body = e.response.text[:200]
        except Exception:
            pass
        if e.response is not None and e.response.status_code == 400 and "100001" in body:
            raise HTTPException(
                status_code=502,
                detail="ezyVet rejected the credentials (code 100001). Your client_secret looks like a bcrypt hash ($2y$...) — that's the stored form, not the plaintext secret. Re-generate API credentials in ezyVet and copy the plaintext secret shown ONCE on creation into EZYVET_CLIENT_SECRET.",
            )
        raise HTTPException(status_code=502, detail=f"ezyVet {e.response.status_code if e.response else '?'}: {body or 'request failed'}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ezyVet unreachable: {str(e)[:160]}")

@api.post("/ezyvet/import")
async def ezyvet_import(payload: EzyVetImportIn, user: dict = Depends(require_clinician)):
    existing = await db.patients.find_one({"ezyvet_animal_id": payload.ezyvet_animal_id}, {"_id": 0})
    if existing:
        return existing
    pid = f"pat_{uuid.uuid4().hex[:12]}"
    doc = payload.model_dump()
    doc.update({
        "patient_id": pid,
        "clinician_id": user["user_id"],
        "owner_email": (doc.get("owner_email") or "").lower(),
        "photo_url": "",
        "source": "ezyvet",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.patients.insert_one(doc)
    doc.pop("_id", None)
    return doc

# ---------- Plan PDF + Email ----------
async def _gather_plan_pdf(plan_id: str, requester: dict) -> tuple[bytes, dict, dict]:
    plan = await db.plans.find_one({"plan_id": plan_id}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plan not found")
    patient = await db.patients.find_one({"patient_id": plan["patient_id"]}, {"_id": 0})
    if not patient:
        raise HTTPException(404, "Patient not found")
    if requester["role"] == "owner" and not _owner_can_access(requester["email"], patient):
        raise HTTPException(403, "Not your plan")
    ex_ids = [it["exercise_id"] for it in plan.get("items", [])]
    ex_docs = await db.exercises.find({"exercise_id": {"$in": ex_ids}}, {"_id": 0}).to_list(500)
    ex_map = {e["exercise_id"]: e for e in ex_docs}
    clinician = await db.users.find_one({"user_id": plan.get("clinician_id")}, {"_id": 0, "name": 1}) or {}

    # Resolver for embedded uploaded images: accepts "/api/files/{file_id}" or raw file_id
    async def _resolve_async(media_ref: str) -> Optional[bytes]:
        if not media_ref:
            return None
        file_id = media_ref.rsplit("/", 1)[-1] if "/" in media_ref else media_ref
        rec = await db.files.find_one({"file_id": file_id, "is_deleted": False}, {"_id": 0})
        if not rec:
            return None
        try:
            data, _ = get_object(rec["storage_path"])
            return data
        except Exception:
            return None

    # PDF builder is sync — pre-resolve uploaded image bytes per exercise
    image_cache: Dict[str, bytes] = {}
    for e in ex_docs:
        if e.get("media_url") and e.get("media_type") == "image":
            b = await _resolve_async(e["media_url"])
            if b:
                image_cache[e["media_url"]] = b

    def resolver(ref: str) -> Optional[bytes]:
        return image_cache.get(ref)

    pdf = build_plan_pdf(plan, patient, ex_map, clinician_name=clinician.get("name", ""), media_resolver=resolver)
    return pdf, plan, patient

@api.get("/plans/{plan_id}/pdf")
async def plan_pdf(plan_id: str, user: dict = Depends(get_current_user)):
    pdf, plan, patient = await _gather_plan_pdf(plan_id, user)
    safe = "".join(c for c in patient.get("name", "plan") if c.isalnum() or c in "-_") or "plan"
    return FastResponse(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{safe}-{plan.get("title","plan")}.pdf"'},
    )

class EmailPlanIn(BaseModel):
    to: Optional[EmailStr] = None
    message: Optional[str] = ""

@api.post("/plans/{plan_id}/email")
async def email_plan(plan_id: str, payload: EmailPlanIn, user: dict = Depends(require_clinician)):
    pdf, plan, patient = await _gather_plan_pdf(plan_id, user)
    to = (payload.to or patient.get("owner_email") or "").strip()
    if not to:
        raise HTTPException(400, "No recipient email — set owner_email on patient or pass `to`.")
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        raise HTTPException(503, "Email not configured. Add RESEND_API_KEY to backend/.env (https://resend.com/api-keys).")
    import base64
    body_html = (
        f"<div style='font-family:Manrope,Arial,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px;margin:0 auto'>"
        f"<h1 style='font-size:22px;color:#C96A52;margin:0 0 8px'>{plan.get('title','Rehab Plan')}</h1>"
        f"<p>Hi! Attached is <b>{patient.get('name','your dog')}</b>'s rehab plan.</p>"
        f"{('<p>'+payload.message+'</p>') if payload.message else ''}"
        f"<p>You can log each exercise inside the PawPrint Rx portal — it helps your clinician track pain trends and progress.</p>"
        f"<p style='color:#787672;font-size:13px;border-top:1px solid #E2DFD8;padding-top:10px;margin-top:20px'>PawPrint Rx</p>"
        f"</div>"
    )
    safe = "".join(c for c in patient.get("name", "plan") if c.isalnum() or c in "-_") or "plan"
    r = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "from": os.environ.get("RESEND_FROM_EMAIL", "PawPrint Rx <onboarding@resend.dev>"),
            "to": [to],
            "subject": f"{patient.get('name','Your dog')}'s rehab plan: {plan.get('title','')}",
            "html": body_html,
            "attachments": [{
                "filename": f"{safe}-rehab-plan.pdf",
                "content": base64.b64encode(pdf).decode(),
            }],
        },
        timeout=30,
    )
    if r.status_code >= 400:
        raise HTTPException(502, f"Resend error: {r.text[:200]}")
    return {"ok": True, "to": to, "id": r.json().get("id", "")}

# ---------- Family settings (owner self-serve) ----------
class FamilyNameIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CoparentIn(BaseModel):
    email: EmailStr


def _require_owner(user: dict) -> dict:
    if user.get("role") != "owner":
        raise HTTPException(403, "Owner access required")
    return user


@api.put("/owner/family-name")
async def update_family_name(payload: FamilyNameIn, user: dict = Depends(get_current_user)):
    _require_owner(user)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"name": payload.name.strip()}})
    return {"ok": True, "name": payload.name.strip()}


@api.get("/owner/coparents")
async def list_coparents(user: dict = Depends(get_current_user)):
    _require_owner(user)
    pets = await db.patients.find({"owner_email": user["email"]}, {"_id": 0, "coparent_emails": 1}).to_list(500)
    emails: set[str] = set()
    for p in pets:
        for e in (p.get("coparent_emails") or []):
            if e:
                emails.add(e.lower())
    return {"coparents": sorted(emails)}


@api.post("/owner/coparents")
async def add_coparent(payload: CoparentIn, request: Request, user: dict = Depends(get_current_user)):
    _require_owner(user)
    email = payload.email.lower()
    if email == user["email"]:
        raise HTTPException(400, "That's your own email.")
    pets = await db.patients.find({"owner_email": user["email"]}, {"_id": 0, "patient_id": 1, "name": 1}).to_list(500)
    if not pets:
        raise HTTPException(400, "You don't own any pets yet.")
    await db.patients.update_many(
        {"owner_email": user["email"]},
        {"$addToSet": {"coparent_emails": email}},
    )
    pet_names = [p.get("name", "") for p in pets if p.get("name")]
    invited = _send_coparent_invite_email(
        recipient=email,
        inviter_name=user.get("name") or user.get("email", ""),
        pet_names=pet_names,
        signup_url_base=str(request.base_url),
    )
    return {"ok": True, "email": email, "patients_updated": len(pets), "invite_sent": invited}


def _send_coparent_invite_email(recipient: str, inviter_name: str, pet_names: list, signup_url_base: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        return False
    frontend = (os.environ.get("FRONTEND_URL") or signup_url_base or "").rstrip("/")
    if frontend.endswith("/api"):
        frontend = frontend[:-4]
    signup_link = f"{frontend}/signup?email={requests.utils.quote(recipient)}&role=owner&invited_by={requests.utils.quote(inviter_name)}"
    pet_list_html = ""
    if pet_names:
        items = "".join(f"<li>{n}</li>" for n in pet_names[:8])
        more = "" if len(pet_names) <= 8 else f"<li>+ {len(pet_names) - 8} more</li>"
        pet_list_html = (
            "<p style='color:#787672;font-size:14px;margin:0'>Pets you will have access to:</p>"
            f"<ul style='margin:6px 0 14px;padding-left:20px'>{items}{more}</ul>"
        )
    body_html = (
        "<div style='font-family:Manrope,Arial,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px;margin:0 auto'>"
        "<h1 style='font-size:22px;color:#C96A52;margin:0 0 8px'>You are invited to PawPrint Rx</h1>"
        f"<p><b>{inviter_name}</b> has shared their rehab plan with you so you can track exercises together.</p>"
        f"{pet_list_html}"
        f"<p style='margin:20px 0'><a href='{signup_link}' style='background:#C96A52;color:white;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block'>Claim your access</a></p>"
        f"<p style='color:#787672;font-size:13px'>Use this same email ({recipient}) when signing up — your access is already linked.</p>"
        "<p style='color:#787672;font-size:12px;border-top:1px solid #E2DFD8;padding-top:10px;margin-top:24px'>PawPrint Rx</p>"
        "</div>"
    )
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": os.environ.get("RESEND_FROM_EMAIL", "PawPrint Rx <onboarding@resend.dev>"),
                "to": [recipient],
                "subject": f"{inviter_name} invited you to PawPrint Rx",
                "html": body_html,
            },
            timeout=15,
        )
        return r.status_code < 400
    except Exception:
        return False


@api.delete("/owner/coparents/{coparent_email}")
async def remove_coparent(coparent_email: str, user: dict = Depends(get_current_user)):
    _require_owner(user)
    email = coparent_email.strip().lower()
    res = await db.patients.update_many(
        {"owner_email": user["email"]},
        {"$pull": {"coparent_emails": email}},
    )
    return {"ok": True, "matched": res.matched_count}


# ---------- Owner Videos (review uploads) ----------
@api.get("/owner/household-summary")
async def household_summary(user: dict = Depends(get_current_user)):
    """Owner-facing: list all of the user's pets with per-pet progress."""
    if user["role"] != "owner":
        raise HTTPException(403, "Owner access required")
    pets = await db.patients.find(_owner_filter(user["email"]), {"_id": 0}).sort("created_at", 1).to_list(200)
    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = []
    for p in pets:
        pid = p["patient_id"]
        plans = await db.plans.find({"patient_id": pid}, {"_id": 0}).to_list(50)
        plan_count = len(plans)
        today_total = sum(len(pl.get("items") or []) for pl in plans)
        diary = await db.diary.find({"patient_id": pid}, {"_id": 0}).sort("created_at", -1).to_list(500)
        today_done_ids = {
            d["exercise_id"] for d in diary
            if d.get("completed") and (d.get("created_at") or "").startswith(today_iso)
        }
        last_pain = diary[0]["pain_score"] if diary else None
        last_at = diary[0]["created_at"] if diary else None
        total_completions = sum(1 for d in diary if d.get("completed"))
        out.append({
            "patient": p,
            "plan_count": plan_count,
            "today_completed": len(today_done_ids),
            "today_total": today_total,
            "last_pain_score": last_pain,
            "last_log_at": last_at,
            "total_completions": total_completions,
        })
    return out


def _send_video_notification(patient_name: str, owner_email: str, plan_title: str, video_link: str, drive_path: str, notes: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    rehab_to = os.environ.get("REHAB_NOTIFY_EMAIL")
    if not api_key or not rehab_to:
        return False
    body_html = (
        f"<div style='font-family:Manrope,Arial,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px;margin:0 auto'>"
        f"<h2 style='font-size:20px;color:#C96A52;margin:0 0 8px'>New owner video for review</h2>"
        f"<p><b>{patient_name}</b>'s owner has uploaded a video.</p>"
        f"<table style='border-collapse:collapse;font-size:14px;margin:8px 0'>"
        f"<tr><td style='padding:4px 12px 4px 0;color:#787672'>Patient</td><td style='padding:4px 0'>{patient_name}</td></tr>"
        f"<tr><td style='padding:4px 12px 4px 0;color:#787672'>Owner</td><td style='padding:4px 0'>{owner_email or '—'}</td></tr>"
        f"<tr><td style='padding:4px 12px 4px 0;color:#787672'>Plan</td><td style='padding:4px 0'>{plan_title or '—'}</td></tr>"
        f"<tr><td style='padding:4px 12px 4px 0;color:#787672'>Location</td><td style='padding:4px 0'>{drive_path}</td></tr>"
        f"</table>"
        f"{('<p><b>Note from owner:</b> '+notes+'</p>') if notes else ''}"
        f"<p style='margin-top:14px'><a href='{video_link}' style='background:#C96A52;color:white;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600'>Open video</a></p>"
        f"<p style='color:#787672;font-size:12px;border-top:1px solid #E2DFD8;padding-top:10px;margin-top:20px'>PawPrint Rx</p>"
        f"</div>"
    )
    try:
        r = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "from": os.environ.get("RESEND_FROM_EMAIL", "PawPrint Rx <onboarding@resend.dev>"),
                "to": [rehab_to],
                "subject": f"New rehab video: {patient_name}",
                "html": body_html,
            },
            timeout=20,
        )
        return r.status_code < 400
    except Exception:
        return False


@api.post("/owner-videos")
async def upload_owner_video(
    file: UploadFile = File(...),
    patient_id: str = Form(...),
    plan_id: Optional[str] = Form(""),
    notes: Optional[str] = Form(""),
    user: dict = Depends(get_current_user),
):
    patient = await db.patients.find_one({"patient_id": patient_id}, {"_id": 0})
    if not patient:
        raise HTTPException(404, "Patient not found")
    if user["role"] == "owner" and not _owner_can_access(user["email"], patient):
        raise HTTPException(403, "Not your patient")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    ct = file.content_type or "application/octet-stream"
    ext = (file.filename or "video.mp4").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "mp4"
    safe_ext = ext if len(ext) <= 5 else "mp4"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    safe_patient = "".join(c for c in patient.get("name", "patient") if c.isalnum() or c in "-_") or "patient"
    safe_filename = f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{(file.filename or 'video').replace('/', '_')}"

    # Always store a copy in object storage (works even without SharePoint)
    fid = uuid.uuid4().hex
    storage_path = f"{APP_NAME}/owner-videos/{user['user_id']}/{fid}.{safe_ext}"
    storage_record = None
    try:
        storage_record = put_object(storage_path, data, ct)
    except Exception as e:
        logger.warning(f"Object-storage upload failed: {e}")

    file_id = f"file_{uuid.uuid4().hex[:12]}"
    if storage_record:
        await db.files.insert_one({
            "file_id": file_id,
            "storage_path": storage_record["path"],
            "original_filename": file.filename,
            "content_type": ct,
            "size": storage_record.get("size", len(data)),
            "owner_id": user["user_id"],
            "is_deleted": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    # Best-effort: also push to SharePoint if configured
    sp_result = None
    sp_error = ""
    if sp.is_configured():
        try:
            sp_result = sp.upload_video(
                folder_subpath=f"{safe_patient}/{today}",
                filename=safe_filename,
                data=data,
                content_type=ct,
            )
        except Exception as e:
            sp_error = str(e)[:200]
            logger.warning(f"SharePoint upload failed: {sp_error}")

    if not storage_record and not sp_result:
        raise HTTPException(502, f"Upload failed. SharePoint: {sp_error or 'not configured'}")

    plan_title = ""
    if plan_id:
        plan = await db.plans.find_one({"plan_id": plan_id}, {"_id": 0, "title": 1})
        plan_title = (plan or {}).get("title", "")

    video_link = (sp_result and sp_result.get("web_url")) or (f"/api/files/{file_id}" if storage_record else "")
    drive_path = (sp_result and sp_result.get("drive_path")) or (storage_record["path"] if storage_record else "")

    record = {
        "video_id": f"vid_{uuid.uuid4().hex[:12]}",
        "patient_id": patient_id,
        "plan_id": plan_id or "",
        "owner_email": patient.get("owner_email", ""),
        "uploaded_by": user["user_id"],
        "uploader_name": user.get("name", ""),
        "filename": file.filename,
        "content_type": ct,
        "size": len(data),
        "notes": notes or "",
        "storage_provider": "sharepoint" if sp_result else "object-storage",
        "sharepoint_url": (sp_result or {}).get("web_url", ""),
        "sharepoint_path": (sp_result or {}).get("drive_path", ""),
        "local_file_id": file_id if storage_record else "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.owner_videos.insert_one(record)

    notified = _send_video_notification(
        patient_name=patient.get("name", "Patient"),
        owner_email=patient.get("owner_email", ""),
        plan_title=plan_title,
        video_link=video_link if (video_link or "").startswith("http") else (
            f"{os.environ.get('PUBLIC_BASE_URL') or os.environ.get('FRONTEND_URL') or ''}{video_link}"
        ),
        drive_path=drive_path,
        notes=notes or "",
    )
    record.pop("_id", None)
    return {**record, "video_link": video_link, "notified": notified, "sharepoint_configured": sp.is_configured()}


@api.get("/owner-videos")
async def list_owner_videos(patient_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    q: dict = {}
    if patient_id:
        q["patient_id"] = patient_id
    if user["role"] == "owner":
        my = await db.patients.find(_owner_filter(user["email"]), {"_id": 0, "patient_id": 1}).to_list(500)
        ids = [p["patient_id"] for p in my]
        if patient_id:
            if patient_id not in ids:
                return []
        else:
            q["patient_id"] = {"$in": ids}
    docs = await db.owner_videos.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for d in docs:
        if d.get("sharepoint_url"):
            d["video_link"] = d["sharepoint_url"]
        elif d.get("local_file_id"):
            d["video_link"] = f"/api/files/{d['local_file_id']}"
        else:
            d["video_link"] = ""
    return docs


@api.delete("/owner-videos/{video_id}")
async def delete_owner_video(video_id: str, user: dict = Depends(require_clinician)):
    res = await db.owner_videos.delete_one({"video_id": video_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Video not found")
    return {"ok": True}


# ---------- Health ----------
@api.get("/")
async def root():
    return {"app": "Canine Rehab Studio", "ok": True}

# ---------- Seed ----------
SEED_EXERCISES = [
    {"name": "Sit-to-Stand", "category": "Strength", "description": "Builds quadriceps, hamstrings & gluteal strength.", "instructions": "Lure dog from a sit to a stand without stepping forward. Keep the spine neutral. Repeat slowly.", "default_sets": 3, "default_reps": 10},
    {"name": "Cookie Stretches (Lateral)", "category": "Pain Relief", "description": "Improves cervical and thoracolumbar lateral flexion.", "instructions": "Standing dog. Lure nose toward the hip on each side. Hold 5 seconds.", "default_sets": 2, "default_reps": 8},
    {"name": "Cavaletti Walking", "category": "Neurologic", "description": "Improves limb awareness, stride length & active range of motion.", "instructions": "Slow walk over 4–6 evenly spaced poles at carpal height. Forward only.", "default_sets": 3, "default_reps": 5},
    {"name": "Three-Leg Stand", "category": "Balance", "description": "Builds core & contralateral limb strength.", "instructions": "Lift one limb at a time for 5–10 seconds. Rotate through all four limbs.", "default_sets": 2, "default_reps": 4},
    {"name": "Wobble Board Stand", "category": "Balance", "description": "Activates stabilizers and improves proprioception.", "instructions": "Front or all 4 paws on wobble board. Encourage shifting weight gently.", "default_sets": 3, "default_reps": 1},
    {"name": "Backwards Walking", "category": "Hindlimb", "description": "Targets gluteals and hamstrings; improves hind-end awareness.", "instructions": "Walk dog slowly backwards in a straight line on non-slip surface.", "default_sets": 3, "default_reps": 10},
    {"name": "Figure-8 Walking", "category": "Neurologic", "description": "Encourages bending through the spine and weight shifting.", "instructions": "Walk in tight figure-8 around two cones. Keep slow controlled pace.", "default_sets": 2, "default_reps": 5},
    {"name": "Underwater Treadmill", "category": "Conditioning", "description": "Low-impact resistance training and gait re-education.", "instructions": "Per clinician water level & speed protocol. Monitor fatigue.", "default_sets": 1, "default_reps": 1},
    {"name": "Passive Range of Motion (Hip)", "category": "Pain Relief", "description": "Maintains joint health post-surgery.", "instructions": "Lateral recumbency. Gentle flexion/extension within pain-free ROM.", "default_sets": 2, "default_reps": 15},
    {"name": "Passive Range of Motion (Stifle)", "category": "Pain Relief", "description": "Maintains stifle ROM, esp. post TPLO/CCL.", "instructions": "Gentle bicycle-style flexion/extension. No forced motion.", "default_sets": 2, "default_reps": 15},
    {"name": "Sit-to-Down-to-Stand", "category": "Strength", "description": "Compound strengthening through full hind-limb chain.", "instructions": "Cycle through positions slowly with controlled transitions.", "default_sets": 2, "default_reps": 8},
    {"name": "Diagonal Leg Lifts", "category": "Balance", "description": "Activates contralateral core stabilizers.", "instructions": "From stand: lift opposite fore + hind paw. Hold 3–5 sec.", "default_sets": 2, "default_reps": 6},
    {"name": "Slow Leash Walking", "category": "Conditioning", "description": "Controlled load-bearing on healing tissues.", "instructions": "Flat ground, even pace, leash short. Avoid sniff-stops.", "default_sets": 1, "default_reps": 1},
    {"name": "Hill Walking (Gentle)", "category": "Hindlimb", "description": "Targets hindlimb extensors and gluteals.", "instructions": "Walk uphill slowly. Avoid steep grades early in rehab.", "default_sets": 2, "default_reps": 5},
    {"name": "Weave Poles (Slow)", "category": "Neurologic", "description": "Lateral flexion and weight shifting.", "instructions": "Slow weave through 4–6 poles. Avoid speed.", "default_sets": 2, "default_reps": 4},
    {"name": "Peanut Ball Stand", "category": "Balance", "description": "Encourages core engagement and stabilization.", "instructions": "Front paws on peanut ball. Encourage shifting and holding.", "default_sets": 3, "default_reps": 1},
    {"name": "Tuck Sits", "category": "Posture", "description": "Promotes square symmetric sit posture.", "instructions": "Reward only square (tucked) sits. Reset and repeat.", "default_sets": 2, "default_reps": 8},
    {"name": "Step-Ups", "category": "Forelimb", "description": "Concentric loading of forelimbs.", "instructions": "Front paws on low platform; cue rear paws to step up. Slow.", "default_sets": 3, "default_reps": 8},
    {"name": "Wheelbarrow Walking", "category": "Forelimb", "description": "Front-end strengthening and weight bearing.", "instructions": "Support hind end; encourage forward walk on forelimbs. Short bursts.", "default_sets": 2, "default_reps": 5},
    {"name": "Cold Laser Therapy", "category": "Pain Relief", "description": "Adjunct modality for pain and inflammation control.", "instructions": "Per clinician's wavelength/dose protocol. Eye protection as needed.", "default_sets": 1, "default_reps": 1},
]

# Canonical category set — frontend dropdown also enforces this list.
ALLOWED_CATEGORIES = ["Strength", "Neurologic", "Posture", "Balance", "Conditioning", "Forelimb", "Hindlimb", "Pain Relief"]

# Mapping from legacy / loose categories used in older seeds → canonical category.
LEGACY_CATEGORY_REMAP = {
    "general": "Strength",
    "Mobility": "Pain Relief",
    "Proprioception": "Neurologic",
    "Core": "Strength",
}


@api.get("/exercises/categories")
async def list_categories(user: dict = Depends(get_current_user)):
    docs = await db.exercise_categories.find({}, {"_id": 0}).sort([("sort_order", 1), ("name", 1)]).to_list(200)
    if not docs:
        # Fallback to canonical list when collection hasn't been seeded yet.
        return {"categories": ALLOWED_CATEGORIES}
    return {"categories": [d["name"] for d in docs], "items": docs}

@api.post("/exercise-categories")
async def create_category(payload: CategoryIn, user: dict = Depends(require_admin)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(400, "Category name is required")
    existing = await db.exercise_categories.find_one({"name": name})
    if existing:
        raise HTTPException(400, f"Category '{name}' already exists")
    last = await db.exercise_categories.find_one({}, sort=[("sort_order", -1)])
    next_order = (last["sort_order"] + 1) if last and last.get("sort_order") is not None else 0
    doc = {
        "category_id": f"cat_{uuid.uuid4().hex[:10]}",
        "name": name,
        "color": (payload.color or "").strip() or "#787672",
        "sort_order": next_order,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.exercise_categories.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/exercise-categories/{category_id}")
async def rename_category(category_id: str, payload: CategoryRenameIn, user: dict = Depends(require_admin)):
    cat = await db.exercise_categories.find_one({"category_id": category_id})
    if not cat:
        raise HTTPException(404, "Category not found")
    new_name = (payload.name or "").strip()
    if not new_name:
        raise HTTPException(400, "Category name is required")
    update: dict = {}
    migrated = 0
    if new_name != cat["name"]:
        clash = await db.exercise_categories.find_one({"name": new_name, "category_id": {"$ne": category_id}})
        if clash:
            raise HTTPException(400, f"Category '{new_name}' already exists")
        update["name"] = new_name
        res = await db.exercises.update_many({"category": cat["name"]}, {"$set": {"category": new_name}})
        migrated = res.modified_count
    if payload.color is not None:
        update["color"] = (payload.color or "").strip() or "#787672"
    if update:
        await db.exercise_categories.update_one({"category_id": category_id}, {"$set": update})
    return {"ok": True, "name": new_name, "color": update.get("color", cat.get("color", "")), "exercises_migrated": migrated}

@api.delete("/exercise-categories/{category_id}")
async def delete_category(category_id: str, user: dict = Depends(require_admin)):
    cat = await db.exercise_categories.find_one({"category_id": category_id})
    if not cat:
        raise HTTPException(404, "Category not found")
    in_use = await db.exercises.count_documents({"category": cat["name"]})
    if in_use > 0:
        raise HTTPException(400, f"'{cat['name']}' is used by {in_use} exercise(s). Rename or move them first.")
    await db.exercise_categories.delete_one({"category_id": category_id})
    return {"ok": True}

async def seed():
    # admin clinician
    admin_email = os.environ.get("ADMIN_EMAIL", "clinician@rehab.com")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "rehab123")
    admin_doc = await db.users.find_one({"email": admin_email})
    if not admin_doc:
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": admin_email,
            "name": "Lead Clinician",
            "role": "clinician",
            "is_admin": True,
            "approval_status": "approved",
            "auth_provider": "password",
            "password_hash": hash_pw(admin_pw),
            "picture": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    else:
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"is_admin": True, "approval_status": "approved"}},
        )
    # demo owner
    owner_email = "owner@rehab.com"
    if not await db.users.find_one({"email": owner_email}):
        await db.users.insert_one({
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": owner_email,
            "name": "Demo Owner",
            "role": "owner",
            "is_admin": False,
            "approval_status": "approved",
            "auth_provider": "password",
            "password_hash": hash_pw("owner123"),
            "picture": "",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    # Promote every email in ADMIN_EMAILS (idempotent). New sign-ups matching one of these
    # emails are also auto-promoted; this loop covers users who already existed before
    # ADMIN_EMAILS was set.
    admin_emails = _admin_email_set()
    if admin_emails:
        await db.users.update_many(
            {"email": {"$in": list(admin_emails)}},
            {"$set": {"is_admin": True, "approval_status": "approved", "role": "clinician"}},
        )
    # Backfill: any existing user without approval_status defaults to approved
    await db.users.update_many(
        {"approval_status": {"$exists": False}},
        {"$set": {"approval_status": "approved", "is_admin": False}},
    )
    # Backfill: seed `roles[]` from the legacy single `role` field for users created before dual-role.
    cursor = db.users.find({"$or": [{"roles": {"$exists": False}}, {"roles": []}, {"roles": None}]}, {"_id": 0, "user_id": 1, "role": 1})
    async for u in cursor:
        r = u.get("role")
        if r:
            await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"roles": [r]}})
    # exercises
    if await db.exercises.count_documents({}) == 0:
        for e in SEED_EXERCISES:
            await db.exercises.insert_one({
                **e,
                "exercise_id": f"ex_{uuid.uuid4().hex[:10]}",
                "media_url": "",
                "media_type": "",
                "created_by": "system",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
    # Migration: re-map any legacy categories to the canonical list.
    for legacy, canonical in LEGACY_CATEGORY_REMAP.items():
        await db.exercises.update_many({"category": legacy}, {"$set": {"category": canonical}})
    # Idempotent re-categorisation of seeded exercises (custom-named exercises untouched).
    for seed in SEED_EXERCISES:
        await db.exercises.update_one(
            {"name": seed["name"], "created_by": "system"},
            {"$set": {"category": seed["category"]}},
        )
    # Backfill patients without an `archived` flag (default to active).
    await db.patients.update_many(
        {"archived": {"$exists": False}},
        {"$set": {"archived": False}},
    )
    # Migration: backfill categories[] from legacy single `category` field.
    cursor = db.exercises.find({"$or": [{"categories": {"$exists": False}}, {"categories": []}, {"categories": None}]}, {"_id": 0, "exercise_id": 1, "category": 1})
    async for ex in cursor:
        cat = (ex.get("category") or "").strip()
        if cat:
            await db.exercises.update_one({"exercise_id": ex["exercise_id"]}, {"$set": {"categories": [cat]}})
    # Migration: coerce numeric default_sets/default_reps and plan sets/reps to strings.
    cursor = db.exercises.find({"$or": [{"default_sets": {"$type": "int"}}, {"default_sets": {"$type": "long"}}]}, {"_id": 0, "exercise_id": 1, "default_sets": 1, "default_reps": 1})
    async for ex in cursor:
        s = ex.get("default_sets")
        r = ex.get("default_reps")
        update = {}
        if isinstance(s, (int, float)):
            update["default_sets"] = str(int(s))
        if isinstance(r, (int, float)):
            update["default_reps"] = str(int(r))
        if update:
            await db.exercises.update_one({"exercise_id": ex["exercise_id"]}, {"$set": update})
    # Plan items: coerce numeric sets/reps embedded in items[] to strings.
    cursor = db.plans.find({"items": {"$exists": True}}, {"_id": 0, "plan_id": 1, "items": 1})
    async for plan in cursor:
        items = plan.get("items") or []
        changed = False
        for it in items:
            if isinstance(it.get("sets"), (int, float)):
                it["sets"] = str(int(it["sets"]))
                changed = True
            if isinstance(it.get("reps"), (int, float)):
                it["reps"] = str(int(it["reps"]))
                changed = True
        if changed:
            await db.plans.update_one({"plan_id": plan["plan_id"]}, {"$set": {"items": items}})
    # Migration: convert legacy numeric `default_duration_seconds` → string `default_duration`.
    cursor = db.exercises.find({"default_duration": {"$in": [None, "", False]}, "default_duration_seconds": {"$gt": 0}}, {"_id": 0, "exercise_id": 1, "default_duration_seconds": 1})
    async for ex in cursor:
        secs = ex.get("default_duration_seconds") or 0
        if secs >= 60 and secs % 60 == 0:
            label = f"{secs // 60} min"
        elif secs >= 60:
            label = f"{secs // 60}m {secs % 60}s"
        else:
            label = f"{secs} sec"
        await db.exercises.update_one({"exercise_id": ex["exercise_id"]}, {"$set": {"default_duration": label}})
    # Seed exercise_categories collection from the canonical list (idempotent — only adds missing names).
    canonical_colors = {
        "Strength": "#C96A52",      # warm terracotta
        "Neurologic": "#7C6EAE",    # iris
        "Posture": "#3F7CAC",       # ocean blue
        "Balance": "#D8A14A",       # honey amber
        "Conditioning": "#5B7566",  # forest moss
        "Forelimb": "#B9577A",      # rose
        "Hindlimb": "#46998B",      # teal
        "Pain Relief": "#2C312E",   # ink charcoal
    }
    for i, name in enumerate(ALLOWED_CATEGORIES):
        await db.exercise_categories.update_one(
            {"name": name},
            {"$setOnInsert": {
                "category_id": f"cat_{uuid.uuid4().hex[:10]}",
                "name": name,
                "color": canonical_colors.get(name, "#787672"),
                "sort_order": i,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    # Backfill: canonical categories that pre-date the color field get their canonical hex.
    for name, color in canonical_colors.items():
        await db.exercise_categories.update_one(
            {"name": name, "$or": [{"color": {"$exists": False}}, {"color": ""}, {"color": None}]},
            {"$set": {"color": color}},
        )
    # Backfill: any remaining categories without a color get the muted neutral default.
    await db.exercise_categories.update_many(
        {"$or": [{"color": {"$exists": False}}, {"color": ""}, {"color": None}]},
        {"$set": {"color": "#787672"}},
    )
    # indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.patients.create_index("patient_id", unique=True)
    await db.exercises.create_index("exercise_id", unique=True)
    await db.exercise_categories.create_index("category_id", unique=True)
    await db.exercise_categories.create_index("name", unique=True)
    await db.plans.create_index("plan_id", unique=True)
    await db.diary.create_index("diary_id", unique=True)
    await db.password_reset_tokens.create_index("token", unique=True)
@app.on_event("startup")
async def on_startup():
    try:
        init_storage()
    except Exception as e:
        logger.warning(f"Storage init failed (non-fatal): {e}")
    await seed()
    logger.info("Startup complete")

@app.on_event("shutdown")
async def on_shutdown():
    client.close()

app.include_router(api)

# FRONTEND_URL can be a single origin or a comma-separated list, e.g.
# "https://pawprintrx.vercel.app,https://pawprintrx.com"
# A wildcard ("*") is not allowed here because cookies (allow_credentials=True)
# require an explicit origin per the CORS spec -- browsers reject "*" + credentials.
_frontend_origins = [o.strip() for o in os.environ.get("FRONTEND_URL", "").split(",") if o.strip()]
if not _frontend_origins:
    logger.warning("FRONTEND_URL is not set -- no origins are allowed to call this API with credentials.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

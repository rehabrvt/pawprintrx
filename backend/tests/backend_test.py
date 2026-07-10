import os, io, pytest, requests, uuid
from pathlib import Path

# Load REACT_APP_BACKEND_URL from frontend/.env if not in env
if "REACT_APP_BACKEND_URL" not in os.environ:
    fe_env = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if fe_env.exists():
        for line in fe_env.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip()
                break

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, r.text
    return s, r.json()

@pytest.fixture(scope="module")
def clinician():
    s, u = _login("clinician@rehab.com", "rehab123")
    assert u["role"] == "clinician"
    return s, u

@pytest.fixture(scope="module")
def owner():
    s, u = _login("owner@rehab.com", "owner123")
    assert u["role"] == "owner"
    return s, u

# -------- Health & Auth --------
def test_health():
    r = requests.get(f"{API}/", timeout=15)
    assert r.status_code == 200 and r.json().get("ok") is True

def test_register_and_me():
    email = f"test_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "secret123", "name": "T", "role": "owner"})
    assert r.status_code == 200, r.text
    assert r.json()["email"] == email
    me = s.get(f"{API}/auth/me")
    assert me.status_code == 200 and me.json()["email"] == email

def test_login_invalid():
    r = requests.post(f"{API}/auth/login", json={"email": "clinician@rehab.com", "password": "wrong"})
    assert r.status_code == 401

def test_me_bearer(clinician):
    s, _ = clinician
    tok = s.cookies.get("access_token")
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200

# -------- Exercises --------
def test_exercises_seeded(clinician):
    s, _ = clinician
    r = s.get(f"{API}/exercises")
    assert r.status_code == 200
    assert len(r.json()) >= 18

def test_clinician_exercise_crud(clinician):
    s, _ = clinician
    r = s.post(f"{API}/exercises", json={"name": "TEST_EX", "category": "Strength", "description": "x", "instructions": "y"})
    assert r.status_code == 200
    eid = r.json()["exercise_id"]
    r2 = s.put(f"{API}/exercises/{eid}", json={"name": "TEST_EX2", "category": "Strength", "description": "x", "instructions": "y"})
    assert r2.status_code == 200 and r2.json()["name"] == "TEST_EX2"
    r3 = s.delete(f"{API}/exercises/{eid}")
    assert r3.status_code == 200

# -------- Patients --------
@pytest.fixture(scope="module")
def patient(clinician):
    s, _ = clinician
    r = s.post(f"{API}/patients", json={"name": "TEST_Buddy", "breed": "Lab", "owner_email": "owner@rehab.com", "condition": "TPLO recovery"})
    assert r.status_code == 200, r.text
    return r.json()

def test_patient_create_list(clinician, patient):
    s, _ = clinician
    assert patient["patient_id"].startswith("pat_")
    r = s.get(f"{API}/patients")
    assert any(p["patient_id"] == patient["patient_id"] for p in r.json())

def test_owner_sees_only_own(owner, patient):
    s, _ = owner
    r = s.get(f"{API}/patients")
    pids = [p["patient_id"] for p in r.json()]
    assert patient["patient_id"] in pids

def test_owner_forbidden_create_patient(owner):
    s, _ = owner
    r = s.post(f"{API}/patients", json={"name": "X", "owner_email": "owner@rehab.com"})
    assert r.status_code == 403

# -------- Plans --------
@pytest.fixture(scope="module")
def plan(clinician, patient):
    s, _ = clinician
    exs = s.get(f"{API}/exercises").json()[:2]
    items = [{"exercise_id": e["exercise_id"], "sets": 3, "reps": 10, "frequency": "Daily", "notes": ""} for e in exs]
    r = s.post(f"{API}/plans", json={"patient_id": patient["patient_id"], "title": "Week 1", "items": items, "notes": "Test plan notes"})
    assert r.status_code == 200, r.text
    return r.json()

def test_plan_get_and_update(clinician, plan, patient):
    s, _ = clinician
    r = s.get(f"{API}/plans", params={"patient_id": patient["patient_id"]})
    assert r.status_code == 200 and any(p["plan_id"] == plan["plan_id"] for p in r.json())
    r2 = s.put(f"{API}/plans/{plan['plan_id']}", json={"patient_id": patient["patient_id"], "title": "Week 1b", "items": plan["items"], "notes": "upd"})
    assert r2.status_code == 200 and r2.json()["title"] == "Week 1b"

def test_owner_can_see_plans(owner, plan, patient):
    s, _ = owner
    r = s.get(f"{API}/plans", params={"patient_id": patient["patient_id"]})
    assert r.status_code == 200
    assert any(p["plan_id"] == plan["plan_id"] for p in r.json())

# -------- Diary --------
def test_owner_diary_create(owner, plan):
    s, _ = owner
    eid = plan["items"][0]["exercise_id"]
    r = s.post(f"{API}/diary", json={"plan_id": plan["plan_id"], "exercise_id": eid, "completed": True, "actual_reps": 10, "pain_score": 2, "notes": "ok"})
    assert r.status_code == 200, r.text
    assert r.json()["pain_score"] == 2

def test_owner_forbidden_other_patient(owner, clinician):
    s_c, _ = clinician
    other = s_c.post(f"{API}/patients", json={"name": "TEST_Other", "owner_email": "someoneelse@example.com"}).json()
    s, _ = owner
    r = s.get(f"{API}/patients/{other['patient_id']}")
    assert r.status_code == 403
    s_c.delete(f"{API}/patients/{other['patient_id']}")

# -------- ezyVet --------
def test_ezyvet_search_friendly_bcrypt_error(clinician):
    """Search with invalid bcrypt-hash secret should yield 502 with a helpful hint."""
    s, _ = clinician
    r = s.get(f"{API}/ezyvet/search", params={"q": "Buddy"}, timeout=40)
    # Expecting 502 because the configured secret is a bcrypt hash placeholder
    assert r.status_code == 502, f"unexpected status {r.status_code}: {r.text[:300]}"
    detail = (r.json().get("detail") or "").lower()
    assert any(k in detail for k in ("bcrypt", "100001", "plaintext")), f"unhelpful error: {detail}"

def test_ezyvet_search_requires_clinician(owner):
    s, _ = owner
    r = s.get(f"{API}/ezyvet/search", params={"q": "Buddy"})
    assert r.status_code == 403

def test_ezyvet_import_creates_patient_and_dedupes(clinician):
    s, _ = clinician
    ez_id = f"demo-{uuid.uuid4().hex[:6]}"
    payload = {"ezyvet_animal_id": ez_id, "name": "TEST_Ezy", "breed": "Lab", "owner_email": "owner@rehab.com"}
    r1 = s.post(f"{API}/ezyvet/import", json=payload)
    assert r1.status_code == 200, r1.text
    j1 = r1.json()
    assert j1["patient_id"].startswith("pat_")
    assert j1.get("source") == "ezyvet"
    assert j1["ezyvet_animal_id"] == ez_id
    # Re-import should return same record (dedupe)
    r2 = s.post(f"{API}/ezyvet/import", json=payload)
    assert r2.status_code == 200
    assert r2.json()["patient_id"] == j1["patient_id"]
    # cleanup
    s.delete(f"{API}/patients/{j1['patient_id']}")

# -------- Plan PDF --------
def test_plan_pdf_clinician(clinician, plan):
    s, _ = clinician
    r = s.get(f"{API}/plans/{plan['plan_id']}/pdf", timeout=60)
    assert r.status_code == 200, r.text[:200]
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"
    assert len(r.content) > 1024

def test_plan_pdf_owner_own(owner, plan):
    s, _ = owner
    r = s.get(f"{API}/plans/{plan['plan_id']}/pdf", timeout=60)
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"

def test_plan_pdf_owner_forbidden_other(owner, clinician):
    s_c, _ = clinician
    other_p = s_c.post(f"{API}/patients", json={"name": "TEST_OtherPdf", "owner_email": "stranger@example.com"}).json()
    exs = s_c.get(f"{API}/exercises").json()[:1]
    items = [{"exercise_id": exs[0]["exercise_id"], "sets": 2, "reps": 5, "frequency": "Daily", "notes": ""}]
    other_plan = s_c.post(f"{API}/plans", json={"patient_id": other_p["patient_id"], "title": "Stranger Plan", "items": items}).json()
    s, _ = owner
    r = s.get(f"{API}/plans/{other_plan['plan_id']}/pdf")
    assert r.status_code == 403
    s_c.delete(f"{API}/plans/{other_plan['plan_id']}")
    s_c.delete(f"{API}/patients/{other_p['patient_id']}")

# -------- Plan Email --------
def test_email_plan_503_when_no_resend_key(clinician, plan):
    s, _ = clinician
    r = s.post(f"{API}/plans/{plan['plan_id']}/email", json={"to": "owner@rehab.com"}, timeout=30)
    assert r.status_code == 503, f"expected 503 got {r.status_code}: {r.text[:200]}"
    detail = (r.json().get("detail") or "").lower()
    assert "resend" in detail or "email not configured" in detail

def test_email_plan_owner_forbidden(owner, plan):
    s, _ = owner
    r = s.post(f"{API}/plans/{plan['plan_id']}/email", json={"to": "owner@rehab.com"})
    assert r.status_code == 403

# -------- Upload (regression) --------
def test_upload_and_download(clinician):
    s, _ = clinician
    files = {"file": ("test.txt", io.BytesIO(b"hello world"), "text/plain")}
    r = s.post(f"{API}/upload", files=files)
    if r.status_code != 200:
        pytest.skip(f"upload failed (storage): {r.status_code} {r.text[:200]}")
    j = r.json()
    r2 = requests.get(f"{BASE}{j['url']}")
    assert r2.status_code == 200
    assert r2.content == b"hello world"

# -------- Iter 3: Exercise video_url --------
def test_exercise_video_url_persists(clinician):
    s, _ = clinician
    r = s.post(f"{API}/exercises", json={
        "name": "TEST_VID_EX", "category": "Mobility",
        "description": "demo", "instructions": "do it",
        "video_url": "https://youtube.com/watch?v=dQw4w9WgXcQ"
    })
    assert r.status_code == 200, r.text
    eid = r.json()["exercise_id"]
    # PUT roundtrip
    r2 = s.put(f"{API}/exercises/{eid}", json={
        "name": "TEST_VID_EX", "category": "Mobility",
        "description": "demo", "instructions": "do it",
        "video_url": "https://youtu.be/dQw4w9WgXcQ"
    })
    assert r2.status_code == 200
    assert r2.json().get("video_url") == "https://youtu.be/dQw4w9WgXcQ"
    # GET list contains it
    lst = s.get(f"{API}/exercises").json()
    matched = [e for e in lst if e["exercise_id"] == eid]
    assert matched and matched[0].get("video_url") == "https://youtu.be/dQw4w9WgXcQ"
    s.delete(f"{API}/exercises/{eid}")


# -------- Iter 3: PDF size grows with video thumbnail/QR --------
def test_plan_pdf_size_with_video_url(clinician, patient):
    s, _ = clinician
    # Create a fresh exercise with a YouTube video_url
    er = s.post(f"{API}/exercises", json={
        "name": "TEST_VID_PDF", "category": "Mobility",
        "description": "demo with vid", "instructions": "watch & do",
        "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    })
    assert er.status_code == 200
    ex = er.json()
    items = [{"exercise_id": ex["exercise_id"], "sets": 3, "reps": 10, "frequency": "Daily", "notes": ""}]
    pr = s.post(f"{API}/plans", json={"patient_id": patient["patient_id"], "title": "TEST_VID_PLAN", "items": items, "notes": "vid plan"})
    assert pr.status_code == 200
    pid = pr.json()["plan_id"]
    pdfr = s.get(f"{API}/plans/{pid}/pdf", timeout=90)
    assert pdfr.status_code == 200
    assert pdfr.headers.get("content-type", "").startswith("application/pdf")
    assert pdfr.content[:4] == b"%PDF"
    size = len(pdfr.content)
    print(f"PDF size with video_url: {size} bytes")
    # Functional check: PDF should embed an Image XObject (the YouTube hqdefault thumbnail
    # gets ASCII85+DCT-encoded inside the stream, so we look for PDF image markers).
    body = pdfr.content
    assert b"/Subtype /Image" in body, "No Image XObject embedded in PDF"
    assert b"/DCTDecode" in body, "No JPEG (DCTDecode) Image embedded — YouTube thumbnail likely missing"
    # And should be much larger than the bare ~3KB baseline (sanity)
    assert size > 15_000, f"PDF unexpectedly small ({size} bytes); thumbnail/QR likely not embedded"
    # cleanup
    s.delete(f"{API}/plans/{pid}")
    s.delete(f"{API}/exercises/{ex['exercise_id']}")


# -------- Iter 3: Owner Videos POST/GET/DELETE + RBAC --------
def _fake_mp4(name="clip.mp4"):
    # Minimal non-empty bytes; backend accepts any non-empty
    return (name, io.BytesIO(b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 256), "video/mp4")


def test_owner_video_upload_object_storage(clinician, patient):
    """Clinician uploading on behalf — verifies storage_provider, video_link, sharepoint_configured=False, notified=False."""
    s, _ = clinician
    files = {"file": _fake_mp4("test_clinician.mp4")}
    data = {"patient_id": patient["patient_id"], "notes": "TEST upload by clinician"}
    r = s.post(f"{API}/owner-videos", files=files, data=data, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["video_id"].startswith("vid_")
    assert j["storage_provider"] == "object-storage"
    assert j["sharepoint_configured"] is False
    assert j["notified"] is False  # RESEND_API_KEY empty
    assert j["local_file_id"].startswith("file_")
    assert j["video_link"].startswith("/api/files/")
    pytest.video_id_clinician = j["video_id"]
    pytest.local_file_id = j["local_file_id"]


def test_owner_video_file_download(clinician):
    """Object-storage uploaded video downloadable via /api/files/{id}."""
    fid = getattr(pytest, "local_file_id", None)
    if not fid:
        pytest.skip("No local_file_id from previous test")
    s, _ = clinician
    r = s.get(f"{API}/files/{fid}", timeout=30)
    assert r.status_code == 200
    ct = r.headers.get("content-type", "")
    assert "video" in ct or "octet-stream" in ct, f"unexpected content-type {ct}"
    assert len(r.content) > 0


def test_owner_video_list_owner_rbac(owner, patient):
    """Owner sees their own patient's videos; list non-empty."""
    s, _ = owner
    r = s.get(f"{API}/owner-videos", params={"patient_id": patient["patient_id"]})
    assert r.status_code == 200
    docs = r.json()
    assert isinstance(docs, list)
    assert len(docs) >= 1
    for d in docs:
        assert d["owner_email"] == "owner@rehab.com"


def test_owner_can_upload_to_own_patient(owner, patient):
    s, _ = owner
    files = {"file": _fake_mp4("by_owner.mp4")}
    data = {"patient_id": patient["patient_id"], "notes": "TEST owner upload"}
    r = s.post(f"{API}/owner-videos", files=files, data=data, timeout=60)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["video_id"].startswith("vid_")
    assert j["uploaded_by"]
    pytest.video_id_owner = j["video_id"]


def test_owner_forbidden_upload_other_patient(owner, clinician):
    """Owner with mismatching email gets 403."""
    s_c, _ = clinician
    other = s_c.post(f"{API}/patients", json={
        "name": "TEST_StrangerVid", "owner_email": "stranger@example.com"
    }).json()
    s, _ = owner
    files = {"file": _fake_mp4("attack.mp4")}
    data = {"patient_id": other["patient_id"], "notes": "should fail"}
    r = s.post(f"{API}/owner-videos", files=files, data=data, timeout=30)
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text[:200]}"
    s_c.delete(f"{API}/patients/{other['patient_id']}")


def test_owner_video_delete_clinician_only(owner, clinician):
    """Owner cannot delete; clinician can."""
    vid = getattr(pytest, "video_id_owner", None)
    if not vid:
        pytest.skip("No owner video to delete")
    s_o, _ = owner
    r = s_o.delete(f"{API}/owner-videos/{vid}")
    assert r.status_code == 403
    # clinician deletes
    s_c, _ = clinician
    r2 = s_c.delete(f"{API}/owner-videos/{vid}")
    assert r2.status_code == 200


def test_cleanup_clinician_video(clinician):
    vid = getattr(pytest, "video_id_clinician", None)
    if not vid:
        pytest.skip("No clinician video to clean")
    s, _ = clinician
    r = s.delete(f"{API}/owner-videos/{vid}")
    assert r.status_code == 200


# -------- Iter 4: Clinician approval workflow --------
def _register(role, email=None):
    email = email or f"test_clin_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "secret123", "name": "T Clin", "role": role}, timeout=30)
    assert r.status_code == 200, r.text
    return s, r.json(), email


def test_seeded_admin_is_approved(clinician):
    s, _ = clinician
    me = s.get(f"{API}/auth/me").json()
    assert me.get("is_admin") is True
    assert me.get("approval_status") == "approved"


def test_register_clinician_pending_owner_approved():
    s_c, u_c, _ = _register("clinician")
    assert u_c.get("is_admin") is False
    assert u_c.get("approval_status") == "pending"
    s_o, u_o, _ = _register("owner")
    assert u_o.get("approval_status") == "approved"


def test_pending_clinician_403_on_clinician_routes():
    s, u, _ = _register("clinician")
    # POST /patients
    r = s.post(f"{API}/patients", json={"name": "X", "owner_email": "x@x.com"})
    assert r.status_code == 403, r.text
    detail = (r.json().get("detail") or "").lower()
    assert "pending" in detail and "approval" in detail
    # POST /exercises
    r2 = s.post(f"{API}/exercises", json={"name": "X", "category": "Strength"})
    assert r2.status_code == 403
    # POST /plans
    r3 = s.post(f"{API}/plans", json={"patient_id": "pat_x", "title": "x", "items": []})
    assert r3.status_code == 403


def test_admin_list_clinicians_pending_visible(clinician):
    s_c, _ = clinician
    # Create a fresh pending clinician
    _, u_pending, email = _register("clinician")
    r = s_c.get(f"{API}/admin/clinicians", params={"status": "pending"})
    assert r.status_code == 200
    ids = [c["user_id"] for c in r.json()]
    assert u_pending["user_id"] in ids
    # Stash for downstream
    pytest.pending_user_id = u_pending["user_id"]
    pytest.pending_email = email


def test_non_admin_403_on_admin_clinicians(owner):
    s_o, _ = owner
    r = s_o.get(f"{API}/admin/clinicians", params={"status": "pending"})
    assert r.status_code == 403
    # Pending clinician — also 403 (admin gate, not approval gate)
    s, _, _ = _register("clinician")
    r2 = s.get(f"{API}/admin/clinicians")
    assert r2.status_code == 403


def test_approve_clinician_unblocks_create(clinician):
    """Approve a pending clinician and verify they can now POST /api/patients."""
    s_c, _ = clinician
    # Register fresh pending clinician
    s_p, u_p, _ = _register("clinician")
    # Pre-check: 403
    pre = s_p.post(f"{API}/patients", json={"name": "TEST_PreApprove", "owner_email": "x@x.com"})
    assert pre.status_code == 403
    # Admin approves
    r = s_c.post(f"{API}/admin/clinicians/{u_p['user_id']}/approve")
    assert r.status_code == 200, r.text
    # Verify status flipped
    lst = s_c.get(f"{API}/admin/clinicians", params={"status": "approved"}).json()
    assert any(c["user_id"] == u_p["user_id"] for c in lst)
    # Now create patient -- should succeed
    post = s_p.post(f"{API}/patients", json={"name": "TEST_PostApprove", "owner_email": "x@x.com"})
    assert post.status_code == 200, post.text
    pid = post.json()["patient_id"]
    # cleanup
    s_c.delete(f"{API}/patients/{pid}")


def test_reject_clinician_keeps_403(clinician):
    s_c, _ = clinician
    s_p, u_p, _ = _register("clinician")
    r = s_c.post(f"{API}/admin/clinicians/{u_p['user_id']}/reject")
    assert r.status_code == 200
    lst = s_c.get(f"{API}/admin/clinicians", params={"status": "rejected"}).json()
    assert any(c["user_id"] == u_p["user_id"] for c in lst)
    # Still 403 from clinician-gated endpoints
    r2 = s_p.post(f"{API}/patients", json={"name": "X", "owner_email": "x@x.com"})
    assert r2.status_code == 403


def test_role_switch_owner_to_clinician_pending_then_back():
    s, u, email = _register("owner")
    assert u.get("approval_status") == "approved"
    r = s.patch(f"{API}/auth/role", data={"role": "clinician"})
    assert r.status_code == 200, r.text
    assert r.json().get("approval_status") == "pending"
    # /me reflects pending + new role
    me = s.get(f"{API}/auth/me").json()
    assert me["role"] == "clinician" and me["approval_status"] == "pending"
    # Switch back to owner
    r2 = s.patch(f"{API}/auth/role", data={"role": "owner"})
    assert r2.status_code == 200
    me2 = s.get(f"{API}/auth/me").json()
    assert me2["role"] == "owner" and me2["approval_status"] == "approved"


# -------- Iter 4: Patient photo upload --------
def _png_bytes():
    # 1x1 transparent PNG
    import base64
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )


def test_patient_photo_upload_clinician(clinician, patient):
    s, _ = clinician
    files = {"file": ("dog.png", io.BytesIO(_png_bytes()), "image/png")}
    r = s.post(f"{API}/patients/{patient['patient_id']}/photo", files=files, timeout=60)
    if r.status_code != 200:
        pytest.skip(f"object storage may be unavailable: {r.status_code} {r.text[:200]}")
    j = r.json()
    assert j["photo_url"].startswith("/api/files/")
    assert j["file_id"].startswith("file_")
    # Patient record updated
    p = s.get(f"{API}/patients/{patient['patient_id']}").json()
    assert p["photo_url"] == j["photo_url"]
    # Download works and is image/*
    dl = requests.get(f"{BASE}{j['photo_url']}", timeout=30)
    assert dl.status_code == 200
    assert dl.headers.get("content-type", "").startswith("image/")
    assert len(dl.content) > 0


def test_patient_photo_upload_owner_own(owner, patient):
    s, _ = owner
    files = {"file": ("by_owner.png", io.BytesIO(_png_bytes()), "image/png")}
    r = s.post(f"{API}/patients/{patient['patient_id']}/photo", files=files, timeout=60)
    if r.status_code != 200:
        pytest.skip(f"object storage may be unavailable: {r.status_code} {r.text[:200]}")
    assert r.json()["photo_url"].startswith("/api/files/")


def test_patient_photo_upload_owner_other_403(owner, clinician):
    s_c, _ = clinician
    other = s_c.post(f"{API}/patients", json={"name": "TEST_PhotoStranger", "owner_email": "stranger2@example.com"}).json()
    s, _ = owner
    files = {"file": ("a.png", io.BytesIO(_png_bytes()), "image/png")}
    r = s.post(f"{API}/patients/{other['patient_id']}/photo", files=files)
    assert r.status_code == 403
    s_c.delete(f"{API}/patients/{other['patient_id']}")


def test_patient_photo_upload_non_image_400(clinician, patient):
    s, _ = clinician
    files = {"file": ("note.txt", io.BytesIO(b"hello"), "text/plain")}
    r = s.post(f"{API}/patients/{patient['patient_id']}/photo", files=files)
    assert r.status_code == 400
    assert "image" in (r.json().get("detail") or "").lower()


# -------- Iter 5: multi-pet under one owner email --------
def test_multi_pet_owner_sees_all(clinician, owner):
    """Clinician creates 3 patients all with same owner_email; owner GET /patients sees all 3 + isolation."""
    s_c, _ = clinician
    s_o, _ = owner
    owner_email = "owner@rehab.com"
    created = []
    try:
        for i, name in enumerate(["TEST_MP_Rex", "TEST_MP_Luna", "TEST_MP_Coco"]):
            r = s_c.post(f"{API}/patients", json={
                "name": name, "breed": f"Breed{i}", "owner_email": owner_email,
                "condition": f"Cond{i}",
            })
            assert r.status_code == 200, r.text
            created.append(r.json())
        # Owner sees all 3 (and possibly more from earlier tests)
        r = s_o.get(f"{API}/patients")
        assert r.status_code == 200
        owner_pids = {p["patient_id"] for p in r.json()}
        for p in created:
            assert p["patient_id"] in owner_pids, f"{p['name']} missing in owner list"
        # Diary isolation: add diary to first pet's plan, ensure second pet's diary is empty / does not contain it
        # Build plan on pet A
        ex = s_c.get(f"{API}/exercises").json()[0]
        plan_a = s_c.post(f"{API}/plans", json={
            "patient_id": created[0]["patient_id"], "title": "MP_A",
            "items": [{"exercise_id": ex["exercise_id"], "sets": 1, "reps": 5, "frequency": "1x/d"}],
        }).json()
        # Owner logs diary for pet A
        d = s_o.post(f"{API}/diary", json={
            "plan_id": plan_a["plan_id"], "exercise_id": ex["exercise_id"],
            "completed": True, "actual_reps": 5, "pain_score": 1, "notes": "MP_A entry",
        })
        assert d.status_code == 200, d.text
        # Pet B diary list must NOT contain that entry
        r_b = s_o.get(f"{API}/diary", params={"patient_id": created[1]["patient_id"]})
        assert r_b.status_code == 200
        assert all("MP_A entry" not in (e.get("notes") or "") for e in r_b.json())
        # Pet A diary DOES contain it
        r_a = s_o.get(f"{API}/diary", params={"patient_id": created[0]["patient_id"]})
        assert r_a.status_code == 200
        assert any("MP_A entry" in (e.get("notes") or "") for e in r_a.json())
        # Pet B plans must NOT contain pet A's plan
        r_pl_b = s_o.get(f"{API}/plans", params={"patient_id": created[1]["patient_id"]})
        assert r_pl_b.status_code == 200
        assert all(pl["plan_id"] != plan_a["plan_id"] for pl in r_pl_b.json())
    finally:
        for p in created:
            s_c.delete(f"{API}/patients/{p['patient_id']}")


# -------- Iter 6: Owner household-summary --------
def test_household_summary_owner_only(owner, clinician):
    s_c, _ = clinician
    r = s_c.get(f"{API}/owner/household-summary")
    assert r.status_code == 403, f"clinician should be 403 got {r.status_code}: {r.text[:200]}"
    s_o, _ = owner
    r2 = s_o.get(f"{API}/owner/household-summary")
    assert r2.status_code == 200
    assert isinstance(r2.json(), list)


def test_household_summary_shape_and_today_increment(clinician, owner):
    s_c, _ = clinician
    s_o, _ = owner
    # Create a fresh pet for owner@rehab.com
    pat = s_c.post(f"{API}/patients", json={
        "name": "TEST_HS_Pet", "breed": "Lab", "owner_email": "owner@rehab.com", "condition": "test"
    }).json()
    pid = pat["patient_id"]
    try:
        # Build a plan with 2 items
        exs = s_c.get(f"{API}/exercises").json()[:2]
        items = [{"exercise_id": e["exercise_id"], "sets": 2, "reps": 5, "frequency": "Daily", "notes": ""} for e in exs]
        plan = s_c.post(f"{API}/plans", json={"patient_id": pid, "title": "HS Plan", "items": items}).json()
        # Get baseline household-summary entry for this pet
        r = s_o.get(f"{API}/owner/household-summary")
        assert r.status_code == 200
        entry = next((x for x in r.json() if x["patient"]["patient_id"] == pid), None)
        assert entry is not None, "new pet missing in household-summary"
        # Shape assertions
        assert set(["patient", "plan_count", "today_completed", "today_total",
                    "last_pain_score", "last_log_at", "total_completions"]).issubset(entry.keys())
        assert entry["plan_count"] == 1
        assert entry["today_total"] == 2  # sum of plan items
        baseline_today = entry["today_completed"]
        baseline_total = entry["total_completions"]
        # Owner logs a diary entry (completed)
        d = s_o.post(f"{API}/diary", json={
            "plan_id": plan["plan_id"], "exercise_id": exs[0]["exercise_id"],
            "completed": True, "actual_reps": 5, "pain_score": 4, "notes": "TEST_HS log"
        })
        assert d.status_code == 200, d.text
        # Re-fetch summary
        r2 = s_o.get(f"{API}/owner/household-summary")
        entry2 = next(x for x in r2.json() if x["patient"]["patient_id"] == pid)
        assert entry2["today_completed"] == baseline_today + 1
        assert entry2["total_completions"] == baseline_total + 1
        assert entry2["last_pain_score"] == 4
        assert entry2["last_log_at"] is not None
        # An incomplete entry should NOT bump today_completed but SHOULD update last_pain_score
        d2 = s_o.post(f"{API}/diary", json={
            "plan_id": plan["plan_id"], "exercise_id": exs[1]["exercise_id"],
            "completed": False, "actual_reps": 0, "pain_score": 7, "notes": "TEST_HS skipped"
        })
        assert d2.status_code == 200
        r3 = s_o.get(f"{API}/owner/household-summary")
        entry3 = next(x for x in r3.json() if x["patient"]["patient_id"] == pid)
        assert entry3["today_completed"] == baseline_today + 1  # unchanged
        assert entry3["last_pain_score"] == 7  # latest regardless of completion
    finally:
        s_c.delete(f"{API}/patients/{pid}")


# -------- Iter 7: Apply last-name to household --------
def test_apply_last_name_to_household_happy_and_idempotent(clinician):
    """Clinician sets last_name on one pet, then applies to siblings under the same owner_email."""
    s_c, _ = clinician
    owner_email = f"test_hh_{uuid.uuid4().hex[:6]}@example.com"
    created = []
    try:
        # Create 3 siblings: A has Smith, B has empty, C has Jones (different)
        a = s_c.post(f"{API}/patients", json={
            "name": "TEST_HH_A", "owner_email": owner_email, "last_name": "Smith"
        }).json()
        created.append(a)
        b = s_c.post(f"{API}/patients", json={
            "name": "TEST_HH_B", "owner_email": owner_email, "last_name": ""
        }).json()
        created.append(b)
        c = s_c.post(f"{API}/patients", json={
            "name": "TEST_HH_C", "owner_email": owner_email, "last_name": "Jones"
        }).json()
        created.append(c)
        # Apply A's last_name to household
        r = s_c.post(f"{API}/patients/{a['patient_id']}/apply-last-name-to-household")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("last_name") == "Smith"
        assert j.get("updated_count") == 2  # B and C got changed
        # Verify persistence
        for p in (b, c):
            got = s_c.get(f"{API}/patients/{p['patient_id']}").json()
            assert got["last_name"] == "Smith", f"{p['name']} not propagated: {got.get('last_name')}"
        # A unchanged
        got_a = s_c.get(f"{API}/patients/{a['patient_id']}").json()
        assert got_a["last_name"] == "Smith"
        # Idempotency: second call → 0
        r2 = s_c.post(f"{API}/patients/{a['patient_id']}/apply-last-name-to-household")
        assert r2.status_code == 200
        assert r2.json().get("updated_count") == 0
    finally:
        for p in created:
            s_c.delete(f"{API}/patients/{p['patient_id']}")


def test_apply_last_name_400_no_last_name(clinician):
    s_c, _ = clinician
    p = s_c.post(f"{API}/patients", json={
        "name": "TEST_HH_NoLN", "owner_email": f"test_hh_{uuid.uuid4().hex[:6]}@example.com",
        "last_name": ""
    }).json()
    try:
        r = s_c.post(f"{API}/patients/{p['patient_id']}/apply-last-name-to-household")
        assert r.status_code == 400, r.text
        assert "last name" in (r.json().get("detail") or "").lower()
    finally:
        s_c.delete(f"{API}/patients/{p['patient_id']}")


def test_apply_last_name_400_no_owner_email(clinician):
    s_c, _ = clinician
    p = s_c.post(f"{API}/patients", json={
        "name": "TEST_HH_NoOwner", "owner_email": "", "last_name": "Smith"
    }).json()
    try:
        r = s_c.post(f"{API}/patients/{p['patient_id']}/apply-last-name-to-household")
        assert r.status_code == 400, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "household" in detail or "owner" in detail
    finally:
        s_c.delete(f"{API}/patients/{p['patient_id']}")


def test_apply_last_name_owner_403(owner, clinician):
    s_c, _ = clinician
    s_o, _ = owner
    p = s_c.post(f"{API}/patients", json={
        "name": "TEST_HH_OwnerRBAC", "owner_email": "owner@rehab.com", "last_name": "Smith"
    }).json()
    try:
        r = s_o.post(f"{API}/patients/{p['patient_id']}/apply-last-name-to-household")
        assert r.status_code == 403, f"owner should be forbidden, got {r.status_code}: {r.text[:200]}"
    finally:
        s_c.delete(f"{API}/patients/{p['patient_id']}")


def test_apply_last_name_pending_clinician_403(clinician):
    """Pending clinician (not yet approved) gets 403 with pending-approval message."""
    s_c, _ = clinician
    # Register fresh pending clinician
    s_p, u_p, _ = _register("clinician")
    p = s_c.post(f"{API}/patients", json={
        "name": "TEST_HH_PendingRBAC", "owner_email": f"hhp_{uuid.uuid4().hex[:6]}@example.com",
        "last_name": "Smith"
    }).json()
    try:
        r = s_p.post(f"{API}/patients/{p['patient_id']}/apply-last-name-to-household")
        assert r.status_code == 403, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "pending" in detail and "approval" in detail
    finally:
        s_c.delete(f"{API}/patients/{p['patient_id']}")


def test_put_patient_persists_last_name(clinician):
    """PUT /api/patients/{id} round-trips last_name correctly."""
    s_c, _ = clinician
    p = s_c.post(f"{API}/patients", json={
        "name": "TEST_HH_PUT", "owner_email": f"hhput_{uuid.uuid4().hex[:6]}@example.com",
        "last_name": "Original"
    }).json()
    try:
        r = s_c.put(f"{API}/patients/{p['patient_id']}", json={
            "name": "TEST_HH_PUT", "owner_email": p["owner_email"], "last_name": "Updated"
        })
        assert r.status_code == 200, r.text
        assert r.json().get("last_name") == "Updated"
        # Verify by GET
        got = s_c.get(f"{API}/patients/{p['patient_id']}").json()
        assert got["last_name"] == "Updated"
    finally:
        s_c.delete(f"{API}/patients/{p['patient_id']}")


# -------- Iter 8: Owner rename + enriched household response --------
def test_apply_lastname_returns_owner_and_suggested_name(clinician):
    """Apply endpoint enriched response contains owner + suggested_owner_name."""
    s_c, _ = clinician
    # Seeded owner@rehab.com is the linked user
    owner_email = "owner@rehab.com"
    last_name = f"Iter8{uuid.uuid4().hex[:4]}"
    a = s_c.post(f"{API}/patients", json={
        "name": "TEST_I8_A", "owner_email": owner_email, "last_name": last_name
    }).json()
    b = s_c.post(f"{API}/patients", json={
        "name": "TEST_I8_B", "owner_email": owner_email, "last_name": ""
    }).json()
    try:
        r = s_c.post(f"{API}/patients/{a['patient_id']}/apply-last-name-to-household")
        assert r.status_code == 200, r.text
        j = r.json()
        # Original fields still there
        assert j.get("ok") is True
        assert j.get("last_name") == last_name
        # NEW fields
        assert j.get("suggested_owner_name") == f"The {last_name} family"
        owner = j.get("owner")
        assert owner is not None, "owner should be the linked user dict, not None"
        assert owner.get("email") == owner_email
        assert "user_id" in owner and owner["user_id"].startswith("user_")
        assert "name" in owner
        # _id must not leak
        assert "_id" not in owner
    finally:
        s_c.delete(f"{API}/patients/{a['patient_id']}")
        s_c.delete(f"{API}/patients/{b['patient_id']}")


def test_apply_lastname_returns_null_owner_when_no_user(clinician):
    """If no matching owner user exists, owner: null but ok still true."""
    s_c, _ = clinician
    fake_email = f"nouser_{uuid.uuid4().hex[:6]}@example.com"
    a = s_c.post(f"{API}/patients", json={
        "name": "TEST_I8_NOUSER_A", "owner_email": fake_email, "last_name": "Phantom"
    }).json()
    b = s_c.post(f"{API}/patients", json={
        "name": "TEST_I8_NOUSER_B", "owner_email": fake_email, "last_name": ""
    }).json()
    try:
        r = s_c.post(f"{API}/patients/{a['patient_id']}/apply-last-name-to-household")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("owner") is None
        assert j.get("suggested_owner_name") == "The Phantom family"
    finally:
        s_c.delete(f"{API}/patients/{a['patient_id']}")
        s_c.delete(f"{API}/patients/{b['patient_id']}")


def test_owner_rename_endpoint_persists_name(clinician):
    """POST /api/owners/{email}/rename clinician-only, persists user.name, verifiable via /auth/me."""
    s_c, _ = clinician
    # Take a snapshot of current name so we can restore
    before_login_s, before_user = _login("owner@rehab.com", "owner123")
    original_name = before_user.get("name", "Demo Owner")
    new_name = f"The TestRename {uuid.uuid4().hex[:4]} family"
    try:
        r = s_c.post(f"{API}/owners/owner@rehab.com/rename", json={"name": new_name})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("owner", {}).get("name") == new_name
        assert "_id" not in j.get("owner", {})
        # Verify via fresh login → /auth/me
        s_o, u_o = _login("owner@rehab.com", "owner123")
        me = s_o.get(f"{API}/auth/me").json()
        assert me["name"] == new_name
    finally:
        # Restore
        s_c.post(f"{API}/owners/owner@rehab.com/rename", json={"name": original_name})


def test_owner_rename_url_encoded_email(clinician):
    """URL-encoded email (owner%40rehab.com) should resolve identically."""
    s_c, _ = clinician
    before_s, before_u = _login("owner@rehab.com", "owner123")
    original_name = before_u.get("name", "Demo Owner")
    new_name = f"The UrlEnc {uuid.uuid4().hex[:4]} family"
    try:
        r = s_c.post(f"{API}/owners/owner%40rehab.com/rename", json={"name": new_name})
        assert r.status_code == 200, r.text
        assert r.json().get("owner", {}).get("name") == new_name
    finally:
        s_c.post(f"{API}/owners/owner@rehab.com/rename", json={"name": original_name})


def test_owner_rename_empty_name_422(clinician):
    s_c, _ = clinician
    r = s_c.post(f"{API}/owners/owner@rehab.com/rename", json={"name": ""})
    assert r.status_code == 422, f"expected 422 got {r.status_code}: {r.text[:200]}"


def test_owner_rename_nonexistent_404(clinician):
    s_c, _ = clinician
    r = s_c.post(f"{API}/owners/ghost_{uuid.uuid4().hex[:6]}@nowhere.example/rename",
                 json={"name": "The Ghost family"})
    assert r.status_code == 404, r.text
    assert "owner not found" in (r.json().get("detail") or "").lower()


def test_owner_rename_owner_role_forbidden(owner):
    s_o, _ = owner
    r = s_o.post(f"{API}/owners/owner@rehab.com/rename", json={"name": "Self rename"})
    assert r.status_code == 403


def test_owner_rename_pending_clinician_forbidden(clinician):
    s_p, u_p, _ = _register("clinician")
    r = s_p.post(f"{API}/owners/owner@rehab.com/rename", json={"name": "Pending tries"})
    assert r.status_code == 403
    detail = (r.json().get("detail") or "").lower()
    assert "pending" in detail and "approval" in detail


# ============================================================
# Iter 9: Family Settings + Co-parents RBAC
# ============================================================

def _restore_owner_name(s_c):
    """Restore the demo owner's display name to a known value."""
    s_c.post(f"{API}/owners/owner@rehab.com/rename", json={"name": "Demo Owner"})


def _purge_coparent(email: str):
    """Best-effort: log in as owner and remove coparent email everywhere."""
    try:
        s_o, _ = _login("owner@rehab.com", "owner123")
        s_o.delete(f"{API}/owner/coparents/{email}")
    except Exception:
        pass


def test_i9_family_name_owner_persists(owner, clinician):
    s_o, _ = owner
    s_c, _ = clinician
    new_name = f"The Smith Family {uuid.uuid4().hex[:4]}"
    try:
        r = s_o.put(f"{API}/owner/family-name", json={"name": new_name})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True and j.get("name") == new_name
        # Verify via /auth/me
        me = s_o.get(f"{API}/auth/me").json()
        assert me["name"] == new_name
    finally:
        _restore_owner_name(s_c)


def test_i9_family_name_clinician_forbidden(clinician):
    s_c, _ = clinician
    r = s_c.put(f"{API}/owner/family-name", json={"name": "Should fail"})
    assert r.status_code == 403


def test_i9_family_name_empty_422(owner):
    s_o, _ = owner
    r = s_o.put(f"{API}/owner/family-name", json={"name": ""})
    assert r.status_code == 422


def test_i9_coparent_add_returns_count(owner):
    s_o, _ = owner
    coparent_email = f"test_cp_{uuid.uuid4().hex[:6]}@example.com"
    try:
        # Get current patient count for the owner
        pats = s_o.get(f"{API}/patients").json()
        owned_n = sum(1 for p in pats if p.get("owner_email") == "owner@rehab.com")
        assert owned_n >= 1, "owner should have at least one pet for this test"

        r = s_o.post(f"{API}/owner/coparents", json={"email": coparent_email})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("email") == coparent_email
        assert j.get("patients_updated") == owned_n

        # Verify present on patients (via GET coparents)
        cps = s_o.get(f"{API}/owner/coparents").json()["coparents"]
        assert coparent_email in cps
    finally:
        s_o.delete(f"{API}/owner/coparents/{coparent_email}")


def test_i9_coparent_own_email_400(owner):
    s_o, _ = owner
    r = s_o.post(f"{API}/owner/coparents", json={"email": "owner@rehab.com"})
    assert r.status_code == 400
    assert "own email" in (r.json().get("detail") or "").lower()


def test_i9_coparent_no_pets_400(clinician):
    """Fresh owner with no pets cannot add coparents."""
    s_fresh, u_fresh, email_fresh = _register("owner")
    r = s_fresh.post(f"{API}/owner/coparents", json={"email": "anyone@example.com"})
    assert r.status_code == 400
    assert "don't own any pets" in (r.json().get("detail") or "").lower()


def test_i9_coparent_list_deduped_sorted_lowercase(owner, clinician):
    s_o, _ = owner
    s_c, _ = clinician
    e1 = f"test_z_{uuid.uuid4().hex[:6]}@example.com"
    e2 = f"test_a_{uuid.uuid4().hex[:6]}@example.com"
    try:
        # Add with mixed case
        s_o.post(f"{API}/owner/coparents", json={"email": e1.upper()})
        s_o.post(f"{API}/owner/coparents", json={"email": e2})
        # Add e1 a second time (dedupe)
        s_o.post(f"{API}/owner/coparents", json={"email": e1})

        cps = s_o.get(f"{API}/owner/coparents").json()["coparents"]
        # Only lowercase
        for e in cps:
            assert e == e.lower()
        # Both present
        assert e1.lower() in cps and e2.lower() in cps
        # Sorted
        assert cps == sorted(cps)
        # Dedup: count of e1 occurrences is 1
        assert cps.count(e1.lower()) == 1
    finally:
        s_o.delete(f"{API}/owner/coparents/{e1.lower()}")
        s_o.delete(f"{API}/owner/coparents/{e2}")


def test_i9_coparent_delete_idempotent(owner):
    s_o, _ = owner
    e = f"test_idem_{uuid.uuid4().hex[:6]}@example.com"
    # Add
    s_o.post(f"{API}/owner/coparents", json={"email": e})
    # Delete twice
    r1 = s_o.delete(f"{API}/owner/coparents/{e}")
    assert r1.status_code == 200 and r1.json().get("ok") is True
    r2 = s_o.delete(f"{API}/owner/coparents/{e}")
    assert r2.status_code == 200 and r2.json().get("ok") is True
    # Confirm gone
    cps = s_o.get(f"{API}/owner/coparents").json()["coparents"]
    assert e not in cps


def test_i9_rbac_coparent_sees_owners_pets(owner, clinician):
    """A registered user listed as coparent must see the owner's pets via GET /patients."""
    s_o, _ = owner
    # Register a fresh owner user — they own zero pets initially
    s_cp, u_cp, cp_email = _register("owner")
    try:
        # Owner invites coparent
        s_o.post(f"{API}/owner/coparents", json={"email": cp_email})

        # Coparent's GET /patients should return the owner's pets
        r = s_cp.get(f"{API}/patients")
        assert r.status_code == 200
        pats = r.json()
        owners_pats = [p for p in pats if p.get("owner_email") == "owner@rehab.com"]
        assert len(owners_pats) >= 1, f"coparent should see owner's pets, got: {pats}"

        # Pick one and verify GET /patients/{id}
        pid = owners_pats[0]["patient_id"]
        r2 = s_cp.get(f"{API}/patients/{pid}")
        assert r2.status_code == 200
        assert r2.json()["patient_id"] == pid

        # household-summary
        r3 = s_cp.get(f"{API}/owner/household-summary")
        assert r3.status_code == 200
        hs = r3.json()
        assert any(item.get("patient", {}).get("patient_id") == pid for item in hs)

        # plans for that patient
        r4 = s_cp.get(f"{API}/plans", params={"patient_id": pid})
        assert r4.status_code == 200

        # diary list
        r5 = s_cp.get(f"{API}/diary", params={"patient_id": pid})
        assert r5.status_code == 200
    finally:
        s_o.delete(f"{API}/owner/coparents/{cp_email}")


def test_i9_rbac_random_owner_sees_no_pets(owner, clinician):
    """Regression: an uninvited owner still gets [] for GET /api/patients."""
    s_rand, _, _ = _register("owner")
    r = s_rand.get(f"{API}/patients")
    assert r.status_code == 200
    assert r.json() == [], f"uninvited owner should see no pets, got {r.json()}"


def test_i9_rbac_coparent_cannot_invite_on_owner_behalf(owner):
    """Coparent's POST /owner/coparents should only act on patients where THEY are owner_email — not the original owner's pets."""
    s_o, _ = owner
    s_cp, u_cp, cp_email = _register("owner")
    sub_coparent = f"test_sub_{uuid.uuid4().hex[:6]}@example.com"
    try:
        # Owner invites coparent
        s_o.post(f"{API}/owner/coparents", json={"email": cp_email})

        # Coparent has zero of their own pets → POST should 400
        r = s_cp.post(f"{API}/owner/coparents", json={"email": sub_coparent})
        assert r.status_code == 400, r.text

        # Verify sub_coparent NOT in the original owner's coparent list
        cps = s_o.get(f"{API}/owner/coparents").json()["coparents"]
        assert sub_coparent not in cps
    finally:
        s_o.delete(f"{API}/owner/coparents/{cp_email}")


def test_i9_rbac_coparent_can_post_diary_and_video(owner, clinician):
    """Coparent can POST diary (with valid plan_id) and POST owner-videos for owner's pets."""
    s_o, _ = owner
    s_c, _ = clinician
    s_cp, u_cp, cp_email = _register("owner")

    # Create a fresh patient owned by owner@rehab.com
    pat_resp = s_c.post(f"{API}/patients", json={
        "name": "TEST_I9_CoPat", "breed": "Lab", "owner_email": "owner@rehab.com",
        "condition": "Recovery"
    })
    assert pat_resp.status_code == 200, pat_resp.text
    pid = pat_resp.json()["patient_id"]

    # Build a plan with one exercise
    exs = s_c.get(f"{API}/exercises").json()
    eid = exs[0]["exercise_id"]
    plan_resp = s_c.post(f"{API}/plans", json={
        "patient_id": pid,
        "title": "TEST_I9_Plan",
        "items": [{"exercise_id": eid, "sets": 1, "reps": 5, "frequency": "Daily", "notes": ""}]
    })
    assert plan_resp.status_code == 200, plan_resp.text
    plan_id = plan_resp.json()["plan_id"]

    try:
        # Invite coparent
        s_o.post(f"{API}/owner/coparents", json={"email": cp_email})

        # Coparent posts a diary entry
        r_d = s_cp.post(f"{API}/diary", json={
            "plan_id": plan_id,
            "exercise_id": eid, "completed": True, "pain_score": 1,
            "notes": "TEST coparent diary"
        })
        assert r_d.status_code == 200, r_d.text

        # Coparent posts an owner-video
        files = {"file": ("test.mp4", b"FAKEVIDEOBYTES", "video/mp4")}
        data = {"patient_id": pid, "notes": "TEST coparent video"}
        r_v = s_cp.post(f"{API}/owner-videos", files=files, data=data)
        assert r_v.status_code == 200, r_v.text
    finally:
        s_o.delete(f"{API}/owner/coparents/{cp_email}")
        s_c.delete(f"{API}/patients/{pid}")


def test_logout(clinician):
    s, _ = clinician
    r = s.post(f"{API}/auth/logout")
    assert r.status_code == 200


# --- iter-10: invite_sent field + bad-email + RBAC for /owner/coparents ---
def test_i10_coparent_add_returns_invite_sent_false_when_no_key(owner):
    """RESEND_API_KEY is empty so invite_sent must be False and response shape preserved."""
    s_o, _ = owner
    coparent_email = f"test_i10_{uuid.uuid4().hex[:6]}@example.com"
    try:
        pats = s_o.get(f"{API}/patients").json()
        owned_n = sum(1 for p in pats if p.get("owner_email") == "owner@rehab.com")
        assert owned_n >= 1

        r = s_o.post(f"{API}/owner/coparents", json={"email": coparent_email})
        assert r.status_code == 200, r.text
        j = r.json()
        # Old keys preserved
        assert j.get("ok") is True
        assert j.get("email") == coparent_email
        assert j.get("patients_updated") == owned_n
        # New key present and False (no Resend key configured)
        assert "invite_sent" in j, f"missing invite_sent in response: {j}"
        assert j["invite_sent"] is False, f"expected invite_sent=False but got {j['invite_sent']}"
        # Side-effect persisted
        cps = s_o.get(f"{API}/owner/coparents").json()["coparents"]
        assert coparent_email in cps
    finally:
        s_o.delete(f"{API}/owner/coparents/{coparent_email}")


def test_i10_coparent_add_bad_email_returns_422(owner):
    """EmailStr validation must reject malformed email with 422 (no 500)."""
    s_o, _ = owner
    r = s_o.post(f"{API}/owner/coparents", json={"email": "not-an-email"})
    assert r.status_code == 422, r.text


def test_i10_coparent_clinician_forbidden_unchanged():
    """RBAC unchanged: clinician calling owner endpoint still 403.

    Uses a fresh login (not the module-scoped fixture) so it doesn't depend on
    the test_logout earlier ordering.
    """
    s_c, u_c = _login("clinician@rehab.com", "rehab123")
    assert u_c["role"] == "clinician"
    r = s_c.post(f"{API}/owner/coparents", json={"email": "anyone@example.com"})
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


def test_i10_coparent_response_shape_keys_exact(owner):
    """Verify exactly the documented keys exist on success."""
    s_o, _ = owner
    coparent_email = f"test_i10shape_{uuid.uuid4().hex[:6]}@example.com"
    try:
        r = s_o.post(f"{API}/owner/coparents", json={"email": coparent_email})
        assert r.status_code == 200
        j = r.json()
        for key in ("ok", "email", "patients_updated", "invite_sent"):
            assert key in j, f"missing key {key} in {j}"
        assert isinstance(j["invite_sent"], bool)
        assert isinstance(j["patients_updated"], int)
    finally:
        s_o.delete(f"{API}/owner/coparents/{coparent_email}")

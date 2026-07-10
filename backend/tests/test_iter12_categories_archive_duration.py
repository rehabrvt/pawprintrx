"""
Iter-12 backend regression tests:
 - Exercise categories: GET, POST, PUT (rename + migration), DELETE (block when in-use), non-admin 403.
 - Exercises/plans accept free-text duration strings; PDF still 200.
 - Patient archive flow: DELETE soft-archives, listing filters (default / archived=true / all),
   unarchive endpoint, permanent-delete rules.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "clinician@rehab.com"
ADMIN_PW = "rehab123"
OWNER_EMAIL = "owner@rehab.com"
OWNER_PW = "owner123"


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_sess():
    return _login(ADMIN_EMAIL, ADMIN_PW)


@pytest.fixture(scope="module")
def owner_sess():
    return _login(OWNER_EMAIL, OWNER_PW)


# ---------- Exercise categories ----------
class TestCategories:
    def test_list_categories_returns_items(self, admin_sess):
        r = admin_sess.get(f"{API}/exercises/categories", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "categories" in data
        assert "items" in data
        names = data["categories"]
        canonical = ["Strength", "Neurologic", "Posture", "Balance", "Conditioning", "Forelimb", "Hindlimb", "Pain Relief"]
        for c in canonical:
            assert c in names, f"Missing canonical {c} in {names}"
        # items should be list of dicts with category_id + name
        assert isinstance(data["items"], list) and len(data["items"]) >= 8
        assert all("category_id" in i and "name" in i for i in data["items"])

    def test_create_rename_delete_category(self, admin_sess):
        name = f"TEST_Aquatic_{uuid.uuid4().hex[:6]}"
        r = admin_sess.post(f"{API}/exercise-categories", json={"name": name}, timeout=30)
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        assert doc["name"] == name
        assert "category_id" in doc
        assert "sort_order" in doc
        cat_id = doc["category_id"]

        # duplicate -> 400
        r2 = admin_sess.post(f"{API}/exercise-categories", json={"name": name}, timeout=30)
        assert r2.status_code == 400

        # rename
        new_name = f"TEST_Hydro_{uuid.uuid4().hex[:6]}"
        r3 = admin_sess.put(f"{API}/exercise-categories/{cat_id}", json={"name": new_name}, timeout=30)
        assert r3.status_code == 200
        rd = r3.json()
        assert rd.get("ok") and rd.get("name") == new_name
        assert "exercises_migrated" in rd  # field exists even if 0

        # delete (no exercises use it) -> 200
        r4 = admin_sess.delete(f"{API}/exercise-categories/{cat_id}", timeout=30)
        assert r4.status_code == 200

    def test_delete_blocked_when_in_use(self, admin_sess):
        name = f"TEST_InUseCat_{uuid.uuid4().hex[:6]}"
        r = admin_sess.post(f"{API}/exercise-categories", json={"name": name}, timeout=30)
        assert r.status_code in (200, 201)
        cat_id = r.json()["category_id"]
        # create exercise using this category
        ex_payload = {
            "name": f"TEST_Ex_{uuid.uuid4().hex[:6]}",
            "category": name,
            "default_duration": "15-30 sec",
        }
        re = admin_sess.post(f"{API}/exercises", json=ex_payload, timeout=30)
        assert re.status_code == 200
        ex_id = re.json()["exercise_id"]

        # delete should be blocked
        rd = admin_sess.delete(f"{API}/exercise-categories/{cat_id}", timeout=30)
        assert rd.status_code == 400
        assert "exercise" in rd.text.lower() or "used" in rd.text.lower()

        # rename and verify migration count > 0
        new_name = f"TEST_Renamed_{uuid.uuid4().hex[:6]}"
        rr = admin_sess.put(f"{API}/exercise-categories/{cat_id}", json={"name": new_name}, timeout=30)
        assert rr.status_code == 200
        assert rr.json().get("exercises_migrated", 0) >= 1

        # exercise should now have new category
        rl = admin_sess.get(f"{API}/exercises", timeout=30)
        assert rl.status_code == 200
        found = [e for e in rl.json() if e.get("exercise_id") == ex_id]
        assert found and found[0]["category"] == new_name

        # cleanup
        admin_sess.delete(f"{API}/exercises/{ex_id}", timeout=30)
        admin_sess.delete(f"{API}/exercise-categories/{cat_id}", timeout=30)

    def test_non_admin_forbidden(self, owner_sess):
        # POST as owner -> 403
        r = owner_sess.post(f"{API}/exercise-categories", json={"name": "TEST_OwnerCat"}, timeout=30)
        assert r.status_code == 403
        # PUT as owner -> 403
        r2 = owner_sess.put(f"{API}/exercise-categories/cat_fake", json={"name": "x"}, timeout=30)
        assert r2.status_code == 403
        # DELETE as owner -> 403
        r3 = owner_sess.delete(f"{API}/exercise-categories/cat_fake", timeout=30)
        assert r3.status_code == 403


# ---------- Free-text duration ----------
class TestDuration:
    def test_exercise_string_duration_persists(self, admin_sess):
        payload = {
            "name": f"TEST_Dur_{uuid.uuid4().hex[:6]}",
            "category": "Strength",
            "default_duration": "15-30 sec",
        }
        r = admin_sess.post(f"{API}/exercises", json=payload, timeout=30)
        assert r.status_code == 200
        ex = r.json()
        assert ex["default_duration"] == "15-30 sec"
        ex_id = ex["exercise_id"]

        rl = admin_sess.get(f"{API}/exercises", timeout=30)
        assert rl.status_code == 200
        match = next((e for e in rl.json() if e["exercise_id"] == ex_id), None)
        assert match and match["default_duration"] == "15-30 sec"

        # cleanup
        admin_sess.delete(f"{API}/exercises/{ex_id}", timeout=30)

    def test_plan_with_string_duration_and_pdf(self, admin_sess):
        # create test patient
        pat_payload = {
            "name": f"TEST_Patient_{uuid.uuid4().hex[:6]}",
            "owner_email": OWNER_EMAIL,
        }
        rp = admin_sess.post(f"{API}/patients", json=pat_payload, timeout=30)
        assert rp.status_code == 200
        pid = rp.json()["patient_id"]

        # create test exercise
        ex_resp = admin_sess.post(f"{API}/exercises", json={
            "name": f"TEST_Ex_{uuid.uuid4().hex[:6]}",
            "category": "Strength",
            "default_duration": "15-30 sec",
        }, timeout=30)
        assert ex_resp.status_code == 200
        ex_id = ex_resp.json()["exercise_id"]

        # create plan
        plan_payload = {
            "patient_id": pid,
            "title": "TEST Plan",
            "items": [{
                "exercise_id": ex_id,
                "sets": 3, "reps": 10,
                "duration": "1-2 min",
                "frequency": "Daily",
                "notes": "",
            }],
        }
        rpl = admin_sess.post(f"{API}/plans", json=plan_payload, timeout=30)
        assert rpl.status_code == 200
        plan_id = rpl.json()["plan_id"]
        assert rpl.json()["items"][0]["duration"] == "1-2 min"

        # GET /plans
        rgp = admin_sess.get(f"{API}/plans?patient_id={pid}", timeout=30)
        assert rgp.status_code == 200
        plans = rgp.json()
        assert any(p["plan_id"] == plan_id and p["items"][0]["duration"] == "1-2 min" for p in plans)

        # PDF
        rpdf = admin_sess.get(f"{API}/plans/{plan_id}/pdf", timeout=60)
        assert rpdf.status_code == 200
        assert rpdf.headers.get("content-type", "").startswith("application/pdf")
        assert len(rpdf.content) > 200

        # cleanup
        admin_sess.delete(f"{API}/plans/{plan_id}", timeout=30)
        admin_sess.delete(f"{API}/exercises/{ex_id}", timeout=30)
        admin_sess.delete(f"{API}/patients/{pid}", timeout=30)
        admin_sess.delete(f"{API}/patients/{pid}/permanent", timeout=30)


# ---------- Patient archive flow ----------
class TestArchiveFlow:
    def _create_patient(self, sess):
        r = sess.post(f"{API}/patients", json={
            "name": f"TEST_Arch_{uuid.uuid4().hex[:6]}",
            "owner_email": OWNER_EMAIL,
        }, timeout=30)
        assert r.status_code == 200
        return r.json()["patient_id"]

    def test_archive_default_excludes(self, admin_sess):
        pid = self._create_patient(admin_sess)
        # archive
        rd = admin_sess.delete(f"{API}/patients/{pid}", timeout=30)
        assert rd.status_code == 200
        assert rd.json().get("archived") is True

        # default list does NOT include
        rl = admin_sess.get(f"{API}/patients", timeout=30)
        assert rl.status_code == 200
        assert not any(p["patient_id"] == pid for p in rl.json())

        # archived=true includes
        ra = admin_sess.get(f"{API}/patients?archived=true", timeout=30)
        assert ra.status_code == 200
        assert any(p["patient_id"] == pid for p in ra.json())

        # archived=all includes
        rall = admin_sess.get(f"{API}/patients?archived=all", timeout=30)
        assert rall.status_code == 200
        assert any(p["patient_id"] == pid for p in rall.json())

        # cleanup
        admin_sess.delete(f"{API}/patients/{pid}/permanent", timeout=30)

    def test_unarchive(self, admin_sess):
        pid = self._create_patient(admin_sess)
        admin_sess.delete(f"{API}/patients/{pid}", timeout=30)
        ru = admin_sess.post(f"{API}/patients/{pid}/unarchive", timeout=30)
        assert ru.status_code == 200
        assert ru.json().get("archived") is False

        rl = admin_sess.get(f"{API}/patients", timeout=30)
        assert any(p["patient_id"] == pid for p in rl.json())

        # cleanup: archive then permanent
        admin_sess.delete(f"{API}/patients/{pid}", timeout=30)
        admin_sess.delete(f"{API}/patients/{pid}/permanent", timeout=30)

    def test_permanent_requires_archived(self, admin_sess):
        pid = self._create_patient(admin_sess)
        # permanent on non-archived -> 400
        r = admin_sess.delete(f"{API}/patients/{pid}/permanent", timeout=30)
        assert r.status_code == 400

        # archive then permanent
        admin_sess.delete(f"{API}/patients/{pid}", timeout=30)
        r2 = admin_sess.delete(f"{API}/patients/{pid}/permanent", timeout=30)
        assert r2.status_code == 200

        # gone from all
        rall = admin_sess.get(f"{API}/patients?archived=all", timeout=30)
        assert not any(p["patient_id"] == pid for p in rall.json())

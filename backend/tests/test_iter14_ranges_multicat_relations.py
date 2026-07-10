"""iter-14 backend tests:
- Free-text range sets/reps on exercises and plan items
- Multi-category exercises with legacy `category` mirroring
- Variations / Progressions arrays
- PDF rendering still works with string ranges
- Migration coerced numeric sets/reps to strings + backfilled categories[]
"""
import os
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
CLINICIAN = {"email": "clinician@rehab.com", "password": "rehab123"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=CLINICIAN, timeout=20)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def created_ids(client):
    """Track ids created in tests for cleanup."""
    ids = {"exercises": [], "patients": [], "plans": []}
    yield ids
    # teardown - delete exercises and plans
    for pid in ids["plans"]:
        try:
            client.delete(f"{BASE_URL}/api/plans/{pid}", timeout=10)
        except Exception:
            pass
    for eid in ids["exercises"]:
        try:
            client.delete(f"{BASE_URL}/api/exercises/{eid}", timeout=10)
        except Exception:
            pass
    for pid in ids["patients"]:
        try:
            client.delete(f"{BASE_URL}/api/patients/{pid}", timeout=10)
            client.delete(f"{BASE_URL}/api/patients/{pid}/permanent", timeout=10)
        except Exception:
            pass


# ---------- Exercises: ranges + multi-category + variations/progressions ----------
class TestExerciseRangesAndMultiCategory:
    def test_create_exercise_with_range_and_multi_category(self, client, created_ids):
        payload = {
            "name": "TEST_Reps_Range_Iter14",
            "categories": ["Strength", "Balance"],
            "default_sets": "3-5",
            "default_reps": "5-10",
            "default_duration": "15-30 sec",
            "variations": [],
            "progressions": [],
        }
        r = client.post(f"{BASE_URL}/api/exercises", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        created_ids["exercises"].append(data["exercise_id"])

        assert data["default_sets"] == "3-5"
        assert data["default_reps"] == "5-10"
        assert isinstance(data["default_sets"], str)
        assert isinstance(data["default_reps"], str)
        assert data["categories"] == ["Strength", "Balance"]
        # legacy mirror
        assert data["category"] == "Strength"
        assert data["default_duration"] == "15-30 sec"
        assert data["variations"] == []
        assert data["progressions"] == []

    def test_create_exercise_coerces_numeric_sets(self, client, created_ids):
        payload = {
            "name": "TEST_Numeric_Coerce_Iter14",
            "categories": ["Strength"],
            "default_sets": 3,   # numeric on purpose
            "default_reps": 12,
            "variations": [],
            "progressions": [],
        }
        r = client.post(f"{BASE_URL}/api/exercises", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        created_ids["exercises"].append(data["exercise_id"])
        assert data["default_sets"] == "3"
        assert data["default_reps"] == "12"
        assert isinstance(data["default_sets"], str)
        assert isinstance(data["default_reps"], str)

    def test_list_exercises_categories_and_string_reps(self, client):
        r = client.get(f"{BASE_URL}/api/exercises", timeout=15)
        assert r.status_code == 200
        docs = r.json()
        assert len(docs) > 0
        missing_cats = [d for d in docs if "categories" not in d or not isinstance(d.get("categories"), list)]
        assert not missing_cats, f"docs missing categories[]: {[d.get('name') for d in missing_cats][:3]}"
        # Migration should have backfilled categories[] from `category` for seeded docs
        for d in docs:
            if d.get("category") and not d.get("categories"):
                pytest.fail(f"Exercise {d.get('name')} has category but no categories[]")
        # Numeric sets/reps should have been coerced to strings on existing docs
        numeric_sets = [d for d in docs if isinstance(d.get("default_sets"), (int, float))]
        numeric_reps = [d for d in docs if isinstance(d.get("default_reps"), (int, float))]
        assert not numeric_sets, f"Numeric default_sets found post-migration: {[d.get('name') for d in numeric_sets][:3]}"
        assert not numeric_reps, f"Numeric default_reps found post-migration: {[d.get('name') for d in numeric_reps][:3]}"

    def test_update_exercise_with_variations_and_progressions(self, client, created_ids):
        # Create base exercise
        r1 = client.post(f"{BASE_URL}/api/exercises", json={
            "name": "TEST_Base_Iter14",
            "categories": ["Strength"],
            "default_sets": "3",
            "default_reps": "10",
            "variations": [],
            "progressions": [],
        }, timeout=15)
        assert r1.status_code == 200
        base = r1.json()
        created_ids["exercises"].append(base["exercise_id"])

        # Create two related exercises
        r2 = client.post(f"{BASE_URL}/api/exercises", json={"name": "TEST_Var_X", "categories": ["Strength"], "default_sets":"3","default_reps":"10"}, timeout=15)
        r3 = client.post(f"{BASE_URL}/api/exercises", json={"name": "TEST_Prog_Z", "categories": ["Strength"], "default_sets":"3","default_reps":"10"}, timeout=15)
        var_id = r2.json()["exercise_id"]; prog_id = r3.json()["exercise_id"]
        created_ids["exercises"].extend([var_id, prog_id])

        # PUT with multi-categories + relations
        upd = {
            "name": base["name"],
            "categories": ["Strength", "Hindlimb"],
            "default_sets": "3-5",
            "default_reps": "8-12",
            "variations": [var_id],
            "progressions": [prog_id],
        }
        r = client.put(f"{BASE_URL}/api/exercises/{base['exercise_id']}", json=upd, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["categories"] == ["Strength", "Hindlimb"]
        assert data["category"] == "Strength"  # mirrored to first
        assert data["variations"] == [var_id]
        assert data["progressions"] == [prog_id]
        assert data["default_sets"] == "3-5"

        # GET to verify persistence
        r = client.get(f"{BASE_URL}/api/exercises", timeout=15)
        doc = next(d for d in r.json() if d["exercise_id"] == base["exercise_id"])
        assert doc["categories"] == ["Strength", "Hindlimb"]
        assert doc["category"] == "Strength"
        assert doc["variations"] == [var_id]
        assert doc["progressions"] == [prog_id]


# ---------- Plans: string sets/reps + PDF ----------
class TestPlanStringRangesAndPdf:
    def test_plan_with_range_sets_reps_persists_and_pdf_renders(self, client, created_ids):
        # Create a patient
        rp = client.post(f"{BASE_URL}/api/patients", json={"name": "TEST_Iter14Pup", "owner_email": "owner@rehab.com"}, timeout=15)
        assert rp.status_code == 200, rp.text
        patient = rp.json()
        created_ids["patients"].append(patient["patient_id"])

        # Reuse any seeded exercise
        ex_list = client.get(f"{BASE_URL}/api/exercises", timeout=15).json()
        assert ex_list, "no exercises available"
        ex_id = ex_list[0]["exercise_id"]

        plan_payload = {
            "patient_id": patient["patient_id"],
            "title": "TEST Iter14 Plan",
            "items": [
                {"exercise_id": ex_id, "sets": "3-5", "reps": "5-10", "duration": "15-30 sec", "frequency": "Daily", "notes": "range test"},
            ],
            "notes": "iter14 plan",
        }
        rpl = client.post(f"{BASE_URL}/api/plans", json=plan_payload, timeout=15)
        assert rpl.status_code == 200, rpl.text
        plan = rpl.json()
        created_ids["plans"].append(plan["plan_id"])
        item = plan["items"][0]
        assert item["sets"] == "3-5"
        assert item["reps"] == "5-10"
        assert isinstance(item["sets"], str) and isinstance(item["reps"], str)

        # GET plans
        rg = client.get(f"{BASE_URL}/api/plans?patient_id={patient['patient_id']}", timeout=15)
        assert rg.status_code == 200
        fetched = next(p for p in rg.json() if p["plan_id"] == plan["plan_id"])
        assert fetched["items"][0]["sets"] == "3-5"
        assert fetched["items"][0]["reps"] == "5-10"

        # PDF render
        rpdf = client.get(f"{BASE_URL}/api/plans/{plan['plan_id']}/pdf", timeout=30)
        assert rpdf.status_code == 200, rpdf.text[:300]
        assert rpdf.headers.get("content-type", "").startswith("application/pdf")
        assert len(rpdf.content) > 200
        assert rpdf.content[:4] == b"%PDF"

    def test_plan_coerces_numeric_sets_reps(self, client, created_ids):
        rp = client.post(f"{BASE_URL}/api/patients", json={"name": "TEST_Iter14Pup2", "owner_email": "owner@rehab.com"}, timeout=15)
        patient = rp.json(); created_ids["patients"].append(patient["patient_id"])
        ex_list = client.get(f"{BASE_URL}/api/exercises", timeout=15).json()
        ex_id = ex_list[0]["exercise_id"]
        payload = {
            "patient_id": patient["patient_id"],
            "title": "TEST coerce",
            "items": [{"exercise_id": ex_id, "sets": 3, "reps": 12, "frequency":"Daily","notes":""}],
        }
        r = client.post(f"{BASE_URL}/api/plans", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        plan = r.json(); created_ids["plans"].append(plan["plan_id"])
        assert plan["items"][0]["sets"] == "3"
        assert plan["items"][0]["reps"] == "12"

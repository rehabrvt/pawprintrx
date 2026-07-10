"""
Iter-13 backend regression tests — category color persistence:
- GET /api/exercises/categories returns items[] each with non-empty `color` (hex).
- 8 canonical categories carry canonical colors after seed.
- POST /api/exercise-categories persists color; omitted color falls back to '#787672'.
- PUT /api/exercise-categories/{id} updates BOTH name & color; PUT with only {name} keeps existing color (no overwrite to empty).
- Non-admin (owner) on POST/PUT returns 403.
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

CANONICAL_COLORS = {
    "Strength": "#C96A52",
    "Neurologic": "#7C6EAE",
    "Posture": "#3F7CAC",
    "Balance": "#D8A14A",
    "Conditioning": "#5B7566",
    "Forelimb": "#B9577A",
    "Hindlimb": "#46998B",
    "Pain Relief": "#2C312E",
}


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


@pytest.fixture(scope="module")
def created_ids():
    """Tracks TEST_ category ids; teardown deletes them at the end of the module."""
    ids = []
    yield ids
    admin = _login(ADMIN_EMAIL, ADMIN_PW)
    for cid in ids:
        try:
            admin.delete(f"{API}/exercise-categories/{cid}", timeout=20)
        except Exception:
            pass


class TestCategoryColorsRead:
    def test_categories_items_have_color(self, admin_sess):
        r = admin_sess.get(f"{API}/exercises/categories", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)
        # Every item must have a non-empty color (hex)
        for it in data["items"]:
            color = it.get("color", "")
            assert isinstance(color, str) and color.startswith("#") and len(color) in (4, 7), \
                f"Bad color on {it.get('name')}: {color!r}"

    def test_canonical_categories_have_canonical_colors(self, admin_sess):
        r = admin_sess.get(f"{API}/exercises/categories", timeout=30)
        assert r.status_code == 200
        items = {it["name"]: it for it in r.json().get("items", [])}
        for name, expected in CANONICAL_COLORS.items():
            assert name in items, f"Canonical category {name!r} missing"
            assert items[name]["color"].lower() == expected.lower(), \
                f"{name}: expected {expected}, got {items[name]['color']}"


class TestCategoryColorsCreate:
    def test_create_with_color_persists(self, admin_sess, created_ids):
        name = f"TEST_Color_{uuid.uuid4().hex[:6]}"
        r = admin_sess.post(
            f"{API}/exercise-categories",
            json={"name": name, "color": "#46998B"},
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        created_ids.append(doc["category_id"])
        assert doc["name"] == name
        assert doc["color"].lower() == "#46998b"

        # Verify persistence via GET
        r2 = admin_sess.get(f"{API}/exercises/categories", timeout=30)
        items = {it["name"]: it for it in r2.json().get("items", [])}
        assert items[name]["color"].lower() == "#46998b"

    def test_create_without_color_falls_back_to_default(self, admin_sess, created_ids):
        name = f"TEST_NoColor_{uuid.uuid4().hex[:6]}"
        r = admin_sess.post(f"{API}/exercise-categories", json={"name": name}, timeout=30)
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        created_ids.append(doc["category_id"])
        assert doc["color"].lower() == "#787672"

    def test_create_empty_color_falls_back_to_default(self, admin_sess, created_ids):
        name = f"TEST_EmptyColor_{uuid.uuid4().hex[:6]}"
        r = admin_sess.post(
            f"{API}/exercise-categories",
            json={"name": name, "color": ""},
            timeout=30,
        )
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        created_ids.append(doc["category_id"])
        assert doc["color"].lower() == "#787672"


class TestCategoryColorsUpdate:
    def test_update_name_and_color_together(self, admin_sess, created_ids):
        # Create
        original = f"TEST_Upd_{uuid.uuid4().hex[:6]}"
        r = admin_sess.post(
            f"{API}/exercise-categories",
            json={"name": original, "color": "#C96A52"},
            timeout=30,
        )
        assert r.status_code in (200, 201)
        cid = r.json()["category_id"]
        created_ids.append(cid)

        new_name = f"TEST_Renamed_{uuid.uuid4().hex[:6]}"
        r2 = admin_sess.put(
            f"{API}/exercise-categories/{cid}",
            json={"name": new_name, "color": "#3F7CAC"},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body.get("name") == new_name
        assert body.get("color", "").lower() == "#3f7cac"
        assert "exercises_migrated" in body

        # Verify via GET
        r3 = admin_sess.get(f"{API}/exercises/categories", timeout=30)
        items = {it["name"]: it for it in r3.json().get("items", [])}
        assert new_name in items
        assert items[new_name]["color"].lower() == "#3f7cac"

    def test_update_only_name_keeps_existing_color(self, admin_sess, created_ids):
        original = f"TEST_KeepColor_{uuid.uuid4().hex[:6]}"
        r = admin_sess.post(
            f"{API}/exercise-categories",
            json={"name": original, "color": "#B9577A"},
            timeout=30,
        )
        assert r.status_code in (200, 201)
        cid = r.json()["category_id"]
        created_ids.append(cid)

        # PUT with ONLY name (color omitted -> None per Pydantic default)
        new_name = f"TEST_NameOnly_{uuid.uuid4().hex[:6]}"
        r2 = admin_sess.put(
            f"{API}/exercise-categories/{cid}",
            json={"name": new_name},
            timeout=30,
        )
        assert r2.status_code == 200, r2.text

        # Verify color is preserved (not overwritten to "")
        r3 = admin_sess.get(f"{API}/exercises/categories", timeout=30)
        items = {it["name"]: it for it in r3.json().get("items", [])}
        assert new_name in items
        assert items[new_name]["color"].lower() == "#b9577a", \
            f"Expected color preserved as #B9577A, got {items[new_name]['color']}"


class TestCategoryNonAdminForbidden:
    def test_owner_create_forbidden(self, owner_sess):
        r = owner_sess.post(
            f"{API}/exercise-categories",
            json={"name": "TEST_NoAccess", "color": "#000000"},
            timeout=30,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

    def test_owner_update_forbidden(self, owner_sess, admin_sess, created_ids):
        # Admin creates one
        r = admin_sess.post(
            f"{API}/exercise-categories",
            json={"name": f"TEST_OwnerPut_{uuid.uuid4().hex[:6]}", "color": "#3F7CAC"},
            timeout=30,
        )
        assert r.status_code in (200, 201)
        cid = r.json()["category_id"]
        created_ids.append(cid)

        # Owner tries to PUT
        r2 = owner_sess.put(
            f"{API}/exercise-categories/{cid}",
            json={"name": "TEST_Hack", "color": "#000000"},
            timeout=30,
        )
        assert r2.status_code == 403, f"expected 403, got {r2.status_code}: {r2.text}"

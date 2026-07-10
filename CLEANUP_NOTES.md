# Cleanup notes: de-platforming from Emergent

This app was generated with Emergent, which wires generated apps to several
Emergent-hosted services that only work inside Emergent's own environment.
Here's everything that was changed so this can run on Render/Vercel/any host.

## 1. File storage (patient photos, owner videos)
**Before**: `backend/server.py` called `https://integrations.emergentagent.com/objstore/...`
using an `EMERGENT_LLM_KEY`. This only works inside Emergent's hosting.

**After**: New `backend/storage.py` module with two backends, selected via
`STORAGE_BACKEND`:
- `local` (default) — saves to disk. Zero config, but most hosts wipe local
  disk on redeploy/restart unless you attach a persistent disk.
- `s3` — saves to any S3-compatible bucket (AWS S3, R2, B2, MinIO). Recommended
  for production. `boto3` was already a dependency, now it's actually used for this.

The function signatures (`put_object`/`get_object`) are unchanged, so no other
code had to change.

## 2. Google sign-in
**Before**: The "Continue with Google" button redirected to
`https://auth.emergentagent.com`, and the backend exchanged a `session_id`
with `https://demobackend.emergentagent.com`. Neither endpoint will authenticate
sessions from an app outside Emergent's platform — this button was effectively
broken for an outside deploy.

**After**: Replaced with a standard Google Identity Services flow:
- Frontend renders Google's own sign-in button (`frontend/src/lib/googleAuth.js`)
  using `REACT_APP_GOOGLE_CLIENT_ID`.
- Backend verifies the resulting ID token directly with Google
  (`POST /api/auth/google`) using `GOOGLE_CLIENT_ID`, via the `google-auth`
  library (already a dependency).
- Issues our own JWT cookies (same as email/password login) instead of a
  separate `session_token`/`user_sessions` mechanism — one auth path instead of two.
- If `GOOGLE_CLIENT_ID` / `REACT_APP_GOOGLE_CLIENT_ID` aren't set, the button
  is simply hidden; email/password login is unaffected either way.
- Removed the now-unused `AuthCallback.jsx` page and the hash-based
  `session_id=` routing special-case in `App.js`/`AuthContext.jsx`.

## 3. CORS
**Before**: `allow_origins=["*"]` combined with `allow_credentials=True`.
Browsers reject this combination outright for cookie-based requests, so
cross-origin auth cookies were not actually reliable.

**After**: `allow_origins` is built from the `FRONTEND_URL` env var (comma-separated
if you have more than one origin, e.g. a preview + prod URL).

## 4. Removed Emergent branding/tracking from `frontend/public/index.html`
- The "Made with Emergent" floating badge.
- A PostHog analytics snippet initialized with an Emergent-owned project key —
  this was sending your app's session/usage data to Emergent's own analytics
  account, not yours. If you want analytics, wire up your own PostHog (or
  other) project key.
- The `<meta name="description">` that read "A product of emergent.sh".
- The `https://assets.emergent.sh/scripts/emergent-main.js` platform script.

## 5. Removed Emergent-only dev dependency
`@emergentbase/visual-edits` was fetched from `https://assets.emergent.sh/...` —
a private tarball URL that may not resolve outside Emergent's build environment.
Removed from `frontend/package.json` and the corresponding wrapper code in
`frontend/craco.config.js` (this dependency was already wrapped in a
try/catch, so it wasn't strictly broken, but it added an external
dependency on Emergent's asset host for no benefit outside their platform).

## 6. Trimmed `backend/requirements.txt`
The original file was Emergent's shared base-image list (~130 packages,
including `openai`, `litellm`, `google-generativeai`, `emergentintegrations`,
`stripe`, etc.) — none of which `server.py`/`ezyvet.py`/`pdf_plan.py`/`sharepoint.py`
actually import. Trimmed to the ~15 packages the code really uses, plus
`boto3` (for S3 storage) and `google-auth` (for Google sign-in). This makes
builds faster and avoids installing large unused ML/LLM libraries.

## 7. Removed Emergent scaffolding files
Deleted: `.emergent/` (build image metadata), `memory/` (Emergent's own
planning notes), `test_reports/` (CI artifacts from Emergent's test runs),
`test_result.md`, `auth_testing.md`, `.gitconfig`. None of these affect the
app; they were Emergent's internal working files.

## What was left alone (legitimate, portable as-is)
- **ezyVet integration** (`backend/ezyvet.py`) — standard OAuth2 client-credentials
  API client, not Emergent-specific. Just needs real `EZYVET_*` credentials.
- **SharePoint/OneDrive integration** (`backend/sharepoint.py`) — standard
  Microsoft Graph app-only auth, already gracefully no-ops if unconfigured.
- **Resend email** calls — a normal third-party API, just needs `RESEND_API_KEY`.

## Before you deploy
- Set a real, random `JWT_SECRET` (don't reuse any example value).
- Change `ADMIN_EMAIL` / `ADMIN_PASSWORD` from their defaults (`clinician@rehab.com` / `rehab123`).
- Decide on `STORAGE_BACKEND` (`local` is fine to try it out; use `s3` before
  you have real users depending on uploaded files surviving).
- See `README.md` for step-by-step Render + Vercel deployment.

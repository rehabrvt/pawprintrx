# PawPrint Rx

Canine rehab plans, exercise library, and progress tracking for clinicians and pet owners.

Full-stack app: **FastAPI + MongoDB** backend, **React (CRA/craco)** frontend, deployed separately.

This app was originally built with [Emergent](https://emergent.sh) and has been de-platformed so
it can run on any host. If you're picking this up after that cleanup, see
`CLEANUP_NOTES.md` for exactly what changed and why.

## Stack

- **Backend**: FastAPI, MongoDB (via Motor), JWT auth, deployed to Render (or any Python host)
- **Frontend**: React + craco + Tailwind + shadcn/ui, deployed to Vercel (or any static host)
- **Optional integrations**: Google sign-in, ezyVet, Microsoft SharePoint/OneDrive, Resend email, S3-compatible file storage

## Local development

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in MONGO_URL, DB_NAME, JWT_SECRET at minimum
uvicorn server:app --reload --port 8000
```

### Frontend
```bash
cd frontend
yarn install
cp .env.example .env   # set REACT_APP_BACKEND_URL=http://localhost:8000
yarn start
```

## Deploying

### 1. Database
Create a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster (or use any MongoDB
instance) and get its connection string for `MONGO_URL`.

### 2. Backend (Render)
1. Push this repo to GitHub.
2. In Render: New -> Web Service -> connect the repo. Root directory: `backend`.
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - Or just use the included `render.yaml` blueprint.
3. Set the environment variables from `backend/.env.example` (at minimum: `MONGO_URL`, `DB_NAME`,
   `JWT_SECRET`, and `FRONTEND_URL` once you know your Vercel URL).
4. Deploy. Note the resulting URL, e.g. `https://pawprintrx-backend.onrender.com`.

**File storage note**: `STORAGE_BACKEND=local` (the default) writes uploaded photos/videos to
disk. Render's default disk is wiped on redeploy/restart unless you attach a persistent disk
(see the commented-out `disk:` block in `render.yaml`). For real production use, set
`STORAGE_BACKEND=s3` and point it at an S3-compatible bucket instead — see `.env.example`.

### 3. Frontend (Vercel)
1. In Vercel: New Project -> import the repo. Root directory: `frontend`.
2. Framework preset: Create React App. Build command `yarn build`, output `build` (already
   configured in `frontend/vercel.json`).
3. Set `REACT_APP_BACKEND_URL` to your Render backend URL from step 2.
4. Deploy. Note the resulting URL, e.g. `https://pawprintrx.vercel.app`.
5. Go back to Render and set `FRONTEND_URL` to this exact URL, then redeploy the backend (CORS
   requires an exact origin match — no wildcards, no trailing slash).

### 4. Google sign-in (optional)
If you want the "Continue with Google" button to work:
1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth
   Client ID (type "Web application"). Add your Vercel URL to "Authorized JavaScript origins".
2. Set `GOOGLE_CLIENT_ID` on the backend and `REACT_APP_GOOGLE_CLIENT_ID` on the frontend to the
   same Client ID.
3. Leave both blank to simply hide the button — email/password login always works.

### 5. First login
A clinician/admin account is auto-created on first backend startup using `ADMIN_EMAIL` /
`ADMIN_PASSWORD` (defaults to `clinician@rehab.com` / `rehab123` if unset — **change these**).

## Optional integrations
All of the following are no-ops if their env vars aren't set — the app works fine without them:
- **Resend** (`RESEND_API_KEY`, etc.) — transactional emails (invites, plan delivery)
- **ezyVet** (`EZYVET_*`) — pulling patient records from ezyVet
- **SharePoint/OneDrive** (`MS_*`, `SP_*`) — archiving owner-uploaded videos

See `backend/.env.example` for the full list of variables.

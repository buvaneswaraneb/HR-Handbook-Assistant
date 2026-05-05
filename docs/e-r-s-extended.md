# ERS Backend — v2 Feature Guide

> This document covers **only the new features added in v2**.  
> For the original employee, skills, experience, project, and team endpoints, refer to `README.md`.

---

## Table of Contents

1. [What Changed in v2](#what-changed-in-v2)
2. [Complete File Structure](#complete-file-structure)
3. [Database Migration](#database-migration)
4. [Feature 1 — Dashboard Analytics API](#feature-1--dashboard-analytics-api)
5. [Feature 2 — Project Progress & Deadlines](#feature-2--project-progress--deadlines)
6. [Feature 3 — Departmental Activity Feed](#feature-3--departmental-activity-feed)
7. [Feature 4 — Search & AI Integration](#feature-4--search--ai-integration)
8. [Feature 5 — Document & Asset Management](#feature-5--document--asset-management)
9. [Pydantic Schemas Reference](#pydantic-schemas-reference)
10. [Frontend Integration Cheatsheet](#frontend-integration-cheatsheet)
11. [Troubleshooting v2](#troubleshooting-v2)

---

## What Changed in v2

### New files (11 total)

| File | Type | Purpose |
|------|------|---------|
| `app/data/migration_v2.sql` | SQL | New tables + triggers + column additions |
| `app/services/e_r_s/analytics_service.py` | Service | Business logic for dashboard metrics |
| `app/services/e_r_s/activity_service.py` | Service | Feed retrieval and manual event logging |
| `app/services/e_r_s/file_service.py` | Service | Upload, link, delete assets via Supabase Storage |
| `app/services/e_r_s/repositories/analytics_repo.py` | Repo | DB queries for counts and skill coverage |
| `app/services/e_r_s/repositories/activity_repo.py` | Repo | DB queries for the activities table |
| `app/services/e_r_s/repositories/file_repo.py` | Repo | DB queries for the files table |
| `app/api/routes/analytics.py` | Router | `GET /analytics/summary` |
| `app/api/routes/activity.py` | Router | `GET /activity/feed`, `POST /activity/feed` |
| `app/api/routes/files.py` | Router | `GET /files`, `POST /files/upload`, `PATCH /files/{id}/link`, `DELETE /files/{id}` |

### Modified files (3 total)

| File | What changed |
|------|-------------|
| `app/api/main.py` | 3 new routers registered |
| `app/services/e_r_s/schemas.py` | New schema classes + updated `ProjectCreate` / `ProjectOut` |
| `app/services/e_r_s/project_service.py` | `days_remaining` computed in `_enrich()` |
| `requirements.txt` | Added `python-multipart` for file upload support |

---

## Complete File Structure

```
backend/
│
├── .env.example                                  ← environment variable template
├── requirements.txt                              ← all Python dependencies
│
└── app/
    │
    ├── api/
    │   ├── __init__.py
    │   ├── main.py                               ← FastAPI app entry point
    │   │                                            registers all 6 routers
    │   └── routes/
    │       ├── __init__.py
    │       ├── employees.py                      ← /employees  (v1)
    │       ├── projects.py                       ← /projects   (v1, updated)
    │       ├── teams.py                          ← /teams      (v1)
    │       ├── analytics.py                      ← /analytics  (v2 NEW)
    │       ├── activity.py                       ← /activity   (v2 NEW)
    │       └── files.py                          ← /files      (v2 NEW)
    │
    ├── data/
    │   ├── schema.sql                            ← original tables (run first)
    │   └── migration_v2.sql                      ← new tables (run second)
    │
    ├── logs/
    │   └── app.log                               ← auto-created on first run
    │
    ├── services/
    │   ├── __init__.py
    │   └── e_r_s/
    │       ├── __init__.py
    │       ├── config.py                         ← loads .env via pydantic-settings
    │       ├── db.py                             ← Supabase client singleton
    │       ├── schemas.py                        ← ALL Pydantic models (v1 + v2)
    │       │
    │       ├── employee_service.py               ← employee business logic (v1)
    │       ├── project_service.py                ← project logic + days_remaining (updated)
    │       ├── tree_service.py                   ← org tree builder (v1)
    │       ├── analytics_service.py              ← dashboard metrics (v2 NEW)
    │       ├── activity_service.py               ← feed get + manual log (v2 NEW)
    │       ├── file_service.py                   ← upload/link/delete assets (v2 NEW)
    │       │
    │       ├── repositories/
    │       │   ├── __init__.py
    │       │   ├── employee_repo.py              ← employee DB queries (v1)
    │       │   ├── project_repo.py               ← project DB queries (v1)
    │       │   ├── skill_repo.py                 ← skill get-or-create (v1)
    │       │   ├── analytics_repo.py             ← counts + skill coverage (v2 NEW)
    │       │   ├── activity_repo.py              ← feed queries (v2 NEW)
    │       │   └── file_repo.py                  ← file CRUD queries (v2 NEW)
    │       │
    │       └── utils/
    │           ├── __init__.py
    │           └── serializer.py                 ← shapes DB rows into API output (v1)
    │
    └── test/
        └── __init__.py
```

---

## Database Migration

### Step 1 — Run original schema (if not done already)
Paste `app/data/schema.sql` into **Supabase → SQL Editor** and run it.

### Step 2 — Run v2 migration
Paste `app/data/migration_v2.sql` into **Supabase → SQL Editor** and run it.

This migration is **idempotent** — safe to re-run. It uses `IF NOT EXISTS` and `DO $$ IF NOT EXISTS` guards throughout.

### What the migration creates

#### New table: `required_skills`
Defines how many employees per department need a given skill. Used by the analytics radar chart to show "Required vs Actual" coverage.

```sql
required_skills
├── id           UUID (PK, auto)
├── department   TEXT          -- e.g. "Engineering", "Design", "HR"
├── skill_id     UUID → skills(id)
├── min_level    SMALLINT 1–5  -- minimum proficiency required
└── head_count   INT           -- how many people are needed with this skill
```

Example rows to seed manually:
```sql
INSERT INTO required_skills (department, skill_id, head_count)
SELECT 'Engineering', id, 5 FROM skills WHERE name = 'Python';

INSERT INTO required_skills (department, skill_id, head_count)
SELECT 'Design', id, 3 FROM skills WHERE name = 'Figma';
```

#### New table: `activities`
The departmental event feed. **Automatically populated by Postgres triggers** — you do not need to write to it manually for employee joins or file uploads.

```sql
activities
├── id           UUID (PK, auto)
├── event_type   TEXT    -- 'employee_joined' | 'project_milestone' | 'file_uploaded' | 'skill_added'
├── department   TEXT    -- "Engineering" | "Design" | "HR" | null = global
├── actor_id     UUID → employees(id)
├── entity_type  TEXT    -- 'employee' | 'project' | 'file'
├── entity_id    UUID    -- loose reference to the relevant record
├── title        TEXT    -- short display text for the feed card
├── description  TEXT
├── metadata     JSONB   -- flexible payload for frontend extras
└── created_at   TIMESTAMPTZ (auto)
```

**Automatic triggers:**
- `trg_log_employee_join` — fires on every `INSERT INTO employees`, logs `employee_joined`
- `trg_log_file_upload` — fires on every `INSERT INTO files`, logs `file_uploaded`

#### New table: `files`
Stores metadata for uploaded assets. The actual binary lives in Supabase Storage; this table stores the reference path.

```sql
files
├── id            UUID (PK, auto)
├── filename      TEXT          -- original filename
├── storage_path  TEXT          -- path inside Supabase Storage bucket "assets"
├── mime_type     TEXT
├── size_bytes    BIGINT
├── project_id    UUID → projects(id)
├── department    TEXT          -- links file into department feed
├── uploaded_by   UUID → employees(id)
├── description   TEXT
└── created_at    TIMESTAMPTZ (auto)
```

#### Modified table: `projects`
Two new columns added safely with `ALTER TABLE ... IF NOT EXISTS`:

```sql
projects
├── ...existing columns...
├── percent_complete  SMALLINT 0–100   DEFAULT 0
└── status            TEXT             DEFAULT 'active'
                      -- allowed: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled'
```

### Supabase Storage bucket setup (for file uploads)
In your Supabase dashboard:
1. Go to **Storage** in the left sidebar
2. Click **New bucket**
3. Name it exactly `assets`
4. Choose public or private depending on your frontend needs
5. Click **Create bucket**

This only needs to be done once.

---

## Feature 1 — Dashboard Analytics API

### `GET /analytics/summary`

Returns all data needed to populate the Bento Metrics Grid and Skill Coverage Radar Chart in one request.

**No query parameters.**

**Response:**
```json
{
  "total_employees": 42,
  "active_projects": 7,
  "on_leave": 5,
  "available": 37,
  "skill_coverage": [
    {
      "skill_name": "Figma",
      "required": 3,
      "actual": 2
    },
    {
      "skill_name": "Python",
      "required": 5,
      "actual": 8
    },
    {
      "skill_name": "React",
      "required": 4,
      "actual": 4
    }
  ]
}
```

**Field reference:**

| Field | Source | Description |
|-------|--------|-------------|
| `total_employees` | COUNT of `employees` table | All employees regardless of status |
| `active_projects` | COUNT of `projects` WHERE `status = 'active'` | Projects currently running |
| `on_leave` | employees WHERE `availability = false` | Currently unavailable count |
| `available` | employees WHERE `availability = true` | Currently available count |
| `skill_coverage` | Join of `required_skills` + `employee_skills` | One entry per unique skill name |
| `skill_coverage[].required` | SUM of `head_count` in `required_skills` | Target headcount with this skill |
| `skill_coverage[].actual` | COUNT of rows in `employee_skills` | Employees who actually have it |

**How the Radar Chart maps to this:**
Feed `skill_coverage` directly as two data series — `required` and `actual` — keyed by `skill_name`. Skills with `actual < required` are your coverage gaps.

**Test:**
```bash
curl http://localhost:8000/analytics/summary
```

---

## Feature 2 — Project Progress & Deadlines

### Updated: `GET /projects` and `GET /projects/{id}`

Both endpoints now return two additional computed/stored fields:

**New fields in `ProjectOut`:**

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `percent_complete` | `int` 0–100 | Stored in DB | Set manually when creating or updating a project |
| `status` | `string` | Stored in DB | One of: `planning`, `active`, `on_hold`, `completed`, `cancelled` |
| `days_remaining` | `int` or `null` | Computed at runtime | `end_date - today`. Negative means overdue. `null` if no `end_date` set |

**`days_remaining` logic** (in `project_service.py`):
```python
days_remaining = (end_date - date.today()).days
```
- Positive → project is upcoming or in progress
- Zero → deadline is today
- Negative → project is overdue
- `null` → no `end_date` was set on the project

**Example response:**
```json
{
  "id": "abc-123",
  "project_name": "Client Portal",
  "status": "active",
  "percent_complete": 85,
  "start_date": "2025-01-01",
  "end_date": "2025-08-31",
  "days_remaining": 117,
  "team": [...]
}
```

### Updated: `POST /projects`

`ProjectCreate` now accepts two new optional fields:

```json
{
  "project_name": "Client Portal",
  "client_name": "Acme Corp",
  "start_date": "2025-01-01",
  "end_date": "2025-08-31",
  "percent_complete": 85,
  "status": "active"
}
```

**Validation:**
- `percent_complete` must be between `0` and `100`
- `status` must be one of: `planning`, `active`, `on_hold`, `completed`, `cancelled`

**Test:**
```bash
curl http://localhost:8000/projects
```

---

## Feature 3 — Departmental Activity Feed

### `GET /activity/feed`

Returns recent activity events ordered newest-first. Automatically populated by DB triggers — no manual writes needed for employee joins and file uploads.

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `department` | string | No | Filter to one department. Omit for global feed |
| `limit` | int | No | Max records to return. Default: `20`. Max: `100` |

**Examples:**
```bash
# Global feed — all departments
curl "http://localhost:8000/activity/feed"

# Engineering department only
curl "http://localhost:8000/activity/feed?department=Engineering"

# Design feed, last 5 items
curl "http://localhost:8000/activity/feed?department=Design&limit=5"
```

**Response:**
```json
[
  {
    "id": "uuid-...",
    "event_type": "employee_joined",
    "department": "Engineering",
    "actor_id": "emp-uuid-...",
    "entity_type": "employee",
    "entity_id": "emp-uuid-...",
    "title": "Arun Kumar joined as Backend Developer",
    "description": null,
    "metadata": {},
    "created_at": "2025-05-04T10:30:00Z"
  },
  {
    "id": "uuid-...",
    "event_type": "file_uploaded",
    "department": "Design",
    "actor_id": "emp-uuid-...",
    "entity_type": "file",
    "entity_id": "file-uuid-...",
    "title": "File uploaded: brand-assets-v3.zip",
    "description": "Q3 brand refresh package",
    "metadata": {},
    "created_at": "2025-05-04T09:15:00Z"
  }
]
```

**Standard `event_type` values:**

| Value | Trigger | When |
|-------|---------|------|
| `employee_joined` | Automatic (DB trigger) | New employee created |
| `file_uploaded` | Automatic (DB trigger) | New file uploaded |
| `project_milestone` | Manual via `POST /activity/feed` | When you log a milestone |
| `skill_added` | Manual via `POST /activity/feed` | When you want to surface a skill update |

---

### `POST /activity/feed`

Manually log a custom event — for project milestones, announcements, or any event the automatic triggers don't cover.

**Request body:**
```json
{
  "event_type": "project_milestone",
  "department": "Engineering",
  "actor_id": "emp-uuid-...",
  "entity_type": "project",
  "entity_id": "project-uuid-...",
  "title": "API v2 shipped to staging",
  "description": "All 14 new endpoints deployed and tested",
  "metadata": {
    "sprint": 12,
    "environment": "staging"
  }
}
```

**All fields except `event_type` and `title` are optional.**

**Response `201`:** The created activity object.

**Test:**
```bash
curl -X POST http://localhost:8000/activity/feed \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "project_milestone",
    "department": "Engineering",
    "title": "Sprint 12 completed"
  }'
```

---

## Feature 4 — Search & AI Integration

These features use **existing endpoints** from v1. No new code was needed — this section explains how to wire them correctly.

### Top search bar → `GET /employees/search`

Maps the frontend "Search resources..." input to the search endpoint.

**Supported query parameters:**

| UI Filter | API Parameter | Example |
|-----------|---------------|---------|
| Team dropdown | `team` | `?team=Engineering` |
| Role dropdown | `role` | `?role=Backend+Developer` |
| Skill tag | `skill` | `?skill=Python` |
| Availability toggle | `availability` | `?availability=true` |
| Minimum rating | `min_rating` | `?min_rating=4.0` |

**Combined search example:**
```bash
curl "http://localhost:8000/employees/search?team=Engineering&skill=Python&availability=true"
```

Returns the same enriched employee object as `GET /employees/{id}` (with nested skills, experience, projects).

### AI Assistant sidebar → `POST /query`

The "Osmium AI Assistant" link should call the RAG query endpoint defined in the separate RAG service (`services/rag/query.py`).

**Request:**
```json
{
  "question": "Who on the Engineering team has React experience and is currently available?"
}
```

**Response:**
```json
{
  "answer": "Based on the documents, Arun Kumar and Priya Singh are available...",
  "sources": [
    { "file": "team-overview.pdf", "page": 2, "chunk_id": "abc-123" }
  ],
  "context_preview": [
    { "text": "Arun Kumar – React (level 4), currently available...", "file": "team-overview.pdf", "page": 2 }
  ]
}
```

> The RAG system must have documents ingested via `POST /ingest` before `/query` will return meaningful answers. See the RAG README for setup.

---

## Feature 5 — Document & Asset Management

### `GET /files`

List uploaded files. Can be filtered by project or department.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `project_id` | UUID | Return only files linked to this project |
| `department` | string | Return only files tagged to this department |

**Examples:**
```bash
# All files
curl "http://localhost:8000/files"

# Files linked to a specific project
curl "http://localhost:8000/files?project_id=abc-123"

# Design department assets only
curl "http://localhost:8000/files?department=Design"
```

**Response:**
```json
[
  {
    "id": "file-uuid-...",
    "filename": "brand-assets-v3.zip",
    "storage_path": "Design/a1b2c3d4-....zip",
    "mime_type": "application/zip",
    "size_bytes": 4823041,
    "project_id": null,
    "department": "Design",
    "uploaded_by": "emp-uuid-...",
    "description": "Q3 brand refresh package",
    "created_at": "2025-05-04T09:15:00Z"
  }
]
```

---

### `POST /files/upload`

Upload a file to Supabase Storage. Uses `multipart/form-data`.

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | ✅ | The binary file to upload |
| `project_id` | string (UUID) | No | Link to a project |
| `department` | string | No | e.g. `Design`, `Engineering`, `HR` |
| `uploaded_by` | string (UUID) | No | Employee UUID who is uploading |
| `description` | string | No | Short description of the asset |

**curl example:**
```bash
curl -X POST http://localhost:8000/files/upload \
  -F "file=@brand-assets-v3.zip" \
  -F "department=Design" \
  -F "description=Q3 brand refresh package" \
  -F "uploaded_by=emp-uuid-..."
```

**JavaScript fetch example:**
```javascript
const form = new FormData();
form.append("file", fileInput.files[0]);
form.append("department", "Design");
form.append("description", "Q3 brand refresh package");

const res = await fetch("/files/upload", { method: "POST", body: form });
const data = await res.json();
```

**Response `201`:** The created file metadata record (same shape as `GET /files` items).

**What happens internally:**
1. File binary is uploaded to Supabase Storage bucket `assets` at path `{department}/{uuid}.{ext}`
2. Metadata record is inserted into the `files` table
3. DB trigger `trg_log_file_upload` fires → entry appears in `GET /activity/feed` automatically

---

### `PATCH /files/{file_id}/link`

Link an already-uploaded file to a project or department after the fact. Useful when the project isn't known at upload time.

**Request body:**
```json
{
  "project_id": "project-uuid-...",
  "department": "Engineering",
  "description": "Updated description"
}
```

All fields are optional — only provided fields are updated.

**Test:**
```bash
curl -X PATCH http://localhost:8000/files/file-uuid-.../link \
  -H "Content-Type: application/json" \
  -d '{"project_id": "project-uuid-...", "department": "Engineering"}'
```

---

### `DELETE /files/{file_id}`

Deletes the file record from the database **and** removes the binary from Supabase Storage.

**Response:** `204 No Content`

**Test:**
```bash
curl -X DELETE http://localhost:8000/files/file-uuid-...
```

> If the Storage delete fails (e.g. file was already removed manually), the DB record is still deleted and a warning is logged. The endpoint does not return an error in this case.

---

## Pydantic Schemas Reference

All schemas live in `app/services/e_r_s/schemas.py`.

### v2 New Schemas

#### `SkillCoverageItem`
```python
skill_name: str
required:   int    # from required_skills table
actual:     int    # from employee_skills table
```

#### `AnalyticsSummary`
```python
total_employees: int
active_projects: int
on_leave:        int
available:       int
skill_coverage:  List[SkillCoverageItem]
```

#### `ActivityCreate` (POST body)
```python
event_type:  str            # required
title:       str            # required
department:  str | None
actor_id:    UUID | None
entity_type: str | None     # 'employee' | 'project' | 'file'
entity_id:   UUID | None
description: str | None
metadata:    dict | None    # any JSON
```

#### `ActivityOut` (GET response)
Same as `ActivityCreate` plus:
```python
id:         UUID
created_at: datetime
```

#### `FileOut` (GET response)
```python
id:           UUID
filename:     str
storage_path: str
mime_type:    str | None
size_bytes:   int | None
project_id:   UUID | None
department:   str | None
uploaded_by:  UUID | None
description:  str | None
created_at:   datetime | None
```

#### `FileLinkRequest` (PATCH body)
```python
project_id:  UUID | None
department:  str | None
description: str | None
```

### v2 Updated Schemas

#### `ProjectCreate` (new optional fields)
```python
# existing fields unchanged, new additions:
percent_complete: int | None    # 0–100
status:           str | None    # 'planning'|'active'|'on_hold'|'completed'|'cancelled'
```

#### `ProjectOut` (new fields in response)
```python
# existing fields unchanged, new additions:
percent_complete: int           # default 0
status:           str           # default 'active'
days_remaining:   int | None    # computed: end_date - today. Negative = overdue
```

---

## Frontend Integration Cheatsheet

```
┌─────────────────────────────────────────────────────────────────┐
│  UI Component              →  API Call                          │
├─────────────────────────────────────────────────────────────────┤
│  Bento Metrics Grid        →  GET /analytics/summary            │
│  Skill Radar Chart         →  GET /analytics/summary            │
│                               → use skill_coverage[]            │
│  Critical Deadlines        →  GET /projects                     │
│                               → use percent_complete,           │
│                                   days_remaining, status        │
│  Activity Feed (all)       →  GET /activity/feed                │
│  Activity Feed (dept)      →  GET /activity/feed?department=X   │
│  Log milestone             →  POST /activity/feed               │
│  Asset list (Design)       →  GET /files?department=Design      │
│  Asset upload              →  POST /files/upload (multipart)    │
│  Link asset to project     →  PATCH /files/{id}/link            │
│  Delete asset              →  DELETE /files/{id}                │
│  Top search bar            →  GET /employees/search?skill=X     │
│                                   &team=Y&availability=true     │
│  AI Assistant sidebar      →  POST /query { "question": "..." } │
└─────────────────────────────────────────────────────────────────┘
```

### Response shape quick reference

```
GET /analytics/summary
→ { total_employees, active_projects, on_leave, available, skill_coverage[] }

GET /activity/feed
→ [{ id, event_type, department, title, description, metadata, created_at }]

GET /projects
→ [{ id, project_name, status, percent_complete, days_remaining, end_date, team[] }]

GET /files
→ [{ id, filename, storage_path, mime_type, size_bytes, project_id, department }]

POST /files/upload   (multipart/form-data)
→ { id, filename, storage_path, ... }

POST /query
→ { answer, sources[], context_preview[] }

GET /employees/search
→ [{ id, name, role, team, availability, skills[], projects[], ... }]
```

---

## Troubleshooting v2

### `GET /analytics/summary` returns empty `skill_coverage`

The `required_skills` table is empty — it has no seed data by default.
Populate it manually in Supabase SQL Editor:

```sql
-- First check what skills exist
SELECT id, name FROM skills;

-- Then insert required skill targets
INSERT INTO required_skills (department, skill_id, head_count)
SELECT 'Engineering', id, 5 FROM skills WHERE name = 'Python';

INSERT INTO required_skills (department, skill_id, head_count)
SELECT 'Design', id, 3 FROM skills WHERE name = 'Figma';
```

`skill_coverage` will then show both `required` and `actual` counts.

---

### `POST /files/upload` returns `500 Upload failed`

Most likely the Supabase Storage bucket `assets` does not exist.
Go to **Supabase → Storage → New bucket** and create it with the name `assets`.

If the bucket exists but upload still fails, check that your `SUPABASE_KEY` in `.env` is the **service-role key** (not the anon key). The service-role key bypasses RLS and has write access to Storage.

---

### `GET /activity/feed` returns an empty array after adding employees

Check that the trigger `trg_log_employee_join` was created by verifying in Supabase:

```sql
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table = 'employees';
```

If it's missing, re-run `migration_v2.sql`.

---

### `days_remaining` is `null` on all projects

The project was created without an `end_date`. Update it:

```bash
curl -X PUT http://localhost:8000/projects/{id} \
  -H "Content-Type: application/json" \
  -d '{"end_date": "2025-12-31"}'
```

---

### `422 Unprocessable Entity` on `POST /projects`

Check:
- `percent_complete` is between `0` and `100`
- `status` is exactly one of: `planning`, `active`, `on_hold`, `completed`, `cancelled`

---

### `python-multipart` not installed error on file upload

```bash
pip install python-multipart
```

Or reinstall all requirements:

```bash
pip install -r requirements.txt
```

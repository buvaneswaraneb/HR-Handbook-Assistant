# ERS — Employee & Resource System

Production-grade FastAPI backend for employee, skills, experience, and project management, backed by **Supabase PostgreSQL**.

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Tech Stack](#tech-stack)
3. [Setup & Running](#setup--running)
4. [Environment Variables](#environment-variables)
5. [Database Setup](#database-setup)
6. [API Reference](#api-reference)
   - [Health](#health)
   - [Employees](#employees)
   - [Skills](#skills)
   - [Experience](#experience)
   - [Teams](#teams)
   - [Projects](#projects)
   - [Bulk Upload](#bulk-upload)
   - [Search](#search)
7. [Request & Response Examples](#request--response-examples)
8. [Architecture Decisions](#architecture-decisions)
9. [Future Extensibility](#future-extensibility)
10. [Troubleshooting](#troubleshooting)

---

## Project Structure

```
backend/
├── .env.example                        ← copy to .env and fill values
├── requirements.txt
└── app/
    ├── api/
    │   ├── __init__.py
    │   ├── main.py                     ← FastAPI entrypoint (thin)
    │   └── routes/
    │       ├── __init__.py
    │       ├── employees.py            ← /employees endpoints
    │       ├── projects.py             ← /projects endpoints
    │       └── teams.py                ← /teams endpoints
    ├── data/
    │   └── schema.sql                  ← run once in Supabase SQL editor
    ├── logs/
    │   └── app.log                     ← auto-created on first run
    ├── services/
    │   ├── __init__.py
    │   └── e_r_s/
    │       ├── __init__.py
    │       ├── config.py               ← reads .env via pydantic-settings
    │       ├── db.py                   ← Supabase client singleton
    │       ├── schemas.py              ← all Pydantic request/response models
    │       ├── employee_service.py     ← business logic for employees
    │       ├── project_service.py      ← business logic for projects
    │       ├── tree_service.py         ← recursive team tree builder
    │       ├── repositories/
    │       │   ├── __init__.py
    │       │   ├── employee_repo.py    ← all employee DB queries
    │       │   ├── project_repo.py     ← all project DB queries
    │       │   └── skill_repo.py       ← skill get-or-create logic
    │       └── utils/
    │           ├── __init__.py
    │           └── serializer.py       ← shapes raw DB rows into API output
    └── test/
        └── __init__.py
```

---

## Tech Stack

| Layer       | Library                  | Purpose                          |
|-------------|--------------------------|----------------------------------|
| Framework   | FastAPI 0.111+           | REST API                         |
| Validation  | Pydantic v2              | Schema validation                |
| Config      | pydantic-settings        | `.env` loading                   |
| Database    | Supabase (PostgreSQL)    | Cloud-hosted relational DB       |
| DB Client   | supabase-py 2.x          | Python SDK for Supabase          |
| Server      | Uvicorn                  | ASGI server                      |
| Logging     | Python stdlib logging    | File + stdout logs               |

---

## Setup & Running

### 1. Clone / navigate to backend

```bash
cd backend
```

### 2. Create virtual environment

```bash
python -m venv venv

# Mac/Linux
source venv/bin/activate

# Windows
venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment

```bash
cp .env.example .env
# Edit .env with your Supabase URL and service-role key
```

### 5. Set up the database

Copy the contents of `app/data/schema.sql` and run it in your **Supabase SQL Editor** (Project → SQL Editor → New query).

### 6. Start the server

```bash
# Run from inside the backend/ directory
uvicorn app.api.main:app --reload
```

Server starts at: `http://localhost:8000`  
Interactive docs: `http://localhost:8000/docs`  
OpenAPI JSON: `http://localhost:8000/openapi.json`

---

## Environment Variables

Create a `.env` file in `backend/`:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-service-role-secret-key
LOG_LEVEL=INFO
```

| Variable       | Required | Description                                      |
|----------------|----------|--------------------------------------------------|
| `SUPABASE_URL` | ✅       | Found in Supabase → Settings → API              |
| `SUPABASE_KEY` | ✅       | Service-role key (bypasses RLS) — keep secret   |
| `LOG_LEVEL`    | ❌       | Default: `INFO`. Options: `DEBUG`, `WARNING`    |

> ⚠️ Never commit `.env` to git. Add it to `.gitignore`.

---

## Database Setup

Run `app/data/schema.sql` once in Supabase. It creates:

| Table                | Purpose                                      |
|----------------------|----------------------------------------------|
| `employees`          | Core employee profiles                       |
| `skills`             | Master skill catalogue                       |
| `employee_skills`    | Employee ↔ skill junction with level/years  |
| `experiences`        | Work history per employee                    |
| `projects`           | Project records                              |
| `project_assignments`| Employee ↔ project junction with role       |

### Key design choices
- All IDs are **UUID** (auto-generated by Postgres via `gen_random_uuid()`)
- `employees.manager_id` is a **self-referencing FK** (supports org hierarchy)
- `employee_skills` has a **unique constraint** on `(employee_id, skill_id)` — prevents duplicates, allows upsert
- `project_assignments` has a **unique constraint** on `(project_id, employee_id)`
- `updated_at` is auto-maintained via Postgres triggers

### Indexes created
```
employees:           manager_id, team, role, rating, availability
employee_skills:     skill_id
experiences:         employee_id
project_assignments: project_id, employee_id
```

---

## API Reference

Base URL: `http://localhost:8000`

### Health

| Method | Path      | Description       |
|--------|-----------|-------------------|
| GET    | `/health` | Server health check |

```bash
curl http://localhost:8000/health
# {"status": "ok"}
```

---

### Employees

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| GET    | `/employees`                      | List all employees (with nested data) |
| POST   | `/employees`                      | Create a new employee              |
| GET    | `/employees/{id}`                 | Get one employee by ID             |
| PUT    | `/employees/{id}`                 | Full update of employee            |
| PATCH  | `/employees/{id}/availability`    | Toggle availability only           |
| GET    | `/employees/search`               | Search/filter employees            |
| POST   | `/employees/bulk-upload`          | Bulk create employees              |

---

### Skills

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| POST   | `/employees/{id}/skills`          | Add a skill to an employee         |
| PUT    | `/employees/{id}/skills/{skill_id}` | Update a specific skill           |

---

### Experience

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| POST   | `/employees/{id}/experience`      | Add a work experience entry        |

---

### Teams

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| GET    | `/teams/{manager_id}/tree`        | Recursive org tree from manager    |

---

### Projects

| Method | Path                              | Description                        |
|--------|-----------------------------------|------------------------------------|
| GET    | `/projects`                       | List all projects                  |
| POST   | `/projects`                       | Create a new project               |
| GET    | `/projects/{id}`                  | Get project with team              |
| POST   | `/projects/{id}/assign`           | Assign an employee to a project    |
| GET    | `/projects/{id}/team`             | Get project team list              |

---

### Bulk Upload

| Method | Path                       | Description                              |
|--------|----------------------------|------------------------------------------|
| POST   | `/employees/bulk-upload`   | Insert multiple employees in one request |

Returns HTTP `207 Multi-Status` with a split result of successes and failures — partial failures don't abort the whole batch.

---

### Search

`GET /employees/search` supports these query parameters:

| Param          | Type    | Example              |
|----------------|---------|----------------------|
| `team`         | string  | `?team=Platform`     |
| `role`         | string  | `?role=Backend+Developer` |
| `skill`        | string  | `?skill=Python`      |
| `availability` | boolean | `?availability=true` |
| `min_rating`   | float   | `?min_rating=4.0`    |

Parameters can be combined:
```
/employees/search?team=Platform&skill=Python&availability=true
```

---

## Request & Response Examples

### POST /employees

**Request:**
```json
{
  "name": "Arun Kumar",
  "email": "arun@example.com",
  "role": "Backend Developer",
  "team": "Platform",
  "manager_id": null,
  "linkedin_url": "https://linkedin.com/in/arun",
  "rating": 4.3,
  "total_experience_years": 4.5,
  "availability": true,
  "project_joined_date": "2025-01-10",
  "project_end_date": "2025-12-31",
  "work_start_time": "09:00:00",
  "work_end_time": "18:00:00"
}
```

**Response `201`:**
```json
{
  "id": "3f7b1c2a-...",
  "name": "Arun Kumar",
  "email": "arun@example.com",
  "role": "Backend Developer",
  "team": "Platform",
  "manager_id": null,
  "linkedin_url": "https://linkedin.com/in/arun",
  "rating": 4.3,
  "total_experience_years": 4.5,
  "availability": true,
  "project_joined_date": "2025-01-10",
  "project_end_date": "2025-12-31",
  "work_start_time": "09:00:00",
  "work_end_time": "18:00:00",
  "created_at": "2025-05-04T10:00:00Z",
  "updated_at": "2025-05-04T10:00:00Z",
  "skills": [],
  "experience": [],
  "projects": []
}
```

---

### POST /employees/{id}/skills

**Request:**
```json
{
  "skill_name": "Python",
  "skill_level": 5,
  "experience_years_with_skill": 4.0,
  "notes": "Primary language"
}
```

> `skill_name` is resolved automatically — the skill is created in the `skills` table if it doesn't exist yet.

---

### POST /employees/{id}/experience

**Request:**
```json
{
  "company_name": "Infosys",
  "job_title": "Software Engineer",
  "start_date": "2021-01-01",
  "end_date": "2023-03-31",
  "description": "Built microservices for banking clients"
}
```

---

### GET /employees/{id} — Full Profile

**Response:**
```json
{
  "id": "3f7b1c2a-...",
  "name": "Arun Kumar",
  "email": "arun@example.com",
  "role": "Backend Developer",
  "team": "Platform",
  "manager_id": "9a2c3d1e-...",
  "linkedin_url": "https://linkedin.com/in/arun",
  "rating": 4.3,
  "total_experience_years": 4.5,
  "availability": true,
  "project_joined_date": "2025-01-10",
  "project_end_date": "2025-12-31",
  "work_start_time": "09:00:00",
  "work_end_time": "18:00:00",
  "skills": [
    {
      "skill_id": "b1c2d3e4-...",
      "skill_name": "Python",
      "skill_level": 5,
      "experience_years_with_skill": 4.0,
      "notes": "Primary language"
    }
  ],
  "experience": [
    {
      "id": "e1f2g3h4-...",
      "company_name": "Infosys",
      "job_title": "Software Engineer",
      "start_date": "2021-01-01",
      "end_date": "2023-03-31",
      "description": "Built microservices for banking clients"
    }
  ],
  "projects": [
    {
      "project_id": "p1q2r3s4-...",
      "project_name": "Client Portal",
      "role_in_project": "Team Lead"
    }
  ]
}
```

---

### GET /teams/{manager_id}/tree

**Response:**
```json
{
  "id": "9a2c3d1e-...",
  "name": "Priya Sharma",
  "role": "Engineering Manager",
  "team": "Platform",
  "availability": true,
  "reports": [
    {
      "id": "b3c4d5e6-...",
      "name": "Rahul Singh",
      "role": "Team Lead",
      "team": "Platform",
      "availability": true,
      "reports": [
        {
          "id": "3f7b1c2a-...",
          "name": "Arun Kumar",
          "role": "Backend Developer",
          "team": "Platform",
          "availability": true,
          "reports": []
        }
      ]
    }
  ]
}
```

---

### POST /projects

**Request:**
```json
{
  "project_name": "Client Portal",
  "client_name": "Acme Corp",
  "client_email": "pm@acme.com",
  "project_description": "Internal employee portal",
  "start_date": "2025-01-01",
  "end_date": "2025-12-31"
}
```

---

### POST /projects/{id}/assign

**Request:**
```json
{
  "employee_id": "3f7b1c2a-...",
  "role_in_project": "team_lead"
}
```

Supported `role_in_project` values: `manager`, `team_lead`, `member`, `hr`

---

### POST /employees/bulk-upload

**Request:**
```json
[
  {
    "name": "Arun Kumar",
    "email": "arun@example.com",
    "role": "Backend Developer",
    "team": "Platform",
    "availability": true,
    "skills": [
      { "skill_name": "Python", "skill_level": 5 }
    ],
    "experience": [
      {
        "company_name": "Infosys",
        "job_title": "Engineer",
        "start_date": "2021-01-01",
        "end_date": "2023-03-31"
      }
    ]
  },
  {
    "name": "Bad Record",
    "email": "duplicate@example.com",
    "role": "Designer"
  }
]
```

**Response `207`:**
```json
{
  "success": ["3f7b1c2a-..."],
  "failed": [
    {
      "email": "duplicate@example.com",
      "error": "duplicate key value violates unique constraint"
    }
  ]
}
```

---

### PATCH /employees/{id}/availability

**Request:**
```json
{ "availability": false }
```

---

## Architecture Decisions

### Layered architecture

```
Router  →  Service  →  Repository  →  Supabase DB
  ↑           ↑             ↑
(HTTP)   (business      (SQL queries
         logic)          only)
```

- **Routers** (`api/routes/`) — HTTP boundary only. Parse requests, call services, return responses.
- **Services** (`e_r_s/*_service.py`) — Business logic. Orchestrate repositories. Handle enrichment.
- **Repositories** (`e_r_s/repositories/`) — All DB queries in one place. No business logic.
- **Schemas** (`e_r_s/schemas.py`) — Single source of truth for all Pydantic models.
- **Serializer** (`e_r_s/utils/serializer.py`) — Shapes raw Supabase rows into clean API output.

### Skill resolution
When adding a skill to an employee, you pass `skill_name` (a string). The service calls `skill_repo.get_or_create()` which finds the skill in the master `skills` table or inserts it. This means:
- No manual skill ID management for callers
- Skill names are normalised at the DB level
- Duplicate skills are prevented

### Upsert pattern
Both `employee_skills` and `project_assignments` use upsert (`ON CONFLICT DO UPDATE`) so re-adding the same skill or re-assigning the same employee just updates the record rather than throwing a 400.

### Team tree
`tree_service.get_team_tree()` is recursive with a `max_depth=5` guard to prevent runaway queries on malformed org hierarchies. Each level calls `get_direct_reports()` which is a simple indexed query on `manager_id`.

---

## Future Extensibility

The schema and service layer are designed so these features can be added without breaking changes:

| Feature                        | How to add                                                                   |
|-------------------------------|------------------------------------------------------------------------------|
| Replacement suggestions        | Query `employees` by `team + role + availability=true` when someone is off  |
| Skill graph                    | `employee_skills` already has all edges — expose a `/skills/graph` endpoint |
| Workload balancing             | Add `workload_percent` column to `project_assignments`                       |
| AI project matching            | Embed skill vectors; query by cosine similarity via pgvector extension       |
| Availability calendar          | Add `employee_leaves` table with date ranges                                 |
| Team org chart                 | `GET /teams/{id}/tree` already returns the recursive tree — feed to D3.js   |
| Role-level auth                | Add `auth_role` column to employees; use Supabase JWT + RLS policies         |
| Audit log                      | Add a Postgres trigger writing to an `audit_log` table on every UPDATE       |

---

## Troubleshooting

### `SUPABASE_KEY` / `SUPABASE_URL` not found
Make sure `.env` exists inside `backend/` (not the project root) and the server is started from inside `backend/`.

### `ModuleNotFoundError: No module named 'app'`
You must run uvicorn **from inside `backend/`**:
```bash
cd backend
uvicorn app.api.main:app --reload
```

### `postgrest.exceptions.APIError: duplicate key`
- For employees: the email already exists — use PUT to update or check before inserting.
- For skills: safe to retry — the upsert pattern handles this.

### Supabase returns empty data but no error
Check that you ran `schema.sql` in the correct Supabase project and that `SUPABASE_URL` points to the same project.

### Logs not appearing
Logs are written to `backend/app/logs/app.log`. The directory is created automatically on first start. Check file permissions if it's missing.

### `422 Unprocessable Entity`
Pydantic validation failed. Check:
- `rating` is between 0–5
- `skill_level` is between 1–5
- `email` is a valid email format
- `manager_id` is a valid UUID (or `null`)
- Dates are in `YYYY-MM-DD` format
- Times are in `HH:MM:SS` format

# ERS API Reference

**Base URL:** `http://localhost:8000`  
**API Version:** 1.0.0 + v2 extensions

This document is a compact REST reference for the ERS (Employee & Resource System) backend. The original employee/project/team APIs are defined in the main README, while the v2 analytics, activity, and files APIs are described in the v2 feature guide. fileciteturn1file1 fileciteturn1file2

---

## 1) Health & Status

### `GET /`
Returns a simple greeting to confirm the API is running.

**Response**
```json
"hello welcome to PRJ006"
```

### `GET /health`
Returns basic server status.

**Response**
```json
{
  "status": "ok"
}
```

---

## 1a) Authentication (Supabase OAuth)

Authentication uses Supabase OAuth with Google. Frontend handles Google login flow; backend validates JWT tokens.

**OAuth Flow**
1. Frontend initiates Google OAuth via Supabase
2. User logs in with Google
3. Supabase redirects to frontend with JWT token
4. Frontend stores token and uses it for API calls
5. Backend validates token in `Authorization: Bearer {token}` header

**See [BACKEND_OAUTH_SETUP.md](BACKEND_OAUTH_SETUP.md) for detailed setup and configuration.**

### `GET /auth/callback`
OAuth callback reference endpoint (handled by frontend).

**Response**
```json
{
  "message": "OAuth callback handled by frontend. Use /auth/me to get user profile."
}
```

### `GET /auth/me`
Get current authenticated user's profile.

**Headers**
```
Authorization: Bearer {supabase_jwt_token}
```

**Response**
```json
{
  "user_id": "uuid",
  "email": "arun@example.com",
  "first_name": "Arun",
  "last_name": "Kumar",
  "employee_id": "uuid or null",
  "google_oauth_connected": false,
  "google_email": null,
  "is_active": true,
  "created_at": "2025-05-06T10:00:00",
  "updated_at": "2025-05-06T10:00:00"
}
```

### `POST /auth/link-employee`
Link authenticated user to an employee record (sets workplace context).

**Headers**
```
Authorization: Bearer {supabase_jwt_token}
Content-Type: application/json
```

**Request**
```json
{
  "employee_id": "uuid"
}
```

**Response**
```json
{
  "message": "User linked to employee",
  "profile": { ... }
}
```

### `GET /auth/workspace`
Get current user's workplace/team/department context.

**Headers**
```
Authorization: Bearer {supabase_jwt_token}
```

**Response**
```json
{
  "employee_id": "uuid",
  "name": "Arun Kumar",
  "role": "Backend Developer",
  "workplace": "Platform",
  "department": "Platform",
  "manager_id": "uuid or null"
}
```

### `GET /auth/team`
Get all employees in current user's team/workplace.

**Headers**
```
Authorization: Bearer {supabase_jwt_token}
```

**Response**
```json
{
  "team": [
    {
      "id": "uuid",
      "name": "Priya Sharma",
      "email": "priya@example.com",
      "role": "Engineering Manager",
      "team": "Platform",
      "availability": true
    }
  ],
  "count": 5
}
```


### `GET /calendar/email`
Get the current user's Google Calendar email.

**Headers**
```
Authorization: Bearer {access_token}
```

**Response**
```json
{
  "email": "arun.kumar@gmail.com"
}
```

### `GET /calendar/credentials`
Check if Google OAuth is connected (token info).

**Headers**
```
Authorization: Bearer {access_token}
```

**Response**
```json
{
  "connected": true,
  "email": "arun@example.com",
  "expires_at": "2025-05-15T10:30:00"
}
```

### `POST /calendar/sync`
Trigger calendar sync for the current user.

**Headers**
```
Authorization: Bearer {access_token}
```

**Response**
```json
{
  "message": "Calendar sync initiated",
  "user_id": "uuid",
  "calendar_email": "arun.kumar@gmail.com",
  "synced_at": "2025-05-06T10:30:00"
}
```

### `GET /calendar/events`
Get calendar events for the current user.

**Headers**
```
Authorization: Bearer {access_token}
```

**Query params**
- `date` (optional): ISO date string (e.g., 2025-05-06)

**Response**
```json
{
  "user_id": "uuid",
  "calendar_email": "arun.kumar@gmail.com",
  "date": "2025-05-06",
  "events": [],
  "message": "Calendar sync integration in progress."
}
```

---

## 2) Employees

### `GET /employees`
Returns all employees with nested skills, experience, and project data.

**Response shape**
```json
{
  "employees": [
    {
      "id": "uuid",
      "name": "Arun Kumar",
      "email": "arun@example.com",
      "role": "Backend Developer",
      "team": "Platform",
      "manager_id": "uuid or null",
      "linkedin_url": "https://linkedin.com/in/arun",
      "rating": 4.3,
      "total_experience_years": 4.5,
      "availability": true,
      "project_joined_date": "2025-01-10",
      "project_end_date": "2025-12-31",
      "work_start_time": "09:00:00",
      "work_end_time": "18:00:00",
      "skills": [],
      "experience": [],
      "projects": []
    }
  ]
}
```

### `POST /employees`
Creates a new employee profile.

**Request**
```json
{
  "name": "Arun Kumar",
  "email": "arun@example.com",
  "role": "Backend Developer",
  "team": "Platform",
  "manager_id": null,
  "team_lead_id": null,
  "linkedin_url": "https://linkedin.com/in/arun",
  "rating": 4.3,
  "total_experience_years": 4.5,
  "availability": true,
  "project_joined_date": "2025-01-10",
  "project_end_date": "2025-12-31",
  "work_start_time": "09:00:00",
  "work_end_time": "18:00:00",
  "google_calendar_email": "arun.calendar@example.com",
  "google_calendar_sync_enabled": true
}
```

**Response**
```json
{
  "id": "uuid",
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
  "skills": [],
  "experience": [],
  "projects": []
}
```

### `GET /employees/{id}`
Returns one employee profile with nested data.

### `PUT /employees/{id}`
Updates employee details.

### `PATCH /employees/{id}/availability`
Updates only availability.

**Request**
```json
{
  "availability": false
}
```

### `GET /employees/search`
Search employees by filters.

**Query params**
- `team`
- `role`
- `skill`
- `availability`
- `min_rating`

**Example**
```text
/employees/search?team=Platform&skill=Python&availability=true
```

### `POST /employees/bulk-upload`
Inserts multiple employee records in one request.

**Request**
```json
[
  {
    "name": "Arun Kumar",
    "email": "arun@example.com",
    "role": "Backend Developer",
    "team": "Platform",
    "availability": true
  }
]
```

**Typical response**
```json
{
  "success": ["uuid"],
  "failed": []
}
```

---

## 3) Skills

### `POST /employees/{id}/skills`
Adds a skill to an employee.

**Request**
```json
{
  "skill_name": "Python",
  "skill_level": 5,
  "experience_years_with_skill": 4.0,
  "notes": "Primary language"
}
```

### `PUT /employees/{id}/skills/{skill_id}`
Updates one employee skill entry.

---

## 4) Experience

### `POST /employees/{id}/experience`
Adds a work experience entry.

**Request**
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

## 5) Teams

### `GET /teams/{manager_id}/tree`
Returns the recursive org tree starting from a manager.

**Response**
```json
{
  "id": "uuid",
  "name": "Priya Sharma",
  "role": "Engineering Manager",
  "team": "Platform",
  "availability": true,
  "reports": [
    {
      "id": "uuid",
      "name": "Rahul Singh",
      "role": "Team Lead",
      "team": "Platform",
      "availability": true,
      "reports": []
    }
  ]
}
```

---

## 6) Projects

### `GET /projects`
Lists all projects.

### `POST /projects`
Creates a new project.

**Request**
```json
{
  "project_name": "Client Portal",
  "client_name": "Acme Corp",
  "client_email": "pm@acme.com",
  "project_description": "Internal employee portal",
  "start_date": "2025-01-01",
  "end_date": "2025-12-31",
  "required_skills": ["Python", "FastAPI"],
  "required_roles": ["backend", "frontend"],
  "manager_id": null,
  "team_lead_id": null,
  "team_member_ids": []
}
```

### `GET /projects/{id}`
Returns project details plus assigned team.

### `PUT /projects/{id}`
Updates project metadata, including required skills, required roles, and assignment references.

**Request**
```json
{
  "project_description": "Updated delivery scope with new API features",
  "required_skills": ["Python", "SQL", "Supabase"],
  "required_roles": ["team_lead", "member"],
  "manager_id": "uuid",
  "team_lead_id": "uuid",
  "team_member_ids": ["uuid", "uuid"]
}
```

### `POST /projects/{id}/assign`
Assigns an employee to a project.

**Request**
```json
{
  "employee_id": "uuid",
  "role_in_project": "team_lead"
}
```

**Allowed roles**
- `manager`
- `team_lead`
- `member`
- `hr`

### `GET /projects/{id}/team`
Returns the team list for a project.

---

## 7) v2 Analytics

### `GET /analytics/summary`
Returns dashboard metrics and skill coverage.

**Response**
```json
{
  "total_employees": 42,
  "active_projects": 7,
  "on_leave": 5,
  "available": 37,
  "skill_coverage": [
    {
      "skill_name": "Python",
      "required": 5,
      "actual": 8
    }
  ]
}
```

---

## 8) v2 Activity Feed

### `GET /activity/feed`
Returns recent activity items.

**Query params**
- `department` (optional)
- `limit` (optional)

**Response**
```json
[
  {
    "id": "uuid",
    "event_type": "employee_joined",
    "department": "Engineering",
    "actor_id": "uuid",
    "entity_type": "employee",
    "entity_id": "uuid",
    "title": "Arun Kumar joined as Backend Developer",
    "description": null,
    "metadata": {},
    "created_at": "2025-05-04T10:30:00Z"
  }
]
```

### `POST /activity/feed`
Creates a custom activity item.

**Request**
```json
{
  "event_type": "project_milestone",
  "department": "Engineering",
  "actor_id": "uuid",
  "entity_type": "project",
  "entity_id": "uuid",
  "title": "API v2 shipped to staging",
  "description": "All new endpoints deployed",
  "metadata": {
    "sprint": 12,
    "environment": "staging"
  }
}
```

---

## 9) v2 Files

### `GET /files`
Lists uploaded files.

**Query params**
- `project_id`
- `department`

### `POST /files/upload`
Uploads a file using `multipart/form-data`.

**Form fields**
- `file`
- `project_id`
- `department`
- `uploaded_by`
- `description`

### `PATCH /files/{file_id}/link`
Links an uploaded file to a project or department.

**Request**
```json
{
  "project_id": "uuid",
  "department": "Engineering",
  "description": "Updated description"
}
```

### `DELETE /files/{file_id}`
Deletes the file metadata and removes the binary from Supabase Storage.

---

## 10) Leave Management

### `GET /leave`
Get leave records with calendar heatmap.

**Query params**
- `start_date` (optional): ISO date
- `end_date` (optional): ISO date

**Response**
```json
{
  "total_members": 50,
  "on_leave_count": 5,
  "leave_people": [
    {
      "employee_id": "uuid",
      "name": "Arun Kumar",
      "role": "Backend Developer",
      "team": "Platform",
      "start_date": "2025-05-06",
      "end_date": "2025-05-10",
      "leave_type": "leave",
      "status": "approved",
      "notes": "Personal leave"
    }
  ],
  "calendar": [
    {
      "date": "2025-05-06",
      "count": 5,
      "percent": 10.0,
      "status": "yellow"
    }
  ]
}
```

### `POST /leave`
Create a new leave record.

**Request**
```json
{
  "employee_id": "uuid",
  "start_date": "2025-05-06",
  "end_date": "2025-05-10",
  "leave_type": "leave",
  "status": "approved",
  "notes": "Personal leave"
}
```

---

## 11) Query / RAG

### `POST /query`
Asks a natural-language question against ingested documents.

**Request**
```json
{
  "question": "What is the health insurance policy?"
}
```

**Response**
```json
{
  "answer": "According to the HR policies document...",
  "sources": [
    {
      "file": "hr_policies.pdf",
      "page": 5,
      "chunk_id": "chunk_42"
    }
  ],
  "context_preview": [
    {
      "text": "Health Insurance: The company provides...",
      "file": "hr_policies.pdf",
      "page": 5
    }
  ]
}
```

---

## 12) Typical Flow

1. Upload document
2. Ingest document
3. Check ingestion status
4. Query the ingested content

**Example**
```bash
curl -X POST "http://localhost:8000/upload" -F "file=@employee_handbook.pdf"
curl -X POST "http://localhost:8000/ingest"
curl -X GET "http://localhost:8000/ingest/status"
curl -X POST "http://localhost:8000/query" -H "Content-Type: application/json" -d '{"question":"What is the vacation policy?"}'
```

---

## 13) Notes

- Employee and project APIs are backed by Supabase PostgreSQL. fileciteturn1file1
- v2 adds analytics, activity, and file management endpoints. fileciteturn1file2
- The RAG endpoints support upload, ingestion, status, and query over PDFs. fileciteturn1file0

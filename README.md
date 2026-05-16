# Osmium

Osmium is an AI focused employee management workspace for HR teams, managers, and project leads. It brings employee records, team structure, projects, leave, files, calendar signals, and workspace AI into one calm operational dashboard.

The product is designed for teams that need a practical place to answer questions like:

- Who is available for a new project?
- Which projects need attention this week?
- Who is currently on leave?
- Which skills exist across the team?
- What documents or policies support this decision?

## Main Features

### Secure Workspace Access

- Sign in with Google or employee email.
- Supabase-backed authentication and email verification.
- User profile area with session identity and logout.
- Protected workspace experience for employee and project data.
- Custom verification email template in `frontend/osmium/email.html`.

### Dashboard

- High-level workspace metrics for employees, live projects, availability, assignments, leave, and completed work.
- Upcoming deadline cards for project tracking.
- Google Calendar integration for nearby events.
- Quick actions for adding employees, creating projects, opening the canvas, and launching AI.
- Leave heatmap preview for spotting absence pressure.

### Employee Management

- Employee directory with searchable profile cards.
- Filters for skill, team, availability, and rating.
- Add and edit employee records with name, email, role, team, experience, work hours, skills, rating, profile photo, and availability.
- Track detailed skills with levels and years of experience.
- Assign employees to projects as manager, team lead, or member.
- Draft protection when closing an unfinished employee form.

### Project Management

- Project cards for client work, internal initiatives, and planning.
- Track project name, client, client email, start date, end date, manager, team lead, status, progress, description, skills, roles, and members.
- Supported statuses include Active, Planning, On Hold, and Completed.
- AI helpers for summarizing project descriptions, generating required skills, and suggesting needed roles.
- Edit and delete projects with confirmation for destructive actions.
- Draft protection when closing an unfinished project form.

### Canvas Planning

- Visual planning surface for employees and projects.
- Drag employees and projects into a canvas workspace.
- Pan, zoom, reset, fit to screen, snap to grid, and arrange nodes.
- Connect employees to projects with assignment roles.
- Inspect selected employees or projects without leaving the canvas.
- AI-assisted project assignment based on skills, availability, and staffing needs.

### Org Tree

- Visual team structure for understanding reporting and staffing relationships.
- Team and employee hierarchy views.
- AI-oriented staffing lens for availability, overloaded managers, project risk, and capacity signals.

### Files

- Upload and manage HR, engineering, design, and workspace documents.
- Drag-and-drop or browse-based uploads.
- Add department and description metadata.
- Filter, download, and delete files.
- Cloudinary-backed file storage support.

### Leave Management

- Add leave for existing employees or manually entered names.
- Track start date, end date, duration, and leave type.
- Supported leave types: Annual Leave, Sick Leave, and Unpaid Leave.
- Full leave heatmap for understanding absence patterns across the year.
- Active and upcoming leave list.

### AI Assistant

- Full-page AI chat for HR, employee, project, document, and workspace questions.
- Attach files to a chat and ask questions about them.
- Conversation history with reopen, continue, delete, and new chat actions.
- Mini Workspace AI available across the app for quick questions about employees, availability, leave, deadlines, assignments, and dashboard summaries.

### Settings

- Theme options: Dark, Light, and System.
- Canvas preferences for snap to grid, edge labels, and node animation.
- Reset canvas layout.
- Activity notification controls.
- Clear local cache when fresh workspace data is needed.

## User Guide

### 1. Sign In

Open Osmium and sign in with Google or your employee email. New users may need to verify their email before entering the workspace.

### 2. Start From the Dashboard

Use the Dashboard to understand the current state of the team. Review total employees, active projects, availability, leave pressure, completed work, upcoming deadlines, and calendar events.

### 3. Add Employees

Go to Employees or use the top-bar quick action. Add the employee's name, email, role, team, rating, experience, work hours, skills, photo URL, and availability. Use skills and availability carefully because project staffing and AI answers depend on them.

### 4. Create Projects

Go to Projects or select New Project from the dashboard. Add client details, dates, status, progress, description, required skills, needed roles, manager, team lead, and members. Use the AI field helpers when you want a faster first draft of the project description, skill list, or role list.

### 5. Plan Work on the Canvas

Open Canvas to visually arrange employees and projects. Add nodes from the side panel, connect employees to project nodes, assign roles, and use the inspector to review details. Use fit-to-screen or reset when the layout gets crowded.

### 6. Review Team Structure

Open Org Tree to understand team hierarchy and staffing relationships. Use it when checking reporting structure, project coverage, or team-level capacity.

### 7. Track Leave

Open Leave to add absences and review upcoming time away. The heatmap helps identify periods where team capacity may be lower.

### 8. Manage Files

Open Files to upload documents and resources. Add department metadata so files are easier to filter later. Uploaded files can support AI-assisted HR and workspace questions.

### 9. Ask AI

Use the full AI Assistant for deeper questions and document-backed conversations. Use Mini Workspace AI for quick questions while staying on the current page, such as "Who is available right now for a project?" or "Summarize the dashboard."

### 10. Adjust Preferences

Open Settings to change theme, canvas behavior, notifications, or clear locally cached data.

## Navigation Map

| Area | Purpose |
| --- | --- |
| Dashboard | Workspace metrics, deadlines, calendar, quick actions, and leave preview |
| Canvas | Visual employee-project planning and assignment connections |
| Org Tree | Team structure and staffing hierarchy |
| Employees | Employee directory, filters, profiles, skills, and availability |
| Projects | Project planning, staffing, status, progress, skills, and roles |
| Files | Document upload, filtering, download, and deletion |
| AI Assistant | Full chat workspace with history and document support |
| Leave | Absence tracking, heatmap, and upcoming leave |
| Settings | Theme, canvas preferences, notifications, and cache controls |

## Tech Stack

- Frontend: static HTML, CSS, and JavaScript modules in `frontend/osmium`.
- Backend: FastAPI in `backend/app/api`.
- Auth and data: Supabase.
- File storage: Cloudinary.
- AI: Groq-compatible OpenAI-style chat endpoints plus local document retrieval.
- Search and retrieval: sentence transformers, FAISS, and PDF ingestion.
- Deployment: GitHub Pages for the static frontend and Docker/FastAPI for the backend.

## Project Structure

```text
.
|-- backend/
|   `-- app/
|       |-- api/                 # FastAPI entry point and route modules
|       |-- data/                # Schema and cached source documents
|       `-- services/            # ERS, RAG, ingestion, file, and calendar services
|-- docs/                        # Feature, setup, OAuth, Docker, and API docs
|-- frontend/
|   `-- osmium/
|       |-- index.html           # Main app shell
|       |-- landing.html         # Public landing page
|       |-- email.html           # Supabase verification email template
|       |-- modules/             # Frontend feature modules
|       |-- styles/              # App styling
|       `-- utils/               # Shared frontend state and helpers
|-- requirements.txt             # Python dependencies
|-- Dockerfile                   # Backend container image
`-- README.md
```

## Local Setup

### 1. Create Environment Variables

Create a root `.env` file. Do not commit real secrets.

```env
SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_ANON_KEY=
SUPABASE_JWT_SECRET=
GROQ_API_KEY=
GROQ_MODEL=llama-3.1-8b-instant
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=hr-assistant
FRONTEND_URL=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
```

### 2. Install Backend Dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Run the Backend

```bash
PYTHONPATH=backend uvicorn app.api.main:app --reload
```

The API runs at:

```text
http://localhost:8000
```

Health check:

```bash
curl http://localhost:8000/health
```

### 4. Open the Frontend

The frontend is static. Open one of these files in a browser:

- `frontend/osmium/landing.html` for the public landing page.
- `frontend/osmium/index.html` for the app workspace.

For GitHub Pages, the workflow copies `landing.html` as the public `index.html` and keeps the app available as `app.html`.

## Docker

Run the backend with Docker Compose:

```bash
docker compose up --build
```

Stop it:

```bash
docker compose down
```

More details are available in `docs/DOCKER.md`.

## Supabase Email Template

The verification email HTML is stored at:

```text
frontend/osmium/email.html
```

Paste it into:

```text
Supabase Dashboard -> Authentication -> Email Templates -> Confirm signup -> Body
```

Suggested subject:

```text
Verify your email for Osmium
```

Keep this Supabase variable unchanged inside the email template:

```html
{{ .ConfirmationURL }}
```

## Documentation

- `docs/FEATURES.md` for the feature index.
- `docs/features/` for detailed feature guides.
- `docs/DOCKER.md` for container setup.
- `docs/SUPABASE_OAUTH.md` and `docs/BACKEND_OAUTH_SETUP.md` for auth setup.
- `docs/AI_README.md` for AI and document assistant notes.
- `docs/ERS_API_Reference.md` for backend API reference.

## Recommended First Workflow

1. Sign in.
2. Add employees with skills and availability.
3. Create projects with required skills and roles.
4. Assign managers, team leads, and members.
5. Use Canvas to visualize staffing.
6. Add leave records.
7. Ask Mini Workspace AI for availability and project summaries.

## Status

Osmium is an active HR assistant and employee resource workspace. The app combines operational HR records with AI-assisted search, planning, and team insight.

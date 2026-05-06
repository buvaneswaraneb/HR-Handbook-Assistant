# Backend OAuth Setup Guide — Supabase + Google

This guide explains how the backend is configured to work with Supabase OAuth and handle workspace/workplace logic.

---

## Architecture

```
Frontend (React/Vue)
   ↓
Supabase OAuth Flow
   ↓
Google Login (Supabase handles this)
   ↓
Google redirects to Supabase callback:
https://PROJECT.supabase.co/auth/v1/callback
   ↓
Supabase creates session + JWT token
   ↓
Supabase redirects to frontend:
http://localhost:3000/auth/callback
   ↓
Frontend stores JWT token
   ↓
Frontend calls backend APIs with:
Authorization: Bearer {jwt_token}
```

---

## Backend Components

### 1. Auth Middleware (`auth_middleware.py`)

Validates Supabase JWT tokens:
- Extracts token from `Authorization: Bearer` header
- Verifies token signature using `SUPABASE_JWT_SECRET`
- Returns user info: `user_id` (sub), `email`, and raw token

```python
middleware = get_auth_middleware()
user = middleware.get_user_from_token(token)
# Returns: {"user_id": "uuid", "email": "user@example.com", "raw_token": {...}}
```

### 2. Supabase Auth Service (`supabase_auth_service.py`)

Handles user lifecycle and workspace logic:
- `get_or_create_user_from_supabase()` — Creates user record on first login
- `link_user_to_employee()` — Links user to employee profile (team/department context)
- `get_user_workspace()` — Returns workplace/team/department info
- `get_user_workspace_team()` — Returns all employees in user's team

### 3. Routes (`supabase_auth.py`)

Protected endpoints (require Supabase JWT):

#### `GET /auth/me`
Get current user's profile with employee and workplace context.

```bash
curl -H "Authorization: Bearer {token}" http://localhost:8000/auth/me
```

Response:
```json
{
  "user_id": "uuid",
  "email": "arun@example.com",
  "first_name": "Arun",
  "last_name": "Kumar",
  "employee_id": "uuid or null",
  "google_oauth_connected": false,
  "is_active": true
}
```

#### `POST /auth/link-employee`
Link authenticated user to an employee record (creates workplace context).

```bash
curl -X POST \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"employee_id": "emp-uuid"}' \
  http://localhost:8000/auth/link-employee
```

#### `GET /auth/workspace`
Get user's workplace/team/department info.

```bash
curl -H "Authorization: Bearer {token}" http://localhost:8000/auth/workspace
```

Response:
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

#### `GET /auth/team`
Get all employees in user's team.

```bash
curl -H "Authorization: Bearer {token}" http://localhost:8000/auth/team
```

Response:
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

---

## Setup Steps

### 1. Environment Variables

Create a `.env` file in the `backend/` directory:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret  # Found in Supabase dashboard > Settings > API

# Frontend
FRONTEND_URL=http://localhost:3000
```

Get these values from Supabase dashboard:
- **SUPABASE_URL**: Settings > API
- **SUPABASE_KEY**: Settings > API > Public (anon)
- **SUPABASE_JWT_SECRET**: Settings > API > JWT Secret

### 2. Database Migrations

Run the migration in Supabase SQL editor:

```sql
-- migration_v4_auth_users.sql
-- (already created in backend/app/data/)
```

This creates:
- `users` table
- `sessions` table (optional, for backup)
- `google_oauth_credentials` table
- Adds columns to `employees` table

### 3. Supabase OAuth Configuration

In Supabase dashboard:

1. Go to **Authentication > Providers > Google**
2. Enable Google provider
3. Add Google OAuth credentials:
   - Client ID
   - Client Secret
4. Set redirect URL to your frontend callback:
   - `http://localhost:3000/auth/callback` (development)
   - `https://yourdomain.com/auth/callback` (production)

### 4. Frontend Integration

Frontend should:
1. Use Supabase client library
2. Initiate Google OAuth: `signInWithOAuth({ provider: 'google' })`
3. Store JWT token after redirect
4. Pass token in `Authorization: Bearer {token}` header for API calls

---

## Workflow Example

### New User (First Login)

1. Frontend initiates Google login
2. User logs in with Google
3. Supabase creates user and session
4. Frontend gets JWT token
5. Frontend calls `GET /auth/me` with token
6. Backend creates user record in DB
7. Frontend shows "Link to employee?" prompt
8. User selects employee from dropdown
9. Frontend calls `POST /auth/link-employee` with employee_id
10. Backend links user to employee
11. User can now access team/workplace context

### Existing User (Subsequent Logins)

1. Frontend gets JWT token from Supabase
2. Frontend calls `GET /auth/me`
3. Backend returns profile with employee_id and workspace
4. User logged in with full context

---

## Testing

```bash
# 1. Get a valid JWT from Supabase (manual login or test token)
TOKEN="your-jwt-token"

# 2. Test /auth/me
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/auth/me

# 3. Get workspace info
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/auth/workspace

# 4. Get team members
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/auth/team
```

---

## Multi-User / Multi-Workspace Support

Since each user links to an employee record, the system naturally supports:

- **Multiple users per workspace**: All employees in same `team` are grouped together
- **Cross-workspace queries**: Filter by employee.team
- **User-specific context**: Calendar, availability, projects tied to employee_id

Example:
- User A links to "Arun Kumar" (Platform team)
- User B links to "Priya Sharma" (Platform team)
- Both users can see each other via `/auth/team`
- Each user's calendar context is their own employee record

---

## Security Notes

- JWT token is validated on every request
- Token expiry is checked (Supabase handles this)
- No passwords stored in our DB (Supabase Auth handles passwords)
- OAuth credentials stored securely in Supabase
- Employee linking can only be done by authenticated users

---

## Next Steps

1. Implement frontend OAuth UI (Supabase client library)
2. Add Google Calendar API integration (fetch events, sync)
3. Add employee self-assignment workflow
4. Implement role-based access control (RBAC)
5. Add audit logging for OAuth events

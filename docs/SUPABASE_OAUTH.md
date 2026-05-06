# Supabase OAuth Implementation Summary

## Overview

The backend now supports **Supabase OAuth with Google** instead of manual email/password authentication.

### Key Changes

1. **Authentication Flow**: Frontend uses Supabase client to handle Google OAuth
   - User logs in with Google
   - Supabase returns JWT token
   - Frontend sends token with API requests

2. **Backend Validation**: `auth_middleware.py` validates JWT tokens
   - Extracts token from `Authorization: Bearer` header
   - Verifies signature using `SUPABASE_JWT_SECRET`
   - Returns user info from token

3. **Workspace Logic**: Users link to employees to get workplace context
   - `POST /auth/link-employee` — Associates user with employee
   - `GET /auth/workspace` — Gets user's team/department
   - `GET /auth/team` — Gets all team members

---

## Files Created/Modified

### New Files
- `backend/app/services/e_r_s/auth_middleware.py` — JWT token validation
- `backend/app/services/e_r_s/supabase_auth_service.py` — User/workspace logic
- `backend/app/api/routes/supabase_auth.py` — OAuth endpoints
- `backend/app/data/migration_v4_auth_users.sql` — Auth tables
- `docs/BACKEND_OAUTH_SETUP.md` — Setup guide
- `.env.example` — Environment variables template

### Modified Files
- `backend/app/api/main.py` — Register supabase_auth router
- `backend/app/api/routes/calendar.py` — Use Supabase auth middleware
- `docs/ERS_API_Reference.md` — Document OAuth endpoints

---

## Environment Variables

Add to `.env`:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret
FRONTEND_URL=http://localhost:3000
```

---

## Database Migrations

Run in Supabase SQL editor:
```sql
-- migration_v4_auth_users.sql (already created)
```

Creates tables:
- `users` — User profiles linked to employees
- `sessions` — Backup session tracking
- `google_oauth_credentials` — OAuth token storage

---

## API Endpoints

All endpoints use `Authorization: Bearer {jwt_token}` header.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/me` | GET | Get current user profile |
| `/auth/link-employee` | POST | Link user to employee |
| `/auth/workspace` | GET | Get user's workplace context |
| `/auth/team` | GET | Get team members |
| `/calendar/email` | GET | Get user's calendar email |
| `/calendar/sync` | POST | Sync calendar |
| `/calendar/events` | GET | Get calendar events |

---

## Multi-User Support

Each user can:
- Link to an employee record
- See their team's members
- Access their workspace context
- Have personal calendar settings

Example:
- User "arun@example.com" links to employee "Arun Kumar"
- User "priya@example.com" links to employee "Priya Sharma"
- Both in "Platform" team → both can see each other via `/auth/team`

---

## Frontend Integration

Frontend should:
1. Use Supabase client library: `@supabase/supabase-js`
2. Call `signInWithOAuth({ provider: 'google' })`
3. Store JWT token in localStorage
4. Send token in all API requests: `Authorization: Bearer {token}`

Example (React):
```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Login
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: 'http://localhost:3000/auth/callback' }
});

// Get token
const { data: session } = await supabase.auth.getSession();
const token = session?.access_token;

// Call backend
const response = await fetch('http://localhost:8000/auth/me', {
  headers: { Authorization: `Bearer ${token}` }
});
```

---

## Next Steps

1. ✅ Backend OAuth framework complete
2. ⏳ Frontend OAuth UI (handled by frontend team)
3. ⏳ Google Calendar API integration
4. ⏳ Role-based access control (RBAC)
5. ⏳ Employee self-service linking UI

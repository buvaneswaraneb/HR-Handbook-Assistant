-- MIGRATION: User authentication (email/password + Google OAuth)
-- Run in Supabase SQL editor after migration_v3_assignments_leave_calendar.sql.

-- Create users table (links to employees)
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT,  -- NULL if using only OAuth
    first_name      TEXT,
    last_name       TEXT,
    employee_id     UUID REFERENCES employees(id) ON DELETE CASCADE,
    is_active       BOOLEAN DEFAULT TRUE,
    email_verified  BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);

-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token    TEXT NOT NULL UNIQUE,
    refresh_token   TEXT,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_access_token ON sessions(access_token);

-- Create google_oauth_credentials table
CREATE TABLE IF NOT EXISTS google_oauth_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    google_id       TEXT UNIQUE NOT NULL,
    email           TEXT NOT NULL,
    access_token    TEXT,
    refresh_token   TEXT,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_user_id ON google_oauth_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_google_oauth_google_id ON google_oauth_credentials(google_id);

-- Add google_access_token and google_refresh_token to employees for calendar sync
ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS google_access_token TEXT,
    ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;

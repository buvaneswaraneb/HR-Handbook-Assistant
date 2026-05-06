-- MIGRATION: Assignments, leave management, Google Calendar sync fields
-- Run in Supabase SQL editor after migration_v2.sql.

ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS team_lead_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS google_calendar_email TEXT,
    ADD COLUMN IF NOT EXISTS google_calendar_sync_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS google_calendar_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_employees_team_lead ON employees(team_lead_id);
CREATE INDEX IF NOT EXISTS idx_employees_google_calendar ON employees(google_calendar_sync_enabled);

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS required_skills TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS required_roles TEXT[] DEFAULT '{}';

CREATE TABLE IF NOT EXISTS leave_records (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    leave_type  TEXT DEFAULT 'leave',
    status      TEXT DEFAULT 'approved',
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_employee ON leave_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave_records(start_date, end_date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_one_manager
    ON project_assignments(project_id)
    WHERE role_in_project = 'manager';

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_one_team_lead
    ON project_assignments(project_id)
    WHERE role_in_project = 'team_lead';

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_lead_unique_project
    ON project_assignments(employee_id)
    WHERE role_in_project = 'team_lead';

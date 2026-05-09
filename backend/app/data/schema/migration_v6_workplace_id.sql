-- ─────────────────────────────────────────────────────────────
-- MIGRATION: workplace_id tenant isolation
-- Run in Supabase SQL Editor.
--
-- Each authenticated user owns a workplace. The backend uses the OAuth /
-- Supabase auth user id as workplace_id, so data created after login is
-- scoped to that user automatically.
-- ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Add workplace_id to first-class tenant tables.
ALTER TABLE users               ADD COLUMN IF NOT EXISTS workplace_id UUID;
ALTER TABLE employees           ADD COLUMN IF NOT EXISTS workplace_id UUID;
ALTER TABLE projects            ADD COLUMN IF NOT EXISTS workplace_id UUID;
ALTER TABLE project_assignments ADD COLUMN IF NOT EXISTS workplace_id UUID;
ALTER TABLE files               ADD COLUMN IF NOT EXISTS workplace_id UUID;
ALTER TABLE activities          ADD COLUMN IF NOT EXISTS workplace_id UUID;
ALTER TABLE leave_records       ADD COLUMN IF NOT EXISTS workplace_id UUID;
ALTER TABLE required_skills     ADD COLUMN IF NOT EXISTS workplace_id UUID;

-- Users default to their own auth id as workplace id.
UPDATE users
SET workplace_id = id
WHERE workplace_id IS NULL;

-- Existing legacy rows are assigned to the first known user so current data
-- remains visible to that account after the migration.
DO $$
DECLARE
    legacy_workplace UUID;
BEGIN
    SELECT id INTO legacy_workplace FROM users ORDER BY created_at NULLS LAST, id LIMIT 1;
    IF legacy_workplace IS NULL THEN
        legacy_workplace := gen_random_uuid();
    END IF;

    UPDATE employees           SET workplace_id = legacy_workplace WHERE workplace_id IS NULL;
    UPDATE projects            SET workplace_id = legacy_workplace WHERE workplace_id IS NULL;
    UPDATE files               SET workplace_id = legacy_workplace WHERE workplace_id IS NULL;
    UPDATE activities          SET workplace_id = legacy_workplace WHERE workplace_id IS NULL;
    UPDATE leave_records       SET workplace_id = legacy_workplace WHERE workplace_id IS NULL;
    UPDATE required_skills     SET workplace_id = legacy_workplace WHERE workplace_id IS NULL;

    UPDATE project_assignments pa
    SET workplace_id = COALESCE(p.workplace_id, e.workplace_id, legacy_workplace)
    FROM projects p, employees e
    WHERE pa.project_id = p.id
      AND pa.employee_id = e.id
      AND pa.workplace_id IS NULL;

    UPDATE project_assignments
    SET workplace_id = legacy_workplace
    WHERE workplace_id IS NULL;
END $$;

ALTER TABLE users               ALTER COLUMN workplace_id SET NOT NULL;
ALTER TABLE employees           ALTER COLUMN workplace_id SET NOT NULL;
ALTER TABLE projects            ALTER COLUMN workplace_id SET NOT NULL;
ALTER TABLE project_assignments ALTER COLUMN workplace_id SET NOT NULL;
ALTER TABLE files               ALTER COLUMN workplace_id SET NOT NULL;
ALTER TABLE activities          ALTER COLUMN workplace_id SET NOT NULL;
ALTER TABLE leave_records       ALTER COLUMN workplace_id SET NOT NULL;
ALTER TABLE required_skills     ALTER COLUMN workplace_id SET NOT NULL;

-- Replace global employee-email uniqueness with workplace-scoped uniqueness.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_workplace_email
    ON employees(workplace_id, lower(email));

-- Required skills should be unique inside a workplace, not globally.
ALTER TABLE required_skills DROP CONSTRAINT IF EXISTS required_skills_department_skill_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_required_skills_workplace_department_skill
    ON required_skills(workplace_id, department, skill_id);

CREATE INDEX IF NOT EXISTS idx_users_workplace               ON users(workplace_id);
CREATE INDEX IF NOT EXISTS idx_employees_workplace           ON employees(workplace_id);
CREATE INDEX IF NOT EXISTS idx_projects_workplace            ON projects(workplace_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_workplace ON project_assignments(workplace_id);
CREATE INDEX IF NOT EXISTS idx_files_workplace               ON files(workplace_id);
CREATE INDEX IF NOT EXISTS idx_activities_workplace          ON activities(workplace_id);
CREATE INDEX IF NOT EXISTS idx_leave_records_workplace       ON leave_records(workplace_id);
CREATE INDEX IF NOT EXISTS idx_required_skills_workplace     ON required_skills(workplace_id);

-- Keep DB-generated activities in the same workplace as their source row.
CREATE OR REPLACE FUNCTION log_employee_join()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO activities (workplace_id, event_type, department, actor_id, entity_type, entity_id, title)
    VALUES (
        NEW.workplace_id,
        'employee_joined',
        NEW.team,
        NEW.id,
        'employee',
        NEW.id,
        NEW.name || ' joined as ' || NEW.role
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_file_upload()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO activities (workplace_id, event_type, department, actor_id, entity_type, entity_id, title, description)
    VALUES (
        NEW.workplace_id,
        'file_uploaded',
        NEW.department,
        NEW.uploaded_by,
        'file',
        NEW.id,
        'File uploaded: ' || NEW.filename,
        NEW.description
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- ERS – Employee, Resource & Project Schema
-- Run once in Supabase SQL editor
-- ─────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- EMPLOYEES
CREATE TABLE IF NOT EXISTS employees (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT        NOT NULL,
    email                   TEXT        NOT NULL UNIQUE,
    role                    TEXT        NOT NULL,
    team                    TEXT,
    manager_id              UUID        REFERENCES employees(id) ON DELETE SET NULL,
    linkedin_url            TEXT,
    rating                  NUMERIC(3,2) CHECK (rating >= 0 AND rating <= 5),
    total_experience_years  NUMERIC(5,2),
    availability            BOOLEAN     DEFAULT TRUE,
    project_joined_date     DATE,
    project_end_date        DATE,
    work_start_time         TIME,
    work_end_time           TIME,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_manager   ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_team      ON employees(team);
CREATE INDEX IF NOT EXISTS idx_employees_role      ON employees(role);
CREATE INDEX IF NOT EXISTS idx_employees_rating    ON employees(rating);
CREATE INDEX IF NOT EXISTS idx_employees_available ON employees(availability);

-- SKILLS (master list)
CREATE TABLE IF NOT EXISTS skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    category    TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- EMPLOYEE ↔ SKILLS (junction)
CREATE TABLE IF NOT EXISTS employee_skills (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    skill_id                    UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    skill_level                 SMALLINT NOT NULL CHECK (skill_level BETWEEN 1 AND 5),
    experience_years_with_skill NUMERIC(5,2),
    notes                       TEXT,
    UNIQUE (employee_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_emp_skills_skill ON employee_skills(skill_id);

-- EXPERIENCES
CREATE TABLE IF NOT EXISTS experiences (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    job_title    TEXT NOT NULL,
    start_date   DATE NOT NULL,
    end_date     DATE,
    description  TEXT
);

CREATE INDEX IF NOT EXISTS idx_experiences_emp ON experiences(employee_id);

-- PROJECTS
CREATE TABLE IF NOT EXISTS projects (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name        TEXT NOT NULL,
    client_name         TEXT,
    client_email        TEXT,
    project_description TEXT,
    start_date          DATE,
    end_date            DATE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- PROJECT ASSIGNMENTS
CREATE TABLE IF NOT EXISTS project_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    role_in_project TEXT NOT NULL,   -- manager / team_lead / member / hr
    assigned_date   DATE DEFAULT CURRENT_DATE,
    UNIQUE (project_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_pa_project  ON project_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_pa_employee ON project_assignments(employee_id);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER set_updated_at_employees
    BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_projects
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

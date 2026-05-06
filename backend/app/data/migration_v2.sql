-- ─────────────────────────────────────────────────────────────
-- MIGRATION: Analytics, Activity, Files additions
-- Run in Supabase SQL Editor (safe to re-run — uses IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────

-- 1. REQUIRED SKILLS per department/role (for Radar Chart comparison)
CREATE TABLE IF NOT EXISTS required_skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department  TEXT NOT NULL,          -- e.g. "Engineering", "Design", "HR"
    skill_id    UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    min_level   SMALLINT DEFAULT 1 CHECK (min_level BETWEEN 1 AND 5),
    head_count  INT DEFAULT 1,          -- how many people needed with this skill
    UNIQUE (department, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_req_skills_dept ON required_skills(department);

-- 2. ACTIVITIES / AUDIT LOG (departmental feed)
CREATE TABLE IF NOT EXISTS activities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type  TEXT NOT NULL,          -- 'employee_joined' | 'project_milestone' | 'file_uploaded' | 'skill_added'
    department  TEXT,                   -- "Engineering" | "Design" | "HR" | null = global
    actor_id    UUID REFERENCES employees(id) ON DELETE SET NULL,
    entity_type TEXT,                   -- 'employee' | 'project' | 'file'
    entity_id   UUID,                   -- FK to the relevant row (loose, not enforced)
    title       TEXT NOT NULL,
    description TEXT,
    metadata    JSONB DEFAULT '{}',     -- flexible payload for frontend
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_dept       ON activities(department);
CREATE INDEX IF NOT EXISTS idx_activities_event_type ON activities(event_type);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at DESC);

-- 3. FILES / ASSETS (document & asset management)
CREATE TABLE IF NOT EXISTS files (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename     TEXT NOT NULL,
    storage_path TEXT NOT NULL,         -- path inside Supabase Storage bucket
    mime_type    TEXT,
    size_bytes   BIGINT,
    project_id   UUID REFERENCES projects(id) ON DELETE SET NULL,
    department   TEXT,                  -- link to department feed
    uploaded_by  UUID REFERENCES employees(id) ON DELETE SET NULL,
    description  TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_project    ON files(project_id);
CREATE INDEX IF NOT EXISTS idx_files_department ON files(department);

-- 4. Add percent_complete + status to projects (skip if columns exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='projects' AND column_name='percent_complete'
    ) THEN
        ALTER TABLE projects ADD COLUMN percent_complete SMALLINT DEFAULT 0
            CHECK (percent_complete BETWEEN 0 AND 100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='projects' AND column_name='status'
    ) THEN
        ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'active'
            CHECK (status IN ('planning','active','on_hold','completed','cancelled'));
    END IF;
END $$;

-- Auto-log employee joins into activities
CREATE OR REPLACE FUNCTION log_employee_join()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO activities (event_type, department, actor_id, entity_type, entity_id, title)
    VALUES (
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

DROP TRIGGER IF EXISTS trg_log_employee_join ON employees;
CREATE TRIGGER trg_log_employee_join
    AFTER INSERT ON employees
    FOR EACH ROW EXECUTE FUNCTION log_employee_join();

-- Auto-log file uploads into activities
CREATE OR REPLACE FUNCTION log_file_upload()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO activities (event_type, department, actor_id, entity_type, entity_id, title, description)
    VALUES (
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

DROP TRIGGER IF EXISTS trg_log_file_upload ON files;
CREATE TRIGGER trg_log_file_upload
    AFTER INSERT ON files
    FOR EACH ROW EXECUTE FUNCTION log_file_upload();

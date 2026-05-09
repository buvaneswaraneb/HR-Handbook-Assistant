from __future__ import annotations
from supabase import Client


class ProjectRepository:
    def __init__(self, db: Client):
        self.db = db

    def get_all(self, workplace_id: str | None = None) -> list[dict]:
        q = self.db.table("projects").select("*")
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        return q.execute().data

    def get_by_id(self, project_id: str, workplace_id: str | None = None) -> dict | None:
        q = self.db.table("projects").select("*").eq("id", project_id)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        rows = q.limit(1).execute().data
        return rows[0] if rows else None

    def create(self, payload: dict) -> dict:
        return self.db.table("projects").insert(payload).execute().data[0]

    def update(self, project_id: str, payload: dict, workplace_id: str | None = None) -> dict:
        q = self.db.table("projects").update(payload).eq("id", project_id)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        return q.execute().data[0]

    def get_assignments(self, project_id: str, workplace_id: str | None = None) -> list[dict]:
        q = (
            self.db.table("project_assignments")
            .select("*, employees(name, role, availability)")
            .eq("project_id", project_id)
        )
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        return q.execute().data

    def get_assignments_for_employee(self, employee_id: str, workplace_id: str | None = None) -> list[dict]:
        q = self.db.table("project_assignments").select("*").eq("employee_id", employee_id)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        return q.execute().data

    def get_employee(self, employee_id: str, workplace_id: str | None = None) -> dict | None:
        q = self.db.table("employees").select("id, role, availability").eq("id", employee_id)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        rows = q.limit(1).execute().data
        return rows[0] if rows else None

    def update_employee(self, employee_id: str, payload: dict, workplace_id: str | None = None) -> dict:
        q = self.db.table("employees").update(payload).eq("id", employee_id)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        return q.execute().data[0]

    def assign(self, payload: dict) -> dict:
        return (
            self.db.table("project_assignments")
            .upsert(payload, on_conflict="project_id,employee_id")
            .execute()
            .data[0]
        )

    def delete_assignment(self, project_id: str, employee_id: str, workplace_id: str | None = None) -> None:
        q = (
            self.db.table("project_assignments")
            .delete()
            .eq("project_id", project_id)
            .eq("employee_id", employee_id)
        )
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        q.execute()

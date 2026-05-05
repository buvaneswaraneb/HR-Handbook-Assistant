from __future__ import annotations
from supabase import Client


class ProjectRepository:
    def __init__(self, db: Client):
        self.db = db

    def get_all(self) -> list[dict]:
        return self.db.table("projects").select("*").execute().data

    def get_by_id(self, project_id: str) -> dict | None:
        res = self.db.table("projects").select("*").eq("id", project_id).single().execute()
        return res.data

    def create(self, payload: dict) -> dict:
        return self.db.table("projects").insert(payload).execute().data[0]

    def get_assignments(self, project_id: str) -> list[dict]:
        return (
            self.db.table("project_assignments")
            .select("*, employees(name)")
            .eq("project_id", project_id)
            .execute()
            .data
        )

    def assign(self, payload: dict) -> dict:
        return (
            self.db.table("project_assignments")
            .upsert(payload, on_conflict="project_id,employee_id")
            .execute()
            .data[0]
        )

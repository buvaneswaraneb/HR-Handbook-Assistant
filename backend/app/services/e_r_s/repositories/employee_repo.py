from __future__ import annotations
from uuid import UUID
from typing import Any
from supabase import Client


class EmployeeRepository:
    def __init__(self, db: Client):
        self.db = db

    # ── core CRUD ─────────────────────────────────────────────────────────────
    def get_all(self) -> list[dict]:
        return self.db.table("employees").select("*").execute().data

    def get_by_id(self, emp_id: str) -> dict | None:
        res = self.db.table("employees").select("*").eq("id", emp_id).single().execute()
        return res.data

    def create(self, payload: dict) -> dict:
        return self.db.table("employees").insert(payload).execute().data[0]

    def update(self, emp_id: str, payload: dict) -> dict:
        return self.db.table("employees").update(payload).eq("id", emp_id).execute().data[0]

    def search(self, filters: dict) -> list[dict]:
        q = self.db.table("employees").select("*")
        if filters.get("team"):
            q = q.eq("team", filters["team"])
        if filters.get("role"):
            q = q.eq("role", filters["role"])
        if filters.get("availability") is not None:
            q = q.eq("availability", filters["availability"])
        if filters.get("min_rating") is not None:
            q = q.gte("rating", filters["min_rating"])
        return q.execute().data

    # ── skills ────────────────────────────────────────────────────────────────
    def get_skills(self, emp_id: str) -> list[dict]:
        return (
            self.db.table("employee_skills")
            .select("*, skills(name, category)")
            .eq("employee_id", emp_id)
            .execute()
            .data
        )

    def upsert_skill(self, payload: dict) -> dict:
        return (
            self.db.table("employee_skills")
            .upsert(payload, on_conflict="employee_id,skill_id")
            .execute()
            .data[0]
        )

    def update_skill(self, emp_id: str, skill_id: str, payload: dict) -> dict:
        return (
            self.db.table("employee_skills")
            .update(payload)
            .eq("employee_id", emp_id)
            .eq("skill_id", skill_id)
            .execute()
            .data[0]
        )

    # ── experience ────────────────────────────────────────────────────────────
    def get_experience(self, emp_id: str) -> list[dict]:
        return (
            self.db.table("experiences")
            .select("*")
            .eq("employee_id", emp_id)
            .execute()
            .data
        )

    def add_experience(self, payload: dict) -> dict:
        return self.db.table("experiences").insert(payload).execute().data[0]

    # ── project assignments ───────────────────────────────────────────────────
    def get_projects(self, emp_id: str) -> list[dict]:
        return (
            self.db.table("project_assignments")
            .select("project_id, role_in_project, projects(project_name)")
            .eq("employee_id", emp_id)
            .execute()
            .data
        )

    # ── team tree ─────────────────────────────────────────────────────────────
    def get_direct_reports(self, manager_id: str) -> list[dict]:
        return (
            self.db.table("employees")
            .select("*")
            .eq("manager_id", manager_id)
            .execute()
            .data
        )

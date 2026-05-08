from __future__ import annotations
from uuid import UUID
from typing import Any
from postgrest.exceptions import APIError
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
        try:
            return self.db.table("employees").insert(payload).execute().data[0]
        except APIError as exc:
            sanitized = _without_unknown_avatar_column(payload, exc)
            if sanitized is None:
                raise
            return self.db.table("employees").insert(sanitized).execute().data[0]

    def update(self, emp_id: str, payload: dict) -> dict:
        try:
            return self.db.table("employees").update(payload).eq("id", emp_id).execute().data[0]
        except APIError as exc:
            sanitized = _without_unknown_avatar_column(payload, exc)
            if sanitized is None:
                raise
            return self.db.table("employees").update(sanitized).eq("id", emp_id).execute().data[0]

    def delete(self, emp_id: str) -> None:
        self.db.table("employees").delete().eq("id", emp_id).execute()

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

    def clear_manager_relations(self, manager_id: str) -> None:
        (
            self.db.table("employees")
            .update({"manager_id": None})
            .eq("manager_id", manager_id)
            .execute()
        )

    def clear_team_lead_relations(self, team_lead_id: str) -> None:
        (
            self.db.table("employees")
            .update({"team_lead_id": None})
            .eq("team_lead_id", team_lead_id)
            .execute()
        )


def _without_unknown_avatar_column(payload: dict, exc: APIError) -> dict | None:
    details = getattr(exc, "details", None)
    message = getattr(exc, "message", "") or ""
    code = getattr(exc, "code", "") or ""
    blob = f"{code} {message} {details}"
    if "avatar_url" not in payload:
        return None
    if "PGRST204" not in blob and "avatar_url" not in blob:
        return None
    sanitized = dict(payload)
    sanitized.pop("avatar_url", None)
    return sanitized

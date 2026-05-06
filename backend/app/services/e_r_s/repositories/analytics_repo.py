from __future__ import annotations
from supabase import Client


class AnalyticsRepository:
    def __init__(self, db: Client):
        self.db = db

    def employee_counts(self) -> dict:
        rows = self.db.table("employees").select("availability").execute().data
        total = len(rows)
        available = sum(1 for r in rows if r["availability"])
        on_leave = total - available
        return {"total": total, "available": available, "on_leave": on_leave}

    def active_project_count(self) -> int:
        rows = (
            self.db.table("projects")
            .select("id")
            .eq("status", "active")
            .execute()
            .data
        )
        return len(rows)

    def required_skills(self) -> list[dict]:
        return (
            self.db.table("required_skills")
            .select("department, head_count, skills(name)")
            .execute()
            .data
        )

    def actual_skill_counts(self) -> list[dict]:
        """Count distinct employees per skill."""
        return (
            self.db.table("employee_skills")
            .select("skill_id, skills(name)")
            .execute()
            .data
        )

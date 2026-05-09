from __future__ import annotations
from supabase import Client


class AnalyticsRepository:
    def __init__(self, db: Client):
        self.db = db

    def employee_counts(self, workplace_id: str | None = None) -> dict:
        q = self.db.table("employees").select("availability")
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        rows = q.execute().data
        total = len(rows)
        available = sum(1 for r in rows if r["availability"])
        on_leave = total - available
        return {"total": total, "available": available, "on_leave": on_leave}

    def active_project_count(self, workplace_id: str | None = None) -> int:
        q = self.db.table("projects").select("id").eq("status", "active")
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        rows = q.execute().data
        return len(rows)

    def required_skills(self, workplace_id: str | None = None) -> list[dict]:
        q = self.db.table("required_skills").select("department, head_count, skills(name)")
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        return q.execute().data

    def actual_skill_counts(self, workplace_id: str | None = None) -> list[dict]:
        """Count distinct employees per skill."""
        q = self.db.table("employee_skills").select("employee_id, skill_id, skills(name)")
        rows = q.execute().data
        if not workplace_id:
            return rows

        employee_ids = {
            row["id"]
            for row in self.db.table("employees").select("id").eq("workplace_id", workplace_id).execute().data
        }
        return [row for row in rows if row.get("employee_id") in employee_ids]

    def google_calendar_status(self, workplace_id: str | None = None) -> dict:
        try:
            q = self.db.table("employees").select("google_calendar_sync_enabled, google_calendar_synced_at")
            if workplace_id:
                q = q.eq("workplace_id", workplace_id)
            rows = q.execute().data
        except Exception:
            return {"synced": 0, "pending": 0, "last_synced_at": None}

        synced_rows = [
            r for r in rows
            if r.get("google_calendar_sync_enabled") and r.get("google_calendar_synced_at")
        ]
        pending = sum(1 for r in rows if r.get("google_calendar_sync_enabled") and not r.get("google_calendar_synced_at"))
        last_synced = max((r.get("google_calendar_synced_at") for r in synced_rows), default=None)
        return {"synced": len(synced_rows), "pending": pending, "last_synced_at": last_synced}

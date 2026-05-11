from __future__ import annotations
from datetime import date
from supabase import Client

from app.services.e_r_s.repositories.leave_repo import app_today


class AnalyticsRepository:
    def __init__(self, db: Client):
        self.db = db

    def employee_counts(self, workplace_id: str | None = None) -> dict:
        q = self.db.table("employees").select("id, availability")
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        rows = q.execute().data
        active_leave_ids = self.active_leave_employee_ids(app_today(), workplace_id)
        total = len(rows)
        available = sum(1 for r in rows if r["availability"] and r.get("id") not in active_leave_ids)
        on_leave = len(active_leave_ids)
        return {"total": total, "available": available, "on_leave": on_leave}

    def active_leave_employee_ids(self, day: date, workplace_id: str | None = None) -> set[str]:
        q = (
            self.db.table("leave_records")
            .select("employee_id")
            .lte("start_date", day.isoformat())
            .gte("end_date", day.isoformat())
        )
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        rows = q.execute().data
        return {row["employee_id"] for row in rows if row.get("employee_id")}

    @staticmethod
    def _project_progress(row: dict) -> int:
        try:
            return int(float(row.get("percent_complete") or 0))
        except (TypeError, ValueError):
            return 0

    def active_project_count(self, workplace_id: str | None = None) -> int:
        q = self.db.table("projects").select("id, status, percent_complete")
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        rows = q.execute().data

        def is_live_project(row: dict) -> bool:
            status = (row.get("status") or "active").lower()
            return status == "active" and self._project_progress(row) < 100

        return sum(1 for row in rows if is_live_project(row))

    def completed_project_count(self, workplace_id: str | None = None) -> int:
        q = self.db.table("projects").select("id, status, percent_complete")
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        rows = q.execute().data

        def is_completed_project(row: dict) -> bool:
            status = (row.get("status") or "active").lower()
            if status == "cancelled":
                return False
            return status == "completed" or self._project_progress(row) >= 100

        return sum(1 for row in rows if is_completed_project(row))

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

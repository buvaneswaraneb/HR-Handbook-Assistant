from __future__ import annotations
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo
from supabase import Client


def app_today() -> date:
    timezone = os.getenv("APP_TIMEZONE", "Asia/Kolkata")
    return datetime.now(ZoneInfo(timezone)).date()


class LeaveRepository:
    def __init__(self, db: Client):
        self.db = db

    def get_records(
        self,
        start_date: date | None = None,
        end_date: date | None = None,
        workplace_id: str | None = None,
    ) -> list[dict]:
        q = (
            self.db.table("leave_records")
            .select("*, employees(name, role, team)")
            .order("start_date")
        )
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        if start_date:
            q = q.gte("end_date", start_date.isoformat())
        if end_date:
            q = q.lte("start_date", end_date.isoformat())
        return q.execute().data

    def create(self, payload: dict) -> dict:
        return self.db.table("leave_records").insert(payload).execute().data[0]

    def delete(self, leave_id: str, workplace_id: str | None = None) -> dict:
        q = self.db.table("leave_records").delete().eq("id", leave_id)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        return q.execute().data

    def active_employee_ids(self, day: date, workplace_id: str | None = None) -> set[str]:
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

    def total_members(self, workplace_id: str | None = None) -> int:
        q = self.db.table("employees").select("id")
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        return len(q.execute().data)

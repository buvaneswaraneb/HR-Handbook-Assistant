from __future__ import annotations
from datetime import date
from supabase import Client


class LeaveRepository:
    def __init__(self, db: Client):
        self.db = db

    def get_records(self, start_date: date | None = None, end_date: date | None = None) -> list[dict]:
        q = (
            self.db.table("leave_records")
            .select("*, employees(name, role, team)")
            .order("start_date")
        )
        if start_date:
            q = q.gte("end_date", start_date.isoformat())
        if end_date:
            q = q.lte("start_date", end_date.isoformat())
        return q.execute().data

    def create(self, payload: dict) -> dict:
        return self.db.table("leave_records").insert(payload).execute().data[0]

    def total_members(self) -> int:
        return len(self.db.table("employees").select("id").execute().data)

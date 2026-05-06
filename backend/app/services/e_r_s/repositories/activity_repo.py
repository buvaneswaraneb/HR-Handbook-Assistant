from __future__ import annotations
from supabase import Client


class ActivityRepository:
    def __init__(self, db: Client):
        self.db = db

    def get_feed(self, department: str | None, limit: int) -> list[dict]:
        q = self.db.table("activities").select("*").order("created_at", desc=True).limit(limit)
        if department:
            q = q.eq("department", department)
        return q.execute().data

    def create(self, payload: dict) -> dict:
        return self.db.table("activities").insert(payload).execute().data[0]

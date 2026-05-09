from __future__ import annotations
from supabase import Client


class FileRepository:
    def __init__(self, db: Client):
        self.db = db

    def get_all(self, project_id: str | None, department: str | None, workplace_id: str | None = None) -> list[dict]:
        q = self.db.table("files").select("*").order("created_at", desc=True)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        if project_id:
            q = q.eq("project_id", project_id)
        if department:
            q = q.eq("department", department)
        return q.execute().data

    def get_by_id(self, file_id: str, workplace_id: str | None = None) -> dict | None:
        q = self.db.table("files").select("*").eq("id", file_id)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        rows = q.limit(1).execute().data
        return rows[0] if rows else None

    def create(self, payload: dict) -> dict:
        return self.db.table("files").insert(payload).execute().data[0]

    def update(self, file_id: str, payload: dict, workplace_id: str | None = None) -> dict:
        q = self.db.table("files").update(payload).eq("id", file_id)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        return q.execute().data[0]

    def delete(self, file_id: str, workplace_id: str | None = None) -> None:
        q = self.db.table("files").delete().eq("id", file_id)
        if workplace_id:
            q = q.eq("workplace_id", workplace_id)
        q.execute()

from __future__ import annotations
from supabase import Client


class FileRepository:
    def __init__(self, db: Client):
        self.db = db

    def get_all(self, project_id: str | None, department: str | None) -> list[dict]:
        q = self.db.table("files").select("*").order("created_at", desc=True)
        if project_id:
            q = q.eq("project_id", project_id)
        if department:
            q = q.eq("department", department)
        return q.execute().data

    def get_by_id(self, file_id: str) -> dict | None:
        res = self.db.table("files").select("*").eq("id", file_id).single().execute()
        return res.data

    def create(self, payload: dict) -> dict:
        return self.db.table("files").insert(payload).execute().data[0]

    def update(self, file_id: str, payload: dict) -> dict:
        return self.db.table("files").update(payload).eq("id", file_id).execute().data[0]

    def delete(self, file_id: str) -> None:
        self.db.table("files").delete().eq("id", file_id).execute()

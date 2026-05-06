from __future__ import annotations
from supabase import Client


class SkillRepository:
    def __init__(self, db: Client):
        self.db = db

    def get_or_create(self, name: str, category: str | None = None) -> dict:
        """Return existing skill or insert a new one."""
        existing = (
            self.db.table("skills")
            .select("*")
            .eq("name", name)
            .limit(1)
            .execute()
            .data
        )
        if existing:
            return existing[0]
        return self.db.table("skills").insert({"name": name, "category": category}).execute().data[0]

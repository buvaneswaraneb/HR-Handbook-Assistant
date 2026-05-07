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

    def get_employee_ids_by_skill(self, skill_name: str) -> set[str]:
        """Get all employee IDs that have a specific skill."""
        # First get the skill
        skill_rows = self.db.table("skills").select("id").eq("name", skill_name).execute().data
        if not skill_rows:
            return set()
        
        skill_id = skill_rows[0]["id"]
        
        # Then get all employees with that skill
        emp_skill_rows = (
            self.db.table("employee_skills")
            .select("employee_id")
            .eq("skill_id", skill_id)
            .execute()
            .data
        )
        return {r["employee_id"] for r in emp_skill_rows}

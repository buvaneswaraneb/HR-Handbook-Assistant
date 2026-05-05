from __future__ import annotations


def build_employee_out(emp: dict, raw_skills: list, raw_exp: list, raw_proj: list) -> dict:
    return {
        **emp,
        "skills": [
            {
                "skill_id":                   r["skill_id"],
                "skill_name":                 r.get("skills", {}).get("name", ""),
                "skill_level":                r["skill_level"],
                "experience_years_with_skill": r.get("experience_years_with_skill"),
                "notes":                      r.get("notes"),
            }
            for r in raw_skills
        ],
        "experience": [
            {
                "id":           r["id"],
                "company_name": r["company_name"],
                "job_title":    r["job_title"],
                "start_date":   r["start_date"],
                "end_date":     r.get("end_date"),
                "description":  r.get("description"),
            }
            for r in raw_exp
        ],
        "projects": [
            {
                "project_id":      r["project_id"],
                "project_name":    r.get("projects", {}).get("project_name", ""),
                "role_in_project": r["role_in_project"],
            }
            for r in raw_proj
        ],
    }

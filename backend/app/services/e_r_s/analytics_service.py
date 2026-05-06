from __future__ import annotations
from collections import defaultdict
from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.analytics_repo import AnalyticsRepository


def get_summary() -> dict:
    repo = AnalyticsRepository(get_db())

    counts      = repo.employee_counts()
    active_proj = repo.active_project_count()
    required    = repo.required_skills()
    actual_rows = repo.actual_skill_counts()

    # Build actual count map: skill_name → count of employees with that skill
    actual_map: dict[str, int] = defaultdict(int)
    for row in actual_rows:
        name = (row.get("skills") or {}).get("name")
        if name:
            actual_map[name] += 1

    # Build required map: skill_name → total head_count needed
    required_map: dict[str, int] = defaultdict(int)
    for row in required:
        name = (row.get("skills") or {}).get("name")
        if name:
            required_map[name] += row.get("head_count", 1)

    # Union of all skill names
    all_skills = set(required_map) | set(actual_map)
    skill_coverage = [
        {
            "skill_name": s,
            "required":   required_map.get(s, 0),
            "actual":     actual_map.get(s, 0),
        }
        for s in sorted(all_skills)
    ]

    return {
        "total_employees": counts["total"],
        "active_projects":  active_proj,
        "on_leave":         counts["on_leave"],
        "available":        counts["available"],
        "skill_coverage":   skill_coverage,
        "google_calendar":  repo.google_calendar_status(),
    }

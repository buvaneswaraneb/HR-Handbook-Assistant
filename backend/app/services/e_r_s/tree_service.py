from __future__ import annotations
from app.services.e_r_s.repositories.employee_repo import EmployeeRepository
from app.services.e_r_s.db import get_db


def get_team_tree(manager_id: str) -> dict:
    repo = EmployeeRepository(get_db())
    root = repo.get_by_id(manager_id)
    if not root:
        raise ValueError(f"Manager {manager_id} not found")
    return _build_node(root, repo, depth=0, max_depth=5)

def _build_node(emp: dict, repo: EmployeeRepository, depth: int, max_depth: int) -> dict:
    node = {
        "id": emp["id"],
        "name": emp["name"],
        "role": emp["role"],
        "team": emp.get("team"),
        "availability": emp.get("availability"),
        "reports": [],
    }
    if depth < max_depth:
        reports = repo.get_direct_reports(emp["id"])
        node["reports"] = [_build_node(r, repo, depth + 1, max_depth) for r in reports]
    return node
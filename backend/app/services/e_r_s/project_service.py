from __future__ import annotations
import logging
from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.project_repo import ProjectRepository
from app.services.e_r_s.schemas import ProjectCreate, AssignmentCreate

logger = logging.getLogger(__name__)


def _repo() -> ProjectRepository:
    return ProjectRepository(get_db())


def list_projects() -> list[dict]:
    repo = _repo()
    projects = repo.get_all()
    return [_enrich(p, repo) for p in projects]


def get_project(project_id: str) -> dict:
    repo = _repo()
    p = repo.get_by_id(project_id)
    if not p:
        raise ValueError(f"Project {project_id} not found")
    return _enrich(p, repo)


def create_project(data: ProjectCreate) -> dict:
    repo = _repo()
    p = repo.create(data.model_dump(exclude_none=True, mode="json"))
    return _enrich(p, repo)


def assign_employee(project_id: str, data: AssignmentCreate) -> dict:
    repo = _repo()
    payload = {
        "project_id": project_id,
        "employee_id": str(data.employee_id),
        "role_in_project": data.role_in_project,
    }
    repo.assign(payload)
    return get_project(project_id)


def get_project_team(project_id: str) -> list[dict]:
    repo = _repo()
    rows = repo.get_assignments(project_id)
    return [
        {
            "employee_id": r["employee_id"],
            "employee_name": r.get("employees", {}).get("name", ""),
            "role_in_project": r["role_in_project"],
            "assigned_date": r.get("assigned_date"),
        }
        for r in rows
    ]


# ── internal ──────────────────────────────────────────────────────────────────
def _enrich(project: dict, repo: ProjectRepository) -> dict:
    team = get_project_team(project["id"])
    return {**project, "team": team}

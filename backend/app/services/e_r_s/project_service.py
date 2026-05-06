from __future__ import annotations
import logging
from datetime import date
from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.project_repo import ProjectRepository
from app.services.e_r_s.schemas import ProjectCreate, ProjectUpdate, AssignmentCreate

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
    payload = data.model_dump(exclude_none=True, mode="json")
    manager_id = payload.pop("manager_id", None)
    team_lead_id = payload.pop("team_lead_id", None)
    member_ids = payload.pop("team_member_ids", [])

    p = repo.create(payload)

    if manager_id:
        assign_employee(p["id"], AssignmentCreate(employee_id=manager_id, role_in_project="manager"))
    if team_lead_id:
        assign_employee(p["id"], AssignmentCreate(employee_id=team_lead_id, role_in_project="team_lead"))
    for member_id in member_ids:
        if member_id not in {manager_id, team_lead_id}:
            assign_employee(p["id"], AssignmentCreate(employee_id=member_id, role_in_project="member"))

    return get_project(p["id"])


def update_project(project_id: str, data: ProjectUpdate) -> dict:
    repo = _repo()
    payload = data.model_dump(exclude_none=True, mode="json")
    manager_id = payload.pop("manager_id", None)
    team_lead_id = payload.pop("team_lead_id", None)
    member_ids = payload.pop("team_member_ids", None)

    if payload:
        repo.update(project_id, payload)

    if manager_id is not None:
        assign_employee(project_id, AssignmentCreate(employee_id=manager_id, role_in_project="manager"))
    if team_lead_id is not None:
        assign_employee(project_id, AssignmentCreate(employee_id=team_lead_id, role_in_project="team_lead"))
    if member_ids is not None:
        for member_id in member_ids:
            if member_id not in {manager_id, team_lead_id}:
                assign_employee(project_id, AssignmentCreate(employee_id=member_id, role_in_project="member"))

    return get_project(project_id)


def assign_employee(project_id: str, data: AssignmentCreate) -> dict:
    repo = _repo()
    role = _normalise_role(data.role_in_project)
    employee_id = str(data.employee_id)
    _validate_assignment(repo, project_id, employee_id, role)
    payload = {
        "project_id": project_id,
        "employee_id": employee_id,
        "role_in_project": role,
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
            "name": r.get("employees", {}).get("name", ""),
            "role_in_project": r["role_in_project"],
            "assigned_date": r.get("assigned_date"),
            "availability": r.get("employees", {}).get("availability"),
            "role": r.get("employees", {}).get("role"),
        }
        for r in rows
    ]


# ── internal ──────────────────────────────────────────────────────────────────
def _enrich(project: dict, repo: ProjectRepository) -> dict:
    team = get_project_team(project["id"])
    days_remaining: int | None = None
    end = project.get("end_date")
    if end:
        end_date = date.fromisoformat(end) if isinstance(end, str) else end
        days_remaining = (end_date - date.today()).days
    return {
        **project,
        "required_skills": project.get("required_skills") or [],
        "required_roles": project.get("required_roles") or [],
        "team": team,
        "days_remaining": days_remaining,
    }


def _normalise_role(role: str) -> str:
    value = (role or "").strip().lower().replace(" ", "_").replace("-", "_")
    aliases = {"lead": "team_lead", "teamleader": "team_lead", "team_leader": "team_lead"}
    value = aliases.get(value, value)
    allowed = {"manager", "team_lead", "member", "hr"}
    if value not in allowed:
        raise ValueError(f"Unsupported project role '{role}'. Use manager, team_lead, member, or hr.")
    return value


def _validate_assignment(repo: ProjectRepository, project_id: str, employee_id: str, role: str) -> None:
    assignments = repo.get_assignments(project_id)
    current_for_employee = next((r for r in assignments if r["employee_id"] == employee_id), None)

    if role in {"manager", "team_lead"}:
        existing = next((r for r in assignments if r["role_in_project"] == role), None)
        if existing and existing["employee_id"] != employee_id:
            label = "team leader" if role == "team_lead" else "manager"
            raise ValueError(f"This project already has a {label}. Remove or change that assignment first.")

    if role == "team_lead":
        for row in repo.get_assignments_for_employee(employee_id):
            if row["role_in_project"] == "team_lead" and row["project_id"] != project_id:
                raise ValueError("A team leader can only lead one active project.")

    if current_for_employee and current_for_employee["role_in_project"] != role:
        repo.delete_assignment(project_id, employee_id)

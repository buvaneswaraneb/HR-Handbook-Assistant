from __future__ import annotations
import logging
from datetime import date
from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.project_repo import ProjectRepository
from app.services.e_r_s.schemas import ProjectCreate, ProjectUpdate, AssignmentCreate

logger = logging.getLogger(__name__)


def _repo() -> ProjectRepository:
    return ProjectRepository(get_db())

def list_projects(workplace_id: str | None = None) -> list[dict]:
    repo = _repo()
    projects = repo.get_all(workplace_id)
    return [_enrich(p, repo, workplace_id) for p in projects]


def get_project(project_id: str, workplace_id: str | None = None) -> dict:
    repo = _repo()
    p = repo.get_by_id(project_id, workplace_id)
    if not p:
        raise ValueError(f"Project {project_id} not found")
    return _enrich(p, repo, workplace_id)


def create_project(data: ProjectCreate, workplace_id: str | None = None) -> dict:
    repo = _repo()
    payload = data.model_dump(exclude_none=True, mode="json")
    if workplace_id:
        payload["workplace_id"] = workplace_id
    manager_id = payload.pop("manager_id", None)
    team_lead_id = payload.pop("team_lead_id", None)
    member_ids = payload.pop("team_member_ids", [])

    p = repo.create(payload)

    if manager_id:
        assign_employee(p["id"], AssignmentCreate(employee_id=manager_id, role_in_project="manager"), workplace_id)
    if team_lead_id:
        assign_employee(p["id"], AssignmentCreate(employee_id=team_lead_id, role_in_project="team_lead"), workplace_id)
    for member_id in member_ids:
        if member_id not in {manager_id, team_lead_id}:
            assign_employee(p["id"], AssignmentCreate(employee_id=member_id, role_in_project="member"), workplace_id)

    return get_project(p["id"], workplace_id)


def update_project(project_id: str, data: ProjectUpdate, workplace_id: str | None = None) -> dict:
    repo = _repo()
    payload = data.model_dump(exclude_none=True, mode="json")
    manager_id = payload.pop("manager_id", None)
    team_lead_id = payload.pop("team_lead_id", None)
    member_ids = payload.pop("team_member_ids", None)

    if payload:
        repo.update(project_id, payload, workplace_id)

    if manager_id is not None:
        assign_employee(project_id, AssignmentCreate(employee_id=manager_id, role_in_project="manager"), workplace_id)
    if team_lead_id is not None:
        assign_employee(project_id, AssignmentCreate(employee_id=team_lead_id, role_in_project="team_lead"), workplace_id)
    if member_ids is not None:
        for member_id in member_ids:
            if member_id not in {manager_id, team_lead_id}:
                assign_employee(project_id, AssignmentCreate(employee_id=member_id, role_in_project="member"), workplace_id)

    return get_project(project_id, workplace_id)


def assign_employee(project_id: str, data: AssignmentCreate, workplace_id: str | None = None) -> dict:
    repo = _repo()
    role = _normalise_role(data.role_in_project)
    employee_id = str(data.employee_id)
    employee = _validate_assignment(repo, project_id, employee_id, role, workplace_id)
    payload = {
        "project_id": project_id,
        "employee_id": employee_id,
        "role_in_project": role,
    }
    if workplace_id:
        payload["workplace_id"] = workplace_id
    repo.assign(payload)
    _sync_project_employee_relations(repo, project_id, workplace_id)
    return get_project(project_id, workplace_id)


def get_project_team(project_id: str, workplace_id: str | None = None) -> list[dict]:
    repo = _repo()
    rows = repo.get_assignments(project_id, workplace_id)
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


def unassign_employee(project_id: str, employee_id: str, workplace_id: str | None = None) -> dict:
    repo = _repo()
    assignments = repo.get_assignments(project_id, workplace_id)
    current = next((row for row in assignments if row["employee_id"] == employee_id), None)
    if not current:
        raise ValueError("Assignment not found.")

    repo.delete_assignment(project_id, employee_id, workplace_id)
    repo.update_employee(employee_id, {"manager_id": None, "team_lead_id": None}, workplace_id)

    remaining = repo.get_assignments_for_employee(employee_id, workplace_id)
    employee = repo.get_employee(employee_id, workplace_id) or {}
    if _is_manager_employee(employee):
        repo.update_employee(employee_id, {"availability": True}, workplace_id)
    else:
        repo.update_employee(employee_id, {"availability": bool(not remaining)}, workplace_id)

    _sync_project_employee_relations(repo, project_id, workplace_id)

    return get_project(project_id, workplace_id)


# ── internal ──────────────────────────────────────────────────────────────────
def _enrich(project: dict, repo: ProjectRepository, workplace_id: str | None = None) -> dict:
    team = get_project_team(project["id"], workplace_id)
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


def _validate_assignment(
    repo: ProjectRepository,
    project_id: str,
    employee_id: str,
    role: str,
    workplace_id: str | None = None,
) -> dict:
    if not repo.get_by_id(project_id, workplace_id):
        raise ValueError("Project not found.")
    employee = repo.get_employee(employee_id, workplace_id)
    if not employee:
        raise ValueError("Employee not found.")

    is_manager = _is_manager_employee(employee)
    assignments = repo.get_assignments(project_id, workplace_id)
    current_for_employee = next((r for r in assignments if r["employee_id"] == employee_id), None)

    if role == "manager" and not is_manager:
        raise ValueError("Only employees with the Manager role can be assigned as project managers.")

    if is_manager and role != "manager":
        raise ValueError("Managers can only be assigned with the manager project role.")

    if role in {"manager", "team_lead"}:
        existing = next((r for r in assignments if r["role_in_project"] == role), None)
        if existing and existing["employee_id"] != employee_id:
            label = "team leader" if role == "team_lead" else "manager"
            raise ValueError(f"This project already has a {label}. Remove or change that assignment first.")

    if not is_manager:
        for row in repo.get_assignments_for_employee(employee_id, workplace_id):
            if row["project_id"] != project_id:
                raise ValueError("This employee is already assigned to another project.")

    if current_for_employee and current_for_employee["role_in_project"] != role:
        repo.delete_assignment(project_id, employee_id, workplace_id)

    return employee


def _is_manager_employee(employee: dict) -> bool:
    return (employee.get("role") or "").strip().lower() == "manager"


def _employee_relation_update(
    manager_id: str | None,
    team_lead_id: str | None,
    employee_id: str,
    role: str,
) -> dict:
    if role == "manager":
        return {"manager_id": None, "team_lead_id": None}
    if role == "team_lead":
        return {"manager_id": manager_id if manager_id != employee_id else None, "team_lead_id": None}
    return {
        "manager_id": manager_id if manager_id != employee_id else None,
        "team_lead_id": team_lead_id if team_lead_id != employee_id else None,
    }


def _sync_project_employee_relations(repo: ProjectRepository, project_id: str, workplace_id: str | None = None) -> None:
    assignments = repo.get_assignments(project_id, workplace_id)
    manager_id = next((row["employee_id"] for row in assignments if row["role_in_project"] == "manager"), None)
    team_lead_id = next((row["employee_id"] for row in assignments if row["role_in_project"] == "team_lead"), None)

    for row in assignments:
        employee = repo.get_employee(row["employee_id"], workplace_id) or {}
        payload = _employee_relation_update(manager_id, team_lead_id, row["employee_id"], row["role_in_project"])
        if not _is_manager_employee(employee):
            payload["availability"] = False
        repo.update_employee(row["employee_id"], payload, workplace_id)

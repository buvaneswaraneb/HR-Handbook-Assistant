from __future__ import annotations
import json
import logging
import os
from datetime import date
from pathlib import Path
from urllib import error as urlerror
from urllib import request as urlrequest

try:
    import httpx
except ImportError:  # pragma: no cover - optional until dependencies are installed
    httpx = None

from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.project_repo import ProjectRepository
from app.services.e_r_s.schemas import (
    AssignmentCreate,
    ProjectCreate,
    ProjectRequirementsSuggestRequest,
    ProjectSummarySuggestRequest,
    ProjectUpdate,
)

logger = logging.getLogger(__name__)

_ENV_FILE = Path(__file__).resolve().parents[4] / ".env"
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant"


def _repo() -> ProjectRepository:
    return ProjectRepository(get_db())


def _env_value(name: str) -> str | None:
    value = os.getenv(name)
    if value:
        return value
    try:
        for line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
            raw = line.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            key, val = raw.split("=", 1)
            if key.strip() == name:
                return val.strip().strip('"').strip("'")
    except OSError:
        return None
    return None


def _clean_tag(value: object) -> str:
    return str(value or "").strip().strip(",.;:")[:48]


def _unique_limited(values: list[object], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        tag = _clean_tag(value)
        key = tag.lower()
        if not tag or key in seen:
            continue
        seen.add(key)
        out.append(tag)
        if len(out) >= limit:
            break
    return out


def _call_groq_json(prompt: str, max_tokens: int = 350) -> dict:
    api_key = _env_value("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY is not configured")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Osmium-HR-Assistant/1.0",
    }
    payload = {
        "model": _env_value("GROQ_MODEL") or DEFAULT_GROQ_MODEL,
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": "You return strict JSON only."},
            {"role": "user", "content": prompt},
        ],
    }

    if httpx is not None:
        with httpx.Client(timeout=httpx.Timeout(20.0, connect=10.0)) as client:
            response = client.post(GROQ_API_URL, headers=headers, json=payload)
            if response.status_code >= 400:
                raise ValueError(_groq_error_message(response.status_code, response.text))
            content = response.json()["choices"][0]["message"]["content"]
            return json.loads(content)

    request = urlrequest.Request(
        GROQ_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlrequest.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
    except urlerror.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise ValueError(_groq_error_message(exc.code, body)) from exc
    content = json.loads(raw)["choices"][0]["message"]["content"]
    return json.loads(content)


def _groq_error_message(status_code: int, body: str) -> str:
    safe_body = " ".join(str(body or "").split())[:280]
    return f"Groq HTTP {status_code}: {safe_body or 'no response body'}"


def _fallback_project_requirements(data: ProjectRequirementsSuggestRequest) -> dict:
    text = " ".join([
        data.project_name or "",
        data.client_name or "",
        data.project_description or "",
    ]).lower()

    skills = ["Project Planning", "Requirements Analysis", "Documentation"]
    roles = ["Project Manager", "Team Lead", "QA Engineer"]

    keyword_suggestions = [
        (("react", "frontend", "front-end", "ui", "web", "portal", "dashboard"), ["React", "JavaScript", "HTML/CSS", "UI/UX Design"], ["Frontend Developer", "UI/UX Designer"]),
        (("node", "api", "backend", "back-end", "server", "service"), ["Node.js", "REST API", "Database Design"], ["Backend Developer"]),
        (("python", "ai", "ml", "machine learning", "automation"), ["Python", "Machine Learning", "Prompt Engineering"], ["AI Engineer", "Backend Developer"]),
        (("data", "analytics", "report", "bi", "metrics"), ["SQL", "Data Visualization", "Analytics"], ["Data Analyst"]),
        (("mobile", "android", "ios", "app"), ["Mobile Development", "API Integration", "App Testing"], ["Mobile Developer"]),
        (("payment", "billing", "ecommerce", "commerce"), ["Payment Gateway", "Security", "Transaction Testing"], ["Backend Developer", "QA Engineer"]),
        (("hr", "employee", "payroll", "leave", "attendance"), ["HR Systems", "Workflow Automation", "Data Privacy"], ["HR Product Analyst"]),
        (("cloud", "deploy", "devops", "infra"), ["Cloud Infrastructure", "CI/CD", "Monitoring"], ["DevOps Engineer"]),
    ]

    for keywords, skill_items, role_items in keyword_suggestions:
        if any(keyword in text for keyword in keywords):
            skills.extend(skill_items)
            roles.extend(role_items)

    skills = _unique_limited(data.existing_skills + skills, 8)
    roles = _unique_limited(data.existing_roles + roles, 6)

    if data.target == "skills":
        roles = []
    elif data.target == "roles":
        skills = []

    return {"required_skills": skills, "required_roles": roles}


def suggest_project_requirements(data: ProjectRequirementsSuggestRequest) -> dict:
    prompt = f"""
You generate concise HR project setup tags for an employee/project management app.

Return ONLY valid JSON in this exact shape:
{{"required_skills":["skill"],"required_roles":["role"]}}

Rules:
- Use the project name, client, and description only.
- Keep skills to 4-8 short tags.
- Keep roles to 3-6 short role names.
- Do not include explanations.
- If target is "skills", return roles as [].
- If target is "roles", return skills as [].

Target: {data.target}
Project name: {data.project_name}
Client: {data.client_name or ""}
Description: {data.project_description or ""}
Existing skills to preserve/avoid duplicating: {", ".join(data.existing_skills)}
Existing roles to preserve/avoid duplicating: {", ".join(data.existing_roles)}
""".strip()

    try:
        parsed = _call_groq_json(prompt, max_tokens=350)
        skills = _unique_limited(data.existing_skills + parsed.get("required_skills", []), 8)
        roles = _unique_limited(data.existing_roles + parsed.get("required_roles", []), 6)
        if data.target == "skills":
            roles = []
        elif data.target == "roles":
            skills = []
        return {"required_skills": skills, "required_roles": roles}
    except (KeyError, ValueError, json.JSONDecodeError, OSError, urlerror.URLError) as exc:
        logger.warning("Project AI requirement suggestion fell back: %s", exc)
        return _fallback_project_requirements(data)


def _fallback_project_summary(data: ProjectSummarySuggestRequest) -> dict:
    name = (data.project_name or "This project").strip()
    client = (data.client_name or "").strip()
    description = " ".join((data.project_description or "").split())
    parts = [name]
    if client:
        parts.append(f"for {client}")
    intro = " ".join(parts)

    if description:
        summary = description[:260].rstrip()
        if len(description) > 260:
            summary = summary.rsplit(" ", 1)[0].rstrip(",.;:") + "."
        return {"summary": summary}

    skills = ", ".join(_unique_limited(data.required_skills, 4))
    roles = ", ".join(_unique_limited(data.required_roles, 3))
    detail = []
    if skills:
        detail.append(f"key capabilities include {skills}")
    if roles:
        detail.append(f"the team needs {roles}")
    suffix = f" with {', and '.join(detail)}" if detail else ""
    return {"summary": f"{intro} is planned as a focused delivery initiative{suffix}."}


def suggest_project_summary(data: ProjectSummarySuggestRequest) -> dict:
    prompt = f"""
You refine project draft text for an HR employee/project management app.

Return ONLY valid JSON in this exact shape:
{{"summary":"summary text"}}

Rules:
- Write one polished project summary.
- Keep it concise: 1-2 sentences, maximum 55 words.
- Use clear operational language.
- Use only the provided project details.
- Do not invent dates, budgets, people, or technology not mentioned.
- Do not include markdown or labels.

Project name: {data.project_name}
Client: {data.client_name or ""}
Current description: {data.project_description or ""}
Required skills: {", ".join(data.required_skills)}
Roles needed: {", ".join(data.required_roles)}
""".strip()

    try:
        parsed = _call_groq_json(prompt, max_tokens=220)
        summary = " ".join(str(parsed.get("summary", "")).split())
        if not summary:
            raise ValueError("Empty summary")
        return {"summary": summary[:420]}
    except (KeyError, ValueError, json.JSONDecodeError, OSError, urlerror.URLError) as exc:
        logger.warning("Project AI summary suggestion fell back: %s", exc)
        return _fallback_project_summary(data)


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
    payload = data.model_dump(exclude_unset=True, mode="json")
    has_manager = "manager_id" in payload
    has_team_lead = "team_lead_id" in payload
    has_members = "team_member_ids" in payload
    manager_id = payload.pop("manager_id", None)
    team_lead_id = payload.pop("team_lead_id", None)
    member_ids = payload.pop("team_member_ids", None)

    if payload:
        repo.update(project_id, payload, workplace_id)

    if has_manager or has_team_lead or has_members:
        _sync_project_assignments(
            repo,
            project_id,
            str(manager_id) if manager_id else None,
            str(team_lead_id) if team_lead_id else None,
            [str(member_id) for member_id in (member_ids or [])],
            workplace_id,
        )

    return get_project(project_id, workplace_id)


def delete_project(project_id: str, workplace_id: str | None = None) -> None:
    repo = _repo()
    if not repo.get_by_id(project_id, workplace_id):
        raise ValueError("Project not found.")

    assignments = repo.get_assignments(project_id, workplace_id)
    repo.delete(project_id, workplace_id)

    for row in assignments:
        employee_id = row.get("employee_id")
        if not employee_id:
            continue
        _refresh_employee_after_assignment_removal(repo, employee_id, workplace_id)


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
    _refresh_employee_after_assignment_removal(repo, employee_id, workplace_id)

    _sync_project_employee_relations(repo, project_id, workplace_id)

    return get_project(project_id, workplace_id)


# ── internal ──────────────────────────────────────────────────────────────────
def _sync_project_assignments(
    repo: ProjectRepository,
    project_id: str,
    manager_id: str | None,
    team_lead_id: str | None,
    member_ids: list[str],
    workplace_id: str | None = None,
) -> None:
    desired: dict[str, str] = {}
    if manager_id:
        desired[manager_id] = "manager"
    if team_lead_id and team_lead_id != manager_id:
        desired[team_lead_id] = "team_lead"
    for member_id in member_ids:
        if member_id and member_id not in {manager_id, team_lead_id}:
            desired[member_id] = "member"

    removed_ids: set[str] = set()
    for row in repo.get_assignments(project_id, workplace_id):
        employee_id = str(row["employee_id"])
        if desired.get(employee_id) != row.get("role_in_project"):
            repo.delete_assignment(project_id, employee_id, workplace_id)
            removed_ids.add(employee_id)

    for employee_id, role in desired.items():
        assign_employee(project_id, AssignmentCreate(employee_id=employee_id, role_in_project=role), workplace_id)

    for employee_id in removed_ids - set(desired):
        _refresh_employee_after_assignment_removal(repo, employee_id, workplace_id)

    _sync_project_employee_relations(repo, project_id, workplace_id)


def _refresh_employee_after_assignment_removal(
    repo: ProjectRepository,
    employee_id: str,
    workplace_id: str | None = None,
) -> None:
    repo.update_employee(employee_id, {"manager_id": None, "team_lead_id": None}, workplace_id)
    remaining = repo.get_assignments_for_employee(employee_id, workplace_id)
    employee = repo.get_employee(employee_id, workplace_id) or {}
    if _is_manager_employee(employee):
        repo.update_employee(employee_id, {"availability": True}, workplace_id)
    else:
        repo.update_employee(employee_id, {"availability": bool(not remaining)}, workplace_id)


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
    return "manager" in (employee.get("role") or "").strip().lower().split()


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

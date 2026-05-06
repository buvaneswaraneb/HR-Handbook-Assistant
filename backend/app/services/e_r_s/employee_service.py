from __future__ import annotations
import logging
from uuid import UUID

from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.employee_repo import EmployeeRepository
from app.services.e_r_s.repositories.skill_repo import SkillRepository
from app.services.e_r_s.schemas import (
    EmployeeCreate, EmployeeUpdate, AvailabilityUpdate,
    EmployeeSkillCreate, EmployeeSkillUpdate, ExperienceCreate,
    EmployeeOut, BulkEmployeeItem, BulkUploadResult,
)
from app.services.e_r_s.utils.serializer import build_employee_out

logger = logging.getLogger(__name__)


def _repos():
    db = get_db()
    return EmployeeRepository(db), SkillRepository(db)


def list_employees() -> list[dict]:
    emp_repo, _ = _repos()
    employees = emp_repo.get_all()
    return [_enrich(e, emp_repo) for e in employees]


def get_employee(emp_id: str) -> dict:
    emp_repo, _ = _repos()
    emp = emp_repo.get_by_id(emp_id)
    if not emp:
        raise ValueError(f"Employee {emp_id} not found")
    return _enrich(emp, emp_repo)


def create_employee(data: EmployeeCreate) -> dict:
    emp_repo, _ = _repos()
    payload = data.model_dump(exclude_none=True, mode="json")
    skills = payload.pop("skills", [])
    emp = emp_repo.create(payload)
    for skill in skills:
        add_skill(emp["id"], EmployeeSkillCreate(**skill))
    return _enrich(emp, emp_repo)


def update_employee(emp_id: str, data: EmployeeUpdate) -> dict:
    emp_repo, _ = _repos()
    payload = data.model_dump(exclude_none=True, mode="json")
    skills = payload.pop("skills", [])
    emp = emp_repo.update(emp_id, payload) if payload else emp_repo.get_by_id(emp_id)
    if not emp:
        raise ValueError(f"Employee {emp_id} not found")
    for skill in skills:
        add_skill(emp_id, EmployeeSkillCreate(**skill))
    return _enrich(emp, emp_repo)


def patch_availability(emp_id: str, data: AvailabilityUpdate) -> dict:
    emp_repo, _ = _repos()
    emp = emp_repo.update(emp_id, {"availability": data.availability})
    return _enrich(emp, emp_repo)


def add_skill(emp_id: str, data: EmployeeSkillCreate) -> dict:
    emp_repo, skill_repo = _repos()
    skill = skill_repo.get_or_create(data.skill_name)
    payload = {
        "employee_id": emp_id,
        "skill_id": skill["id"],
        "skill_level": data.skill_level,
        "experience_years_with_skill": data.experience_years_with_skill,
        "notes": data.notes,
    }
    emp_repo.upsert_skill({k: v for k, v in payload.items() if v is not None})
    return get_employee(emp_id)


def update_skill(emp_id: str, skill_id: str, data: EmployeeSkillUpdate) -> dict:
    emp_repo, _ = _repos()
    emp_repo.update_skill(emp_id, skill_id, data.model_dump(exclude_none=True))
    return get_employee(emp_id)


def add_experience(emp_id: str, data: ExperienceCreate) -> dict:
    emp_repo, _ = _repos()
    payload = data.model_dump(exclude_none=True, mode="json")
    payload["employee_id"] = emp_id
    emp_repo.add_experience(payload)
    return get_employee(emp_id)


def search_employees(filters: dict) -> list[dict]:
    emp_repo, skill_repo = _repos()

    # skill filter requires join — handled separately
    skill_name = filters.pop("skill", None)
    employees = emp_repo.search(filters)

    if skill_name:
        db = get_db()
        skill_rows = db.table("skills").select("id").eq("name", skill_name).execute().data
        if not skill_rows:
            return []
        skill_id = skill_rows[0]["id"]
        emp_skill_rows = db.table("employee_skills").select("employee_id").eq("skill_id", skill_id).execute().data
        emp_ids = {r["employee_id"] for r in emp_skill_rows}
        employees = [e for e in employees if e["id"] in emp_ids]

    return [_enrich(e, emp_repo) for e in employees]


def bulk_upload(items: list[BulkEmployeeItem]) -> BulkUploadResult:
    result = BulkUploadResult()
    for item in items:
        try:
            emp = create_employee(EmployeeCreate(**item.model_dump(exclude={"skills", "experience"})))
            emp_id = emp["id"]
            for sk in item.skills:
                add_skill(emp_id, sk)
            for ex in item.experience:
                add_experience(emp_id, ex)
            result.success.append(emp_id)
        except Exception as e:
            logger.warning("Bulk upload failed for %s: %s", item.email, e)
            result.failed.append({"email": item.email, "error": str(e)})
    return result


# ── internal helper ───────────────────────────────────────────────────────────
def _enrich(emp: dict, emp_repo: EmployeeRepository) -> dict:
    eid = emp["id"]
    raw_skills = emp_repo.get_skills(eid)
    raw_exp    = emp_repo.get_experience(eid)
    raw_proj   = emp_repo.get_projects(eid)
    return build_employee_out(emp, raw_skills, raw_exp, raw_proj)

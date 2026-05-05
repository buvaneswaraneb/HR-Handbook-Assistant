from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.services.e_r_s import (
    employee_service as svc,
)
from app.services.e_r_s.schemas import (
    EmployeeCreate, EmployeeUpdate, AvailabilityUpdate,
    EmployeeSkillCreate, EmployeeSkillUpdate,
    ExperienceCreate, BulkEmployeeItem,
)

router = APIRouter(prefix="/employees", tags=["Employees"])


def _404(e: ValueError):
    raise HTTPException(status_code=404, detail=str(e))


@router.get("")
def list_employees():
    return svc.list_employees()


@router.post("", status_code=201)
def create_employee(body: EmployeeCreate):
    return svc.create_employee(body)


@router.get("/search")
def search_employees(
    team: Optional[str] = None,
    role: Optional[str] = None,
    skill: Optional[str] = None,
    availability: Optional[bool] = None,
    min_rating: Optional[float] = Query(None, ge=0, le=5),
):
    filters = {
        "team": team, "role": role, "skill": skill,
        "availability": availability, "min_rating": min_rating,
    }
    return svc.search_employees({k: v for k, v in filters.items() if v is not None})


@router.post("/bulk-upload", status_code=207)
def bulk_upload(body: list[BulkEmployeeItem]):
    return svc.bulk_upload(body)


@router.get("/{emp_id}")
def get_employee(emp_id: UUID):
    try:
        return svc.get_employee(str(emp_id))
    except ValueError as e:
        _404(e)


@router.put("/{emp_id}")
def update_employee(emp_id: UUID, body: EmployeeUpdate):
    try:
        return svc.update_employee(str(emp_id), body)
    except ValueError as e:
        _404(e)


@router.patch("/{emp_id}/availability")
def patch_availability(emp_id: UUID, body: AvailabilityUpdate):
    try:
        return svc.patch_availability(str(emp_id), body)
    except ValueError as e:
        _404(e)


@router.post("/{emp_id}/skills", status_code=201)
def add_skill(emp_id: UUID, body: EmployeeSkillCreate):
    try:
        return svc.add_skill(str(emp_id), body)
    except ValueError as e:
        _404(e)


@router.put("/{emp_id}/skills/{skill_id}")
def update_skill(emp_id: UUID, skill_id: UUID, body: EmployeeSkillUpdate):
    try:
        return svc.update_skill(str(emp_id), str(skill_id), body)
    except ValueError as e:
        _404(e)


@router.post("/{emp_id}/experience", status_code=201)
def add_experience(emp_id: UUID, body: ExperienceCreate):
    try:
        return svc.add_experience(str(emp_id), body)
    except ValueError as e:
        _404(e)

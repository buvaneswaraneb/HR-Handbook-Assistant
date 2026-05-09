from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Header, HTTPException, Query
from typing import Optional

from app.services.e_r_s import (
    employee_service as svc,
)
from app.services.e_r_s.schemas import (
    EmployeeCreate, EmployeeUpdate, AvailabilityUpdate,
    EmployeeSkillCreate, EmployeeSkillUpdate,
    ExperienceCreate, BulkEmployeeItem,
)
from app.api.auth_context import get_workplace_id

router = APIRouter(prefix="/employees", tags=["Employees"])


def _404(e: ValueError):
    raise HTTPException(status_code=404, detail=str(e))


@router.get("")
def list_employees(authorization: Optional[str] = Header(None)):
    return svc.list_employees(get_workplace_id(authorization))


@router.post("", status_code=201)
def create_employee(body: EmployeeCreate, authorization: Optional[str] = Header(None)):
    return svc.create_employee(body, get_workplace_id(authorization))


@router.get("/search")
def search_employees(
    team: Optional[str] = None,
    role: Optional[str] = None,
    skill: Optional[str] = None,
    availability: Optional[bool] = None,
    min_rating: Optional[float] = Query(None, ge=0, le=5),
    authorization: Optional[str] = Header(None),
):
    filters = {
        "team": team, "role": role, "skill": skill,
        "availability": availability, "min_rating": min_rating,
    }
    return svc.search_employees({k: v for k, v in filters.items() if v is not None}, get_workplace_id(authorization))


@router.post("/bulk-upload", status_code=207)
def bulk_upload(body: list[BulkEmployeeItem], authorization: Optional[str] = Header(None)):
    return svc.bulk_upload(body, get_workplace_id(authorization))


@router.get("/linkedin-avatar")
def linkedin_avatar(url: str = Query(..., min_length=1)):
    try:
        return svc.resolve_linkedin_avatar(url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{emp_id}")
def get_employee(emp_id: UUID, authorization: Optional[str] = Header(None)):
    try:
        return svc.get_employee(str(emp_id), get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.put("/{emp_id}")
def update_employee(emp_id: UUID, body: EmployeeUpdate, authorization: Optional[str] = Header(None)):
    try:
        return svc.update_employee(str(emp_id), body, get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.delete("/{emp_id}", status_code=204)
def delete_employee(emp_id: UUID, authorization: Optional[str] = Header(None)):
    try:
        svc.delete_employee(str(emp_id), get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.patch("/{emp_id}/availability")
def patch_availability(emp_id: UUID, body: AvailabilityUpdate, authorization: Optional[str] = Header(None)):
    try:
        return svc.patch_availability(str(emp_id), body, get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.post("/{emp_id}/skills", status_code=201)
def add_skill(emp_id: UUID, body: EmployeeSkillCreate, authorization: Optional[str] = Header(None)):
    try:
        return svc.add_skill(str(emp_id), body, get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.put("/{emp_id}/skills/{skill_id}")
def update_skill(emp_id: UUID, skill_id: UUID, body: EmployeeSkillUpdate, authorization: Optional[str] = Header(None)):
    try:
        return svc.update_skill(str(emp_id), str(skill_id), body, get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.post("/{emp_id}/experience", status_code=201)
def add_experience(emp_id: UUID, body: ExperienceCreate, authorization: Optional[str] = Header(None)):
    try:
        return svc.add_experience(str(emp_id), body, get_workplace_id(authorization))
    except ValueError as e:
        _404(e)

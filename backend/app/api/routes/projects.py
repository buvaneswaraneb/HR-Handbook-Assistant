from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Header, HTTPException
from typing import Optional

from app.services.e_r_s import project_service as svc
from app.services.e_r_s.schemas import (
    AssignmentCreate,
    ProjectCreate,
    ProjectRequirementsSuggestRequest,
    ProjectRequirementsSuggestResponse,
    ProjectSummarySuggestRequest,
    ProjectSummarySuggestResponse,
    ProjectUpdate,
)
from app.api.auth_context import get_workplace_id

router = APIRouter(prefix="/projects", tags=["Projects"])


def _project_error(e: ValueError):
    detail = str(e)
    lower = detail.lower()
    if "not found" in lower:
        status_code = 404
    elif "already" in lower:
        status_code = 409
    else:
        status_code = 400
    raise HTTPException(status_code=status_code, detail=detail)


@router.get("")
def list_projects(authorization: Optional[str] = Header(None)):
    return svc.list_projects(get_workplace_id(authorization))


@router.post("", status_code=201)
def create_project(body: ProjectCreate, authorization: Optional[str] = Header(None)):
    try:
        return svc.create_project(body, get_workplace_id(authorization))
    except ValueError as e:
        _project_error(e)


@router.post("/ai/requirements", response_model=ProjectRequirementsSuggestResponse)
def suggest_project_requirements(body: ProjectRequirementsSuggestRequest, authorization: Optional[str] = Header(None)):
    get_workplace_id(authorization)
    return svc.suggest_project_requirements(body)


@router.post("/ai/summary", response_model=ProjectSummarySuggestResponse)
def suggest_project_summary(body: ProjectSummarySuggestRequest, authorization: Optional[str] = Header(None)):
    get_workplace_id(authorization)
    return svc.suggest_project_summary(body)


@router.get("/{project_id}")
def get_project(project_id: UUID, authorization: Optional[str] = Header(None)):
    try:
        return svc.get_project(str(project_id), get_workplace_id(authorization))
    except ValueError as e:
        _project_error(e)


@router.post("/{project_id}/assign", status_code=201)
def assign_employee(project_id: UUID, body: AssignmentCreate, authorization: Optional[str] = Header(None)):
    try:
        return svc.assign_employee(str(project_id), body, get_workplace_id(authorization))
    except ValueError as e:
        _project_error(e)


@router.delete("/{project_id}/assign/{employee_id}")
def unassign_employee(project_id: UUID, employee_id: UUID, authorization: Optional[str] = Header(None)):
    try:
        return svc.unassign_employee(str(project_id), str(employee_id), get_workplace_id(authorization))
    except ValueError as e:
        _project_error(e)


@router.put("/{project_id}")
def update_project(project_id: UUID, body: ProjectUpdate, authorization: Optional[str] = Header(None)):
    try:
        return svc.update_project(str(project_id), body, get_workplace_id(authorization))
    except ValueError as e:
        _project_error(e)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: UUID, authorization: Optional[str] = Header(None)):
    try:
        svc.delete_project(str(project_id), get_workplace_id(authorization))
    except ValueError as e:
        _project_error(e)


@router.get("/{project_id}/team")
def get_project_team(project_id: UUID, authorization: Optional[str] = Header(None)):
    try:
        return svc.get_project_team(str(project_id), get_workplace_id(authorization))
    except ValueError as e:
        _project_error(e)

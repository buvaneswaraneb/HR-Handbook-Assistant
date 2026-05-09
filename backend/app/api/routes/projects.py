from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Header, HTTPException
from typing import Optional

from app.services.e_r_s import project_service as svc
from app.services.e_r_s.schemas import ProjectCreate, ProjectUpdate, AssignmentCreate
from app.api.auth_context import get_workplace_id

router = APIRouter(prefix="/projects", tags=["Projects"])


def _404(e: ValueError):
    raise HTTPException(status_code=404, detail=str(e))


@router.get("")
def list_projects(authorization: Optional[str] = Header(None)):
    return svc.list_projects(get_workplace_id(authorization))


@router.post("", status_code=201)
def create_project(body: ProjectCreate, authorization: Optional[str] = Header(None)):
    return svc.create_project(body, get_workplace_id(authorization))


@router.get("/{project_id}")
def get_project(project_id: UUID, authorization: Optional[str] = Header(None)):
    try:
        return svc.get_project(str(project_id), get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.post("/{project_id}/assign", status_code=201)
def assign_employee(project_id: UUID, body: AssignmentCreate, authorization: Optional[str] = Header(None)):
    try:
        return svc.assign_employee(str(project_id), body, get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.delete("/{project_id}/assign/{employee_id}")
def unassign_employee(project_id: UUID, employee_id: UUID, authorization: Optional[str] = Header(None)):
    try:
        return svc.unassign_employee(str(project_id), str(employee_id), get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.put("/{project_id}")
def update_project(project_id: UUID, body: ProjectUpdate, authorization: Optional[str] = Header(None)):
    try:
        return svc.update_project(str(project_id), body, get_workplace_id(authorization))
    except ValueError as e:
        _404(e)


@router.get("/{project_id}/team")
def get_project_team(project_id: UUID, authorization: Optional[str] = Header(None)):
    try:
        return svc.get_project_team(str(project_id), get_workplace_id(authorization))
    except ValueError as e:
        _404(e)

from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, HTTPException

from app.services.e_r_s import project_service as svc
from app.services.e_r_s.schemas import ProjectCreate, AssignmentCreate

router = APIRouter(prefix="/projects", tags=["Projects"])


def _404(e: ValueError):
    raise HTTPException(status_code=404, detail=str(e))


@router.get("")
def list_projects():
    return svc.list_projects()


@router.post("", status_code=201)
def create_project(body: ProjectCreate):
    return svc.create_project(body)


@router.get("/{project_id}")
def get_project(project_id: UUID):
    try:
        return svc.get_project(str(project_id))
    except ValueError as e:
        _404(e)


@router.post("/{project_id}/assign", status_code=201)
def assign_employee(project_id: UUID, body: AssignmentCreate):
    try:
        return svc.assign_employee(str(project_id), body)
    except ValueError as e:
        _404(e)


@router.get("/{project_id}/team")
def get_project_team(project_id: UUID):
    try:
        return svc.get_project_team(str(project_id))
    except ValueError as e:
        _404(e)

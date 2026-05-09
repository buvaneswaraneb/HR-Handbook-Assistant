from __future__ import annotations
from datetime import date
from uuid import UUID
from fastapi import APIRouter, Header, Query
from typing import Optional

from app.services.e_r_s import leave_service as svc
from app.services.e_r_s.schemas import LeaveRecordCreate
from app.api.auth_context import get_workplace_id

router = APIRouter(prefix="/leave", tags=["Leave Management"])


@router.get("")
def list_leave(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    authorization: Optional[str] = Header(None),
):
    return svc.list_leave(start_date, end_date, get_workplace_id(authorization))


@router.post("", status_code=201)
def create_leave(body: LeaveRecordCreate, authorization: Optional[str] = Header(None)):
    return svc.create_leave(body, get_workplace_id(authorization))


@router.delete("/{leave_id}")
def delete_leave(leave_id: UUID, authorization: Optional[str] = Header(None)):
    return svc.delete_leave(str(leave_id), get_workplace_id(authorization))

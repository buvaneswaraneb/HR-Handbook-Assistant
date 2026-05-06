from __future__ import annotations
from datetime import date
from fastapi import APIRouter, Query

from app.services.e_r_s import leave_service as svc
from app.services.e_r_s.schemas import LeaveRecordCreate

router = APIRouter(prefix="/leave", tags=["Leave Management"])


@router.get("")
def list_leave(
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
):
    return svc.list_leave(start_date, end_date)


@router.post("", status_code=201)
def create_leave(body: LeaveRecordCreate):
    return svc.create_leave(body)

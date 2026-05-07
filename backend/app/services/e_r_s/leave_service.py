from __future__ import annotations
from datetime import date

from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.leave_repo import LeaveRepository
from app.services.e_r_s.schemas import LeaveRecordCreate
from app.services.e_r_s.cache import cached, cache_clear


def _repo() -> LeaveRepository:
    return LeaveRepository(get_db())


@cached(ttl_seconds=30, key_prefix="list_leave")
def list_leave(start_date: date | None = None, end_date: date | None = None) -> list[dict]:
    repo = _repo()
    rows = repo.get_records(start_date, end_date)
    
    result = []
    for row in rows:
        employee = row.get("employees") or {}
        result.append({
            "id": row["id"],
            "employee_id": row["employee_id"],
            "employee_name": employee.get("name", "—"),
            "role": employee.get("role"),
            "team": employee.get("team"),
            "start_date": row["start_date"],
            "end_date": row["end_date"],
            "leave_type": row.get("leave_type", "leave"),
            "status": row.get("status", "approved"),
            "notes": row.get("notes"),
        })
    
    return result


def create_leave(data: LeaveRecordCreate) -> dict:
    repo = _repo()
    payload = data.model_dump(exclude_none=True, mode="json")
    result = repo.create(payload)
    cache_clear("list_leave")
    return result


def delete_leave(leave_id: str) -> dict:
    repo = _repo()
    result = repo.delete(leave_id)
    cache_clear("list_leave")
    return result




def _to_date(value) -> date:
    return date.fromisoformat(value) if isinstance(value, str) else value

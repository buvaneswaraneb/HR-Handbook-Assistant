from __future__ import annotations
from collections import defaultdict
from datetime import date, timedelta

from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.leave_repo import LeaveRepository
from app.services.e_r_s.schemas import LeaveRecordCreate


def _repo() -> LeaveRepository:
    return LeaveRepository(get_db())


def list_leave(start_date: date | None = None, end_date: date | None = None) -> dict:
    repo = _repo()
    total = repo.total_members()
    rows = repo.get_records(start_date, end_date)
    today = date.today()

    on_leave_people = []
    counts_by_day: dict[date, set[str]] = defaultdict(set)

    for row in rows:
        start = _to_date(row["start_date"])
        end = _to_date(row["end_date"])
        employee = row.get("employees") or {}

        if start <= today <= end:
            on_leave_people.append(_person_out(row, employee))

        cursor = max(start, start_date or start)
        last = min(end, end_date or end)
        while cursor <= last:
            counts_by_day[cursor].add(row["employee_id"])
            cursor += timedelta(days=1)

    calendar = []
    for day in sorted(counts_by_day):
        count = len(counts_by_day[day])
        percent = round((count / total) * 100, 2) if total else 0
        calendar.append({
            "date": day.isoformat(),
            "count": count,
            "percent": percent,
            "status": _leave_status(percent),
        })

    return {
        "total_members": total,
        "on_leave_count": len(on_leave_people),
        "leave_people": on_leave_people,
        "calendar": calendar,
    }


def create_leave(data: LeaveRecordCreate) -> dict:
    repo = _repo()
    payload = data.model_dump(exclude_none=True, mode="json")
    return repo.create(payload)


def _to_date(value) -> date:
    return date.fromisoformat(value) if isinstance(value, str) else value


def _leave_status(percent: float) -> str:
    if percent > 10:
        return "red"
    if percent >= 5:
        return "yellow"
    if percent >= 1:
        return "green"
    return "none"


def _person_out(row: dict, employee: dict) -> dict:
    return {
        "employee_id": row["employee_id"],
        "name": employee.get("name", ""),
        "role": employee.get("role"),
        "team": employee.get("team"),
        "start_date": row["start_date"],
        "end_date": row["end_date"],
        "leave_type": row.get("leave_type"),
        "status": row.get("status"),
        "notes": row.get("notes"),
    }

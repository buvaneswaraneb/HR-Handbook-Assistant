from __future__ import annotations
from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.activity_repo import ActivityRepository
from app.services.e_r_s.schemas import ActivityCreate


def get_feed(department: str | None = None, limit: int = 20, workplace_id: str | None = None) -> list[dict]:
    repo = ActivityRepository(get_db())
    return repo.get_feed(department, limit, workplace_id)


def log_activity(data: ActivityCreate, workplace_id: str | None = None) -> dict:
    repo = ActivityRepository(get_db())
    payload = data.model_dump(exclude_none=True, mode="json")
    if workplace_id:
        payload["workplace_id"] = workplace_id
    return repo.create(payload)

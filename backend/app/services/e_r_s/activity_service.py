from __future__ import annotations
from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.activity_repo import ActivityRepository
from app.services.e_r_s.schemas import ActivityCreate


def get_feed(department: str | None = None, limit: int = 20) -> list[dict]:
    repo = ActivityRepository(get_db())
    return repo.get_feed(department, limit)


def log_activity(data: ActivityCreate) -> dict:
    repo = ActivityRepository(get_db())
    payload = data.model_dump(exclude_none=True, mode="json")
    return repo.create(payload)

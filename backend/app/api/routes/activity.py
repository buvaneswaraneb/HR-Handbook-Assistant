from typing import Optional
from fastapi import APIRouter, Query
from app.services.e_r_s import activity_service as svc
from app.services.e_r_s.schemas import ActivityCreate

router = APIRouter(prefix="/activity", tags=["Activity Feed"])


@router.get("/feed")
def get_feed(
    department: Optional[str] = Query(None, description="Filter by department e.g. Engineering, Design, HR"),
    limit: int = Query(20, ge=1, le=100),
):
    """
    Returns recent activity events ordered by newest first.
    Populated automatically by DB triggers (employee joins, file uploads).
    Can also be written to manually via POST.
    """
    return svc.get_feed(department=department, limit=limit)


@router.post("/feed", status_code=201)
def log_activity(body: ActivityCreate):
    """Manually log a project milestone or custom event into the feed."""
    return svc.log_activity(body)

from fastapi import APIRouter, Header, Query
from typing import Optional
from app.services.e_r_s import activity_service as svc
from app.services.e_r_s.schemas import ActivityCreate
from app.api.auth_context import get_workplace_id

router = APIRouter(prefix="/activity", tags=["Activity Feed"])


@router.get("/feed")
def get_feed(
    department: Optional[str] = Query(None, description="Filter by department e.g. Engineering, Design, HR"),
    limit: int = Query(20, ge=1, le=100),
    authorization: Optional[str] = Header(None),
):
    """
    Returns recent activity events ordered by newest first.
    Populated automatically by DB triggers (employee joins, file uploads).
    Can also be written to manually via POST.
    """
    return svc.get_feed(department=department, limit=limit, workplace_id=get_workplace_id(authorization))


@router.post("/feed", status_code=201)
def log_activity(body: ActivityCreate, authorization: Optional[str] = Header(None)):
    """Manually log a project milestone or custom event into the feed."""
    return svc.log_activity(body, get_workplace_id(authorization))

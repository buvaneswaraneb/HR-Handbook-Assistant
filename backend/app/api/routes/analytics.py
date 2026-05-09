from fastapi import APIRouter, Header
from typing import Optional
from app.services.e_r_s import analytics_service as svc
from app.api.auth_context import get_workplace_id

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/summary")
def summary(authorization: Optional[str] = Header(None)):
    """
    Returns:
    - total_employees, active_projects, on_leave, available
    - skill_coverage: list of {skill_name, required, actual} for Radar Chart
    """
    return svc.get_summary(get_workplace_id(authorization))

from fastapi import APIRouter
from app.services.e_r_s import analytics_service as svc

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/summary")
def summary():
    """
    Returns:
    - total_employees, active_projects, on_leave, available
    - skill_coverage: list of {skill_name, required, actual} for Radar Chart
    """
    return svc.get_summary()

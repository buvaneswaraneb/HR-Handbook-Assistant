from uuid import UUID
from fastapi import APIRouter, HTTPException
from app.services.e_r_s import tree_service as svc

router = APIRouter(prefix="/teams", tags=["Teams"])


@router.get("/{manager_id}/tree")
def get_team_tree(manager_id: UUID):
    try:
        return svc.get_team_tree(str(manager_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from app.services.e_r_s import auth_service
from app.services.e_r_s.auth_middleware import get_auth_middleware


def extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def get_current_user(authorization: Optional[str], required: bool = True) -> dict | None:
    token = extract_bearer_token(authorization)
    if not token:
        if required:
            raise HTTPException(status_code=401, detail="Unauthorized")
        return None

    user = get_auth_middleware().get_user_from_token(token)
    if user:
        return user

    try:
        auth_user = auth_service.get_current_user_from_token(token)
        if auth_user:
            return {
                "user_id": auth_user["id"],
                "email": auth_user["email"],
                "raw_token": auth_user,
            }
    except Exception:
        pass

    if required:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return None


def get_workplace_id(authorization: Optional[str], required: bool = True) -> str | None:
    user = get_current_user(authorization, required=required)
    if not user:
        return None
    return str(user["user_id"])

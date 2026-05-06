from __future__ import annotations
from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from datetime import date

from app.services.e_r_s import calendar_service as svc
from app.services.e_r_s.auth_middleware import get_auth_middleware

router = APIRouter(prefix="/calendar", tags=["Calendar"])


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def _get_current_user(authorization: Optional[str]) -> dict:
    """Validate Supabase JWT and get user."""
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    middleware = get_auth_middleware()
    user = middleware.get_user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return user


@router.get("/email")
def get_calendar_email(authorization: Optional[str] = Header(None)):
    """Get the current user's Google Calendar email."""
    user = _get_current_user(authorization)
    try:
        email = svc.get_google_calendar_email(user["user_id"])
        if not email:
            raise HTTPException(status_code=404, detail="Google Calendar email not set")
        return {"email": email}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/credentials")
def get_calendar_credentials(authorization: Optional[str] = Header(None)):
    """Get the current user's Google OAuth token info (sanitized)."""
    user = _get_current_user(authorization)
    try:
        cred = svc.get_google_oauth_token(user["user_id"])
        if not cred:
            raise HTTPException(status_code=404, detail="Google OAuth not connected")
        # Don't return actual tokens, just indicate connection status
        return {
            "connected": True,
            "email": user["email"],
            "expires_at": cred.get("expires_at"),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/sync")
def sync_calendar(authorization: Optional[str] = Header(None)):
    """Trigger calendar sync for current user."""
    user = _get_current_user(authorization)
    try:
        return svc.sync_google_calendar(user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/events")
def get_calendar_events(
    date: Optional[str] = None,
    authorization: Optional[str] = Header(None)
):
    """
    Get calendar events for current user.
    
    This endpoint expects the frontend to fetch events from Google Calendar API
    and pass them to the backend for processing. Currently returns mock data.
    
    Query params:
    - date (optional): ISO date string (e.g., 2025-05-06)
    """
    user = _get_current_user(authorization)
    
    try:
        calendar_email = svc.get_google_calendar_email(user["user_id"])
        if not calendar_email:
            raise ValueError("Google Calendar email not set for this user")

        # TODO: Integrate with Google Calendar API or fetch cached events
        # For now, return placeholder
        return {
            "user_id": user["user_id"],
            "calendar_email": calendar_email,
            "date": date,
            "events": [],
            "message": "Calendar sync integration in progress. Events can be fetched from Google Calendar API.",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

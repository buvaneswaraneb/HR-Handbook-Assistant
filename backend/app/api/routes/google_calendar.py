"""
google_calendar_routes.py — Google Calendar OAuth and sync endpoints.
"""

from __future__ import annotations
import os
from fastapi import APIRouter, HTTPException, Header, Query
from fastapi.responses import RedirectResponse
from typing import Optional

from app.services.e_r_s import supabase_auth_service as auth_svc
from app.services.e_r_s import google_calendar_service as cal_svc

router = APIRouter(prefix="/auth/google/calendar", tags=["Google Calendar"])

def _get_current_user(authorization: Optional[str]) -> dict:
    """Extract and validate current user from Authorization header."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = parts[1]
    try:
        user = auth_svc._get_current_user(f"Bearer {token}")
        return user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

@router.get("/connect")
def connect_google_calendar(
    authorization: Optional[str] = Header(None),
    redirect_uri: str = Query(...)
):
    """
    Start Google Calendar OAuth flow.
    Returns authorization URL that frontend should open in a popup.
    """
    user = _get_current_user(authorization)
    user_id = user.get("user_id")
    
    try:
        callback_redirect = f"{os.getenv('FRONTEND_URL', 'http://localhost:5502')}/google-calendar-callback"
        oauth_url = cal_svc.get_google_oauth_url(user_id, callback_redirect)
        return {"authorization_url": oauth_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate OAuth URL: {str(e)}")

@router.get("/callback")
def handle_oauth_callback(
    code: str = Query(...),
    state: str = Query(...)
):
    """
    Handle Google OAuth callback.
    Google redirects here with authorization code and user_id in state.
    """
    try:
        tokens = cal_svc.exchange_code_for_tokens(code)
        cal_svc.store_google_credentials(state, tokens)
        return {"success": True, "message": "Google Calendar connected successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"OAuth callback failed: {str(e)}")

@router.post("/sync")
def sync_calendar_events(
    authorization: Optional[str] = Header(None)
):
    """
    Sync events from user's Google Calendar.
    Fetches upcoming events and caches them in the database.
    """
    user = _get_current_user(authorization)
    user_id = user.get("user_id")
    
    try:
        events = cal_svc.fetch_google_calendar_events(user_id)
        cal_svc.cache_calendar_events(user_id, events)
        return {
            "success": True,
            "synced_events": len(events),
            "message": f"Synced {len(events)} calendar events"
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")

@router.get("/events")
def get_calendar_events(
    authorization: Optional[str] = Header(None),
    days: int = Query(30, ge=1, le=365)
):
    """
    Get cached calendar events for the current user.
    """
    user = _get_current_user(authorization)
    user_id = user.get("user_id")
    
    try:
        events = cal_svc.get_cached_events(user_id, days)
        return {"events": events, "total": len(events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve events: {str(e)}")

@router.get("/status")
def get_calendar_status(
    authorization: Optional[str] = Header(None)
):
    """
    Check if user has connected Google Calendar.
    """
    user = _get_current_user(authorization)
    user_id = user.get("user_id")
    
    try:
        is_connected = cal_svc.is_google_calendar_connected(user_id)
        return {"connected": is_connected}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check status: {str(e)}")

@router.post("/disconnect")
def disconnect_calendar(
    authorization: Optional[str] = Header(None)
):
    """
    Disconnect Google Calendar and revoke access.
    """
    user = _get_current_user(authorization)
    user_id = user.get("user_id")
    
    try:
        cal_svc.disconnect_google_calendar(user_id)
        return {"success": True, "message": "Google Calendar disconnected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Disconnect failed: {str(e)}")

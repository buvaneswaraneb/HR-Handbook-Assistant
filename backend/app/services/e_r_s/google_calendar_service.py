"""
google_calendar_service.py — Google Calendar integration service.
Handles OAuth flow, event fetching, and caching.
"""

import os
import json
from datetime import datetime, timedelta
from typing import Optional, List
import requests
from supabase import create_client
from app.services.e_r_s.config import get_settings

GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
]

def get_supabase_client():
    """Get Supabase client for database operations."""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_key)

def get_google_oauth_url(user_id: str, redirect_uri: str) -> str:
    """Generate Google OAuth authorization URL."""
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    scope = " ".join(CALENDAR_SCOPES)
    
    return (
        f"{GOOGLE_OAUTH_BASE}?"
        f"client_id={client_id}&"
        f"redirect_uri={redirect_uri}&"
        f"response_type=code&"
        f"scope={scope}&"
        f"access_type=offline&"
        f"prompt=consent&"
        f"state={user_id}"
    )

def exchange_code_for_tokens(code: str) -> dict:
    """Exchange Google OAuth code for access and refresh tokens."""
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    redirect_uri = os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "")
    
    data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    
    response = requests.post(GOOGLE_TOKEN_URL, data=data)
    response.raise_for_status()
    return response.json()

def refresh_access_token(refresh_token: str) -> str:
    """Refresh Google access token using refresh token."""
    client_id = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    
    response = requests.post(GOOGLE_TOKEN_URL, data=data)
    response.raise_for_status()
    tokens = response.json()
    return tokens.get("access_token")

def store_google_credentials(user_id: str, tokens: dict) -> None:
    """Store Google Calendar OAuth credentials in database."""
    db = get_supabase_client()
    
    access_token = tokens.get("access_token")
    refresh_token = tokens.get("refresh_token")
    expires_in = tokens.get("expires_in", 3600)
    
    token_expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
    
    # Upsert credential record
    db.table("google_calendar_credentials").upsert({
        "user_id": user_id,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expires_at": token_expires_at.isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }).execute()

def get_google_credentials(user_id: str) -> Optional[dict]:
    """Retrieve Google Calendar credentials from database."""
    db = get_supabase_client()
    
    result = db.table("google_calendar_credentials").select(
        "access_token, refresh_token, token_expires_at"
    ).eq("user_id", user_id).execute()
    
    if not result.data:
        return None
    
    creds = result.data[0]
    
    # Check if token is expired
    expires_at = datetime.fromisoformat(creds["token_expires_at"])
    if datetime.utcnow() > expires_at:
        # Refresh token
        try:
            new_access_token = refresh_access_token(creds["refresh_token"])
            creds["access_token"] = new_access_token
            # Update in DB
            new_expires_at = datetime.utcnow() + timedelta(seconds=3600)
            db.table("google_calendar_credentials").update({
                "access_token": new_access_token,
                "token_expires_at": new_expires_at.isoformat(),
            }).eq("user_id", user_id).execute()
        except Exception as e:
            print(f"Failed to refresh token for user {user_id}: {e}")
            return None
    
    return creds

def fetch_google_calendar_events(user_id: str) -> List[dict]:
    """Fetch upcoming events from user's Google Calendar."""
    creds = get_google_credentials(user_id)
    if not creds:
        raise ValueError("Google Calendar not connected for this user")
    
    access_token = creds["access_token"]
    headers = {"Authorization": f"Bearer {access_token}"}
    
    # Get events from next 30 days
    now = datetime.utcnow().isoformat() + "Z"
    thirty_days = (datetime.utcnow() + timedelta(days=30)).isoformat() + "Z"
    
    params = {
        "timeMin": now,
        "timeMax": thirty_days,
        "maxResults": 25,
        "singleEvents": True,
        "orderBy": "startTime",
    }
    
    response = requests.get(
        f"{GOOGLE_CALENDAR_API}/calendars/primary/events",
        headers=headers,
        params=params
    )
    response.raise_for_status()
    
    return response.json().get("items", [])

def cache_calendar_events(user_id: str, events: List[dict]) -> None:
    """Cache Google Calendar events in database."""
    db = get_supabase_client()
    
    # Clear old cached events
    db.table("google_calendar_events").delete().eq("user_id", user_id).execute()
    
    # Insert new events
    cached_events = []
    for event in events:
        start = event.get("start", {})
        end = event.get("end", {})
        
        # Handle both dateTime and date formats
        start_time = start.get("dateTime") or start.get("date")
        end_time = end.get("dateTime") or end.get("date")
        
        if start_time and end_time:
            cached_events.append({
                "user_id": user_id,
                "google_event_id": event.get("id"),
                "title": event.get("summary", "Untitled"),
                "description": event.get("description"),
                "start_time": start_time,
                "end_time": end_time,
                "event_url": event.get("htmlLink"),
            })
    
    if cached_events:
        db.table("google_calendar_events").insert(cached_events).execute()

def get_cached_events(user_id: str, days: int = 30) -> List[dict]:
    """Get cached calendar events for a user."""
    db = get_supabase_client()
    
    future_date = (datetime.utcnow() + timedelta(days=days)).isoformat()
    
    result = db.table("google_calendar_events").select(
        "id, title, description, start_time, end_time, event_url"
    ).eq("user_id", user_id).gte(
        "start_time", datetime.utcnow().isoformat()
    ).lte(
        "start_time", future_date
    ).order("start_time", desc=False).execute()
    
    return result.data or []

def disconnect_google_calendar(user_id: str) -> None:
    """Revoke Google Calendar access and delete stored credentials."""
    db = get_supabase_client()
    
    # Delete cached events
    db.table("google_calendar_events").delete().eq("user_id", user_id).execute()
    
    # Delete credentials
    db.table("google_calendar_credentials").delete().eq("user_id", user_id).execute()

def is_google_calendar_connected(user_id: str) -> bool:
    """Check if user has connected Google Calendar."""
    creds = get_google_credentials(user_id)
    return creds is not None

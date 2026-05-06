from __future__ import annotations
import logging
from datetime import datetime, date
from typing import Optional

from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.auth_repo import AuthRepository
from app.services.e_r_s.repositories.employee_repo import EmployeeRepository

logger = logging.getLogger(__name__)


def _auth_repo() -> AuthRepository:
    return AuthRepository(get_db())


def _emp_repo() -> EmployeeRepository:
    return EmployeeRepository(get_db())


def get_google_calendar_email(user_id: str) -> str | None:
    """Get the user's Google Calendar email from employee record."""
    auth_repo = _auth_repo()
    user = auth_repo.get_user_by_id(user_id)
    if not user or not user.get("employee_id"):
        return None

    emp_repo = _emp_repo()
    employee = emp_repo.get_by_id(str(user["employee_id"]))
    if not employee:
        return None

    return employee.get("google_calendar_email")


def get_google_oauth_token(user_id: str) -> dict | None:
    """Get the user's Google OAuth credentials."""
    auth_repo = _auth_repo()
    oauth_cred = auth_repo.get_google_oauth(user_id)
    if not oauth_cred:
        return None

    # Check if access token is expired
    if oauth_cred.get("expires_at"):
        expires_at = datetime.fromisoformat(oauth_cred["expires_at"])
        if datetime.utcnow() > expires_at:
            logger.warning("Google access token expired for user %s", user_id)
            return None

    return {
        "access_token": oauth_cred["access_token"],
        "refresh_token": oauth_cred["refresh_token"],
        "expires_at": oauth_cred["expires_at"],
    }


def update_google_oauth_token(
    user_id: str,
    access_token: str,
    refresh_token: str | None = None,
    expires_at: str | None = None,
) -> dict:
    """Update Google OAuth tokens for user."""
    auth_repo = _auth_repo()
    return auth_repo.update_google_oauth_tokens(
        user_id=user_id,
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
    )


def get_calendar_events(user_id: str, events_data: list) -> dict:
    """
    Process calendar events for the user.
    This assumes the frontend or an external service has fetched events from Google Calendar.
    """
    user = _auth_repo().get_user_by_id(user_id)
    if not user:
        raise ValueError(f"User {user_id} not found")

    return {
        "user_id": user_id,
        "email": user["email"],
        "calendar_email": get_google_calendar_email(user_id),
        "events": events_data,
        "synced_at": datetime.utcnow().isoformat(),
    }


def sync_google_calendar(user_id: str) -> dict:
    """
    Sync Google Calendar for the user.
    This endpoint returns the necessary info for the frontend to perform the sync,
    or can integrate with a service that handles Google Calendar API calls.
    """
    auth_repo = _auth_repo()
    emp_repo = _emp_repo()

    user = auth_repo.get_user_by_id(user_id)
    if not user:
        raise ValueError(f"User {user_id} not found")

    oauth_cred = auth_repo.get_google_oauth(user_id)
    if not oauth_cred:
        raise ValueError("Google OAuth not connected for this user")

    calendar_email = get_google_calendar_email(user_id)
    if not calendar_email:
        raise ValueError("Google Calendar email not set for this user")

    # Update employee's synced_at timestamp
    if user.get("employee_id"):
        emp_repo.update(str(user["employee_id"]), {"google_calendar_synced_at": datetime.utcnow().isoformat()})

    return {
        "message": "Calendar sync initiated",
        "user_id": user_id,
        "calendar_email": calendar_email,
        "synced_at": datetime.utcnow().isoformat(),
    }

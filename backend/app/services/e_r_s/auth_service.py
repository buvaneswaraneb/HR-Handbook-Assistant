from __future__ import annotations
import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional

from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.auth_repo import AuthRepository
from app.services.e_r_s.repositories.employee_repo import EmployeeRepository
from app.services.e_r_s.auth_schemas import (
    LoginRequest, SignupRequest, AuthResponse, GoogleOAuthToken, UserProfile, ChangePasswordRequest
)

logger = logging.getLogger(__name__)


def _auth_repo() -> AuthRepository:
    return AuthRepository(get_db())


def _emp_repo() -> EmployeeRepository:
    return EmployeeRepository(get_db())


def _generate_tokens() -> tuple[str, str]:
    """Generate access and refresh tokens."""
    access_token = secrets.token_urlsafe(32)
    refresh_token = secrets.token_urlsafe(32)
    return access_token, refresh_token


def signup(data: SignupRequest) -> AuthResponse:
    """Register a new user with email and password."""
    auth_repo = _auth_repo()

    # Check if user already exists
    existing = auth_repo.get_user_by_email(data.email)
    if existing:
        raise ValueError(f"User with email {data.email} already exists")

    # Create user
    user = auth_repo.create_user(
        email=data.email,
        first_name=data.first_name,
        last_name=data.last_name,
        password=data.password,
    )

    # Create session
    access_token, refresh_token = _generate_tokens()
    auth_repo.create_session(user["id"], access_token, refresh_token)

    return AuthResponse(
        user_id=user["id"],
        email=user["email"],
        first_name=user.get("first_name"),
        last_name=user.get("last_name"),
        employee_id=user.get("employee_id"),
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=(datetime.utcnow() + timedelta(hours=24)).isoformat(),
    )


def login(data: LoginRequest) -> AuthResponse:
    """Login with email and password."""
    auth_repo = _auth_repo()

    user = auth_repo.get_user_by_email(data.email)
    if not user:
        raise ValueError("Invalid email or password")

    if not user.get("password_hash"):
        raise ValueError("This account uses OAuth. Please sign in with Google.")

    if not auth_repo.verify_password(data.password, user["password_hash"]):
        raise ValueError("Invalid email or password")

    if not user.get("is_active"):
        raise ValueError("This account is inactive")

    # Create session
    access_token, refresh_token = _generate_tokens()
    auth_repo.create_session(user["id"], access_token, refresh_token)

    return AuthResponse(
        user_id=user["id"],
        email=user["email"],
        first_name=user.get("first_name"),
        last_name=user.get("last_name"),
        employee_id=user.get("employee_id"),
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=(datetime.utcnow() + timedelta(hours=24)).isoformat(),
    )


def handle_google_oauth(google_token: GoogleOAuthToken) -> AuthResponse:
    """Handle Google OAuth token exchange and user creation/update."""
    auth_repo = _auth_repo()

    # Try to find user by google_id
    oauth_cred = auth_repo.get_google_oauth_by_google_id(google_token.google_id)

    if oauth_cred:
        # User exists — update tokens
        user_id = oauth_cred["user_id"]
        auth_repo.update_google_oauth_tokens(
            user_id=user_id,
            access_token=google_token.access_token,
            refresh_token=google_token.refresh_token,
            expires_at=google_token.expires_at.isoformat() if google_token.expires_at else None,
        )
    else:
        # New user — create account
        existing_user = auth_repo.get_user_by_email(google_token.email)
        if existing_user:
            # User exists with this email from email/password signup — link OAuth
            user_id = existing_user["id"]
        else:
            # Create new user via OAuth
            names = google_token.email.split("@")[0].split(".")
            first_name = names[0].capitalize() if names else "User"
            last_name = names[1].capitalize() if len(names) > 1 else ""
            user = auth_repo.create_user_oauth_only(
                email=google_token.email,
                first_name=first_name,
                last_name=last_name,
            )
            user_id = user["id"]

        # Save Google OAuth credentials
        auth_repo.upsert_google_oauth(
            user_id=user_id,
            google_id=google_token.google_id,
            email=google_token.email,
            access_token=google_token.access_token,
            refresh_token=google_token.refresh_token,
            expires_at=google_token.expires_at.isoformat() if google_token.expires_at else None,
        )

    # Create session
    user = auth_repo.get_user_by_id(user_id)
    access_token, refresh_token = _generate_tokens()
    auth_repo.create_session(user_id, access_token, refresh_token)

    return AuthResponse(
        user_id=user["id"],
        email=user["email"],
        first_name=user.get("first_name"),
        last_name=user.get("last_name"),
        employee_id=user.get("employee_id"),
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=(datetime.utcnow() + timedelta(hours=24)).isoformat(),
    )


def get_user_profile(user_id: str) -> UserProfile:
    """Get authenticated user's profile."""
    auth_repo = _auth_repo()
    user = auth_repo.get_user_by_id(user_id)
    if not user:
        raise ValueError(f"User {user_id} not found")

    oauth_cred = auth_repo.get_google_oauth(user_id)

    return UserProfile(
        user_id=user["id"],
        email=user["email"],
        first_name=user.get("first_name"),
        last_name=user.get("last_name"),
        employee_id=user.get("employee_id"),
        google_oauth_connected=oauth_cred is not None,
        google_email=oauth_cred["email"] if oauth_cred else None,
        is_active=user.get("is_active", True),
        created_at=user.get("created_at"),
        updated_at=user.get("updated_at"),
    )


def change_password(user_id: str, data: ChangePasswordRequest) -> dict:
    """Change user password."""
    auth_repo = _auth_repo()
    user = auth_repo.get_user_by_id(user_id)
    if not user:
        raise ValueError(f"User {user_id} not found")

    if not auth_repo.verify_password(data.current_password, user.get("password_hash") or ""):
        raise ValueError("Current password is incorrect")

    auth_repo.update_user(user_id, {"password_hash": auth_repo._AuthRepository__class__._hash_password(data.new_password)})
    # Invalidate all sessions
    auth_repo.invalidate_all_user_sessions(user_id)

    return {"message": "Password changed. Please log in again."}


def logout(access_token: str) -> dict:
    """Logout — invalidate session."""
    auth_repo = _auth_repo()
    auth_repo.invalidate_session(access_token)
    return {"message": "Logged out"}


def get_current_user_from_token(access_token: str) -> dict | None:
    """Validate token and return user."""
    auth_repo = _auth_repo()
    session = auth_repo.get_session_by_token(access_token)
    if not session:
        return None

    # Check if token expired
    if session.get("expires_at"):
        expires_at = datetime.fromisoformat(session["expires_at"])
        if datetime.utcnow() > expires_at:
            auth_repo.invalidate_session(access_token)
            return None

    # Update last used
    try:
        auth_repo.update_session_last_used(session["id"])
    except Exception:
        pass  # Non-critical

    user = auth_repo.get_user_by_id(session["user_id"])
    return user

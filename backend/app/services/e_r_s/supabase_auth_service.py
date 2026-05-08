from __future__ import annotations
import logging
from datetime import datetime, timezone
from uuid import UUID

from app.services.e_r_s.db import get_auth_db, get_db
from app.services.e_r_s.repositories.auth_repo import AuthRepository
from app.services.e_r_s.repositories.employee_repo import EmployeeRepository
from app.services.e_r_s.auth_schemas import AuthResponse, LoginRequest, SignupRequest, UserProfile

logger = logging.getLogger(__name__)


def _auth_repo() -> AuthRepository:
    return AuthRepository(get_db())


def _emp_repo() -> EmployeeRepository:
    return EmployeeRepository(get_db())


def _read_auth_attr(obj, key: str, default=None):
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _normalize_expires_at(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    return value


def _auth_response_from_supabase(auth_result) -> AuthResponse:
    user = _read_auth_attr(auth_result, "user")
    session = _read_auth_attr(auth_result, "session")
    if not user or not session:
        raise ValueError("Supabase did not return a valid session")

    user_id = _read_auth_attr(user, "id")
    email = _read_auth_attr(user, "email")
    metadata = _read_auth_attr(user, "user_metadata", {}) or {}
    if not user_id or not email:
        raise ValueError("Supabase did not return a valid user")

    local_user = get_or_create_user_from_supabase(user_id, email)
    first_name = local_user.get("first_name") or metadata.get("first_name") or metadata.get("given_name")
    last_name = local_user.get("last_name") or metadata.get("last_name") or metadata.get("family_name")

    return AuthResponse(
        user_id=user_id,
        email=email,
        first_name=first_name,
        last_name=last_name,
        employee_id=local_user.get("employee_id"),
        access_token=_read_auth_attr(session, "access_token"),
        refresh_token=_read_auth_attr(session, "refresh_token"),
        expires_at=_normalize_expires_at(_read_auth_attr(session, "expires_at")),
        password_configured=bool(local_user.get("password_hash")),
    )


def get_email_auth_status(email: str) -> dict:
    """Return whether this email already has a local password configured."""
    user = _auth_repo().get_user_by_email(email)
    return {
        "email": email,
        "exists": bool(user),
        "password_configured": bool(user and user.get("password_hash")),
    }


def start_email_otp(email: str, redirect_to: str | None = None) -> dict:
    """
    Send a Supabase email OTP. should_create_user=True lets first-time users
    receive a code and become Supabase Auth users after verification.
    """
    try:
        options = {"should_create_user": True}
        if redirect_to:
            options["email_redirect_to"] = redirect_to

        get_auth_db().auth.sign_in_with_otp({
            "email": email,
            "options": options,
        })
        return {"email": email, "message": "Verification code sent"}
    except Exception as e:
        raise ValueError(f"Could not send verification code: {e}")


def verify_email_otp(email: str, token: str) -> AuthResponse:
    """Verify a Supabase email OTP and return an authenticated session."""
    try:
        result = get_auth_db().auth.verify_otp({
            "email": email,
            "token": token,
            "type": "email",
        })
        return _auth_response_from_supabase(result)
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Invalid or expired verification code: {e}")


def signup_with_password(data: SignupRequest) -> AuthResponse:
    """Register a user through Supabase email/password auth."""
    try:
        result = get_auth_db().auth.sign_up({
            "email": data.email,
            "password": data.password,
            "options": {
                "data": {
                    "first_name": data.first_name,
                    "last_name": data.last_name,
                    "full_name": f"{data.first_name} {data.last_name}".strip(),
                }
            },
        })
        return _auth_response_from_supabase(result)
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Supabase signup failed: {e}")


def login_with_password(data: LoginRequest) -> AuthResponse:
    """Authenticate a user through Supabase email/password auth."""
    try:
        result = get_auth_db().auth.sign_in_with_password({
            "email": data.email,
            "password": data.password,
        })
        return _auth_response_from_supabase(result)
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"Invalid email or password: {e}")


def set_password_for_user(user_id: str, email: str, password: str) -> dict:
    """Set the local app password after a Supabase-authenticated magic-link login."""
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")

    auth_repo = _auth_repo()
    user = auth_repo.get_user_by_id(user_id) or auth_repo.get_user_by_email(email)
    if not user:
        user = get_or_create_user_from_supabase(user_id, email)

    updated = auth_repo.set_password(user["id"], password)
    return {
        "message": "Password configured",
        "password_configured": bool(updated.get("password_hash")),
    }


def get_or_create_user_from_supabase(supabase_user_id: str, email: str) -> dict:
    """
    Get or create a user record from Supabase auth user.
    Supabase provides user_id and email from the JWT.
    """
    auth_repo = _auth_repo()
    
    # Try to find user by email
    user = auth_repo.get_user_by_email(email)
    if user:
        return user

    # User doesn't exist in our DB yet — create record
    # Use Supabase user_id as our user_id
    from datetime import datetime
    user_data = {
        "id": supabase_user_id,
        "email": email,
        "first_name": email.split("@")[0].capitalize(),
        "last_name": "",
        "is_active": True,
        "password_hash": None,  # OAuth only
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    
    try:
        result = get_db().table("users").insert(user_data).execute()
        return result.data[0]
    except Exception as e:
        logger.warning(f"Could not create user {email}: {e}")
        # Return minimal user data if insert fails (user may already exist)
        return {
            "id": supabase_user_id,
            "email": email,
            "first_name": email.split("@")[0],
            "last_name": "",
        }


def link_user_to_employee(user_id: str, employee_id: str) -> dict:
    """Link authenticated user to an employee record."""
    auth_repo = _auth_repo()
    try:
        return auth_repo.link_user_to_employee(user_id, employee_id)
    except Exception as e:
        raise ValueError(f"Could not link user to employee: {e}")


def get_user_employee(user_id: str) -> dict | None:
    """Get the employee record linked to this user."""
    auth_repo = _auth_repo()
    user = auth_repo.get_user_by_id(user_id)
    if not user or not user.get("employee_id"):
        return None

    emp_repo = _emp_repo()
    return emp_repo.get_by_id(str(user["employee_id"]))


def get_user_workspace(user_id: str) -> dict:
    """Get the user's workspace/workplace info based on their employee record."""
    employee = get_user_employee(user_id)
    if not employee:
        return {"workplace": None, "department": None, "team": None}

    return {
        "employee_id": employee.get("id"),
        "name": employee.get("name"),
        "role": employee.get("role"),
        "workplace": employee.get("team"),  # team as workplace
        "department": employee.get("team"),
        "manager_id": employee.get("manager_id"),
    }


def get_user_profile_from_supabase(supabase_user_id: str, email: str) -> UserProfile:
    """
    Build user profile from Supabase auth and local DB.
    Called after successful Supabase OAuth.
    """
    user = get_or_create_user_from_supabase(supabase_user_id, email)
    employee = get_user_employee(user["id"])
    
    return UserProfile(
        user_id=user["id"],
        email=user["email"],
        first_name=user.get("first_name"),
        last_name=user.get("last_name"),
        employee_id=employee.get("id") if employee else None,
        google_oauth_connected=False,
        google_email=None,
        password_configured=bool(user.get("password_hash")),
        is_active=user.get("is_active", True),
        created_at=user.get("created_at"),
        updated_at=user.get("updated_at"),
    )


def get_user_workspace_team(user_id: str) -> list[dict]:
    """Get all employees in the user's team/workplace."""
    employee = get_user_employee(user_id)
    if not employee or not employee.get("team"):
        return []

    emp_repo = _emp_repo()
    # Get all employees in same team
    return emp_repo.search({"team": employee["team"]})

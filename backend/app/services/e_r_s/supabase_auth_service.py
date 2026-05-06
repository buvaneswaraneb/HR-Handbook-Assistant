from __future__ import annotations
import logging
from uuid import UUID

from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.auth_repo import AuthRepository
from app.services.e_r_s.repositories.employee_repo import EmployeeRepository
from app.services.e_r_s.auth_schemas import UserProfile

logger = logging.getLogger(__name__)


def _auth_repo() -> AuthRepository:
    return AuthRepository(get_db())


def _emp_repo() -> EmployeeRepository:
    return EmployeeRepository(get_db())


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

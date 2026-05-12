from __future__ import annotations
import os
from urllib.parse import urlencode
from fastapi import APIRouter, HTTPException, Header, Query
from fastapi.responses import RedirectResponse
from typing import Optional
from pydantic import BaseModel

from app.services.e_r_s.auth_middleware import get_auth_middleware
from app.services.e_r_s import supabase_auth_service as svc
from app.services.e_r_s import auth_service
from app.services.e_r_s.auth_schemas import UserProfile, LoginRequest, SignupRequest

router = APIRouter(prefix="/auth", tags=["Authentication"])


class LinkEmployeeRequest(BaseModel):
    employee_id: str


class EmailOtpStartRequest(BaseModel):
    email: str
    redirect_to: Optional[str] = None


class EmailOtpVerifyRequest(BaseModel):
    email: str
    token: str


class SetPasswordRequest(BaseModel):
    password: str


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None


def _get_current_user(authorization: Optional[str]) -> dict:
    """Validate token and get user (supports both Supabase JWT and custom tokens)."""
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Try Supabase JWT first
    middleware = get_auth_middleware()
    user = middleware.get_user_from_token(token)
    if user:
        return user

    # Fall back to custom token from email/password login
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

    raise HTTPException(status_code=401, detail="Invalid or expired token")


@router.get("/google/login")
def google_login(
    redirect_to: str = Query(..., description="Frontend URL that will receive the Supabase OAuth hash")
):
    """
    Start Google OAuth through Supabase without exposing Supabase project keys
    in the frontend. The browser opens this endpoint in a popup; FastAPI then
    redirects to Supabase's hosted Google provider flow.
    """
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not supabase_url:
        raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured")

    query = urlencode({
        "provider": "google",
        "redirect_to": redirect_to,
        "scopes": "email profile",
    })
    return RedirectResponse(f"{supabase_url}/auth/v1/authorize?{query}")


@router.post("/callback")
def oauth_callback():
    """
    Supabase OAuth callback reference endpoint.
    The browser receives Supabase's URL fragment and posts the session back to
    the opener window; use /auth/me with the JWT to load the backend profile.
    """
    return {
        "message": "OAuth callback handled by frontend popup. Use /auth/me to get user profile."
    }


@router.post("/email/start")
def start_email_otp(body: EmailOtpStartRequest):
    """
    Send a Supabase email OTP. First-time users are created by Supabase when
    they successfully verify the emailed code.
    """
    try:
        return svc.start_email_otp(body.email, body.redirect_to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/email/status")
def email_auth_status(email: str = Query(...)):
    """
    Check whether a local app password exists for this email before choosing
    password login or magic-link login.
    """
    try:
        return svc.get_email_auth_status(email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/email/verify")
def verify_email_otp(body: EmailOtpVerifyRequest):
    """
    Verify a Supabase email OTP and return a Supabase JWT session.
    """
    try:
        return svc.verify_email_otp(body.email, body.token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/password")
def set_password(body: SetPasswordRequest, authorization: Optional[str] = Header(None)):
    """
    Set the local app password after a verified Supabase magic-link login.
    """
    user = _get_current_user(authorization)
    try:
        return svc.set_password_for_user(user["user_id"], user["email"], body.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login")
def login(body: LoginRequest):
    """
    Login with Supabase email/password auth.
    Returns a Supabase access token that can be used with /auth/me.
    """
    try:
        return svc.login_with_password(body)
    except ValueError as e:
        try:
            return auth_service.login(body)
        except ValueError:
            raise HTTPException(status_code=401, detail=str(e))
        except Exception:
            raise HTTPException(status_code=401, detail=str(e))


@router.post("/signup")
def signup(body: SignupRequest):
    """
    Register with Supabase email/password auth.
    """
    try:
        return svc.signup_with_password(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/me")
def get_me(authorization: Optional[str] = Header(None)):
    """
    Get current authenticated user's profile.
    Uses Supabase JWT token from Authorization header.

    Returns user profile with employee and workspace info.
    """
    user = _get_current_user(authorization)

    try:
        profile = svc.get_user_profile_from_supabase(user["user_id"], user["email"])
        return profile
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not load profile: {str(e)}")


@router.post("/link-employee")
def link_employee(
    body: LinkEmployeeRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Link authenticated user to an employee record.
    This associates the logged-in user with their employee profile.

    Required after initial OAuth signup.
    """
    user = _get_current_user(authorization)

    try:
        result = svc.link_user_to_employee(user["user_id"], body.employee_id)
        profile = svc.get_user_profile_from_supabase(user["user_id"], user["email"])
        return {
            "message": "User linked to employee",
            "profile": profile
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Link failed: {str(e)}")


@router.get("/workspace")
def get_workspace(authorization: Optional[str] = Header(None)):
    """
    Get current user's workspace/team/department context.
    Returns employee, team, and department information.
    """
    user = _get_current_user(authorization)

    try:
        workspace = svc.get_user_workspace(user["user_id"])
        return workspace
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not load workspace: {str(e)}")


@router.get("/team")
def get_team(authorization: Optional[str] = Header(None)):
    """
    Get all employees in the current user's team/workplace.
    """
    user = _get_current_user(authorization)

    try:
        team = svc.get_user_workspace_team(user["user_id"])
        return {
            "team": team,
            "count": len(team)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not load team: {str(e)}")

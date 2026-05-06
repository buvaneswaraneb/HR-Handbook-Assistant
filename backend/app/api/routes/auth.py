from __future__ import annotations
from fastapi import APIRouter, HTTPException, Header
from typing import Optional

from app.services.e_r_s import auth_service as svc
from app.services.e_r_s.auth_schemas import (
    LoginRequest, SignupRequest, GoogleCallbackRequest, UserProfile
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/signup")
def signup(body: SignupRequest):
    """Register a new user with email and password."""
    try:
        return svc.signup(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Signup failed")


@router.post("/login")
def login(body: LoginRequest):
    """Login with email and password."""
    try:
        return svc.login(body)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Login failed")


@router.get("/me")
def get_profile(authorization: Optional[str] = Header(None)):
    """Get current user's profile."""
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    user = svc.get_current_user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    try:
        return svc.get_user_profile(user["id"])
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/logout")
def logout(authorization: Optional[str] = Header(None)):
    """Logout — invalidate current session."""
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    return svc.logout(token)


@router.post("/google-callback")
def google_callback(body: GoogleCallbackRequest):
    """
    Handle Google OAuth callback.
    Frontend should exchange Google auth code for tokens via Google API,
    then send the resulting access_token here.
    This is a simplified flow — in production, do token exchange server-side.
    """
    raise HTTPException(
        status_code=501,
        detail="Google callback not yet fully implemented. See documentation."
    )


# ── Utilities ─────────────────────────────────────────────────────────────────
def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    if not authorization:
        return None
    parts = authorization.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1]
    return None

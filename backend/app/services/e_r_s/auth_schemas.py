from __future__ import annotations
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


# ── Login / Sign up ───────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    first_name: str
    last_name: str


class AuthResponse(BaseModel):
    user_id: UUID
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    employee_id: Optional[UUID] = None
    access_token: str
    refresh_token: Optional[str] = None
    expires_at: Optional[datetime] = None


# ── Google OAuth ──────────────────────────────────────────────────────────────
class GoogleOAuthToken(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    expires_at: Optional[datetime] = None
    email: str
    google_id: str


class GoogleCallbackRequest(BaseModel):
    code: str
    state: Optional[str] = None


# ── User Profile ──────────────────────────────────────────────────────────────
class UserProfile(BaseModel):
    user_id: UUID
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    employee_id: Optional[UUID] = None
    google_oauth_connected: bool = False
    google_email: Optional[str] = None
    is_active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)

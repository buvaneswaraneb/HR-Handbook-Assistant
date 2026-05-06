from __future__ import annotations
from datetime import datetime, timedelta
from uuid import UUID
from supabase import Client
import hashlib
import secrets


class AuthRepository:
    def __init__(self, db: Client):
        self.db = db

    # ── User CRUD ─────────────────────────────────────────────────────────────
    def get_user_by_email(self, email: str) -> dict | None:
        res = self.db.table("users").select("*").eq("email", email).single().execute()
        return res.data

    def get_user_by_id(self, user_id: str) -> dict | None:
        res = self.db.table("users").select("*").eq("id", user_id).single().execute()
        return res.data

    def create_user(self, email: str, first_name: str, last_name: str, password: str) -> dict:
        password_hash = self._hash_password(password)
        payload = {
            "email": email,
            "password_hash": password_hash,
            "first_name": first_name,
            "last_name": last_name,
            "is_active": True,
        }
        return self.db.table("users").insert(payload).execute().data[0]

    def create_user_oauth_only(self, email: str, first_name: str, last_name: str) -> dict:
        """Create user account via Google OAuth (no password)."""
        payload = {
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "is_active": True,
            "password_hash": None,
        }
        return self.db.table("users").insert(payload).execute().data[0]

    def update_user(self, user_id: str, payload: dict) -> dict:
        payload["updated_at"] = datetime.utcnow().isoformat()
        return (
            self.db.table("users")
            .update(payload)
            .eq("id", user_id)
            .execute()
            .data[0]
        )

    def link_user_to_employee(self, user_id: str, employee_id: str) -> dict:
        return self.update_user(user_id, {"employee_id": employee_id})

    # ── Sessions ──────────────────────────────────────────────────────────────
    def create_session(
        self, user_id: str, access_token: str, refresh_token: str | None = None, expires_in_hours: int = 24
    ) -> dict:
        expires_at = (datetime.utcnow() + timedelta(hours=expires_in_hours)).isoformat()
        payload = {
            "user_id": user_id,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
        }
        return self.db.table("sessions").insert(payload).execute().data[0]

    def get_session_by_token(self, access_token: str) -> dict | None:
        res = (
            self.db.table("sessions")
            .select("*")
            .eq("access_token", access_token)
            .single()
            .execute()
        )
        return res.data

    def update_session_last_used(self, session_id: str) -> dict:
        return (
            self.db.table("sessions")
            .update({"last_used_at": datetime.utcnow().isoformat()})
            .eq("id", session_id)
            .execute()
            .data[0]
        )

    def invalidate_session(self, access_token: str) -> None:
        self.db.table("sessions").delete().eq("access_token", access_token).execute()

    def invalidate_all_user_sessions(self, user_id: str) -> None:
        self.db.table("sessions").delete().eq("user_id", user_id).execute()

    # ── Google OAuth Credentials ──────────────────────────────────────────────
    def get_google_oauth(self, user_id: str) -> dict | None:
        res = (
            self.db.table("google_oauth_credentials")
            .select("*")
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        return res.data

    def get_google_oauth_by_google_id(self, google_id: str) -> dict | None:
        res = (
            self.db.table("google_oauth_credentials")
            .select("*")
            .eq("google_id", google_id)
            .single()
            .execute()
        )
        return res.data

    def upsert_google_oauth(
        self,
        user_id: str,
        google_id: str,
        email: str,
        access_token: str,
        refresh_token: str | None = None,
        expires_at: str | None = None,
    ) -> dict:
        payload = {
            "user_id": user_id,
            "google_id": google_id,
            "email": email,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
        }
        return (
            self.db.table("google_oauth_credentials")
            .upsert(payload, on_conflict="user_id")
            .execute()
            .data[0]
        )

    def update_google_oauth_tokens(
        self,
        user_id: str,
        access_token: str,
        refresh_token: str | None = None,
        expires_at: str | None = None,
    ) -> dict:
        payload = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "updated_at": datetime.utcnow().isoformat(),
        }
        return (
            self.db.table("google_oauth_credentials")
            .update(payload)
            .eq("user_id", user_id)
            .execute()
            .data[0]
        )

    # ── Utilities ─────────────────────────────────────────────────────────────
    @staticmethod
    def _hash_password(password: str) -> str:
        """Hash password with salt."""
        salt = secrets.token_hex(32)
        hash_obj = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
        return f"{salt}${hash_obj.hex()}"

    @staticmethod
    def verify_password(password: str, password_hash: str) -> bool:
        """Verify password against hash."""
        try:
            salt, hash_hex = password_hash.split("$")
            hash_obj = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000)
            return hash_obj.hex() == hash_hex
        except Exception:
            return False

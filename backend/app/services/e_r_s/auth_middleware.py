from __future__ import annotations
import os
import logging
import jwt
from typing import Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class SupabaseAuthMiddleware:
    """Validate Supabase JWT tokens in Authorization header."""

    def __init__(self):
        self.supabase_url = os.getenv("SUPABASE_URL", "")
        self.supabase_key = os.getenv("SUPABASE_ANON_KEY", "")
        self.jwt_secret = os.getenv("SUPABASE_JWT_SECRET", "")

    def extract_token(self, authorization: Optional[str]) -> Optional[str]:
        """Extract Bearer token from Authorization header."""
        if not authorization:
            return None
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
        return None

    def verify_token(self, token: str) -> dict | None:
        """
        Verify Supabase JWT token.
        Returns decoded token if valid, None otherwise.
        """
        if not token or not self.jwt_secret:
            return None

        try:
            # Decode JWT without verification first to get algorithm
            unverified = jwt.decode(token, options={"verify_signature": False})
            
            # Verify with secret
            decoded = jwt.decode(
                token,
                self.jwt_secret,
                algorithms=["HS256"],
                options={"verify_exp": True}
            )
            return decoded
        except jwt.ExpiredSignatureError:
            logger.warning("Token expired")
            return None
        except jwt.InvalidTokenError as e:
            logger.warning(f"Invalid token: {e}")
            return None
        except Exception as e:
            logger.warning(f"Token verification error: {e}")
            return None

    def get_user_from_token(self, token: str) -> dict | None:
        """
        Decode token and extract user info.
        Returns: {"user_id": "uuid", "email": "user@example.com", "raw_token": decoded_token}
        """
        decoded = self.verify_token(token)
        if not decoded:
            return None

        # Supabase JWT structure
        user_id = decoded.get("sub")  # subject is user_id in Supabase
        email = decoded.get("email")
        
        if not user_id:
            return None

        return {
            "user_id": user_id,
            "email": email,
            "raw_token": decoded,
        }


# Singleton instance
_middleware: SupabaseAuthMiddleware | None = None


def get_auth_middleware() -> SupabaseAuthMiddleware:
    global _middleware
    if _middleware is None:
        _middleware = SupabaseAuthMiddleware()
    return _middleware

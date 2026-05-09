from __future__ import annotations
import os
import logging
import jwt
from typing import Optional

from app.services.e_r_s.config import get_settings

logger = logging.getLogger(__name__)


class SupabaseAuthMiddleware:
    """Validate Supabase JWT tokens in Authorization header."""

    def __init__(self):
        settings = get_settings()
        self.supabase_url = (os.getenv("SUPABASE_URL") or settings.supabase_url or "").rstrip("/")
        self.supabase_key = os.getenv("SUPABASE_ANON_KEY") or settings.supabase_anon_key
        self.jwt_secret = os.getenv("SUPABASE_JWT_SECRET") or settings.supabase_jwt_secret or ""
        self.issuer = f"{self.supabase_url}/auth/v1" if self.supabase_url else None
        self.jwks_url = f"{self.issuer}/.well-known/jwks.json" if self.issuer else None
        self._jwks_client = jwt.PyJWKClient(self.jwks_url) if self.jwks_url else None

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
        if not token:
            return None

        try:
            header = jwt.get_unverified_header(token)
            algorithm = header.get("alg")
            if algorithm == "HS256":
                return self._verify_hs256_token(token)
            if algorithm in {"ES256", "RS256"}:
                return self._verify_jwks_token(token, algorithm)

            logger.warning("Unsupported Supabase token algorithm: %s", algorithm)
            return None
        except jwt.ExpiredSignatureError:
            logger.warning("Token expired")
            return None
        except jwt.InvalidTokenError as e:
            logger.warning("Invalid token: %s", e)
            return None
        except Exception as e:
            logger.warning("Token verification error: %s", e)
            return None

    def _verify_hs256_token(self, token: str) -> dict | None:
        if not self.jwt_secret:
            return None
        return jwt.decode(
            token,
            self.jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            issuer=self.issuer,
            options={"verify_exp": True, "verify_iss": bool(self.issuer)},
        )

    def _verify_jwks_token(self, token: str, algorithm: str) -> dict | None:
        if not self._jwks_client:
            return None
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=[algorithm],
                audience="authenticated",
                issuer=self.issuer,
                options={"verify_exp": True, "verify_iss": bool(self.issuer)},
            )
        except jwt.InvalidAudienceError:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            decoded = jwt.decode(
                token,
                signing_key.key,
                algorithms=[algorithm],
                issuer=self.issuer,
                options={"verify_exp": True, "verify_aud": False, "verify_iss": bool(self.issuer)},
            )
            return decoded

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

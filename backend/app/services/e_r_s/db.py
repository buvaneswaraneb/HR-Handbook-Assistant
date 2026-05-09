from supabase import create_client, Client
from app.services.e_r_s.config import get_settings


def get_db() -> Client:
    """Create a fresh Supabase client for the current request path."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_key)


def get_auth_db() -> Client:
    """Create a fresh Supabase auth client for the current request path."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_anon_key or s.supabase_key)

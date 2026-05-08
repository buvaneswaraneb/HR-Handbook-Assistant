from functools import lru_cache
from supabase import create_client, Client
from app.services.e_r_s.config import get_settings


@lru_cache
def get_db() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_key)


@lru_cache
def get_auth_db() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_anon_key or s.supabase_key)

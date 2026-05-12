from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings

ROOT_ENV_FILE = Path(__file__).resolve().parents[4] / ".env"


class Settings(BaseSettings):
    supabase_url: str
    supabase_key: str          # service-role key (bypasses RLS)xx
    supabase_anon_key: str = ""
    supabase_jwt_secret: str = ""
    log_level: str = "INFO"
    groq_api_key: str = ""
    cloudinary_url: str = ""
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    cloudinary_folder: str = "hr-assistant"

    class Config:
        env_file = str(ROOT_ENV_FILE)
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()

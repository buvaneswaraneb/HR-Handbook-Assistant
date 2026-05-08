from __future__ import annotations
import html
import logging
import mimetypes
import re
from urllib.parse import urlparse
from uuid import UUID

import requests

from app.services.e_r_s.db import get_db
from app.services.e_r_s import file_service
from app.services.e_r_s.repositories.employee_repo import EmployeeRepository
from app.services.e_r_s.repositories.skill_repo import SkillRepository
from app.services.e_r_s.schemas import (
    EmployeeCreate, EmployeeUpdate, AvailabilityUpdate,
    EmployeeSkillCreate, EmployeeSkillUpdate, ExperienceCreate,
    EmployeeOut, BulkEmployeeItem, BulkUploadResult,
)
from app.services.e_r_s.utils.serializer import build_employee_out
from app.services.e_r_s.cache import cached, cache_clear, cache_delete

logger = logging.getLogger(__name__)
_LINKEDIN_META_PATTERNS = (
    r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']',
    r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']',
    r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
)


def _repos():
    db = get_db()
    return EmployeeRepository(db), SkillRepository(db)


@cached(ttl_seconds=30, key_prefix="list_employees")
def list_employees() -> list[dict]:
    emp_repo, _ = _repos()
    employees = emp_repo.get_all()
    return [_enrich(e, emp_repo) for e in employees]


@cached(ttl_seconds=30, key_prefix="get_employee")
def get_employee(emp_id: str) -> dict:
    emp_repo, _ = _repos()
    emp = emp_repo.get_by_id(emp_id)
    if not emp:
        raise ValueError(f"Employee {emp_id} not found")
    return _enrich(emp, emp_repo)


def create_employee(data: EmployeeCreate) -> dict:
    emp_repo, _ = _repos()
    payload = data.model_dump(exclude_none=True, mode="json")
    skills = payload.pop("skills", [])
    emp = emp_repo.create(payload)
    cache_clear("list_employees")
    for skill in skills:
        add_skill(emp["id"], EmployeeSkillCreate(**skill))
    return _enrich(emp, emp_repo)


def update_employee(emp_id: str, data: EmployeeUpdate) -> dict:
    emp_repo, _ = _repos()
    payload = data.model_dump(exclude_none=True, mode="json")
    skills = payload.pop("skills", [])
    emp = emp_repo.update(emp_id, payload) if payload else emp_repo.get_by_id(emp_id)
    if not emp:
        raise ValueError(f"Employee {emp_id} not found")
    cache_clear("list_employees")
    cache_delete(f"get_employee:{emp_id}")
    for skill in skills:
        add_skill(emp_id, EmployeeSkillCreate(**skill))
    return _enrich(emp, emp_repo)


def patch_availability(emp_id: str, data: AvailabilityUpdate) -> dict:
    emp_repo, _ = _repos()
    emp = emp_repo.update(emp_id, {"availability": data.availability})
    cache_clear("list_employees")
    cache_delete(f"get_employee:{emp_id}")
    return _enrich(emp, emp_repo)


def delete_employee(emp_id: str) -> None:
    emp_repo, _ = _repos()
    emp = emp_repo.get_by_id(emp_id)
    if not emp:
        raise ValueError(f"Employee {emp_id} not found")
    emp_repo.delete(emp_id)
    cache_clear("list_employees")
    cache_delete(f"get_employee:{emp_id}")


def add_skill(emp_id: str, data: EmployeeSkillCreate) -> dict:
    emp_repo, skill_repo = _repos()
    skill = skill_repo.get_or_create(data.skill_name)
    payload = {
        "employee_id": emp_id,
        "skill_id": skill["id"],
        "skill_level": data.skill_level,
        "experience_years_with_skill": data.experience_years_with_skill,
        "notes": data.notes,
    }
    emp_repo.upsert_skill({k: v for k, v in payload.items() if v is not None})
    cache_delete(f"get_employee:{emp_id}")
    return get_employee(emp_id)


def update_skill(emp_id: str, skill_id: str, data: EmployeeSkillUpdate) -> dict:
    emp_repo, _ = _repos()
    emp_repo.update_skill(emp_id, skill_id, data.model_dump(exclude_none=True))
    cache_delete(f"get_employee:{emp_id}")
    return get_employee(emp_id)


def add_experience(emp_id: str, data: ExperienceCreate) -> dict:
    emp_repo, _ = _repos()
    payload = data.model_dump(exclude_none=True, mode="json")
    payload["employee_id"] = emp_id
    emp_repo.add_experience(payload)
    cache_delete(f"get_employee:{emp_id}")
    return get_employee(emp_id)


def search_employees(filters: dict) -> list[dict]:
    emp_repo, skill_repo = _repos()

    # skill filter requires join — handled separately
    skill_name = filters.pop("skill", None)
    employees = emp_repo.search(filters)

    if skill_name:
        emp_ids = skill_repo.get_employee_ids_by_skill(skill_name)
        employees = [e for e in employees if e["id"] in emp_ids]

    return [_enrich(e, emp_repo) for e in employees]


def resolve_linkedin_avatar(profile_url: str) -> dict:
    if not profile_url:
        raise ValueError("Please provide a LinkedIn profile or image URL.")

    source_url = profile_url.strip()
    parsed = urlparse(source_url)
    host = (parsed.hostname or "").lower()
    if "licdn.com" in host or _looks_like_image_url(source_url):
        media_url = source_url
    elif "linkedin.com" in host:
        try:
            response = requests.get(
                source_url,
                headers=_web_headers(),
                timeout=12,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise ValueError("Could not reach the LinkedIn profile page.") from exc

        page = response.text or ""
        media_url = None
        for pattern in _LINKEDIN_META_PATTERNS:
            match = re.search(pattern, page, re.IGNORECASE)
            if match:
                media_url = html.unescape(match.group(1))
                break
        if not media_url:
            raise ValueError("Could not find a public profile image on that LinkedIn page.")
    else:
        raise ValueError("Please provide a LinkedIn profile, LinkedIn media URL, or direct image URL.")

    try:
        image_response = requests.get(
            media_url,
            headers=_web_headers(referer=source_url if "linkedin.com" in host else "https://www.linkedin.com/"),
            timeout=20,
        )
        image_response.raise_for_status()
    except requests.RequestException as exc:
        raise ValueError("Could not download the LinkedIn profile image.") from exc

    content_type = image_response.headers.get("Content-Type", "").split(";")[0].strip().lower()
    if not content_type.startswith("image/"):
        raise ValueError("LinkedIn did not return a usable image.")

    extension = mimetypes.guess_extension(content_type) or ".jpg"
    uploaded = file_service.upload_cloudinary_bytes(
        contents=image_response.content,
        filename=f"linkedin-avatar{extension}",
        department="avatars",
        description="LinkedIn profile image",
    )
    if not uploaded.get("secure_url"):
        raise ValueError("Profile image upload failed.")

    return {
        "avatar_url": uploaded["secure_url"],
        "source_url": media_url,
        "storage_provider": "cloudinary",
    }


def _web_headers(referer: str | None = None) -> dict:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    }
    if referer:
        headers["Referer"] = referer
    return headers


def _looks_like_image_url(url: str) -> bool:
    path = (urlparse(url).path or "").lower()
    return path.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg"))


def bulk_upload(items: list[BulkEmployeeItem]) -> BulkUploadResult:
    result = BulkUploadResult()
    for item in items:
        try:
            emp = create_employee(EmployeeCreate(**item.model_dump(exclude={"skills", "experience"})))
            emp_id = emp["id"]
            for sk in item.skills:
                add_skill(emp_id, sk)
            for ex in item.experience:
                add_experience(emp_id, ex)
            result.success.append(emp_id)
        except Exception as e:
            logger.warning("Bulk upload failed for %s: %s", item.email, e)
            result.failed.append({"email": item.email, "error": str(e)})
    cache_clear("list_employees")
    return result


# ── internal helper ───────────────────────────────────────────────────────────
def _enrich(emp: dict, emp_repo: EmployeeRepository) -> dict:
    eid = emp["id"]
    raw_skills = emp_repo.get_skills(eid)
    raw_exp    = emp_repo.get_experience(eid)
    raw_proj   = emp_repo.get_projects(eid)
    return build_employee_out(emp, raw_skills, raw_exp, raw_proj)

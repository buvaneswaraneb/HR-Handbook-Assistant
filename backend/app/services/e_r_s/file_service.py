from __future__ import annotations
import logging
import re
import uuid
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import unquote, urlparse

from fastapi import UploadFile

from app.services.e_r_s.config import get_settings
from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.file_repo import FileRepository
from app.services.e_r_s.schemas import FileLinkRequest

# RAG / vector-store service is offline — import only for type checking.
if TYPE_CHECKING:
    from app.services.ingestion.vector_store import VectorStore

logger = logging.getLogger(__name__)

CLOUDINARY_PREFIX = "cloudinary://"


def list_files(
    project_id: str | None = None,
    department: str | None = None,
    workplace_id: str | None = None,
) -> list[dict]:
    records = FileRepository(get_db()).get_all(project_id, department, workplace_id)
    return [_with_cloudinary_fields(record) for record in records]


def upload_file(
    file: UploadFile,
    project_id: str | None,
    department: str | None,
    uploaded_by: str | None,
    description: str | None,
    workplace_id: str | None = None,
) -> dict:
    return upload_file_bytes(
        contents=file.file.read(),
        filename=file.filename or "upload",
        content_type=file.content_type,
        project_id=project_id,
        department=department,
        uploaded_by=uploaded_by,
        description=description,
        workplace_id=workplace_id,
    )


def upload_file_bytes(
    contents: bytes,
    filename: str,
    content_type: str | None,
    project_id: str | None = None,
    department: str | None = None,
    uploaded_by: str | None = None,
    description: str | None = None,
    workplace_id: str | None = None,
) -> dict:
    if not contents:
        raise ValueError("Cannot upload an empty file")

    repo = FileRepository(get_db())
    cloudinary_result = _upload_to_cloudinary(
        contents=contents,
        filename=filename,
        department=department,
        description=description,
    )

    record = {
        "filename": filename,
        "storage_path": _cloudinary_ref(
            cloudinary_result["resource_type"],
            cloudinary_result["public_id"],
        ),
        "mime_type": content_type,
        "size_bytes": len(contents),
        "project_id": project_id,
        "department": department,
        "uploaded_by": uploaded_by,
        "description": description,
    }
    if workplace_id:
        record["workplace_id"] = workplace_id
    try:
        created = repo.create({k: v for k, v in record.items() if v is not None})
    except Exception:
        public_id = cloudinary_result.get("public_id")
        resource_type = cloudinary_result.get("resource_type", "image")
        if public_id:
            try:
                _destroy_cloudinary_asset(public_id, resource_type)
            except Exception as cleanup_exc:
                logger.warning("Cloudinary cleanup failed for %s: %s", public_id, cleanup_exc)
        raise

    return _with_cloudinary_fields(
        created,
        secure_url=cloudinary_result.get("secure_url"),
        asset_id=cloudinary_result.get("asset_id"),
    )


def upload_cloudinary_bytes(
    contents: bytes,
    filename: str,
    department: str | None = None,
    description: str | None = None,
) -> dict:
    if not contents:
        raise ValueError("Cannot upload an empty file")

    result = _upload_to_cloudinary(
        contents=contents,
        filename=filename,
        department=department,
        description=description,
    )
    return {
        "url": result.get("secure_url"),
        "secure_url": result.get("secure_url"),
        "cloudinary_public_id": result.get("public_id"),
        "cloudinary_resource_type": result.get("resource_type", "image"),
        "cloudinary_asset_id": result.get("asset_id"),
    }


def link_file(file_id: str, data: FileLinkRequest, workplace_id: str | None = None) -> dict:
    repo = FileRepository(get_db())
    return _with_cloudinary_fields(repo.update(file_id, data.model_dump(exclude_none=True, mode="json"), workplace_id))


def delete_file(
    file_id: str,
    vector_store: "VectorStore | None" = None,
    workplace_id: str | None = None,
) -> None:
    db   = get_db()
    repo = FileRepository(db)
    rec  = repo.get_by_id(file_id, workplace_id)
    if rec:
        filename = rec.get("filename")
        if filename and vector_store is not None:
            # RAG service offline — only clean up vectors if a store was supplied.
            try:
                removed_vectors = vector_store.delete_by_source(filename, workplace_id=workplace_id)
                logger.info("Deleted %d vector chunks for file %s", removed_vectors, filename)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Vector cleanup failed for %s: %s", filename, exc)

        resource_type, public_id = _parse_cloudinary_ref(rec.get("storage_path", ""))
        try:
            if public_id:
                _destroy_cloudinary_asset(public_id, resource_type)
        except Exception as exc:
            logger.warning("Cloudinary delete failed for %s: %s", rec.get("storage_path"), exc)
        repo.delete(file_id, workplace_id)


def _upload_to_cloudinary(
    contents: bytes,
    filename: str,
    department: str | None,
    description: str | None,
) -> dict:
    cloudinary, uploader, _ = _cloudinary_modules()
    settings = _configure_cloudinary(cloudinary)
    folder = _cloudinary_folder(settings.cloudinary_folder, department)
    stream = BytesIO(contents)
    stream.name = filename

    return uploader.upload(
        stream,
        resource_type="auto",
        folder=folder,
        public_id=_public_id(filename),
        use_filename=False,
        unique_filename=False,
        overwrite=False,
        context={
            "filename": filename,
            "department": department or "general",
            "description": description or "",
        },
    )


def _destroy_cloudinary_asset(public_id: str, resource_type: str) -> None:
    cloudinary, uploader, _ = _cloudinary_modules()
    _configure_cloudinary(cloudinary)
    uploader.destroy(public_id, resource_type=resource_type, invalidate=True)


def _cloudinary_modules():
    try:
        import cloudinary
        import cloudinary.uploader
        from cloudinary.utils import cloudinary_url
    except ImportError as exc:
        raise RuntimeError("Cloudinary dependency is missing. Run pip install -r requirements.txt.") from exc
    return cloudinary, cloudinary.uploader, cloudinary_url


def _configure_cloudinary(cloudinary_module) -> object:
    settings = get_settings()
    cloud_name = settings.cloudinary_cloud_name
    api_key = settings.cloudinary_api_key
    api_secret = settings.cloudinary_api_secret

    if settings.cloudinary_url:
        parsed = urlparse(settings.cloudinary_url)
        if parsed.scheme != "cloudinary" or not parsed.hostname:
            raise RuntimeError("CLOUDINARY_URL must look like cloudinary://api_key:api_secret@cloud_name")
        cloud_name = parsed.hostname
        api_key = unquote(parsed.username or "")
        api_secret = unquote(parsed.password or "")

    missing = [
        name for name, value in (
            ("CLOUDINARY_CLOUD_NAME", cloud_name),
            ("CLOUDINARY_API_KEY", api_key),
            ("CLOUDINARY_API_SECRET", api_secret),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            "Cloudinary credentials are not configured. Set "
            f"{', '.join(missing)} in the repo-root .env, or set CLOUDINARY_URL."
        )

    cloudinary_module.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        secure=True,
    )
    return settings


def _with_cloudinary_fields(
    record: dict,
    secure_url: str | None = None,
    asset_id: str | None = None,
) -> dict:
    resource_type, public_id = _parse_cloudinary_ref(record.get("storage_path", ""))
    enriched = dict(record)
    if public_id:
        enriched["storage_provider"] = "cloudinary"
        enriched["cloudinary_public_id"] = public_id
        enriched["cloudinary_resource_type"] = resource_type
        enriched["url"] = secure_url or _cloudinary_url(public_id, resource_type)
        enriched["secure_url"] = enriched["url"]
    if asset_id:
        enriched["cloudinary_asset_id"] = asset_id
    return enriched


def _cloudinary_url(public_id: str, resource_type: str) -> str | None:
    try:
        cloudinary, _, cloudinary_url = _cloudinary_modules()
        _configure_cloudinary(cloudinary)
        return cloudinary_url(public_id, resource_type=resource_type, secure=True)[0]
    except Exception as exc:
        logger.debug("Could not build Cloudinary URL for %s: %s", public_id, exc)
        return None


def _cloudinary_ref(resource_type: str, public_id: str) -> str:
    return f"{CLOUDINARY_PREFIX}{resource_type}/{public_id}"


def _parse_cloudinary_ref(storage_path: str) -> tuple[str, str | None]:
    if not storage_path.startswith(CLOUDINARY_PREFIX):
        return "image", None
    remainder = storage_path[len(CLOUDINARY_PREFIX):]
    if "/" not in remainder:
        return "image", None
    resource_type, public_id = remainder.split("/", 1)
    return resource_type or "image", public_id or None


def _cloudinary_folder(base_folder: str, department: str | None) -> str:
    parts = [_slug(base_folder) or "hr-assistant", _slug(department) or "general"]
    return "/".join(parts)


def _public_id(filename: str) -> str:
    stem = Path(filename).stem or "file"
    return f"{uuid.uuid4()}-{_slug(stem) or 'file'}"


def _slug(value: str | None) -> str:
    if not value:
        return ""
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip()).strip("-_").lower()
    return slug[:80]

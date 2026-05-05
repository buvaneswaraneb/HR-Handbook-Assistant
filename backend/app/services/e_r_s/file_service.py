from __future__ import annotations
import logging
import uuid
from fastapi import UploadFile

from app.services.e_r_s.db import get_db
from app.services.e_r_s.repositories.file_repo import FileRepository
from app.services.e_r_s.schemas import FileLinkRequest

logger = logging.getLogger(__name__)

BUCKET = "assets"   # create this bucket in Supabase Storage → New bucket → "assets" (public or private)


def list_files(project_id: str | None = None, department: str | None = None) -> list[dict]:
    return FileRepository(get_db()).get_all(project_id, department)


def upload_file(
    file: UploadFile,
    project_id: str | None,
    department: str | None,
    uploaded_by: str | None,
    description: str | None,
) -> dict:
    db = get_db()
    repo = FileRepository(db)

    ext          = file.filename.rsplit(".", 1)[-1] if "." in file.filename else ""
    storage_path = f"{department or 'general'}/{uuid.uuid4()}.{ext}"
    contents     = file.file.read()

    # Upload to Supabase Storage
    db.storage.from_(BUCKET).upload(
        path=storage_path,
        file=contents,
        file_options={"content-type": file.content_type or "application/octet-stream"},
    )

    record = {
        "filename":     file.filename,
        "storage_path": storage_path,
        "mime_type":    file.content_type,
        "size_bytes":   len(contents),
        "project_id":   project_id,
        "department":   department,
        "uploaded_by":  uploaded_by,
        "description":  description,
    }
    return repo.create({k: v for k, v in record.items() if v is not None})


def link_file(file_id: str, data: FileLinkRequest) -> dict:
    repo = FileRepository(get_db())
    return repo.update(file_id, data.model_dump(exclude_none=True, mode="json"))


def delete_file(file_id: str) -> None:
    db   = get_db()
    repo = FileRepository(db)
    rec  = repo.get_by_id(file_id)
    if rec:
        try:
            db.storage.from_(BUCKET).remove([rec["storage_path"]])
        except Exception as exc:
            logger.warning("Storage delete failed for %s: %s", rec["storage_path"], exc)
        repo.delete(file_id)

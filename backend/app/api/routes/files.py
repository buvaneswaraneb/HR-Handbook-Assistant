from typing import Optional
from uuid import UUID
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from app.services.e_r_s import file_service as svc
from app.services.e_r_s.schemas import FileLinkRequest

router = APIRouter(prefix="/sb/files", tags=["Files & Assets"])


@router.get("")
def list_files(
    project_id: Optional[UUID] = Query(None),
    department: Optional[str]  = Query(None),
):
    """List uploaded files. Optionally filter by project or department."""
    return svc.list_files(
        project_id=str(project_id) if project_id else None,
        department=department,
    )


@router.post("/upload", status_code=201)
def upload_file(
    file:        UploadFile  = File(...),
    project_id:  Optional[str] = Form(None),
    department:  Optional[str] = Form(None),
    uploaded_by: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
):
    """
    Upload a file to Supabase Storage and record metadata in the files table.
    The file is automatically linked to the activity feed via a DB trigger.

    Form fields:
    - project_id  (UUID, optional) — links asset to a project
    - department  (string, optional) — e.g. "Design", "Engineering", "HR"
    - uploaded_by (UUID, optional) — employee who uploaded
    - description (string, optional)
    """
    try:
        return svc.upload_file(
            file=file,
            project_id=project_id,
            department=department,
            uploaded_by=uploaded_by,
            description=description,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")


@router.patch("/{file_id}/link")
def link_file(file_id: UUID, body: FileLinkRequest):
    """Link an already-uploaded file to a project or department after the fact."""
    try:
        return svc.link_file(str(file_id), body)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: UUID):
    """Delete file record and remove from Supabase Storage."""
    svc.delete_file(str(file_id))

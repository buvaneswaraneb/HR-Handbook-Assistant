"""
file_fetch.py — Upload / Download routes as an APIRouter.

Registered in main.py via:
    app.include_router(file_router)

UPLOAD_DIR is anchored to backend/app/data/raw-docs-cache/ using __file__
so it resolves correctly regardless of the working directory.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

# __file__ == backend/app/services/upload-downloader/file_fetch.py
# .parent.parent.parent == backend/app
# / "data" / "raw-docs-cache" == backend/app/data/raw-docs-cache
UPLOAD_DIR = (
    Path(__file__).resolve().parent.parent.parent / "data" / "raw-docs-cache"
)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

file_router = APIRouter(tags=["files"])


# ── Upload ────────────────────────────────────────────────────────────────────
@file_router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    filename = os.path.basename(file.filename)
    file_path = UPLOAD_DIR / filename

    content = await file.read()
    file_path.write_bytes(content)

    return {"message": "Uploaded", "filename": filename}


# ── Download ──────────────────────────────────────────────────────────────────
@file_router.get("/download/{filename}")
def download_file(filename: str):
    file_path = UPLOAD_DIR / filename

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=str(file_path),
        filename=filename,
        media_type="application/octet-stream",
    )


# ── List files ────────────────────────────────────────────────────────────────
@file_router.get("/files")
def list_files():
    files = [f.name for f in UPLOAD_DIR.iterdir() if f.is_file()]
    return {"files": files}


# ── Delete ────────────────────────────────────────────────────────────────────
@file_router.delete("/files/delete/{filename}")
def delete_file(filename: str):
    # os.path.basename guards against path-traversal (e.g. ../../etc/passwd)
    safe_name = os.path.basename(filename)
    file_path = UPLOAD_DIR / safe_name

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File '{safe_name}' not found")

    file_path.unlink()
    return {"message": "Deleted", "filename": safe_name}
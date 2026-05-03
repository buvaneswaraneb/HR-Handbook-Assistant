import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse

app = FastAPI()

UPLOAD_DIR = "raw-docs-cache/" 
os.makedirs(UPLOAD_DIR, exist_ok=True)


# 📤 Upload API
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename")

    filename = os.path.basename(file.filename)
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    return {"message": "Uploaded", "filename": filename}


# Download API
@app.get("/download/{filename}")
def download_file(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream"
    )


# List files (optional but useful)
@app.get("/files")
def list_files():
    files = os.listdir(UPLOAD_DIR)
    return {"files": files}
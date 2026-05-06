# HR RAG API Documentation

**Base URL:** `http://localhost:8000`

**API Version:** 1.0.0

**Description:** Document ingestion + LLM-powered Q&A over company PDFs. The API provides endpoints for managing documents (upload, download, list, delete), ingesting them into a vector store, and querying against them using a RAG (Retrieval Augmented Generation) architecture.

---

## Table of Contents

1. [Health & Status](#health--status)
2. [Document Management](#document-management)
3. [Ingestion](#ingestion)
4. [Query](#query)
---

## Health & Status

### GET /

**Description:** Simple greeting endpoint to verify API is running.

**Request:**
```bash
curl -X GET "http://localhost:8000/"
```

**Response:** `200 OK`
```json
"hello welcome to PRJ006"
```

---

### GET /health

**Description:** Health check endpoint to verify API status.

**Request:**
```bash
curl -X GET "http://localhost:8000/health"
```

**Response:** `200 OK`
```json
{
  "status": "ok"
}
```

---

## Document Management

### POST /upload

**Description:** Upload a PDF file to the cache directory (`backend/app/data/raw-docs-cache/`).

**Request:**
```bash
curl -X POST "http://localhost:8000/upload" \
  -H "accept: application/json" \
  -F "file=@path/to/document.pdf"
```

**Parameters:**
- `file` (required, FormData): PDF file to upload

**Response:** `200 OK`
```json
{
  "message": "Uploaded",
  "filename": "document.pdf"
}
```

**Error Responses:**
- `400 Bad Request`: No filename provided
```json
{
  "detail": "No filename provided"
}
```

---

### GET /files

**Description:** List all files currently in the cache directory.

**Request:**
```bash
curl -X GET "http://localhost:8000/files"
```

**Response:** `200 OK`
```json
{
  "files": [
    "employee_handbook.pdf",
    "hr_policies.pdf",
    "benefits_guide.pdf"
  ]
}
```

---

### GET /download/{filename}

**Description:** Download a file from the cache directory.

**Request:**
```bash
curl -X GET "http://localhost:8000/download/employee_handbook.pdf" \
  -H "accept: application/octet-stream" \
  -o employee_handbook.pdf
```

**Path Parameters:**
- `filename` (required, string): Name of the file to download

**Response:** `200 OK`
- Returns the file as binary data with appropriate headers

**Error Responses:**
- `404 Not Found`: File does not exist
```json
{
  "detail": "File not found"
}
```

---

### DELETE /files/delete/{filename}

**Description:** Delete a file from the cache directory.

**Request:**
```bash
curl -X DELETE "http://localhost:8000/files/delete/old_document.pdf"
```

**Path Parameters:**
- `filename` (required, string): Name of the file to delete

**Response:** `200 OK`
```json
{
  "message": "Deleted",
  "filename": "old_document.pdf"
}
```

**Error Responses:**
- `404 Not Found`: File does not exist
```json
{
  "detail": "File 'old_document.pdf' not found"
}
```

---

## Ingestion

### POST /ingest

**Description:** Ingest all PDF files in the cache directory (`backend/app/data/raw-docs-cache/`) into the vector store. This process:
1. Loads all PDF files from the cache
2. Chunks them into smaller pieces
3. Embeds chunks using sentence-transformers
4. Stores embeddings in the FAISS vector store
5. Caches processed metadata

**Request:**
```bash
curl -X POST "http://localhost:8000/ingest" \
  -H "accept: application/json"
```

**Request Body:** None

**Response:** `200 OK`
```json
{
  "status": "ok",
  "processed": [
    "employee_handbook.pdf",
    "hr_policies.pdf"
  ],
  "skipped": [
    "corrupted_file.pdf"
  ],
  "failed": [],
  "duration_s": 12.45
}
```

**Response Fields:**
- `status` (string): "ok" if all succeeded, "partial" if any failed
- `processed` (array): List of successfully ingested files
- `skipped` (array): List of files skipped (e.g., already processed)
- `failed` (array): List of files that failed to process
- `duration_s` (float): Time taken to complete ingestion in seconds

**Error Responses:**
- `409 Conflict`: Ingestion already in progress
```json
{
  "detail": "Ingestion already in progress"
}
```

- `503 Service Unavailable`: Store not initialized
```json
{
  "detail": "Store not initialised"
}
```

---

### GET /ingest/status

**Description:** Get current vector store statistics and ingestion status.

**Request:**
```bash
curl -X GET "http://localhost:8000/ingest/status"
```

**Response:** `200 OK`
```json
{
  "total_vectors": 1250,
  "docs_processed": 3
}
```

**Response Fields:**
- `total_vectors` (integer): Total number of embedded chunks in the vector store
- `docs_processed` (integer): Number of documents that have been ingested

**Error Responses:**
- `503 Service Unavailable`: Store not initialized
```json
{
  "detail": "Store not initialised"
}
```

---

## Query

### POST /query

**Description:** Ask a natural language question against ingested documents. This endpoint:
1. Embeds the user's question
2. Retrieves similar chunks from the vector store (FAISS similarity search)
3. Formats retrieved chunks as context
4. Sends context + question to Groq LLM (llama-3.1-8b-instant)
5. Returns the LLM's answer with citations

**Request:**
```bash
curl -X POST "http://localhost:8000/query" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is the health insurance policy?"
  }'
```

**Request Body:**
```json
{
  "question": "What is the health insurance policy?"
}
```

**Request Fields:**
- `question` (string, required): The question to ask about the ingested documents

**Response:** `200 OK`
```json
{
  "answer": "According to the HR policies document, the health insurance policy provides comprehensive medical coverage for all full-time employees and their eligible dependents. The company covers 80% of premium costs, and employees are responsible for the remaining 20%.",
  "sources": [
    {
      "file": "hr_policies.pdf",
      "page": 5,
      "chunk_id": "chunk_42"
    },
    {
      "file": "hr_policies.pdf",
      "page": 6,
      "chunk_id": "chunk_43"
    }
  ],
  "context_preview": [
    {
      "text": "Health Insurance: The company provides comprehensive medical coverage to all full-time employees...",
      "file": "hr_policies.pdf",
      "page": 5
    },
    {
      "text": "Employee contribution is 20% of the premium cost, with the company covering the remaining 80%...",
      "file": "hr_policies.pdf",
      "page": 6
    }
  ]
}
```

**Response Fields:**
- `answer` (string): The LLM-generated answer to the question
- `sources` (array): List of source documents/chunks used to generate the answer
  - `file` (string): PDF filename
  - `page` (integer): Page number in the PDF
  - `chunk_id` (string): Internal chunk identifier
- `context_preview` (array): Preview of the actual text chunks used
  - `text` (string): Excerpt from the document
  - `file` (string): PDF filename
  - `page` (integer): Page number

**Error Responses:**
- `400 Bad Request`: Missing documents or invalid query
```json
{
  "detail": "No documents ingested yet. POST to /ingest first."
}
```

- `400 Bad Request`: Invalid question format
```json
{
  "detail": "Question must be a non-empty string"
}
```

- `503 Service Unavailable`: Query engine not initialized
```json
{
  "detail": "Query engine not initialised"
}
```

- `500 Internal Server Error`: LLM query failed
```json
{
  "detail": "LLM query failed"
}
```

---

## Typical Workflow

### 1. Upload Documents
```bash
# Upload multiple PDFs
curl -X POST "http://localhost:8000/upload" -F "file=@employee_handbook.pdf"
curl -X POST "http://localhost:8000/upload" -F "file=@hr_policies.pdf"
curl -X POST "http://localhost:8000/upload" -F "file=@benefits_guide.pdf"
```

### 2. List Uploaded Files
```bash
curl -X GET "http://localhost:8000/files"
```

### 3. Ingest Documents
```bash
curl -X POST "http://localhost:8000/ingest"
```

### 4. Check Ingestion Status
```bash
curl -X GET "http://localhost:8000/ingest/status"
```

### 5. Query Documents
```bash
curl -X POST "http://localhost:8000/query" \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the vacation policies?"}'
```

---

## Configuration & Limits

### Query Configuration
- **Model:** Groq llama-3.1-8b-instant
- **Max Tokens:** 1024
- **Score Threshold:** 0.30 (minimum cosine similarity)
- **Candidate K:** 5 (chunks retrieved before filtering)
- **Context Token Budget:** ~4000 tokens (~16,000 characters)
- **Batch Size:** 10 (max chunks per API call)

### File Upload
- **Supported Format:** PDF
- **Upload Directory:** `backend/app/data/raw-docs-cache/`
- **Concurrent Uploads:** Unlimited

### Ingestion
- **Embedding Model:** Sentence-transformers (all-MiniLM-L6-v2)
- **Vector Store:** FAISS (in-memory)
- **Storage Location:** `backend/app/data/faiss-store/`

---

## CORS Policy

The API has CORS enabled with the following configuration:
- **Allow Origins:** `*` (all origins)
- **Allow Methods:** `*` (all HTTP methods)
- **Allow Headers:** `*` (all headers)

---

## Logging

Query logs are written hourly to:
```
backend/app/logs/DD-MM-YY-HH:00.log
```

Each log file contains:
- Query timestamp
- User question
- Retrieved documents and chunks
- LLM response
- Processing duration
- Any errors or warnings

---

## Authentication

Currently, the API does not require authentication. All endpoints are publicly accessible.

---

## Rate Limiting

No rate limiting is currently implemented. Large volumes of concurrent requests may impact performance.


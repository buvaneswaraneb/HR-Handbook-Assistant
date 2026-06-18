# Osmium Architecture

The Osmium backend is now composed of three independently deployable microservices backed by Supabase pgvector.

## 1. backend (formerly main-service)
- **Responsibilities**: Handles PDF file uploads, validation, and file registry management via `backend/app/api/main.py`. It also dispatches jobs to the `ingestion_jobs` queue.
- **Endpoints**: `POST /upload`, `GET /files`, `GET /files/{file_id}/download`, `DELETE /files/{file_id}`, `GET /health`, `GET /ingest/status`.
- **Database**: Connects to Supabase to update the `files` and `ingestion_jobs` tables. Uploads raw PDFs to Supabase Storage bucket `pdf-uploads`.

## 2. chunker-service
- **Responsibilities**: A background worker that polls the `ingestion_jobs` table. It downloads the PDF from Supabase storage, extracts text, chunks it semantically, generates embeddings using `SentenceTransformers (all-MiniLM-L6-v2)`, and upserts the chunks into the `chunks` table.
- **Endpoints**: `GET /health`.

## 3. rag-service
- **Responsibilities**: Handles user Q&A queries. It rewrites queries using Groq, embeds the variants, performs a pgvector cosine similarity search on the `chunks` table, and then synthesizes the answer using Groq.
- **Endpoints**: `POST /query`, `GET /health`.

## Running Locally
To run locally, you will need to start all three services in separate terminals.

```bash
# Terminal 1: backend (main-service)
cd backend
uvicorn app.api.main:app --port 8000 --reload

# Terminal 2: chunker-service
cd chunker-service
uvicorn main:app --port 8002

# Terminal 3: rag-service
cd rag-service
uvicorn main:app --port 8003
```

## Database / Job Queue
- We replaced FAISS with **Supabase pgvector**.
- The `files` table holds metadata and state.
- The `chunks` table holds semantic text chunks and `vector(384)` embeddings, with an `ivfflat` index on cosine similarity.
- The `ingestion_jobs` table acts as a lightweight queue without needing Redis or RabbitMQ. `main-service` inserts pending jobs, and `chunker-service` polls them and updates their status.

## Frontend Impact
Since the monolith was split into microservices, the frontend `LOCAL_API_BASE` (port 8000) targets `main-service` for uploads and file management. We updated `frontend/osmium/modules/api.js` so that `queryRAG` hits `http://localhost:8003/query` directly to talk to `rag-service`.

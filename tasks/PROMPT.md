# PROMPT.md — Agent Prompt: Osmium Three-Service Migration

Paste this prompt into Claude Code (or your preferred AI coding agent) at the root of the Osmium project.

---

```
You are a senior Python backend engineer migrating the Osmium HR Handbook RAG service from a single monolithic FastAPI app into three independently deployable microservices. Read TASK.md in full before writing any code. Everything you need to know about the current architecture, the target architecture, the Supabase schema, the job queue design, and the ordered task list is in that file.

## Your job

Work through TASK.md top to bottom. For each phase, complete all tasks in that phase before moving to the next.

## Hard rules

1. Create three service folders at the project root: main-service/, chunker-service/, and rag-service/. Run `git init` inside each one.
2. Do NOT prescribe a fixed internal file structure. Decide the optimal layout for each service based on its responsibilities. Keep it simple; do not over-engineer.
3. Do NOT add Redis, RabbitMQ, or Celery. The job queue is a Supabase table called ingestion_jobs.
4. Do NOT modify frontend code unless an API contract changed. If it changed, document it in a BREAKING_CHANGES.md inside the affected service folder.
5. Each service must be independently startable. No shared in-process imports across service boundaries.
6. Use pgvector (<=> cosine operator) for all vector search. Normalize embeddings (L2 norm) before inserting.
7. All Supabase access uses the service-role key. It must never appear in any frontend-facing response.
8. Every service must expose GET /health returning {"status": "ok"}.
9. Write SQL migration files (plain .sql) for the files, chunks, and ingestion_jobs tables including the pgvector extension enable statement. Place migrations in a top-level migrations/ folder at the project root (not inside any service folder).
10. Write a top-level ARCHITECTURE.md explaining the three services, the Supabase tables, the job queue flow, how to run all three locally, and how they are deployed.

## What each service owns

**main-service**
- POST /upload — validate PDF, generate file_id/source_name/doc_hash, upload to Supabase Storage, insert files row (status=processing), insert ingestion_jobs row (status=pending), return {file_id, status}.
- GET /files — list files rows for the workspace.
- GET /files/{file_id}/download — stream PDF from Supabase Storage.
- DELETE /files/{file_id} — delete chunks rows by source_name, delete PDF from Storage, delete files row.
- GET /health and GET /ingest/status.
- No embedding, no LLM calls.

**chunker-service**
- Poll ingestion_jobs table for pending rows, claim by setting status=running.
- Download PDF from Supabase Storage.
- Extract text with pypdf, chunk with semantic overlapping chunker, embed with SentenceTransformers all-MiniLM-L6-v2.
- Delete stale chunks rows for the same doc_hash + workspace_id before upserting.
- Batch upsert chunk rows (chunk_id, file_id, workspace_id, source_name, doc_hash, page, content, token_count, embedding).
- Update files row to ready or failed.
- Update ingestion_jobs row to done or failed.
- GET /health.
- No public query endpoint. No LLM calls.

**rag-service**
- POST /query — accept {question, file_ids[], history[]}, X-Workspace-Id header.
- Map file_ids to ready source_names via Supabase files table; error if any are processing/failed.
- Rewrite question into up to 3 variants via Groq.
- Embed variants with SentenceTransformers all-MiniLM-L6-v2.
- pgvector similarity search on chunks table filtered by workspace_id and source_names; apply score threshold.
- Merge duplicates, trim to token budget, build strict system prompt.
- Call Groq llama-3.1-8b-instant, parse JSON {answer, sources, context_preview}.
- Map source_name back to original_filename before responding.
- GET /health.
- No upload handling, no chunking, no file storage.

## Supabase schema summary (write this as SQL migrations)

Enable pgvector:
  CREATE EXTENSION IF NOT EXISTS vector;

files table: file_id (uuid PK), workspace_id (text), source_name (text), original_filename (text), doc_hash (text), status (text), storage_path (text), created_at (timestamptz), updated_at (timestamptz).

chunks table: chunk_id (text PK), file_id (uuid FK → files), workspace_id (text), source_name (text), doc_hash (text), page (int), content (text), token_count (int), embedding (vector(384)), created_at (timestamptz). Add an ivfflat index on the embedding column.

ingestion_jobs table: job_id (uuid PK), file_id (uuid), workspace_id (text), source_name (text), doc_hash (text), storage_path (text), status (text), created_at (timestamptz), updated_at (timestamptz).

## .env.example for each service

main-service:
  SUPABASE_URL=
  SUPABASE_SERVICE_ROLE_KEY=
  SUPABASE_STORAGE_BUCKET=pdf-uploads

chunker-service:
  SUPABASE_URL=
  SUPABASE_SERVICE_ROLE_KEY=
  SUPABASE_STORAGE_BUCKET=pdf-uploads
  POLL_INTERVAL_SECONDS=5

rag-service:
  SUPABASE_URL=
  SUPABASE_SERVICE_ROLE_KEY=
  GROQ_API_KEY=

## When you are done

Verify:
- Three folders at project root each with .git/ inside.
- migrations/ folder at project root with SQL files.
- ARCHITECTURE.md at project root.
- Each service has README.md, .env.example, and a dependency manifest.
- All GET /health endpoints return {"status": "ok"} when the service starts with valid env vars.

Do not ask clarifying questions. Make reasonable engineering decisions and document them in ARCHITECTURE.md.
```

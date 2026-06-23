# TASK.md — Osmium RAG Migration: Mono-service → Three-service Architecture

## Goal

Split the current single FastAPI RAG service into three independently deployable services, each in its own subfolder with its own git repository, and migrate from on-disk FAISS + JSON files to Supabase (PostgreSQL + pgvector) for all persistent state.

---

## Target Architecture

```
osmium/                        ← existing project root (unchanged)
├── frontend/                  ← unchanged
├── main-service/              ← NEW — git init here
│     owns: PDF upload, file registry, file management API, job dispatch
├── chunker-service/           ← NEW — git init here
│     owns: PDF text extraction, semantic chunking, embedding, vector upsert
└── rag-service/               ← NEW — git init here (replaces old rag-service/)
      owns: query rewriting, vector retrieval, Groq completion, citation response
```

Each service folder must be `git init`-ed so it can be pushed to its own remote repository. Do not touch the frontend folder.

---

## Service Boundaries

### 1. main-service
- Receives PDF uploads from the frontend.
- Validates the file (PDF, non-empty).
- Reads and sanitizes `X-Workspace-Id`.
- Generates `file_id` (UUID), `source_name`, `doc_hash` (SHA-256).
- Stores the PDF in Supabase Storage (bucket: `pdf-uploads`, path: `{workspace_id}/{file_id}/{source_name}`).
- Writes a file registry row to Supabase (`files` table) with status `processing`.
- Dispatches a chunking job to the chunker-service (HTTP POST to chunker internal endpoint or via a Supabase-backed job queue table — choose the simpler option).
- Exposes file management endpoints: list, download, delete.
  - Delete must: remove the registry row, delete the PDF from Supabase Storage, and delete all vector rows for that `source_name` from the `chunks` table.
- Exposes `GET /health` and `GET /ingest/status` (reads counts from Supabase).
- Does NOT do any embedding or LLM calls.

### 2. chunker-service
- Receives a job payload: `{ file_id, source_name, doc_hash, workspace_id, storage_path }`.
- Downloads the PDF bytes from Supabase Storage using the storage path.
- Extracts text with pypdf.
- Runs the semantic overlapping chunker; each chunk carries metadata: `source_name`, `page`, `chunk_id`, `token_count`, `doc_hash`, `workspace_id`.
- Embeds chunks with SentenceTransformers `all-MiniLM-L6-v2`.
- Upserts chunk rows into Supabase (`chunks` table): `chunk_id`, `file_id`, `workspace_id`, `source_name`, `doc_hash`, `page`, `content`, `token_count`, `embedding` (vector column via pgvector).
- Deletes stale rows for the same `doc_hash` + `workspace_id` before upserting (deduplication).
- Updates the `files` registry row to `ready` on success or `failed` on error.
- Has no public-facing API beyond the job intake endpoint; it is an internal worker.
- Does NOT serve queries or manage files.

### 3. rag-service
- Receives `POST /query` from the frontend: `{ question, file_ids[], history[] }`, plus `X-Workspace-Id` header.
- Reads the `files` registry from Supabase to map `file_ids` → `source_names` (only `ready` rows).
- Returns a clear error if any selected file is `processing` or `failed`.
- Formats recent chat history for follow-up context.
- Calls Groq to rewrite the user question into up to 3 semantic search variants.
- Embeds each variant with SentenceTransformers.
- Runs pgvector similarity search on the `chunks` table filtered by `workspace_id` and `source_names`; applies a score threshold.
- Merges duplicate chunks, sorts by best score, trims to token budget.
- Builds a strict system prompt (answer only from context, return JSON).
- Calls Groq `llama-3.1-8b-instant`; parses `{ answer, sources, context_preview }`.
- Maps `source_name` values back to original filenames before responding.
- Does NOT handle uploads, file storage, or chunking.

---

## Supabase Schema

The agent must create (or document as SQL migrations) the following:

### `files` table
| column | type | notes |
|---|---|---|
| file_id | uuid primary key | |
| workspace_id | text | sanitized from X-Workspace-Id |
| source_name | text | file_id + sanitized filename |
| original_filename | text | |
| doc_hash | text | SHA-256 |
| status | text | processing / ready / failed |
| storage_path | text | Supabase Storage path |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `chunks` table
| column | type | notes |
|---|---|---|
| chunk_id | text primary key | stable hash of doc_hash + chunk index |
| file_id | uuid references files | |
| workspace_id | text | |
| source_name | text | |
| doc_hash | text | |
| page | int | |
| content | text | |
| token_count | int | |
| embedding | vector(384) | pgvector, MiniLM output dim |
| created_at | timestamptz | |

Enable the `pgvector` extension in Supabase before running migrations.

---

## Job Queue (chunker dispatch)

Use a lightweight Supabase table-based queue to avoid adding Redis/RabbitMQ as a new dependency:

### `ingestion_jobs` table
| column | type | notes |
|---|---|---|
| job_id | uuid primary key | |
| file_id | uuid | |
| workspace_id | text | |
| source_name | text | |
| doc_hash | text | |
| storage_path | text | |
| status | text | pending / running / done / failed |
| created_at | timestamptz | |
| updated_at | timestamptz | |

- main-service inserts a row with `status=pending` after upload.
- chunker-service polls this table (or uses a Supabase Realtime subscription) for `pending` jobs, claims one by setting `status=running`, processes, then sets `status=done` or `failed`.
- This keeps the dependency surface minimal (no Redis required).

---

## Tasks (ordered)

### Phase 1 — Supabase Setup
1. Enable `pgvector` extension in the Supabase project.
2. Write SQL migration files for `files`, `chunks`, and `ingestion_jobs` tables.
3. Create the `pdf-uploads` bucket in Supabase Storage with workspace-scoped paths.
4. Define RLS policies (service-role key bypasses RLS; use it server-side only).

### Phase 2 — Scaffold Service Folders
5. Create `main-service/` inside the project root and run `git init` inside it.
6. Create `chunker-service/` inside the project root and run `git init` inside it.
7. Create `rag-service/` inside the project root (replacing or alongside the old one) and run `git init` inside it.
8. Each service folder gets its own `.gitignore`, `README.md`, `.env.example`, and dependency manifest.
9. Each `.env.example` must list: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and any service-specific keys (`GROQ_API_KEY` for rag-service, `CHUNKER_INTERNAL_URL` for main-service if using HTTP dispatch instead of DB polling).

### Phase 3 — main-service Implementation
10. Implement `POST /upload`: validate → generate IDs → upload PDF to Supabase Storage → insert `files` row (status=processing) → insert `ingestion_jobs` row (status=pending) → return `{ file_id, status }`.
11. Implement `GET /files`: query `files` table filtered by `workspace_id`, return list.
12. Implement `GET /files/{file_id}/download`: fetch PDF bytes from Supabase Storage, stream back.
13. Implement `DELETE /files/{file_id}`: delete `chunks` rows by `source_name`, delete PDF from Storage, delete `files` row.
14. Implement `GET /health` and `GET /ingest/status` (count rows in files and chunks tables).

### Phase 4 — chunker-service Implementation
15. Implement the job poller: poll `ingestion_jobs` for `status=pending`, claim with `status=running`.
16. Download PDF from Supabase Storage.
17. Extract text (pypdf), chunk (semantic overlapping), embed (MiniLM).
18. Delete existing `chunks` rows for `doc_hash + workspace_id` (dedup).
19. Batch-upsert chunk rows into `chunks` table.
20. Update `files` row to `ready` or `failed`.
21. Update `ingestion_jobs` row to `done` or `failed`.

### Phase 5 — rag-service Implementation
22. Implement `POST /query`: validate → map file_ids → rewrite query (Groq) → embed variants (MiniLM) → pgvector search on `chunks` → merge/trim → Groq completion → parse JSON → map source names → return response.
23. Implement `GET /health`.

### Phase 6 — Integration & Cleanup
24. Update frontend `api.js` if any endpoint URLs or response shapes changed (document any breaking changes in each service's README).
25. Write a top-level `ARCHITECTURE.md` in the project root explaining the three services, data flow, Supabase tables, and how to run all three locally.
26. Remove or archive the old monolithic `rag-service/` if it was kept alongside during migration.

---

## Constraints for the Agent

- Do not prescribe a specific file structure inside each service folder; choose the layout that best suits each service's complexity.
- Do not add external message brokers (Redis, RabbitMQ, Celery). Use Supabase tables for the job queue.
- Do not change the frontend code unless an endpoint contract broke; document any changes.
- Each service must be independently runnable with `uvicorn` (or equivalent) without starting the other two.
- Use the existing SentenceTransformers + Groq stack; do not swap models unless noted.
- pgvector cosine similarity replaces FAISS `IndexFlatIP`; normalize embeddings before insert and use `<=>` operator for search.
- All Supabase access must use the service-role key server-side. Never expose it to the frontend.
- Each service must have a working `GET /health` endpoint that returns `{ status: "ok" }`.

---

## Definition of Done

- [ ] Three service folders exist at project root, each with `git init` run inside.
- [ ] Each service has its own `.env.example`, `README.md`, and dependency manifest.
- [ ] SQL migrations for `files`, `chunks`, and `ingestion_jobs` tables are written.
- [ ] main-service handles upload, file management, and job dispatch; no embedding or LLM code.
- [ ] chunker-service polls for jobs, processes PDFs, and upserts vectors; no public query endpoint.
- [ ] rag-service handles queries end-to-end using pgvector; no upload or chunking code.
- [ ] All three services can run independently and communicate only through Supabase.
- [ ] A top-level `ARCHITECTURE.md` documents the full system.

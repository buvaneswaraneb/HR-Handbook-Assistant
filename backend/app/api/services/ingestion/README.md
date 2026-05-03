# RAG Ingestion Service

Production-grade document ingestion pipeline: **PDF → chunks → embeddings → FAISS**.  
No LLM layer. Pure ingestion, chunking, embedding, and storage.

---

## Architecture

```
services/ingestion/
├── loader.py        PDF reading & page extraction (pypdf)
├── chunker.py       Semantic-aware chunking (paragraph → sentence fallback)
├── embedder.py      Batched embedding via sentence-transformers
├── vector_store.py  FAISS index + metadata + dedup management
└── pipeline.py      Orchestrator: ties all modules together
main.py              FastAPI app exposing /ingest and /ingest/status
```

### Data flow

```
raw-docs-cache/*.pdf
        │
        ▼
   loader.py          → list[PageRecord]   (text + page metadata)
        │
        ▼
   chunker.py         → list[Chunk]        (600–800 token, overlapping)
        │
        ▼
   embedder.py        → np.ndarray         (384-dim, normalised float32)
        │
        ▼
  vector_store.py     → faiss-store/       (index.faiss + metadata.json)
        │
        ▼
  DELETE source PDF   (only after successful disk persistence)
```

---

## Quickstart

### 1. Install

```bash
pip install -r requirements.txt
```

### 2. Place PDFs

```bash
mkdir raw-docs-cache
cp your_document.pdf raw-docs-cache/
```

### 3. Run the server

```bash
uvicorn main:app --reload
```

### 4. Trigger ingestion

```bash
curl -X POST http://localhost:8000/ingest
```

Sample response:
```json
{
  "status": "ok",
  "processed": ["report.pdf"],
  "skipped": [],
  "failed": [],
  "duration_s": 3.42
}
```

### 5. Check store stats

```bash
curl http://localhost:8000/ingest/status
```

---

## Chunking Strategy

| Parameter       | Value          | Rationale                              |
|-----------------|----------------|----------------------------------------|
| Target size     | 700 tokens     | Middle of 600–800 budget               |
| Max size        | 800 tokens     | Hard ceiling                           |
| Overlap         | 125 tokens     | Preserves cross-chunk context          |
| Splitting order | paragraph → sentence | Never breaks mid-sentence         |
| Token estimate  | `len(text) / 4` | Accurate enough, zero dependencies   |

---

## Embedding Model

**`all-MiniLM-L6-v2`** (sentence-transformers)

- 384-dimensional output vectors  
- ~22 M parameters — fast on CPU  
- No API key, no per-token cost  
- Vectors are L2-normalised → cosine similarity = dot-product (IndexFlatIP)

---

## FAISS Store Layout

```
faiss-store/
├── index.faiss       FAISS IndexFlatIP — exact cosine search
├── metadata.json     Parallel list of chunk metadata + content
└── processed.json    Set of ingested doc SHA-256 hashes (dedup)
```

**Incremental updates**: if a document's hash is already in `processed.json`,
it is skipped and its cache file is cleaned up. No reprocessing.

**Safe deletion**: source PDFs are deleted **only after** `store.save()` completes
(atomic rename on POSIX). A crash mid-pipeline leaves the PDF intact for retry.

---

## Scaling Notes

| Concern              | Current approach         | Upgrade path                          |
|----------------------|--------------------------|---------------------------------------|
| Index type           | `IndexFlatIP` (exact)    | `IndexIVFFlat` / HNSW for N > 100 k  |
| Multi-worker safety  | Single-process writes    | `filelock` or PostgreSQL + pgvector   |
| Embedding throughput | CPU batch, size 64       | GPU + larger batch                    |
| Large corpora        | In-memory metadata JSON  | SQLite / DuckDB for millions of rows  |

---

## Environment Variables (optional)

| Variable               | Default              | Description                    |
|------------------------|----------------------|--------------------------------|
| `CACHE_DIR`            | `raw-docs-cache`     | PDF input directory            |
| `STORE_DIR`            | `faiss-store`        | FAISS index output directory   |
| `EMBEDDING_MODEL`      | `all-MiniLM-L6-v2`  | sentence-transformers model ID |
| `EMBEDDING_BATCH_SIZE` | `64`                 | Batch size for encoding        |

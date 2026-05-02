**File Structure**
---

```
hr-handbook-assistant/
│
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI entry point
│   │   │
│   │   ├── api/                    # Routes layer
│   │   │   ├── routes.py           # /ask, /upload
│   │   │   └── deps.py             # dependencies (auth etc.)
│   │   │
│   │   ├── core/                   # Config & settings
│   │   │   ├── config.py
│   │   │   └── security.py
│   │   │
│   │   ├── services/               # Business logic
│   │   │   ├── rag_pipeline.py
│   │   │   ├── document_loader.py
│   │   │   ├── chunking.py
│   │   │   ├── embeddings.py
│   │   │   └── retriever.py
│   │   │
│   │   ├── db/                     # Data layer
│   │   │   ├── vector_store.py
│   │   │   └── database.py
│   │   │
│   │   ├── models/                 # Schemas (Pydantic)
│   │   │   └── schema.py
│   │   │
│   │   └── utils/                  # Helpers
│   │       ├── logger.py
│   │       └── helpers.py
│   │
│   ├── data/
│   │   ├── raw_docs/               # Uploaded PDFs
│   │   ├── processed/              # Chunked data
│   │   └── vector_store/           # FAISS files
│   │
│   └── tests/
│       └── test_api.py
│
├── frontend/
│   ├── app.py                      # Streamlit UI
│   └── components/                 # UI components (optional)
│
├── scripts/                        # Utility scripts
│   ├── ingest_data.py              # Build vector DB
│   └── refresh_db.py
│
├── logs/
│   └── app.log
│
├── .env
├── requirements.txt
├── README.md
└── run.sh 
```

---
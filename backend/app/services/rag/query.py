"""
query.py — RAG query layer.

Flow:
  1. Rewrite the user's question into semantic search variants.
  2. Embed those search queries via sentence-transformers.
  3. Retrieve and merge relevant chunks from FAISS.
  4. Format chunks into the context block the LLM expects.
  5. Call Groq (llama-3.1-8b-instant) with the strict system prompt.
  6. Parse and return structured JSON response.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from dotenv import dotenv_values


# ── custom hourly rotating handler ────────────────────────────────────────────
class HourlyRotatingHandler(logging.FileHandler):
    """Creates a new log file every hour with format: dd-mm-yy-hh:00.log"""
    
    def __init__(self, log_dir: Path, backupCount: int = 24):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.backupCount = backupCount
        self.last_hour = None
        
        # Create initial filename
        self._generate_filename()
        try:
            super().__init__(str(self.current_filepath), encoding='utf-8')
        except Exception as e:
            print(f"Error initializing logging handler: {e}")
            raise
    
    def _generate_filename(self):
        """Generate filename based on current hour with :00 for minutes."""
        now = datetime.now()
        self.last_hour = (now.year, now.month, now.day, now.hour)
        # Create filename with :00 so all logs in the same hour use the same file
        # e.g., 13:15 → 04-05-26-13:00.log, 13:59 → 04-05-26-13:00.log
        date_hour = now.strftime("%d-%m-%y-%H")
        self.current_filepath = self.log_dir / f"{date_hour}:00.log"
    
    def emit(self, record: logging.LogRecord) -> None:
        """Check if hour changed and rotate if needed."""
        try:
            now = datetime.now()
            current_hour = (now.year, now.month, now.day, now.hour)
            
            # If hour changed, rotate to new file
            if current_hour != self.last_hour:
                self.doRollover()
            
            super().emit(record)
        except Exception as e:
            print(f"Error in logger emit: {e}")
            self.handleError(record)
    
    def doRollover(self):
        """Close current file and open a new one."""
        try:
            # Close the current stream and file
            if self.stream:
                self.flush()
                self.stream.close()
            
            # Generate new filename for the new hour
            self._generate_filename()
            self.baseFilename = str(self.current_filepath)
            
            # Open the new file
            self.stream = self._open()
        except Exception as e:
            print(f"Error in doRollover: {e}")
            raise


# ── configure logging ─────────────────────────────────────────────────────────
LOGS_DIR = Path(
    os.getenv(
        "RAG_LOGS_DIR",
        Path(tempfile.gettempdir()) / "hr-assistant-runtime" / "logs",
    )
)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# Configure root logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Clear any existing handlers to avoid duplicates
logger.handlers.clear()

# Hourly rotating file handler
try:
    hourly_handler = HourlyRotatingHandler(LOGS_DIR, backupCount=168)  # keep 7 days of logs
    hourly_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    hourly_handler.setFormatter(file_formatter)
    logger.addHandler(hourly_handler)
    print(f"✓ Logger initialized - logs will be saved to: {LOGS_DIR}")
except Exception as e:
    print(f"✗ Failed to initialize logger: {e}")

# Console handler (optional, for development)
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_formatter = logging.Formatter('%(levelname)s - %(message)s')
console_handler.setFormatter(console_formatter)
logger.addHandler(console_handler)

# ── load the repo-root .env file ─────────────────────────────────────────────
_ENV_FILE = Path(__file__).resolve().parents[4] / ".env"
_env_vars = dotenv_values(_ENV_FILE)   # returns {} if file not found (no crash)

import httpx

from app.services.ingestion.embedder import get_default_embedder
from app.services.ingestion.vector_store import VectorStore

# ── config ────────────────────────────────────────────────────────────────────
GROQ_API_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL       = "llama-3.1-8b-instant"  # adjust as needed; check Groq docs for available models
MAX_TOKENS       = 1024
BATCH_SIZE       = 10     # max chunks per API call to avoid 413 payload errors
GROQ_RETRY_COUNT = 2

# Retrieval settings
SCORE_THRESHOLD  = 0.25   # min cosine similarity to include a chunk (0–1)
CANDIDATE_K      = 20     # how many candidates FAISS returns before filtering
CONTEXT_TOKEN_BUDGET = 4_000  # ~4 chars per token; trim context if too long
MAX_QUERY_VARIANTS = 3

SYSTEM_PROMPT = """ You are an internal HR assistant.

Answer using ONLY the provided context from company documents.

STRICT RULES:
- Do NOT use outside knowledge.
- Do NOT infer, guess, or fabricate.
- Do NOT repeat the question.
- Do NOT add explanation outside the answer.
- Use ONLY facts explicitly present in the context.
- Every answer MUST include citations from the provided metadata only.
- If the context does not explicitly support the answer, return the fallback JSON exactly.
- Conversation history is provided only to understand follow-up wording,
  remember attached PDF names, and answer questions about this chat.
- For company/document facts, use document context and citations only.
- If answering only from conversation history or active PDF names, use sources: [].

If the input is a greeting like "hi" or "hello", return:
{"answer":"Hello! How can I help you?","sources":[],"context_preview":[]}

If no answer is found, return exactly:
{"answer":"I don't know based on the provided documents.","sources":[],"context_preview":[]}

OUTPUT FORMAT — return ONLY valid JSON:
{
  "answer": "<final answer>",
  "sources": [
    {"file": "<filename>", "page": <number>, "chunk_id": "<chunk_id>"}
  ],
  "context_preview": [
    {"text": "<excerpt max 200 chars>", "file": "<filename>", "page": <number>}
  ]
}
"""

SYNTHESIS_PROMPT = """You are an HR assistant merging batch results.

You will receive multiple batch JSON results from retrieved document chunks.

STRICT RULES:
- Use ONLY the batch results provided.
- Do NOT add new facts.
- Do NOT infer missing details.
- Do NOT invent citations.
- Keep only sources that directly support the final answer.
- If all batches are insufficient or conflicting, return the fallback JSON exactly.

If there are no batch results, return:
{"answer":"I don't know based on the provided documents.","sources":[],"context_preview":[]}

OUTPUT FORMAT — return ONLY valid JSON:
{
  "answer": "<final synthesized answer>",
  "sources": [
    {"file": "<filename>", "page": <number>, "chunk_id": "<chunk_id>"}
  ],
  "context_preview": [
    {"text": "<excerpt max 200 chars>", "file": "<filename>", "page": <number>}
  ]
}
"""

QUERY_REWRITE_PROMPT = """You rewrite HR/document questions into search queries for a vector database.

Your job is NOT to answer the question.
Create concise semantic search queries that would retrieve the right policy/document chunks.
Include synonyms, policy terms, likely section names, and concrete entities from the user question.

Return ONLY valid JSON:
{"queries":["<query 1>","<query 2>","<query 3>"]}
"""
# ── data models ───────────────────────────────────────────────────────────────
@dataclass
class QueryResult:
    answer: str
    sources: list[dict]
    context_preview: list[dict]
    raw_chunks: list[dict]   # full FAISS results (for debugging)


# ── main query function ───────────────────────────────────────────────────────
class RAGQueryEngine:
    def __init__(
        self,
        store: VectorStore | None = None,
        groq_api_key: str | None = None,
        score_threshold: float = SCORE_THRESHOLD,
        candidate_k: int = CANDIDATE_K,
    ) -> None:
        self._store           = store or VectorStore()
        self._embedder        = get_default_embedder()
        # Priority: explicit arg → .env file → shell environment
        self._api_key         = groq_api_key or _env_vars.get("GROQ_API_KEY") or os.environ.get("GROQ_API_KEY", "")
        self._score_threshold = score_threshold
        self._candidate_k     = candidate_k

        if not self._api_key:
            raise ValueError(
                "GROQ_API_KEY is not set. "
                "Export it: export GROQ_API_KEY=gsk_..."
            )

    def query(
        self,
        question: str,
        workplace_id: str | None = None,
        source_names: list[str] | None = None,
        history: list[dict] | None = None,
    ) -> QueryResult:
        if not question.strip():
            raise ValueError("Question cannot be empty.")

        normalized_question = " ".join(question.split())
        if _is_greeting(normalized_question):
            return QueryResult(
                answer="Hello! How can I help you?",
                sources=[],
                context_preview=[],
                raw_chunks=[],
            )

        history_items = history or []
        history_context = _format_history(history_items)
        history_search_text = _history_search_text(history_items)
        active_sources = [name for name in (source_names or []) if name]

        # 1. Convert the user's intent into multiple semantic search queries.
        search_queries = self._build_search_queries(question, history_context, history_search_text)

        # 2. Retrieve and merge chunks across all query variants.
        raw_chunks = self._retrieve_for_queries(
            search_queries,
            workplace_id=workplace_id,
            source_names=set(active_sources) if active_sources else None,
        )
        logger.info(
            "Retrieved %d relevant chunks across %d query variants (threshold=%.2f) for: %s",
            len(raw_chunks), len(search_queries), self._score_threshold, question[:60],
        )

        # 3. Trim to context token budget
        raw_chunks = _trim_to_budget(raw_chunks, budget_chars=CONTEXT_TOKEN_BUDGET * 4)
        if not raw_chunks and not history_context and not active_sources:
            return QueryResult(
                answer="I don't know based on the provided documents.",
                sources=[],
                context_preview=[],
                raw_chunks=[],
            )

        # 4. Make one answer call. The context budget above prevents oversized
        # payloads while avoiding extra rate-limit pressure from batch calls.
        context_block = _build_context(raw_chunks) if raw_chunks else "(No matching document chunks were retrieved.)"
        token_count = _estimate_token_count(SYSTEM_PROMPT, question, context_block + history_context)
        logger.debug("Final answer token estimation: ~%d tokens", token_count)

        llm_response = self._call_groq(
            question,
            context_block,
            history_context=history_context,
            active_sources=active_sources,
        )
        return _parse_response(llm_response, raw_chunks)

    def _build_search_queries(
        self,
        question: str,
        history_context: str = "",
        history_search_text: str = "",
    ) -> list[str]:
        normalized_question = " ".join(question.split())
        if _is_greeting(normalized_question):
            return [normalized_question]

        history_aware_question = normalized_question
        if history_search_text and _is_follow_up(normalized_question):
            history_aware_question = f"{history_search_text}\nFollow-up question: {normalized_question}"
        if history_context:
            history_aware_question = (
                f"Recent conversation:\n{history_context}\n\n"
                f"Current question: {history_aware_question}"
            )

        queries = [history_aware_question]
        try:
            rewritten = self._rewrite_search_queries(history_aware_question)
            for query in rewritten:
                cleaned = " ".join(str(query).split())
                if cleaned and cleaned.lower() not in {q.lower() for q in queries}:
                    queries.append(cleaned)
                if len(queries) >= MAX_QUERY_VARIANTS:
                    break
        except Exception as exc:
            logger.warning("Query rewrite failed, using original question only: %s", exc)

        logger.info("Search query variants: %s", queries)
        return queries

    def _rewrite_search_queries(self, question: str) -> list[str]:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": GROQ_MODEL,
            "max_tokens": 256,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": QUERY_REWRITE_PROMPT},
                {"role": "user", "content": question},
            ],
        }
        raw = self._post_groq(payload, headers)
        try:
            data = json.loads(_strip_markdown_json(raw))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Query rewrite returned non-JSON: {raw[:120]}") from exc
        queries = data.get("queries", [])
        return queries if isinstance(queries, list) else []

    def _retrieve_for_queries(
        self,
        queries: list[str],
        workplace_id: str | None = None,
        source_names: set[str] | None = None,
    ) -> list[dict]:
        merged: dict[str, dict] = {}

        for query in queries:
            vec = self._embedder.embed([query], is_query=True)[0]
            chunks = self._store.search_with_threshold(
                vec,
                score_threshold=self._score_threshold,
                candidate_k=self._candidate_k,
                workplace_id=workplace_id,
                source_names=source_names,
            )
            logger.info("Retrieved %d chunks for query variant: %s", len(chunks), query[:80])

            for chunk in chunks:
                key = chunk.get("chunk_id") or f"{chunk.get('source')}:{chunk.get('page')}:{hash(chunk.get('content', ''))}"
                existing = merged.get(key)
                if not existing or chunk.get("_score", 0) > existing.get("_score", 0):
                    merged[key] = {**chunk, "matched_queries": [query]}
                else:
                    existing.setdefault("matched_queries", []).append(query)

        return sorted(merged.values(), key=lambda item: item.get("_score", 0), reverse=True)

    def _synthesize_batch_results(
        self, question: str, batch_results: list[QueryResult], all_chunks: list[dict]
    ) -> QueryResult:
        """
        Synthesize answers from multiple batches into a single final answer.
        Calls Groq one more time with batch summaries.
        """
        # Build a summary of all batch results for synthesis
        batch_summaries = []
        all_sources = []
        all_previews = []
        
        for idx, result in enumerate(batch_results):
            batch_summaries.append(f"Batch {idx + 1}: {result.answer}")
            all_sources.extend(result.sources)
            all_previews.extend(result.context_preview)
        
        synthesis_input = (
            f"Question: {question}\n\n"
            "Batch Results:\n"
            + "\n".join(batch_summaries) +
            "\n\nCombine these batch answers into a single, coherent response. "
            "Use all relevant sources cited in the batches."
        )
        
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": GROQ_MODEL,
            "max_tokens": MAX_TOKENS,
            "temperature": 0.0,
            "messages": [
                {"role": "system", "content": SYNTHESIS_PROMPT},
                {"role": "user", "content": synthesis_input},
            ],
        }
        
        try:
            llm_response = self._post_groq(payload, headers)
        except Exception as e:
            logger.error("Synthesis call failed: %s. Returning first batch result.", e)
            return batch_results[0]
        
        # Parse synthesis response
        result = _parse_response(llm_response, all_chunks)
        
        # Merge sources (deduplicate if needed)
        if not result.sources:
            result.sources = all_sources
        if not result.context_preview:
            result.context_preview = all_previews
        
        return result

    def _call_groq(
        self,
        question: str,
        context: str,
        history_context: str = "",
        active_sources: list[str] | None = None,
    ) -> str:
        active_pdf_block = "\n".join(f"- {name}" for name in (active_sources or [])) or "(none)"
        history_block = history_context or "(none)"
        user_message = (
            f"Conversation history:\n{history_block}\n\n"
            f"Active PDF context:\n{active_pdf_block}\n\n"
            f"Document context:\n{context}\n\n"
            f"Question: {question}"
        )

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type":  "application/json",
        }
        payload = {
            "model":       GROQ_MODEL,
            "max_tokens":  MAX_TOKENS,
            "temperature": 0.0,   # deterministic for RAG
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_message},
            ],
        }

        try:
            return self._post_groq(payload, headers)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 429:
                retry_after = exc.response.headers.get("retry-after")
                logger.warning("Groq rate limit hit for question %r. retry-after=%s", question[:80], retry_after)
                return json.dumps({
                    "answer": "The language service is rate limited right now. Please wait a moment and try again.",
                    "sources": [],
                    "context_preview": [],
                })
            raise
        except (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError) as exc:
            logger.warning("Groq network call failed for question %r: %s", question[:80], exc)
            return json.dumps({
                "answer": "I couldn't reach the language service just now. Please try again.",
                "sources": [],
                "context_preview": [],
            })

    def _post_groq(self, payload: dict, headers: dict) -> str:
        timeout = httpx.Timeout(30.0, connect=10.0)
        last_exc = None

        for attempt in range(1, GROQ_RETRY_COUNT + 2):
            try:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.post(GROQ_API_URL, headers=headers, json=payload)
                    resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"]
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                status = exc.response.status_code
                if status == 429 and attempt <= GROQ_RETRY_COUNT:
                    retry_after = _retry_after_seconds(exc.response.headers.get("retry-after"))
                    wait_s = retry_after if retry_after is not None else 1.2 * attempt
                    logger.warning("Groq rate limit attempt %d; retrying in %.1fs", attempt, wait_s)
                    time.sleep(wait_s)
                    continue
                raise
            except (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError) as exc:
                last_exc = exc
                logger.warning("Groq request attempt %d failed: %s", attempt, exc)
                if attempt <= GROQ_RETRY_COUNT:
                    time.sleep(0.6 * attempt)
                    continue
                raise
            except (KeyError, IndexError, ValueError) as exc:
                logger.error("Groq response shape invalid: %s", exc)
                raise ValueError("Invalid response from language service.") from exc

        raise last_exc or RuntimeError("Groq request failed.")


# ── helpers ───────────────────────────────────────────────────────────────────
def _format_history(history: list[dict], max_turns: int = 8, max_chars: int = 3_000) -> str:
    """Compact chat history for follow-up resolution without bloating prompts."""
    lines: list[str] = []
    for item in history[-max_turns:]:
        if not isinstance(item, dict):
            continue

        role = str(item.get("role") or "").strip().lower()
        if role not in {"user", "assistant", "bot"}:
            continue
        role_label = "assistant" if role == "bot" else role

        content = " ".join(str(item.get("content") or item.get("text") or "").split())
        attachment_name = str(item.get("attachment_name") or item.get("attachmentName") or "").strip()
        file_names = item.get("file_names") or item.get("fileNames") or []
        if isinstance(file_names, str):
            file_names = [file_names]
        file_names = [str(name).strip() for name in file_names if str(name).strip()]

        extras = []
        if attachment_name:
            extras.append(f"attached PDF: {attachment_name}")
        if file_names:
            extras.append("active PDFs: " + ", ".join(file_names[:5]))

        detail = content
        if extras:
            detail = f"{detail} ({'; '.join(extras)})" if detail else f"({'; '.join(extras)})"
        if detail:
            lines.append(f"{role_label}: {detail[:700]}")

    formatted = "\n".join(lines)
    return formatted[-max_chars:]


def _history_search_text(history: list[dict], max_items: int = 4, max_chars: int = 1_200) -> str:
    """Extract recent conversational content that helps resolve vague follow-ups."""
    lines: list[str] = []
    for item in history[-max_items:]:
        if not isinstance(item, dict):
            continue
        content = " ".join(str(item.get("content") or item.get("text") or "").split())
        if content and not content.lower().startswith("error:"):
            lines.append(content[:400])

        attachment_name = str(item.get("attachment_name") or item.get("attachmentName") or "").strip()
        if attachment_name:
            lines.append(f"Attached PDF: {attachment_name}")

        file_names = item.get("file_names") or item.get("fileNames") or []
        if isinstance(file_names, str):
            file_names = [file_names]
        clean_names = [str(name).strip() for name in file_names if str(name).strip()]
        if clean_names:
            lines.append("Active PDFs: " + ", ".join(clean_names[:5]))

    return "\n".join(lines)[-max_chars:]


def _is_follow_up(text: str) -> bool:
    normalized = text.strip().lower()
    if len(normalized.split()) <= 5:
        return True
    follow_up_terms = (
        "tell me more",
        "explain more",
        "more about",
        "what about",
        "why",
        "how so",
        "continue",
        "that",
        "this",
        "it",
        "he",
        "she",
        "they",
    )
    return any(term in normalized for term in follow_up_terms)


def _trim_to_budget(chunks: list[dict], budget_chars: int) -> list[dict]:
    """
    Keep chunks in score order until the cumulative content length would
    exceed budget_chars.  Ensures we never overflow the LLM context window
    even when many chunks pass the similarity threshold.
    """
    kept, total = [], 0
    for chunk in chunks:          # already sorted best-score-first
        content_len = len(chunk.get("content", ""))
        if total + content_len > budget_chars:
            break
        kept.append(chunk)
        total += content_len
    if len(kept) < len(chunks):
        logger.info("Context trimmed: kept %d/%d chunks within %d-char budget",
                    len(kept), len(chunks), budget_chars)
    return kept


def _build_context(chunks: list[dict]) -> str:
    """Format FAISS results into the [CHUNK] block the system prompt expects."""
    parts = []
    for chunk in chunks:
        parts.append(
            f"[CHUNK]\n"
            f"source: {chunk.get('source', 'unknown')}\n"
            f"page: {chunk.get('page', 0)}\n"
            f"chunk_id: {chunk.get('chunk_id', '')}\n"
            f"relevance_score: {chunk.get('_score', 0):.3f}\n"
            f"content:\n{chunk.get('content', '')}\n"
        )
    return "\n".join(parts)


def _parse_response(raw: str, chunks: list[dict]) -> QueryResult:
    """Parse LLM JSON output — with a safe fallback if malformed."""
    cleaned = _strip_markdown_json(raw)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        logger.warning("LLM returned non-JSON: %s", raw[:200])
        data = {
            "answer": "I don't know based on the provided documents.",
            "sources": [],
            "context_preview": [],
        }

    return QueryResult(
        answer          = data.get("answer", ""),
        sources         = _normalize_sources(data.get("sources", []), chunks),
        context_preview = _normalize_previews(data.get("context_preview", []), chunks),
        raw_chunks      = chunks,
    )


def _strip_markdown_json(raw: str) -> str:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    return cleaned.strip()


def _is_greeting(text: str) -> bool:
    return text.strip().lower() in {"hi", "hello", "hey", "hai", "good morning", "good afternoon", "good evening"}


def _retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def _normalize_sources(sources: object, chunks: list[dict]) -> list[dict]:
    if not isinstance(sources, list):
        return []

    normalized = []
    for source in sources:
        if not isinstance(source, dict):
            continue

        matched_chunk = _find_chunk_for_citation(source, chunks)
        file = source.get("file") or source.get("source") or (matched_chunk or {}).get("source")
        page = _coerce_page(source.get("page"), matched_chunk)
        chunk_id = source.get("chunk_id") or (matched_chunk or {}).get("chunk_id")

        if not file or page is None or not chunk_id:
            logger.warning("Dropping malformed source citation: %s", source)
            continue

        normalized.append({
            "file": str(file),
            "page": page,
            "chunk_id": str(chunk_id),
        })

    return _dedupe_dicts(normalized, ("file", "page", "chunk_id"))


def _normalize_previews(previews: object, chunks: list[dict]) -> list[dict]:
    if not isinstance(previews, list):
        return []

    normalized = []
    for preview in previews:
        if not isinstance(preview, dict):
            continue

        matched_chunk = _find_chunk_for_citation(preview, chunks)
        file = preview.get("file") or preview.get("source") or (matched_chunk or {}).get("source")
        page = _coerce_page(preview.get("page"), matched_chunk)
        text = preview.get("text") or (matched_chunk or {}).get("content", "")

        if not file or page is None:
            logger.warning("Dropping malformed context preview: %s", preview)
            continue

        normalized.append({
            "text": str(text)[:200],
            "file": str(file),
            "page": page,
        })

    return _dedupe_dicts(normalized, ("text", "file", "page"))


def _find_chunk_for_citation(citation: dict, chunks: list[dict]) -> dict | None:
    chunk_id = citation.get("chunk_id")
    file = citation.get("file") or citation.get("source")

    if chunk_id:
        for chunk in chunks:
            if str(chunk.get("chunk_id", "")) == str(chunk_id):
                return chunk

    if file:
        for chunk in chunks:
            if str(chunk.get("source", "")) == str(file):
                return chunk

    if not chunk_id and not file and len(chunks) == 1:
        return chunks[0]

    return None


def _coerce_page(value: object, matched_chunk: dict | None = None) -> int | None:
    if value is None or value == "":
        value = (matched_chunk or {}).get("page")

    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if not isinstance(value, str):
        return None

    value = value.strip()
    if not value:
        return None

    try:
        return int(value)
    except ValueError:
        return None


def _dedupe_dicts(items: list[dict], keys: tuple[str, ...]) -> list[dict]:
    seen = set()
    deduped = []
    for item in items:
        marker = tuple(item.get(key) for key in keys)
        if marker in seen:
            continue
        seen.add(marker)
        deduped.append(item)
    return deduped


def _estimate_token_count(system_prompt: str, question: str, context: str) -> int:
    """
    Estimate token count for system prompt + question + context.
    Uses a simple ~1 token per 4 characters approximation.
    For production, consider using tiktoken: pip install tiktoken
    """
    total_text = system_prompt + question + context
    # Rough estimation: ~4 characters per token for English text
    estimated_tokens = len(total_text) // 4
    return estimated_tokens

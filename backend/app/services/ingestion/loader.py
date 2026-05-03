"""
loader.py — PDF document loader with page-level metadata extraction.
Reads all PDFs from raw-docs-cache/ and yields structured page objects.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import pypdf

logger = logging.getLogger(__name__)

# Anchor to backend/app/data/raw-docs-cache regardless of the working directory.
# __file__ is  backend/app/services/ingestion/loader.py
# → .parent.parent.parent  == backend/app
# → / "data" / "raw-docs-cache" == backend/app/data/raw-docs-cache
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "raw-docs-cache"


@dataclass
class PageRecord:
    """Represents a single page extracted from a PDF."""
    source: str          # filename
    page: int            # 0-based page index
    text: str            # raw extracted text
    doc_hash: str        # SHA-256 of the whole file (dedup key)
    total_pages: int
    extra: dict = field(default_factory=dict)  # future extension


def _file_hash(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(65_536), b""):
            sha.update(block)
    return sha.hexdigest()


def load_pdfs(cache_dir: Path = CACHE_DIR) -> Iterator[tuple[Path, list[PageRecord]]]:
    """
    Yield (pdf_path, [PageRecord, ...]) for every PDF in cache_dir.
    Skips files that cannot be parsed and logs a warning instead of crashing.
    """
    pdf_files = sorted(cache_dir.glob("*.pdf"))
    if not pdf_files:
        logger.info("No PDFs found in %s", cache_dir)
        return

    for pdf_path in pdf_files:
        logger.info("Loading %s", pdf_path.name)
        try:
            records = _extract_pages(pdf_path)
            yield pdf_path, records
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to load %s: %s", pdf_path.name, exc)


def _extract_pages(pdf_path: Path) -> list[PageRecord]:
    doc_hash = _file_hash(pdf_path)
    source = pdf_path.name
    records: list[PageRecord] = []

    with pdf_path.open("rb") as fh:
        reader = pypdf.PdfReader(fh)
        total = len(reader.pages)

        for idx, page in enumerate(reader.pages):
            raw_text = page.extract_text() or ""
            text = _clean(raw_text)
            if not text:
                continue  # skip blank / image-only pages

            records.append(
                PageRecord(
                    source=source,
                    page=idx,
                    text=text,
                    doc_hash=doc_hash,
                    total_pages=total,
                )
            )

    logger.debug("Extracted %d non-empty pages from %s", len(records), source)
    return records


def _clean(text: str) -> str:
    """Normalise whitespace without destroying paragraph structure."""
    import re
    # Collapse runs of spaces/tabs but preserve newlines (paragraph markers)
    text = re.sub(r"[ \t]+", " ", text)
    # Collapse 3+ consecutive newlines into two (one blank line)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

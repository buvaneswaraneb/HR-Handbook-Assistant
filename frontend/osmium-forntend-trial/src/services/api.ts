export interface FileInfo {
  filename: string;
  size: number;
  uploaded_at?: string;
}

export interface IngestStatus {
  total_documents: number;
  total_vectors: number;
  last_ingested_at?: string;
}

export interface QueryResponse {
  answer: string;
  sources: string[];
}

const BASE_URL = 'http://localhost:8000'; // Relative to the window origin for full-stack deployment

export const api = {
  async getHealth() {
    const res = await fetch(`${BASE_URL}/health`);
    return res.json();
  },

  async getFiles(): Promise<FileInfo[]> {
    const res = await fetch(`${BASE_URL}/files`);
    if (!res.ok) throw new Error('Failed to fetch files');
    return res.json();
  },

  async uploadFile(file: File): Promise<{ filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },

  async ingest(): Promise<{ status: string }> {
    const res = await fetch(`${BASE_URL}/ingest`, { method: 'POST' });
    if (!res.ok) throw new Error('Ingestion failed');
    return res.json();
  },

  async getIngestStatus(): Promise<IngestStatus> {
    const res = await fetch(`${BASE_URL}/ingest/status`);
    if (!res.ok) throw new Error('Failed to get ingest status');
    return res.json();
  },

  async query(question: string): Promise<QueryResponse> {
    const res = await fetch(`${BASE_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) throw new Error('Query failed');
    return res.json();
  },

  getDownloadUrl(filename: string): string {
    return `${BASE_URL}/download/${filename}`;
  }
};

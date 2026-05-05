const BASE_URL = '/api-rag';

export interface FileStatus {
  name: string;
  status: 'Ingested' | 'Processing' | 'Pending';
  size?: string;
  updatedAt?: string;
}

export interface QuerySource {
  file: string;
  page: number;
  chunk_id: string;
}

export interface QueryResponse {
  answer: string;
  sources: QuerySource[];
  context_preview: {
    text: string;
    file: string;
    page: number;
  }[];
}

export const api = {
  async getFiles(): Promise<string[]> {
    const res = await fetch(`${BASE_URL}/files`);
    const data = await res.json();
    return data.files || [];
  },

  async uploadFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },

  async deleteFile(filename: string) {
    const res = await fetch(`${BASE_URL}/files/delete/${filename}`, {
      method: 'DELETE',
    });
    return res.json();
  },

  async ingest() {
    const res = await fetch(`${BASE_URL}/ingest`, {
      method: 'POST',
    });
    return res.json();
  },

  async getStatus() {
    const res = await fetch(`${BASE_URL}/ingest/status`);
    return res.json();
  },

  async query(question: string): Promise<QueryResponse> {
    const res = await fetch(`${BASE_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Query failed');
    }
    return res.json();
  }
};

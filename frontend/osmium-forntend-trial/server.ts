import express, { Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { GoogleGenAI } from '@google/genai';

// Setup directories
const CACHE_DIR = path.join(process.cwd(), 'data', 'raw-docs-cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Multer setup for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CACHE_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // In-memory mock statistics for ingest
  let ingestStats = {
    total_documents: 0,
    total_vectors: 0,
    last_ingested_at: null as string | null,
  };

  // Backend Endpoints
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/files', (req, res) => {
    try {
      const files = fs.readdirSync(CACHE_DIR).map((filename) => {
        const stats = fs.statSync(path.join(CACHE_DIR, filename));
        return {
          filename,
          size: stats.size,
          uploaded_at: stats.mtime.toISOString(),
        };
      });
      res.json(files);
    } catch (error) {
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  app.post('/upload', upload.single('file'), (req: any, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ filename: req.file.originalname });
  });

  app.get('/download/:filename', (req, res) => {
    const filePath = path.join(CACHE_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.download(filePath);
  });

  app.post('/ingest', (req, res) => {
    try {
      const files = fs.readdirSync(CACHE_DIR);
      ingestStats = {
        total_documents: files.length,
        total_vectors: files.length * 100, // Mock transformation
        last_ingested_at: new Date().toISOString(),
      };
      res.json({ status: 'success' });
    } catch (error) {
      res.status(500).json({ error: 'Ingestion failed' });
    }
  });

  app.get('/ingest/status', (req, res) => {
    res.json(ingestStats);
  });

  app.post('/query', async (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'No question provided' });

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.json({ 
          answer: "GEMINI_API_KEY is missing. Add it to secrets.",
          sources: []
        });
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const files = fs.readdirSync(CACHE_DIR);
      const contextDocs = files.slice(0, 3).join(", ");

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Answer the following question based on user documents (${contextDocs}): ${question}`,
      });
      
      res.json({
        answer: response.text,
        sources: files.slice(0, 2),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

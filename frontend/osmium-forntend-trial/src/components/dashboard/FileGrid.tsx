import { useState, useEffect } from 'react';
import { FileText, Upload, RefreshCw, CheckCircle2, AlertCircle, Download, Trash2, Database, Loader2, Plus } from 'lucide-react';
import { api, FileInfo, IngestStatus } from '@/src/services/api';
import { cn } from '@/src/lib/utils';

export default function FileGrid() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [fileList, ingestStatus] = await Promise.all([
        api.getFiles(),
        api.getIngestStatus(),
      ]);
      setFiles(Array.isArray(fileList) ? fileList : []);
      setStatus(ingestStatus || { total_documents: 0, total_vectors: 0 });
    } catch (err) {
      setError('Could not connect to backend. Please ensure it is running on localhost:8000');
      setFiles([]);
      setStatus({ total_documents: 0, total_vectors: 0 });
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      await api.uploadFile(file);
      await fetchData();
    } catch (err) {
      setError('Upload failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleIngest = async () => {
    try {
      setIsIngesting(true);
      await api.ingest();
      await fetchData();
    } catch (err) {
      setError('Ingestion failed');
    } finally {
      setIsIngesting(false);
    }
  };

  if (isLoading && files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent-purple" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4">
          <div className="bg-surface-container px-4 py-2 rounded-xl border border-outline-variant flex items-center gap-3">
            <Database className="h-4 w-4 text-accent-purple" />
            <div>
              <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider">Vector Store</p>
              <p className="text-sm font-semibold">{status?.total_vectors || 0} Vectors</p>
            </div>
          </div>
          <div className="bg-surface-container px-4 py-2 rounded-xl border border-outline-variant flex items-center gap-3">
            <FileText className="h-4 w-4 text-accent-purple" />
            <div>
              <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-wider">Documents</p>
              <p className="text-sm font-semibold">{status?.total_documents || 0} Ingested</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <label className="cursor-pointer px-4 py-2 bg-surface-container text-on-surface text-sm font-medium rounded-xl border border-outline-variant hover:bg-surface-container-high transition-colors flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Upload PDF
            <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
          </label>
          <button
            onClick={handleIngest}
            disabled={isIngesting || files.length === 0}
            className="px-4 py-2 bg-accent-purple text-white text-sm font-medium rounded-xl hover:bg-opacity-90 transition-all shadow-lg shadow-accent-purple/10 flex items-center gap-2 disabled:opacity-50"
          >
            {isIngesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isIngesting ? 'Ingesting...' : 'Ingest All'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500 text-sm">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          {error}
          <button onClick={fetchData} className="ml-auto underline hover:no-underline">Retry</button>
        </div>
      )}

      {files.length === 0 ? (
        <div className="flex-1 border-2 border-dashed border-outline-variant rounded-3xl flex flex-col items-center justify-center p-20 text-center">
          <div className="w-16 h-16 bg-surface-container rounded-2xl flex items-center justify-center mb-6 border border-outline-variant">
            <Upload className="h-8 w-8 text-on-surface-variant" />
          </div>
          <h3 className="text-xl font-semibold text-on-surface">No documents uploaded</h3>
          <p className="text-on-surface-variant mt-2 max-w-sm">
            Upload your first PDF to begin building your knowledge base.
          </p>
          <label className="mt-8 text-accent-purple font-medium hover:underline cursor-pointer">
            Browse files →
            <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map((file) => (
            <div key={file.filename} className="bg-surface-container border border-outline-variant p-4 rounded-2xl hover:border-accent-purple/50 transition-all group">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 bg-accent-purple/10 rounded-lg flex items-center justify-center text-accent-purple">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="flex gap-1">
                  <a 
                    href={api.getDownloadUrl(file.filename)}
                    download
                    className="p-1.5 text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              </div>
              <h4 className="font-medium text-on-surface truncate pr-2">{file.filename}</h4>
              <p className="text-xs text-on-surface-variant mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              
              <div className="mt-4 pt-4 border-t border-outline-variant flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-green-500">
                  <CheckCircle2 className="h-3 w-3" />
                  Cached
                </span>
                <span className="text-[10px] text-on-surface-variant">
                  {file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : 'Ready'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

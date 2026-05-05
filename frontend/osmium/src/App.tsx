import { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  Boxes, 
  BrainCircuit, 
  Settings, 
  HelpCircle, 
  Search, 
  Bell, 
  LayoutGrid, 
  Upload, 
  CloudUpload,
  FileText,
  FileCheck,
  FileClock,
  Trash2,
  Cpu,
  Database,
  Send,
  Mic,
  ArrowRight,
  Bot,
  BookOpen,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api, QueryResponse } from './api';

// --- Types ---

interface Message {
  id: string;
  type: 'user' | 'ai';
  text: string;
  timestamp: string;
  sources?: QueryResponse['sources'];
}

interface DocFile {
  name: string;
  size: string;
  updatedAt: string;
  status: 'Ingested' | 'Processing' | 'Pending';
}

// --- Main App ---

export default function App() {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [stats, setStats] = useState({ total_vectors: 0, docs_processed: 0 });
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'ai',
      text: 'Hello! I am Osmium Assistant. Ask me anything about your documents.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [input, setInput] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Polling stats
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isQuerying]);

  const fetchData = async () => {
    try {
      const docNames = await api.getFiles();
      const status = await api.getStatus();
      setStats(status);
      
      // Mocking some metadata since API doesn't provide it yet
      setFiles(docNames.map(name => ({
        name,
        size: '1.2 MB', // Placeholder
        updatedAt: 'Today', // Placeholder
        status: status.docs_processed > 0 ? 'Ingested' : 'Pending'
      })));
    } catch (error) {
      console.error('Failed to fetch data', error);
    }
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList) return;
    for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (file.type !== 'application/pdf') continue;
        try {
            await api.uploadFile(file);
        } catch (error) {
            console.error('Upload failed', error);
        }
    }
    fetchData();
  };

  const handleIngest = async () => {
    setIsIngesting(true);
    try {
      await api.ingest();
      fetchData();
    } catch (error) {
      console.error('Ingestion failed', error);
    } finally {
      setIsIngesting(false);
    }
  };

  const handleQuery = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isQuerying) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      type: 'user',
      text: input,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsQuerying(true);

    try {
      const res = await api.query(input);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        text: res.answer,
        sources: res.sources,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error: any) {
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        text: `Error: ${error.message}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleDelete = async (name: string) => {
    try {
        await api.deleteFile(name);
        fetchData();
    } catch (error) {
        console.error('Delete failed', error);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-on-surface">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 border-r border-outline-variant bg-surface-container-lowest flex flex-col py-8 px-6">
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-on-primary shadow-lg shadow-primary/20">
            <Cpu size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-on-surface">Osmium</h1>
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">ERM Suite</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          <SidebarLink icon={<LayoutDashboard size={20} />} label="Dashboard" />
          <SidebarLink icon={<Users size={20} />} label="Employees" />
          <SidebarLink icon={<Boxes size={20} />} label="Projects" />
          <SidebarLink icon={<BrainCircuit size={20} />} label="Osmium AI" active />
        </nav>

        <div className="pt-8 border-t border-outline-variant space-y-1">
          <SidebarLink icon={<Settings size={20} />} label="Settings" />
          <SidebarLink icon={<HelpCircle size={20} />} label="Support" />
        </div>
      </aside>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 flex-shrink-0 border-b border-outline-variant bg-white/50 backdrop-blur-md flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-4 w-96">
            <div className="flex-1 relative flex items-center">
              <Search className="absolute left-3 text-primary" size={16} />
              <input 
                type="text" 
                placeholder="Search knowledge base..."
                className="w-full pl-10 pr-4 py-2 bg-surface-container rounded-full text-sm border-none focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <HeaderIconButton icon={<Bell size={20} />} />
            <HeaderIconButton icon={<LayoutGrid size={20} />} />
            <div className="h-8 w-8 rounded-full bg-primary-container ml-2 overflow-hidden border border-outline-variant">
              <img 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBHnGwhTt8ecvgaRvQ_drbTSpqcMig39yeRz_XuqiaZsUwZYG7g6Ugh-TjkyzX0GSQzp3lL0T2sOf8c8QAHXk1GgBsw7XA04MSVnOuJiE2mUOY4r7Sdxikqg_UDGcM_yGR5i92vgihqwUMD9FG4il5lTpSc1civRbwMu6ezsZgoUbx-zjLtfE0bfl1xipuJOM4N3_OTDCcr_jwsQcnbbn4H5L8WYHEpAW8GnxIrngWIaCkS_qJ7A0bOE16QCXWmD6hp6vOzZc6_w0g" 
                alt="User"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar bg-surface/50">
          <div className="p-8 max-w-[1600px] mx-auto">
            {/* Title & Stats */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
              <div>
                <h2 className="text-3xl font-bold tracking-tight mb-2">AI Assistant & Knowledge Base</h2>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 px-2.5 py-1 rounded-full border border-green-100">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse" />
                    System Online
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary-fixed px-2.5 py-1 rounded-full border border-primary-fixed-dim">
                    <Database size={12} />
                    Vector Store: Active
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <StatCard label="Total Vectors" value={`${(stats.total_vectors / 1000000).toFixed(1)}M+`} />
                <StatCard label="Processed" value={`${stats.docs_processed} Docs`} />
                <StatCard label="Last Sync" value="14 mins ago" primary />
              </div>
            </div>

            {/* Dashboard Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-8 items-start">
              {/* Document Management */}
              <div className="xl:col-span-3 space-y-8">
                <section className="bg-white rounded-2xl shadow-sm border border-outline-variant overflow-hidden flex flex-col h-[700px]">
                  <div className="p-6 border-b border-outline-variant flex items-center justify-between">
                    <h3 className="text-xl font-bold flex items-center gap-2">
                       <CloudUpload className="text-primary" size={24} />
                       Document Management
                    </h3>
                    <button 
                      onClick={handleIngest}
                      disabled={isIngesting}
                      className="bg-primary text-on-primary px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-primary-container transition-all disabled:opacity-50 shadow-md shadow-primary/20"
                    >
                      <BrainCircuit size={18} className={isIngesting ? 'animate-spin' : ''} />
                      {isIngesting ? 'Ingesting...' : 'Ingest Documents'}
                    </button>
                  </div>

                  <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-8">
                    {/* Upload Zone */}
                    <div 
                      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                      onDragLeave={() => setDragActive(false)}
                      onDrop={(e) => { e.preventDefault(); setDragActive(false); handleUpload(e.dataTransfer.files); }}
                      className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer group ${
                        dragActive ? 'border-primary bg-primary/5' : 'border-outline-variant bg-surface-container-low hover:bg-primary/5 hover:border-primary/50'
                      }`}
                    >
                      <Upload className={`mx-auto mb-4 transition-colors ${dragActive ? 'text-primary' : 'text-outline group-hover:text-primary'}`} size={40} />
                      <p className="text-lg font-semibold text-on-surface">Drop files here or click to upload</p>
                      <p className="text-sm text-on-surface-variant mt-1">PDF, DOCX, TXT, or CSV (Max 25MB)</p>
                      <input 
                        type="file" 
                        multiple 
                        accept=".pdf"
                        onChange={(e) => handleUpload(e.target.files)}
                        className="hidden" 
                        id="file-upload" 
                      />
                      <label htmlFor="file-upload" className="absolute inset-0 cursor-pointer" />
                    </div>

                    {/* Doc List */}
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-outline mb-4">Uploaded Documents</h4>
                      <div className="space-y-3">
                        <AnimatePresence initial={false}>
                          {files.map((file) => (
                            <motion.div 
                              key={file.name}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, x: -20 }}
                              className="group flex items-center justify-between p-4 rounded-xl bg-white border border-outline-variant hover:border-primary/30 transition-all hover:shadow-md"
                            >
                              <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                  file.name.endsWith('.pdf') ? 'bg-error-container text-error' : 'bg-primary-fixed text-primary'
                                }`}>
                                  <FileText size={20} />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-on-surface truncate pr-2">{file.name}</p>
                                  <p className="text-xs text-on-surface-variant">{file.size} • Updated {file.updatedAt}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-6">
                                <StatusBadge status={file.status} />
                                <button 
                                  onClick={() => handleDelete(file.name)}
                                  className="text-outline hover:text-error transition-colors p-1 opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </motion.div>
                          ))}
                        </AnimatePresence>
                        {files.length === 0 && (
                          <p className="text-center py-10 text-on-surface-variant text-sm border border-dashed border-outline-variant rounded-xl italic">
                            No documents uploaded yet.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Creative Banner */}
                    <div className="relative rounded-2xl overflow-hidden h-48 group shadow-lg">
                      <img 
                        src="https://lh3.googleusercontent.com/aida/ADBb0uiLIA1PLWLfpyx3SWUTidQVBriG90vlNP1DcOV0vov52xG7iOtSGIRrjSsLbGcJ1hsp7T3PwchY9iYDE4vduZBhMtZLQLD56pyXznRRfAMv8w-S8MsB8cR_Mm8n_rEMdemosRepM1eCSTiJGs5BqxopDbX0RD0uzvwWw6-dv3J0-eZGWlkfyz_Ur9GT_TyYf7EwdZEhCeuRUTndL8O4DXDi5OIbKdVGRsOu_P1H3YrwxZ8YY53iKYj3eIUR0I1aEr83Hnja0pRRDw"
                        className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                        alt="Neural flow"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-6">
                        <h4 className="text-xl font-bold text-white mb-1">Intelligent Indexing</h4>
                        <p className="text-sm text-white/80 max-w-md">Our RAG engine uses state-of-the-art embedding models to vectorize your business context.</p>
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              {/* Chat Interface */}
              <div className="xl:col-span-2">
                <section className="bg-white rounded-2xl shadow-sm border border-outline-variant overflow-hidden flex flex-col h-[700px] shadow-2xl shadow-primary/5">
                  <div className="p-6 border-b border-outline-variant flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary">
                      <Bot size={24} />
                    </div>
                    <div>
                      <h3 className="font-bold">Osmium Assistant</h3>
                      <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest">Listening to Knowledge Base</p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-surface/30">
                    {messages.map((m) => (
                      <div key={m.id} className={`flex flex-col ${m.type === 'user' ? 'items-end' : 'items-start'} space-y-2`}>
                        <div className={`p-4 rounded-2xl text-sm leading-relaxed max-w-[90%] shadow-sm ${
                          m.type === 'user' 
                            ? 'bg-primary text-on-primary rounded-tr-none' 
                            : 'bg-white border border-outline-variant text-on-surface rounded-tl-none'
                        }`}>
                          <p>{m.text}</p>
                          {m.sources && m.sources.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-outline-variant">
                              <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-2 flex items-center gap-1">
                                <BookOpen size={12} />
                                Sources
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {m.sources.map((s, idx) => (
                                  <div key={idx} className="flex items-center gap-1 px-2 py-1 rounded bg-surface-container border border-outline-variant text-[10px] font-bold text-on-surface-variant">
                                    <FileText size={10} />
                                    {s.file} (P{s.page})
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] text-outline px-2">{m.timestamp}</span>
                      </div>
                    ))}
                    {isQuerying && (
                      <div className="flex items-center gap-3 text-primary/60">
                        <div className="flex gap-1.5 items-center">
                          <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 rounded-full bg-primary" />
                          <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-primary" />
                          <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-primary" />
                        </div>
                        <span className="text-xs italic">Analyzing knowledge base...</span>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="p-6 border-t border-outline-variant bg-white">
                    <form onSubmit={handleQuery} className="relative group">
                      <input 
                        type="text" 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask anything about your documents..."
                        className="w-full pl-5 pr-20 py-4 bg-surface-container rounded-2xl border-none focus:ring-2 focus:ring-primary/20 outline-none text-sm transition-all shadow-inner"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button type="button" className="p-2 text-outline hover:text-primary transition-colors">
                          <Mic size={20} />
                        </button>
                        <button 
                          type="submit" 
                          disabled={!input.trim() || isQuerying}
                          className="bg-primary text-on-primary p-2.5 rounded-xl transition-all disabled:opacity-50 hover:bg-primary-container shadow-lg shadow-primary/20"
                        >
                          <Send size={20} />
                        </button>
                      </div>
                    </form>
                    <p className="text-[10px] text-center text-outline mt-3 flex items-center justify-center gap-1">
                       <Info size={12} />
                       Osmium AI may provide inaccurate info. Verify important details.
                    </p>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </main>

        <footer className="h-12 flex-shrink-0 bg-surface-container-lowest border-t border-outline-variant flex items-center justify-between px-8 text-[11px] font-medium text-outline">
          <p>© 2024 Osmium Systems Inc.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-primary transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-primary transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-primary transition-colors">Security</a>
          </div>
        </footer>
      </div>
    </div>
  );
}

// --- Sub-components ---

function SidebarLink({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <a 
      href="#" 
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
        active 
          ? 'bg-primary/5 text-primary font-bold border border-primary/20 shadow-sm' 
          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
      }`}
    >
      <span className={active ? 'text-primary' : 'text-outline group-hover:text-on-surface'}>{icon}</span>
      <span className="text-sm">{label}</span>
      {active && <ArrowRight size={14} className="ml-auto opacity-50" />}
    </a>
  );
}

function HeaderIconButton({ icon }: { icon: React.ReactNode }) {
  return (
    <button className="p-2 text-outline hover:text-primary hover:bg-primary/5 rounded-xl transition-all">
      {icon}
    </button>
  );
}

function StatCard({ label, value, primary = false }: { label: string, value: string, primary?: boolean }) {
  return (
    <div className={`bg-white p-4 rounded-2xl shadow-sm border min-w-[140px] transition-all hover:shadow-md ${primary ? 'border-primary/20' : 'border-outline-variant'}`}>
      <p className="text-outline text-[11px] font-bold uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold tracking-tight ${primary ? 'text-primary' : 'text-on-surface'}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: DocFile['status'] }) {
  const styles = {
    Ingested: 'bg-green-50 text-green-700 border-green-100',
    Processing: 'bg-primary-fixed text-primary border-primary-fixed-dim',
    Pending: 'bg-surface-container text-outline border-outline-variant'
  };

  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${styles[status]}`}>
      {status === 'Processing' && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
      {status}
    </span>
  );
}

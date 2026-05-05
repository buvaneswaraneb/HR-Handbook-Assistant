import { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import ChatAssistant from './components/layout/ChatAssistant';
import FileGrid from './components/dashboard/FileGrid';
import { Download, Plus } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');

  return (
    <div className="h-screen flex overflow-hidden bg-surface text-on-surface">
      <Sidebar />
      
      <main className="flex-1 overflow-auto flex flex-col p-8 bg-surface">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-on-surface">Overview</h1>
            <p className="text-on-surface-variant text-sm mt-1">
              Welcome back. Manage your document knowledge base and assistant.
            </p>
          </div>
          
          <div className="flex gap-3">
            <button className="px-4 py-2 bg-surface-container text-on-surface text-sm font-medium rounded-xl border border-outline-variant hover:bg-surface-container-high transition-colors flex items-center gap-2">
              <Download className="h-4 w-4" />
              Download Report
            </button>
            <button className="px-4 py-2 bg-accent-purple text-white text-sm font-medium rounded-xl hover:bg-opacity-90 transition-all shadow-lg shadow-accent-purple/10 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New Project
            </button>
          </div>
        </div>

        <FileGrid />
      </main>

      <ChatAssistant />
    </div>
  );
}

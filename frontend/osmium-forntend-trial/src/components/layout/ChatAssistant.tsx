import { useState, useRef, useEffect } from 'react';
import { Bot, X, Paperclip, Send, Loader2, Code2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api, QueryResponse } from '@/src/services/api';
import { cn } from '@/src/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  timestamp: string;
  rawJson?: any;
}

export default function ChatAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! How can I help you with your documents today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await api.query(input);
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.answer,
        sources: response.sources,
        rawJson: response,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error while processing your request.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <aside className="w-80 bg-surface-container-lowest border-l border-outline-variant flex flex-col h-full flex-shrink-0">
      <div className="h-20 px-6 flex items-center justify-between border-b border-outline-variant">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-accent-purple" />
          <h2 className="text-sm font-semibold text-on-surface">AI Assistant</h2>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowJson(!showJson)}
            className={cn("p-1.5 rounded-lg transition-colors", showJson ? "bg-accent-purple text-white" : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container")}
            title="Toggle JSON Output"
          >
            <Code2 className="h-4 w-4" />
          </button>
          <button className="p-1 text-on-surface-variant hover:text-on-surface transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {messages.map((msg, idx) => (
          <div key={idx} className={cn("flex flex-col gap-1", msg.role === 'user' ? "items-end" : "items-start")}>
            <div
              className={cn(
                "p-3 rounded-2xl text-sm max-w-[90%] break-words shadow-sm",
                msg.role === 'user'
                  ? "bg-accent-purple text-white rounded-tr-none"
                  : "bg-surface-container text-on-surface rounded-tl-none border border-outline-variant"
              )}
            >
              <div className="prose prose-invert prose-sm">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
              
              {msg.rawJson && showJson && (
                <div className="mt-4 p-2 bg-black/40 rounded-lg overflow-x-auto">
                  <p className="text-[9px] uppercase font-bold text-accent-purple mb-1 border-b border-accent-purple/20 pb-1">Raw JSON Output</p>
                  <pre className="text-[9px] font-mono whitespace-pre text-green-400/80">
                    {JSON.stringify(msg.rawJson, null, 2)}
                  </pre>
                </div>
              )}

              {msg.sources && msg.sources.length > 0 && !showJson && (
                <div className="mt-2 pt-2 border-t border-outline-variant/30 text-[10px] opacity-70 italic">
                  Sources: {msg.sources.join(', ')}
                </div>
              )}
            </div>
            <span className="text-[10px] text-on-surface-variant px-1">{msg.timestamp}</span>
          </div>
        ))}
        {isLoading && (
          <div className="flex flex-col gap-1 items-start">
            <div className="bg-surface-container p-3 rounded-2xl rounded-tl-none border border-outline-variant">
              <Loader2 className="h-4 w-4 animate-spin text-accent-purple" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-outline-variant bg-surface-container-lowest">
        <div className="mb-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask a question..."
            className="w-full bg-surface-container border-none rounded-xl text-sm text-on-surface placeholder:text-on-surface-variant focus:ring-1 focus:ring-accent-purple resize-none p-3 h-20 outline-none transition-all"
          />
        </div>
        <div className="flex gap-2">
          <button className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-surface-container text-on-surface-variant text-xs font-medium rounded-lg border border-outline-variant hover:text-on-surface hover:border-outline transition-colors">
            <Paperclip className="h-4 w-4" />
            Send Files
          </button>
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-accent-purple text-white text-xs font-medium rounded-lg hover:bg-opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-accent-purple/10"
          >
            <Send className="h-4 w-4" />
            Send Text
          </button>
        </div>
      </div>
    </aside>
  );
}

// ============================================================
// ai.js — AI Assistant (Full-Page Split Layout)
// Left: Chat · Right: File Injection Panel
// ============================================================

import { State } from '../utils/state.js';
import { queryRAG, getFiles, deleteFile, uploadFile } from './api.js?v=20260512-3';
import { escHtml, fmtBytes, fmtDate } from '../utils/helpers.js?v=20260509-3';
import { showToast } from './ui.js';

let messagesEl, inputEl, filesPanelEl, historySidebarEl, historyListEl, historyCountEl;
let injectedFiles = [];   // files currently "active" in context
let pendingAttach = null; // file staged for upload
let isSending = false;
let chatHistory = [];
let conversations = [];
let currentConversationId = null;
let aiFilesCache = [];
let loadedMemoryKey = null;

const CHAT_HISTORY_LIMIT = 40;
const API_HISTORY_LIMIT = 10;
const MAX_CONVERSATIONS = 30;
const WELCOME_HTML = `
  <div style="margin-bottom:8px">Hello! I am the Osmium HR HandBook.</div>
  <div>Please upload a PDF first, then ask questions from your HR handbook.</div>`;

export function initAI() {
  messagesEl   = document.getElementById('ai-messages');
  inputEl      = document.getElementById('ai-input');
  filesPanelEl = document.getElementById('ai-files-panel');
  historySidebarEl = document.getElementById('ai-history-sidebar');
  historyListEl = document.getElementById('ai-history-list');
  historyCountEl = document.getElementById('ai-history-count');

  if (!messagesEl) return;

  // Send button
  document.getElementById('ai-send')?.addEventListener('click', e => {
    e.preventDefault();
    sendMessage();
  });

  document.getElementById('ai-new-chat')?.addEventListener('click', e => {
    e.preventDefault();
    startNewConversation();
  });

  document.getElementById('ai-history-toggle')?.addEventListener('click', e => {
    e.preventDefault();
    toggleHistorySidebar();
  });

  document.getElementById('ai-history-close')?.addEventListener('click', e => {
    e.preventDefault();
    setHistorySidebar(false);
  });

  // Textarea: Enter sends (Shift+Enter = newline)
  inputEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Attach file button inside chat input
  document.getElementById('ai-attach-btn')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('ai-file-input')?.click();
  });

  document.getElementById('ai-file-input')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) stageAttachment(f);
    e.target.value = '';
  });

  // Quick chips
  document.querySelectorAll('.ai-chip[data-q]').forEach(chip => {
    chip.addEventListener('click', () => {
      if (!canSendMainAIMessage()) {
        showUploadRequired();
        return;
      }
      if (inputEl) { inputEl.value = chip.dataset.q; inputEl.focus(); }
    });
  });

  // Keyboard shortcut Cmd+/
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      window.switchViewGlobal?.('ai');
    }
  });

  // State listeners
  State.on('view:ai', () => {
    loadConversationMemory();
    loadAIFiles();
    inputEl?.focus();
  });
  State.on('data:files:refresh', () => {
    if (State.currentView === 'ai') loadAIFiles();
  });
  State.on('change:auth', () => loadConversationMemory(true));

  loadConversationMemory();
  if (State.currentView === 'ai') loadAIFiles();
}

// ─── CHAT MEMORY ─────────────────────────────────────────────
function memoryKey() {
  const id = State.auth?.workplaceId || State.authProfile?.workplace_id || State.authProfile?.user_id || State.auth?.user?.id || 'anonymous';
  return `osmium_ai_memory_${id}`;
}

function conversationsKey() {
  return `${memoryKey()}_conversations`;
}

function loadConversationMemory(force = false) {
  if (!messagesEl) return;
  const key = memoryKey();
  if (!force && loadedMemoryKey === key) return;
  loadedMemoryKey = key;

  const storeKey = conversationsKey();
  try {
    const savedStore = JSON.parse(localStorage.getItem(storeKey) || '{}');
    conversations = Array.isArray(savedStore.conversations)
      ? savedStore.conversations.map(normalizeConversation).filter(Boolean).slice(0, MAX_CONVERSATIONS)
      : [];
    currentConversationId = savedStore.currentConversationId || null;

    if (!conversations.length) {
      const legacy = JSON.parse(localStorage.getItem(key) || '{}');
      if (Array.isArray(legacy.messages) && legacy.messages.length) {
        const migrated = normalizeConversation({
          id: newConversationId(),
          messages: legacy.messages,
          injectedFiles: legacy.injectedFiles,
          updatedAt: Date.now(),
        });
        conversations = migrated ? [migrated] : [];
        currentConversationId = migrated?.id || null;
        persistConversationStore();
      }
    }
  } catch {
    conversations = [];
    currentConversationId = null;
  }

  const active = getActiveConversation();
  if (active) {
    chatHistory = active.messages.slice(-CHAT_HISTORY_LIMIT);
    injectedFiles = Array.isArray(active.injectedFiles) ? [...active.injectedFiles] : [];
    currentConversationId = active.id;
  } else {
    chatHistory = [];
    injectedFiles = [];
  }

  renderConversation();
  renderHistoryList();
  updateContextBadge();
}

function persistConversationStore() {
  conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  conversations = conversations.slice(0, MAX_CONVERSATIONS);
  try {
    localStorage.setItem(conversationsKey(), JSON.stringify({
      currentConversationId,
      conversations,
    }));
  } catch {}
}

function persistConversation() {
  if (!currentConversationId && (chatHistory.length || injectedFiles.length)) {
    currentConversationId = newConversationId();
    conversations.unshift({
      id: currentConversationId,
      title: 'New conversation',
      messages: [],
      injectedFiles: [],
      updatedAt: Date.now(),
    });
  }

  const active = getActiveConversation();
  if (active) {
    active.messages = chatHistory.slice(-CHAT_HISTORY_LIMIT);
    active.injectedFiles = [...injectedFiles];
    active.title = conversationTitle(active.messages);
    active.updatedAt = Date.now();
  }

  persistConversationStore();
  renderHistoryList();
}

function newConversationId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeConversation(item) {
  if (!item || typeof item !== 'object') return null;
  const messages = Array.isArray(item.messages) ? item.messages.slice(-CHAT_HISTORY_LIMIT) : [];
  return {
    id: item.id || newConversationId(),
    title: item.title || conversationTitle(messages),
    messages,
    injectedFiles: Array.isArray(item.injectedFiles) ? item.injectedFiles : [],
    updatedAt: Number(item.updatedAt) || Date.now(),
  };
}

function getActiveConversation() {
  return conversations.find(item => item.id === currentConversationId) || conversations[0] || null;
}

function conversationTitle(messages) {
  const firstUser = (messages || []).find(item => item.role === 'user' && (item.content || item.attachmentName));
  const seed = firstUser?.content || firstUser?.attachmentName || 'New conversation';
  return seed.length > 48 ? `${seed.slice(0, 45)}...` : seed;
}

function conversationPreview(conv) {
  const last = [...(conv.messages || [])].reverse().find(item => item.content || item.attachmentName);
  if (!last) return 'No messages yet';
  const text = last.content || last.attachmentName || '';
  return text.length > 64 ? `${text.slice(0, 61)}...` : text;
}

function formatHistoryTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderHistoryList() {
  if (!historyListEl) return;
  const count = conversations.length;
  if (historyCountEl) {
    historyCountEl.textContent = count ? `${count} conversation${count === 1 ? '' : 's'}` : 'No conversations';
  }

  if (!count) {
    historyListEl.innerHTML = `
      <div class="ai-history-empty">
        <span class="material-symbols-outlined">history</span>
        <div>No previous conversations yet.</div>
      </div>`;
    return;
  }

  historyListEl.innerHTML = conversations.map(conv => `
    <div class="ai-history-item ${conv.id === currentConversationId ? 'active' : ''}" onclick="window._openAIConversation('${conv.id}')">
      <div class="ai-history-item-main">
        <div class="ai-history-title">${escHtml(conv.title || 'New conversation')}</div>
        <div class="ai-history-preview">${escHtml(conversationPreview(conv))}</div>
      </div>
      <div class="ai-history-meta">
        <span>${escHtml(formatHistoryTime(conv.updatedAt))}</span>
        <button type="button" class="ai-history-delete" title="Delete conversation" onclick="event.stopPropagation();window._deleteAIConversation('${conv.id}')">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>`).join('');
}

function setHistorySidebar(open) {
  historySidebarEl?.classList.toggle('collapsed', !open);
  historySidebarEl?.classList.toggle('open', open);
}

function toggleHistorySidebar() {
  const isCollapsed = historySidebarEl?.classList.contains('collapsed');
  const isOpen = historySidebarEl?.classList.contains('open');
  const compactLayout = window.matchMedia('(max-width: 1120px)').matches;
  if (isCollapsed) {
    setHistorySidebar(true);
    return;
  }
  setHistorySidebar(compactLayout ? !isOpen : false);
}

window._openAIConversation = function(id) {
  const conv = conversations.find(item => item.id === id);
  if (!conv) return;
  currentConversationId = id;
  chatHistory = conv.messages.slice(-CHAT_HISTORY_LIMIT);
  injectedFiles = Array.isArray(conv.injectedFiles) ? [...conv.injectedFiles] : [];
  pendingAttach = null;
  renderPendingAttachment();
  persistConversationStore();
  renderConversation();
  renderHistoryList();
  loadAIFiles();
  updateContextBadge();
  inputEl?.focus();
};

window._deleteAIConversation = function(id) {
  const conv = conversations.find(item => item.id === id);
  if (!conv) return;
  if (!confirm(`Delete "${conv.title || 'this conversation'}"?`)) return;
  conversations = conversations.filter(item => item.id !== id);
  if (currentConversationId === id) {
    const next = conversations[0] || null;
    currentConversationId = next?.id || null;
    chatHistory = next?.messages?.slice(-CHAT_HISTORY_LIMIT) || [];
    injectedFiles = next?.injectedFiles ? [...next.injectedFiles] : [];
    renderConversation();
    updateContextBadge();
    loadAIFiles();
  }
  try {
    persistConversationStore();
    renderHistoryList();
  } catch {}
};

function renderConversation() {
  if (!messagesEl) return;
  messagesEl.innerHTML = '';
  if (!chatHistory.length) {
    appendMsg('bot', WELCOME_HTML);
    return;
  }

  chatHistory.forEach(item => {
    if (item.role === 'user') {
      appendMsg('user', userMessageHtml(item.content || '', item.attachmentName ? { name: item.attachmentName } : null));
    } else {
      appendMsg('bot', botMessageHtml(item.content || '', item.sources || []));
    }
  });
  scrollToBottom();
}

function hasUploadedPdf() {
  return aiFilesCache.some(isPdfFile);
}

function hasPendingPdf() {
  return Boolean(pendingAttach && isPdfFile(pendingAttach));
}

function canSendMainAIMessage() {
  return hasUploadedPdf() || hasPendingPdf();
}

function updateMessageGate() {
  const blocked = !canSendMainAIMessage();
  const sendBtn = document.getElementById('ai-send');
  const notice = document.getElementById('ai-upload-required');
  const chips = document.querySelectorAll('.ai-chip[data-q]');

  if (inputEl) {
    inputEl.disabled = blocked;
    inputEl.placeholder = blocked
      ? 'Upload a PDF handbook first...'
      : 'Ask the HR HandBook a question... (Shift+Enter for new line)';
  }
  if (sendBtn) sendBtn.disabled = blocked || isSending;
  if (notice) notice.style.display = blocked ? 'flex' : 'none';
  chips.forEach(chip => {
    chip.classList.toggle('disabled', blocked);
    chip.setAttribute('aria-disabled', blocked ? 'true' : 'false');
  });
}

function showUploadRequired() {
  updateMessageGate();
  showToast('Upload or attach one PDF before sending messages in the HR HandBook.', 'error');
}

function pushHistory(item) {
  chatHistory.push(item);
  if (chatHistory.length > CHAT_HISTORY_LIMIT) {
    chatHistory = chatHistory.slice(-CHAT_HISTORY_LIMIT);
  }
  persistConversation();
}

function apiHistory() {
  return chatHistory.slice(-API_HISTORY_LIMIT).map(item => ({
    role: item.role === 'bot' ? 'assistant' : item.role,
    content: item.content || '',
    attachment_name: item.attachmentName || null,
    file_names: item.fileNames || [],
  }));
}

function startNewConversation() {
  chatHistory = [];
  injectedFiles = [];
  currentConversationId = null;
  pendingAttach = null;
  renderPendingAttachment();
  persistConversationStore();
  renderHistoryList();
  renderConversation();
  loadAIFiles();
  updateContextBadge();
  inputEl?.focus();
}

// ─── FILE RIGHT PANEL ─────────────────────────────────────────
export async function loadAIFiles() {
  if (!filesPanelEl) return;
  if (!State.authProfile) {
    filesPanelEl.innerHTML = `<div style="padding:16px;color:var(--gl-on-surface-4);font-size:0.8rem">Sign in to load files.</div>`;
    aiFilesCache = [];
    updateMessageGate();
    return;
  }
  try {
    const files = await getFiles();
    renderAIFilePanel(files);
  } catch {
    if (filesPanelEl) filesPanelEl.innerHTML = `<div style="padding:16px;color:var(--gl-on-surface-4);font-size:0.8rem">Could not load files.</div>`;
    aiFilesCache = [];
    updateMessageGate();
  }
}

function renderAIFilePanel(files) {
  if (!filesPanelEl) return;
  const pdfFiles = (files || []).filter(isPdfFile);
  aiFilesCache = pdfFiles;
  const before = injectedFiles.length;
  injectedFiles = injectedFiles.filter(id => pdfFiles.some(file => file.id === id));
  if (before !== injectedFiles.length) persistConversation();
  updateContextBadge();

  if (!pdfFiles.length) {
    updateMessageGate();
    filesPanelEl.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--gl-on-surface-4)">
        <span class="material-symbols-outlined" style="font-size:36px;display:block;margin-bottom:8px;opacity:0.4">folder_open</span>
        <div style="font-size:0.82rem">No PDFs uploaded yet.</div>
        <div style="font-size:0.72rem;margin-top:4px">Upload PDFs to inject into AI context.</div>
      </div>`;
    return;
  }

  updateMessageGate();

  const extIcon = { PDF:'picture_as_pdf' };
  const extColor = { PDF:'#f5574a' };

  filesPanelEl.innerHTML = pdfFiles.map(f => {
    const ext = (f.filename || '').split('.').pop().toUpperCase();
    const icon = extIcon[ext] || 'insert_drive_file';
    const color = extColor[ext] || 'var(--gl-on-surface-4)';
    const isInjected = injectedFiles.includes(f.id);

    return `
      <div class="ai-file-item" id="aif-${f.id}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--gl-outline);transition:background 0.15s" 
        onmouseenter="this.style.background='var(--gl-surface-high)'"
        onmouseleave="this.style.background='transparent'">
        <span class="material-symbols-outlined" style="font-size:18px;color:${color};flex-shrink:0">${icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.8rem;font-weight:600;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(f.filename)}">${escHtml(f.filename)}</div>
          <div style="font-size:0.68rem;color:var(--gl-on-surface-4)">${fmtBytes(f.size_bytes)} · ${fmtDate(f.created_at)}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button type="button" class="ai-inject-btn" title="${isInjected ? 'Remove from context' : 'Inject into context'}"
            style="width:28px;height:28px;border-radius:4px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:${isInjected ? '#3dd68c22' : 'transparent'};color:${isInjected ? '#3dd68c' : 'var(--gl-on-surface-4)'};transition:all 0.15s"
            onclick="window._toggleInjectFile('${f.id}', '${escHtml(f.filename)}')">
            <span class="material-symbols-outlined" style="font-size:15px">${isInjected ? 'check_circle' : 'add_circle_outline'}</span>
          </button>
          ${f.url ? `<button type="button" title="Download file"
            style="width:28px;height:28px;border-radius:4px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:transparent;color:var(--gl-on-surface-4);transition:all 0.15s"
            onmouseenter="this.style.color='var(--gl-on-surface)'"
            onmouseleave="this.style.color='var(--gl-on-surface-4)'"
            onclick="window._downloadAIFile('${escHtml(f.url)}', '${escHtml(f.filename || 'download')}')">
            <span class="material-symbols-outlined" style="font-size:15px">download</span>
          </button>` : ''}
          <button type="button" title="Delete file"
            style="width:28px;height:28px;border-radius:4px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:transparent;color:var(--gl-on-surface-4);transition:all 0.15s"
            onmouseenter="this.style.color='#f5574a'"
            onmouseleave="this.style.color='var(--gl-on-surface-4)'"
            onclick="window._deleteAIFile('${f.id}')">
            <span class="material-symbols-outlined" style="font-size:15px">delete</span>
          </button>
        </div>
      </div>`;
  }).join('');
}

function isPdfFile(file) {
  const name = file?.filename || file?.name || '';
  const mime = file?.mime_type || file?.content_type || file?.type || '';
  return /\.pdf$/i.test(name) || mime === 'application/pdf';
}

window._toggleInjectFile = function(fileId, filename) {
  if (injectedFiles.includes(fileId)) {
    injectedFiles = injectedFiles.filter(id => id !== fileId);
    showToast(`Removed "${filename}" from context`);
  } else {
    injectedFiles.push(fileId);
    showToast(`Injecting "${filename}" into context`);
  }
  persistConversation();
  loadAIFiles();
  updateContextBadge();
};

window._deleteAIFile = async function(fileId) {
  if (!confirm('Permanently delete this file?')) return;
  try {
    await deleteFile(fileId);
    injectedFiles = injectedFiles.filter(id => id !== fileId);
    persistConversation();
    showToast('File deleted.');
    State.emit('data:files:refresh');
    updateContextBadge();
  } catch (e) { showToast(e.message, 'error'); }
};

window._downloadAIFile = function(url, filename) {
  triggerCloudDownload(url, filename);
};

function updateContextBadge() {
  const badge = document.getElementById('ai-context-badge');
  if (!badge) return;
  if (injectedFiles.length) {
    badge.textContent = `${injectedFiles.length} file${injectedFiles.length > 1 ? 's' : ''} in context`;
    badge.style.color = '#3dd68c';
    return;
  }
  if (aiFilesCache.length) {
    badge.textContent = `${aiFilesCache.length} PDF${aiFilesCache.length > 1 ? 's' : ''} available`;
    badge.style.color = '#3dd68c';
    return;
  }
  badge.textContent = 'No PDFs uploaded';
  badge.style.color = 'var(--gl-on-surface-4)';
}

function injectedFileNames() {
  return injectedFiles
    .map(id => aiFilesCache.find(file => file.id === id)?.filename)
    .filter(Boolean);
}

// ─── ATTACHMENT STAGING ───────────────────────────────────────
function stageAttachment(file) {
  if (!isPdfFile(file)) {
    pendingAttach = null;
    showToast('Only PDF files can be attached to AI.', 'error');
    renderPendingAttachment();
    return;
  }
  pendingAttach = file;
  renderPendingAttachment();
  updateMessageGate();
}

function renderPendingAttachment() {
  const indicator = document.getElementById('ai-attach-indicator');
  if (!indicator) return;

  if (!pendingAttach) {
    indicator.innerHTML = '';
    indicator.style.display = 'none';
    updateMessageGate();
    return;
  }

  indicator.style.display = 'flex';
  indicator.innerHTML = `
    <span class="material-symbols-outlined" style="font-size:14px">picture_as_pdf</span>
    <span style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(pendingAttach.name)}">${escHtml(pendingAttach.name)}</span>
    <button type="button" class="ai-attach-clear" title="Remove attachment" onclick="window._clearAttach()">
      <span class="material-symbols-outlined" style="font-size:13px">close</span>
    </button>`;
  updateMessageGate();
}

window._clearAttach = function() {
  pendingAttach = null;
  renderPendingAttachment();
};

// ─── SEND MESSAGE ─────────────────────────────────────────────
async function sendMessage() {
  if (isSending) return;
  if (!canSendMainAIMessage()) {
    showUploadRequired();
    return;
  }

  const q = inputEl?.value.trim();
  if (!q && !pendingAttach) return;

  const sendBtn = document.getElementById('ai-send');
  isSending = true;
  if (sendBtn) sendBtn.disabled = true;

  try {
    const attachment = pendingAttach;
    const attachedName = attachment?.name || '';
    const activeFileIds = injectedFiles.length ? [...injectedFiles] : aiFilesCache.map(file => file.id).filter(Boolean);
    const previousHistory = apiHistory();
    const activeNamesBeforeSend = injectedFileNames();

    if (inputEl) {
      inputEl.value = '';
      inputEl.style.height = 'auto';
    }
    window._clearAttach();

    const userHtml = userMessageHtml(q, attachment);
    appendMsg('user', userHtml);
    pushHistory({
      role: 'user',
      content: q || '',
      attachmentName: attachedName || null,
      fileNames: activeNamesBeforeSend,
    });

    const thinkingEl = appendMsg('bot', attachment
      ? processingFileHtml(attachedName)
      : `<span style="color:var(--gl-on-surface-4);font-style:italic">Thinking…</span>`);
    scrollToBottom();

    // Upload attachment first if present
    if (attachment) {
      const formData = new FormData();
      formData.append('file', attachment);
      try {
        const result = await uploadFile(formData);
        if (result?.id) {
          if (!injectedFiles.includes(result.id)) injectedFiles.push(result.id);
          if (!activeFileIds.includes(result.id)) activeFileIds.push(result.id);
          if (result.filename && !aiFilesCache.some(file => file.id === result.id)) {
            aiFilesCache.unshift(result);
          }
          persistConversation();
          updateContextBadge();
          State.emit('data:files:refresh');
          showToast(`"${attachedName}" uploaded & injected`);
        }
      } catch (e) {
        showToast(`Upload failed: ${e.message}`, 'error');
        thinkingEl.innerHTML = `<span style="color:#f5574a">Could not process "${escHtml(attachedName)}": ${escHtml(e.message)}</span>`;
        scrollToBottom();
        return;
      }
    }

    if (!q) {
      const content = `File processed and added to context: ${attachedName}`;
      thinkingEl.innerHTML = `File processed and added to context: <strong>${escHtml(attachedName)}</strong>`;
      pushHistory({ role: 'assistant', content, sources: [], fileNames: [attachedName] });
      scrollToBottom();
      return;
    }

    try {
      thinkingEl.innerHTML = `<span style="color:var(--gl-on-surface-4);font-style:italic">Thinking…</span>`;
      const data = await queryRAG(q, activeFileIds, previousHistory);
      const answer = data.answer || '';

      const validSources = (data.sources || []).filter(s => {
        const page = s.page ?? s.page_number;
        return (s.file || s.filename || s.source) && page !== undefined && page !== null && page !== '';
      });

      thinkingEl.innerHTML = botMessageHtml(answer, validSources);
      pushHistory({
        role: 'assistant',
        content: answer,
        sources: validSources,
        fileNames: injectedFileNames(),
      });
    } catch (e) {
      const content = `Error: ${e.message}`;
      thinkingEl.innerHTML = `<span style="color:#f5574a">${escHtml(content)}</span>`;
      pushHistory({ role: 'assistant', content, sources: [] });
    }

    scrollToBottom();
  } finally {
    isSending = false;
    updateMessageGate();
  }
}

function userMessageHtml(text, attachment) {
  const body = text ? `<div style="white-space:pre-wrap">${escHtml(text)}</div>` : '';
  const fileChip = attachment ? `
    <div class="ai-sent-attachment">
      <span class="material-symbols-outlined" style="font-size:14px">picture_as_pdf</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(attachment.name)}</span>
    </div>` : '';
  return `${body}${fileChip}`;
}

function botMessageHtml(answer, sources = []) {
  let html = `<div style="line-height:1.7;white-space:pre-wrap">${escHtml(answer || '')}</div>`;
  const validSources = (sources || []).filter(s => {
    const page = s.page ?? s.page_number;
    return (s.file || s.filename || s.source) && page !== undefined && page !== null && page !== '';
  });

  if (!validSources.length) return html;

  html += `<div class="ai-sources">
    <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--gl-on-surface-4);margin-bottom:8px">Sources</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${validSources.map(s => {
        const fileName = s.file || s.filename || s.source;
        const page = s.page ?? s.page_number;
        const snippet = s.preview || s.snippet || s.text || '';
        return `<div class="ai-source-chip" style="display:block;line-height:1.45">
          <div style="display:flex;align-items:center;gap:5px;font-weight:700">
            <span class="material-symbols-outlined" style="font-size:12px">description</span>
            ${escHtml(fileName)} · Page ${escHtml(String(page))}
          </div>
          ${snippet ? `<div style="margin-top:3px;color:var(--gl-on-surface-3);font-weight:400">${escHtml(String(snippet).slice(0, 180))}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;

  return html;
}

function processingFileHtml(filename) {
  return `
    <div style="display:flex;align-items:center;gap:8px;color:var(--gl-on-surface-3)">
      <span class="spinner-sm spinner"></span>
      <span>Processing ${escHtml(filename)}…</span>
    </div>
    <div style="font-size:0.72rem;color:var(--gl-on-surface-4);margin-top:6px">Uploading and indexing the file before answering.</div>`;
}

function triggerCloudDownload(url, filename) {
  if (!url) return;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'download';
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function appendMsg(role, html) {
  const el = document.createElement('div');
  el.className = `ai-msg ai-msg-${role}`;
  el.innerHTML = html;
  messagesEl.appendChild(el);
  return el;
}

function scrollToBottom() {
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ─── AUTO-RESIZE TEXTAREA ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('ai-input');
  ta?.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  });
});

// Expose for nav & legacy floating toggle
window.toggleAIWindow = () => window.switchViewGlobal?.('ai');
window.openAIWindow   = () => window.switchViewGlobal?.('ai');

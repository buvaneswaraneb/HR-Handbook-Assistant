// ============================================================
// ai.js — AI Assistant (Full-Page Split Layout)
// Left: Chat · Right: File Injection Panel
// ============================================================

import { State } from '../utils/state.js';
import { queryRAG, getFiles, deleteFile, uploadFile } from './api.js';
import { escHtml, fmtBytes, fmtDate } from '../utils/helpers.js';
import { showToast } from './ui.js';

let messagesEl, inputEl, filesPanelEl;
let injectedFiles = [];   // files currently "active" in context
let pendingAttach = null; // file staged for upload

export function initAI() {
  messagesEl   = document.getElementById('ai-messages');
  inputEl      = document.getElementById('ai-input');
  filesPanelEl = document.getElementById('ai-files-panel');

  if (!messagesEl) return;

  // Send button
  document.getElementById('ai-send')?.addEventListener('click', sendMessage);

  // Textarea: Enter sends (Shift+Enter = newline)
  inputEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Attach file button inside chat input
  document.getElementById('ai-attach-btn')?.addEventListener('click', () => {
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
    loadAIFiles();
    inputEl?.focus();
  });

  // Load right panel when view initialises
  loadAIFiles();
}

// ─── FILE RIGHT PANEL ─────────────────────────────────────────
export async function loadAIFiles() {
  if (!filesPanelEl) return;
  try {
    const files = await getFiles();
    renderAIFilePanel(files);
  } catch {
    if (filesPanelEl) filesPanelEl.innerHTML = `<div style="padding:16px;color:var(--gl-on-surface-4);font-size:0.8rem">Could not load files.</div>`;
  }
}

function renderAIFilePanel(files) {
  if (!filesPanelEl) return;

  if (!files.length) {
    filesPanelEl.innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--gl-on-surface-4)">
        <span class="material-symbols-outlined" style="font-size:36px;display:block;margin-bottom:8px;opacity:0.4">folder_open</span>
        <div style="font-size:0.82rem">No files uploaded yet.</div>
        <div style="font-size:0.72rem;margin-top:4px">Upload files to inject into AI context.</div>
      </div>`;
    return;
  }

  const extIcon = { PDF:'picture_as_pdf', PNG:'image', JPG:'image', JPEG:'image', ZIP:'folder_zip', DOC:'description', DOCX:'description', XLS:'table_chart', XLSX:'table_chart' };
  const extColor = { PDF:'#f5574a', PNG:'#f5a623', JPG:'#f5a623', DOCX:'#5abfe8', DOC:'#5abfe8', XLS:'#3dd68c', XLSX:'#3dd68c' };

  filesPanelEl.innerHTML = files.map(f => {
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
          <button class="ai-inject-btn" title="${isInjected ? 'Remove from context' : 'Inject into context'}"
            style="width:28px;height:28px;border-radius:4px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:${isInjected ? '#3dd68c22' : 'transparent'};color:${isInjected ? '#3dd68c' : 'var(--gl-on-surface-4)'};transition:all 0.15s"
            onclick="window._toggleInjectFile('${f.id}', '${escHtml(f.filename)}')">
            <span class="material-symbols-outlined" style="font-size:15px">${isInjected ? 'check_circle' : 'add_circle_outline'}</span>
          </button>
          <button title="Delete file"
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

window._toggleInjectFile = function(fileId, filename) {
  if (injectedFiles.includes(fileId)) {
    injectedFiles = injectedFiles.filter(id => id !== fileId);
    showToast(`Removed "${filename}" from context`);
  } else {
    injectedFiles.push(fileId);
    showToast(`Injecting "${filename}" into context`);
  }
  loadAIFiles();
  updateContextBadge();
};

window._deleteAIFile = async function(fileId) {
  if (!confirm('Permanently delete this file?')) return;
  try {
    await deleteFile(fileId);
    injectedFiles = injectedFiles.filter(id => id !== fileId);
    showToast('File deleted.');
    loadAIFiles();
    updateContextBadge();
  } catch (e) { showToast(e.message, 'error'); }
};

function updateContextBadge() {
  const badge = document.getElementById('ai-context-badge');
  if (!badge) return;
  badge.textContent = injectedFiles.length ? `${injectedFiles.length} file${injectedFiles.length > 1 ? 's' : ''} in context` : 'No files in context';
  badge.style.color = injectedFiles.length ? '#3dd68c' : 'var(--gl-on-surface-4)';
}

// ─── ATTACHMENT STAGING ───────────────────────────────────────
function stageAttachment(file) {
  pendingAttach = file;
  const indicator = document.getElementById('ai-attach-indicator');
  if (indicator) {
    indicator.textContent = file.name;
    indicator.style.display = 'flex';
  }
}

window._clearAttach = function() {
  pendingAttach = null;
  const indicator = document.getElementById('ai-attach-indicator');
  if (indicator) indicator.style.display = 'none';
};

// ─── SEND MESSAGE ─────────────────────────────────────────────
async function sendMessage() {
  const q = inputEl?.value.trim();
  if (!q && !pendingAttach) return;

  // Upload attachment first if present
  if (pendingAttach) {
    const formData = new FormData();
    formData.append('file', pendingAttach);
    try {
      const result = await uploadFile(formData);
      if (result?.id) {
        injectedFiles.push(result.id);
        updateContextBadge();
        loadAIFiles();
        showToast(`"${pendingAttach.name}" uploaded & injected`);
      }
    } catch (e) {
      showToast(`Upload failed: ${e.message}`, 'error');
    }
    window._clearAttach();
  }

  if (!q) return;
  if (inputEl) inputEl.value = '';
  inputEl.style.height = 'auto';

  appendMsg('user', escHtml(q));

  const thinkingEl = appendMsg('bot', `<span style="color:var(--gl-on-surface-4);font-style:italic">Thinking…</span>`);
  scrollToBottom();

  try {
    const data = await queryRAG(q, injectedFiles);
    const answer = data.answer || '';

    // Format answer with line breaks preserved
    let html = `<div style="line-height:1.7;white-space:pre-wrap">${escHtml(answer)}</div>`;

    if (data.sources?.length) {
      html += `<div class="ai-sources">
        <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--gl-on-surface-4);margin-bottom:6px">Sources</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${data.sources.map(s => {
            // Validate file name exists in our file list
            const cleanFile = s.file || '';
            const page = s.page ? `· p.${s.page}` : '';
            return `<span class="ai-source-chip">
              <span class="material-symbols-outlined" style="font-size:11px">description</span>
              ${escHtml(cleanFile)} ${page}
            </span>`;
          }).join('')}
        </div>
      </div>`;
    }

    thinkingEl.innerHTML = html;
  } catch (e) {
    thinkingEl.innerHTML = `<span style="color:#f5574a">Error: ${escHtml(e.message)}</span>`;
  }

  scrollToBottom();
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

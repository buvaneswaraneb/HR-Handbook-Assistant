// ============================================================
// ai.js — AI Assistant Window (Floating, Draggable, RAG Chat)
// ============================================================

import { State } from '../utils/state.js';
import { queryRAG } from './api.js';
import { escHtml } from '../utils/helpers.js';

let win, messagesEl, inputEl;
let isDragging = false, dragOffX = 0, dragOffY = 0;

export function initAI() {
  win        = document.getElementById('ai-window');
  messagesEl = document.getElementById('ai-messages');
  inputEl    = document.getElementById('ai-input');

  if (!win) return;

  // Draggable titlebar
  const titlebar = win.querySelector('.ai-titlebar');
  titlebar?.addEventListener('mousedown', startDrag);

  // Controls
  document.getElementById('ai-close')?.addEventListener('click', closeAI);
  document.getElementById('ai-minimize')?.addEventListener('click', toggleMinimize);
  document.getElementById('ai-send')?.addEventListener('click', sendMessage);
  inputEl?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

  // State listeners
  State.on('toggle:ai', toggleAI);

  // Quick chips
  document.querySelectorAll('.ai-chip[data-q]').forEach(chip => {
    chip.addEventListener('click', () => {
      if (inputEl) { inputEl.value = chip.dataset.q; sendMessage(); }
    });
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); toggleAI(); }
  });
}

function toggleAI() {
  if (win.classList.contains('open')) closeAI();
  else openAI();
}

function openAI() {
  win.classList.add('open');
  win.classList.remove('minimized');
  State.set('aiWindowOpen', true);
  inputEl?.focus();
  const navBtn = document.querySelector('.nav-item[data-view="ai"]');
  navBtn?.classList.add('active');
}

function closeAI() {
  win.classList.remove('open');
  State.set('aiWindowOpen', false);
  const navBtn = document.querySelector('.nav-item[data-view="ai"]');
  navBtn?.classList.remove('active');
}

function toggleMinimize() {
  win.classList.toggle('minimized');
  const icon = document.getElementById('ai-minimize')?.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = win.classList.contains('minimized') ? 'expand_less' : 'remove';
}

// ─── DRAG ────────────────────────────────────────────────────
function startDrag(e) {
  if (e.button !== 0) return;
  isDragging = true;
  const rect = win.getBoundingClientRect();
  dragOffX = e.clientX - rect.left;
  dragOffY = e.clientY - rect.top;

  // Switch to absolute positioning for dragging
  win.style.right = 'auto';
  win.style.bottom = 'auto';
  win.style.left = rect.left + 'px';
  win.style.top  = rect.top  + 'px';

  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup',   stopDrag, { once: true });
}

function onDrag(e) {
  if (!isDragging) return;
  let x = e.clientX - dragOffX;
  let y = e.clientY - dragOffY;
  x = Math.max(0, Math.min(window.innerWidth  - 100, x));
  y = Math.max(0, Math.min(window.innerHeight - 52, y));
  win.style.left = x + 'px';
  win.style.top  = y + 'px';
}

function stopDrag() {
  isDragging = false;
  window.removeEventListener('mousemove', onDrag);
}

// ─── CHAT ────────────────────────────────────────────────────
async function sendMessage() {
  const q = inputEl?.value.trim();
  if (!q) return;
  if (inputEl) inputEl.value = '';

  appendMsg('user', escHtml(q));

  const thinkingEl = appendMsg('bot', '<span style="color:var(--gl-on-surface-4);font-style:italic">Thinking…</span>');
  scrollToBottom();

  try {
    const data = await queryRAG(q);
    let html = `<div style="line-height:1.6">${escHtml(data.answer || '')}</div>`;

    if (data.sources?.length) {
      html += `<div class="ai-sources">
        <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--gl-on-surface-4);margin-bottom:5px">Sources</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px">
          ${data.sources.map(s => `<span class="ai-source-chip"><span class="material-symbols-outlined" style="font-size:11px">description</span>${escHtml(s.file)} · p.${s.page}</span>`).join('')}
        </div>
      </div>`;
    }

    thinkingEl.innerHTML = html;
  } catch (e) {
    thinkingEl.innerHTML = `<span style="color:var(--gl-error)">Error: ${escHtml(e.message)}</span>`;
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

// Expose for nav button
window.toggleAIWindow = toggleAI;
window.openAIWindow   = openAI;

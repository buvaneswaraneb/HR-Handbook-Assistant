// ============================================================
// ui.js — Shared UI: Toasts, Modals, Nav, Spinners
// Osmium ERM · Glacier Design System
// ============================================================

import { State } from '../utils/state.js';
import { escHtml } from '../utils/helpers.js';
import { checkHealth } from './api.js';

// ─── TOAST ───────────────────────────────────────────────────
export function showToast(msg, type = 'success', duration = 3500) {
  const stack = document.getElementById('toast-stack');
  const icons = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
  const colors = { success: 'var(--gl-success)', error: 'var(--gl-error)', info: 'var(--gl-info)', warning: 'var(--gl-warning)' };

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span class="material-symbols-outlined" style="color:${colors[type]};font-variation-settings:'FILL' 1">${icons[type]}</span>
    <span style="flex:1">${escHtml(msg)}</span>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--gl-on-surface-4);cursor:pointer;padding:0;display:flex;">
      <span class="material-symbols-outlined" style="font-size:16px">close</span>
    </button>`;

  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ─── MODAL ───────────────────────────────────────────────────
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); el.querySelector('[autofocus]')?.focus(); }
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

export function initModalOverlays() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
  });
}

// ─── NAVIGATION ──────────────────────────────────────────────
export function switchView(view) {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(`view-${view}`);
  if (panel) panel.classList.add('active');

  document.querySelectorAll('.nav-item[data-view]').forEach(l => {
    l.classList.toggle('active', l.dataset.view === view);
  });

  document.getElementById('topbar-title').textContent = viewTitle(view);
  State.set('currentView', view);

  // Emit so modules can load their data
  State.emit(`view:${view}`);
}

function viewTitle(v) {
  return {
    dashboard: 'Dashboard',
    canvas: 'Canvas',
    employees: 'Employees',
    projects: 'Projects',
    files: 'Assets & Files',
    tree: 'Org Tree',
    ai: 'AI Assistant',
  }[v] || v.charAt(0).toUpperCase() + v.slice(1);
}

// ─── API STATUS ───────────────────────────────────────────────
export function initApiStatus() {
  State.on('api:status', status => {
    const dot = document.getElementById('api-dot');
    const txt = document.getElementById('api-text');
    if (!dot || !txt) return;
    dot.className = 'api-dot ' + (status === 'ok' ? 'ok' : 'error');
    txt.textContent = status === 'ok' ? 'API Connected' : 'API Offline';
  });

  // Poll every 30s
  checkHealth();
  setInterval(checkHealth, 30000);
}

// ─── CONTEXT MENU ────────────────────────────────────────────
let activeCtxMenu = null;

export function showContextMenu(x, y, items) {
  hideContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  items.forEach(item => {
    if (item === 'divider') {
      menu.insertAdjacentHTML('beforeend', '<div class="ctx-divider"></div>');
      return;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.innerHTML = `<span class="material-symbols-outlined">${item.icon || 'circle'}</span>${escHtml(item.label)}`;
    el.addEventListener('click', () => { hideContextMenu(); item.action(); });
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  activeCtxMenu = menu;

  // Reposition if off-screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
  if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
}

export function hideContextMenu() {
  if (activeCtxMenu) { activeCtxMenu.remove(); activeCtxMenu = null; }
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });

// ─── THEME ───────────────────────────────────────────────────
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('light', !prefersDark);
  } else {
    root.classList.toggle('light', theme === 'light');
  }
  State.set('theme', theme);
}

// ─── KEYBOARD SHORTCUTS ──────────────────────────────────────
export function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'k') {
      e.preventDefault();
      document.getElementById('global-search')?.focus();
    }
    if (mod && e.key === '/') {
      e.preventDefault();
      State.emit('toggle:ai');
    }
    if (mod && e.key === '0') {
      e.preventDefault();
      State.emit('canvas:reset');
    }
  });
}

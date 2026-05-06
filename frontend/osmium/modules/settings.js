// ============================================================
// settings.js — Settings Panel
// Theme · API URL · Canvas · Notifications
// ============================================================

import { State } from '../utils/state.js';
import { applyTheme } from './ui.js';
import { checkHealth } from './api.js';
import { showToast } from './ui.js';

export function initSettings() {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;

  document.getElementById('settings-close')?.addEventListener('click', closeSettings);

  // Close on outside click
  document.addEventListener('click', e => {
    if (panel.classList.contains('open') &&
        !panel.contains(e.target) &&
        !e.target.closest('[data-settings-toggle]')) {
      closeSettings();
    }
  });

  // Load saved values into UI
  syncUI();
}

function syncUI() {
  const s = State.settings;

  // API URL
  const apiInput = document.getElementById('setting-api-url');
  if (apiInput) apiInput.value = s.apiBase;

  // Theme
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === s.theme);
  });

  // Toggles
  setToggle('setting-snap-grid', s.snapToGrid);
  setToggle('setting-edge-labels', s.showEdgeLabels);
  setToggle('setting-animate', s.animateNodes);
  setToggle('setting-notify', s.notifyOnActivity);
}

function setToggle(id, val) {
  const input = document.getElementById(id);
  if (input) input.checked = val;
}

export function openSettings() {
  document.getElementById('settings-panel')?.classList.add('open');
}

export function closeSettings() {
  document.getElementById('settings-panel')?.classList.remove('open');
}

// ─── SAVE HANDLERS (called from HTML) ─────────────────────────
window._saveApiUrl = function() {
  const val = document.getElementById('setting-api-url')?.value.trim();
  if (!val) return;
  State.apiBase = val;
  State.setSettings({ apiBase: val });
  checkHealth();
  showToast('API URL updated');
};

window._setTheme = function(theme) {
  applyTheme(theme);
  State.setSettings({ theme });
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
};

window._toggleSetting = function(key, checked) {
  State.setSettings({ [key]: checked });
  if (key === 'snapToGrid')    State.canvas.snapToGrid    = checked;
  if (key === 'showEdgeLabels') State.settings.showEdgeLabels = checked;
};

window._resetLayout = function() {
  if (!confirm('Reset canvas layout? Node positions will be lost.')) return;
  State.canvas.nodes  = [];
  State.canvas.edges  = [];
  State.canvas.groups = [];
  State.emit('canvas:nodes:change', []);
  State.emit('canvas:edges:change', []);
  showToast('Canvas layout reset');
};

window._clearCache = function() {
  State.employees = [];
  State.projects  = [];
  State.files     = [];
  showToast('Cache cleared — data will reload on next view switch');
};

window.openSettings  = openSettings;
window.closeSettings = closeSettings;

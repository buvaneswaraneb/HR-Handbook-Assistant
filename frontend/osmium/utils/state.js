// ============================================================
// state.js — Centralized App State Store
// Osmium ERM · Glacier Design System
// ============================================================

const LEGACY_API_BASE = 'https://hr-handbook-assistant-production.up.railway.app';
const FRONTEND_PAGES_URL = 'https://buvaneswaraneb.github.io/HR-Handbook-Assistant';
const OLD_API_BASES = [
  'https://nonsignificantly-bilgier-particia.ngrok-free.dev',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  FRONTEND_PAGES_URL,
];

function defaultApiBase() {
  if (window.location.hostname.endsWith('vercel.app')) {
    return `${window.location.origin}/api`;
  }
  return LEGACY_API_BASE;
}

export const DEFAULT_API_BASE = defaultApiBase();

export function normalizeApiBase(value) {
  const base = String(value || '').trim().replace(/\/+$/, '');
  if (!base || OLD_API_BASES.includes(base)) return DEFAULT_API_BASE;
  return base;
}

export const State = {
  // API
  apiBase: DEFAULT_API_BASE,
  apiConnected: false,

  // Auth
  auth: null,
  authProfile: null,

  supabaseConfigured: false,


  // Navigation
  currentView: 'dashboard',

  // Data cache
  employees: [],
  projects: [],
  files: [],
  orgTree: null,

  // Canvas
  canvas: {
    nodes: [],       // { id, empId, x, y }
    groups: [],      // { id, projId, x, y, w, h, nodeIds[] }
    edges: [],       // { id, fromId, toId, type }
    zoom: 1,
    panX: 0,
    panY: 0,
    snapToGrid: false,
    gridSize: 20,
    selectedIds: new Set(),
    selectedEdgeId: null,
  },

  // UI state
  inspectorOpen: false,
  inspectorTarget: null,   // { type: 'employee'|'project', data: {} }
  aiWindowOpen: false,
  settingsOpen: false,
  treeExpanded: {},        // { nodeId: boolean }
  theme: 'dark',           // 'dark' | 'light' | 'system'

  // Settings
  settings: {
    apiBase: DEFAULT_API_BASE,
    theme: 'dark',
    snapToGrid: false,
    gridSize: 20,
    showEdgeLabels: true,
    animateNodes: true,
    notifyOnActivity: true,
    canvasNodeDensity: 'comfortable', // 'compact' | 'comfortable' | 'spacious'
  },

  // Listeners
  _listeners: {},

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return () => this.off(event, fn);
  },

  off(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(f => f !== fn);
  },

  emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  },

  set(key, value) {
    this[key] = value;
    this.emit('change', { key, value });
    this.emit(`change:${key}`, value);
  },

  setSettings(partial) {
    if (Object.prototype.hasOwnProperty.call(partial, 'apiBase')) {
      partial = { ...partial, apiBase: normalizeApiBase(partial.apiBase) };
    }
    Object.assign(this.settings, partial);
    this.apiBase = normalizeApiBase(this.settings.apiBase);
    this.emit('settings:change', this.settings);
    this._persistSettings();
  },

  resetWorkspaceData() {
    this.employees = [];
    this.projects = [];
    this.files = [];
    this.orgTree = null;
    this.inspectorOpen = false;
    this.inspectorTarget = null;
    this.canvas.nodes = [];
    this.canvas.groups = [];
    this.canvas.edges = [];
    this.canvas.selectedIds.clear();
    this.canvas.selectedEdgeId = null;
    this.emit('workspace:reset');
    this.emit('change:employees', this.employees);
    this.emit('change:projects', this.projects);
    this.emit('change:files', this.files);
    this.emit('canvas:nodes:change', this.canvas.nodes);
    this.emit('canvas:edges:change', this.canvas.edges);
  },

  _persistSettings() {
    try { localStorage.setItem('osmium_settings', JSON.stringify(this.settings)); } catch {}
  },

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem('osmium_settings') || '{}');
      saved.apiBase = normalizeApiBase(saved.apiBase);
      Object.assign(this.settings, saved);
      this.apiBase = normalizeApiBase(this.settings.apiBase);
      this.settings.apiBase = this.apiBase;
      this.theme = this.settings.theme || 'dark';
      this._persistSettings();
    } catch {}
  },

  // Canvas helpers
  addCanvasNode(node) {
    this.canvas.nodes.push(node);
    this.emit('canvas:nodes:change', this.canvas.nodes);
  },

  removeCanvasNode(id) {
    this.canvas.nodes = this.canvas.nodes.filter(n => n.id !== id);
    this.canvas.edges = this.canvas.edges.filter(e => e.fromId !== id && e.toId !== id);
    this.canvas.groups.forEach(g => { g.nodeIds = g.nodeIds.filter(nid => nid !== id); });
    this.canvas.selectedIds.delete(id);
    this.emit('canvas:nodes:change', this.canvas.nodes);
    this.emit('canvas:edges:change', this.canvas.edges);
  },

  addCanvasEdge(edge) {
    const exists = this.canvas.edges.find(e =>
      (e.fromId === edge.fromId && e.toId === edge.toId) ||
      (e.fromId === edge.toId && e.toId === edge.fromId)
    );
    if (!exists) {
      this.canvas.edges.push(edge);
      this.emit('canvas:edges:change', this.canvas.edges);
    }
  },

  removeCanvasEdge(id) {
    this.canvas.edges = this.canvas.edges.filter(e => e.id !== id);
    this.emit('canvas:edges:change', this.canvas.edges);
  },

  selectNode(id, multi = false) {
    if (!multi) this.canvas.selectedIds.clear();
    if (id) this.canvas.selectedIds.add(id);
    this.emit('canvas:selection:change', [...this.canvas.selectedIds]);
  },

  deselectAll() {
    this.canvas.selectedIds.clear();
    this.canvas.selectedEdgeId = null;
    this.emit('canvas:selection:change', []);
  },
};

// ============================================================
// canvas.js — Infinite 2D Canvas Engine
// Pan · Zoom · Node Drag · Multi-select · Edges · Groups
// Side Panel · Hover Glow · Edge Bubbles · Hierarchy
// ============================================================

import { State } from '../utils/state.js';
import { uid, clamp, snap, throttle } from '../utils/helpers.js';
import { showContextMenu, showToast } from './ui.js';
import { escHtml, initials, avatarColor, avatarTextColor } from '../utils/helpers.js';
import { getEmployees, getProjects, assignToProject } from './api.js';

// Hierarchy maps per project: { projId: { managerId, teamLeadId, memberIds[] } }
const projectAssignments = {};

let world, svgLayer, bgEl, zoomLabel, selBox;
let isPanning = false, isSpacePanning = false, isSpaceDown = false;
let isDragging = false, dragNodeId = null, dragOffsetX = 0, dragOffsetY = 0;
let isSelecting = false, selStartX = 0, selStartY = 0;
let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
let isConnecting = false, connectFromId = null;

const MIN_ZOOM = 0.15, MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.1;

// ─── INIT ─────────────────────────────────────────────────────
export function initCanvas() {
  const container = document.getElementById('canvas-view');
  bgEl     = document.getElementById('canvas-bg');
  world    = document.getElementById('canvas-world');
  svgLayer = document.getElementById('canvas-svg-layer');
  zoomLabel = document.getElementById('canvas-zoom-label');
  selBox   = document.getElementById('selection-box');

  // Setup SVG arrowhead marker
  svgLayer.innerHTML = `
    <defs>
      <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="var(--gl-outline-3)" />
      </marker>
      <marker id="arrowhead-primary" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="var(--gl-primary)" />
      </marker>
    </defs>`;

  applyTransform();
  updateZoomLabel();

  // ─ Mouse events ─
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('mouseup', onMouseUp);
  container.addEventListener('mouseleave', onMouseUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('contextmenu', e => e.preventDefault());

  // ─ Space bar for pan mode ─
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !e.target.matches('input,textarea,select')) {
      e.preventDefault();
      if (!isSpaceDown) { isSpaceDown = true; container.style.cursor = 'grab'; }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!e.target.matches('input,textarea,select')) deleteSelected();
    }
    if (e.key === 'g' || e.key === 'G') {
      if (!e.target.matches('input,textarea,select')) toggleSnapGrid();
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') { isSpaceDown = false; container.style.cursor = 'default'; }
  });

  // ─ State listeners ─
  State.on('canvas:nodes:change', renderNodes);
  State.on('canvas:edges:change', renderEdges);
  State.on('canvas:selection:change', updateSelectionStyles);
  State.on('canvas:reset', resetView);
  State.on('canvas:fit', fitToScreen);
  State.on('view:canvas', initSidePanel);

  // ─ Toolbar ─
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => zoomAt(0.5, 0.5, 1));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => zoomAt(0.5, 0.5, -1));
  document.getElementById('btn-zoom-reset')?.addEventListener('click', resetView);
  document.getElementById('btn-fit-screen')?.addEventListener('click', fitToScreen);
  document.getElementById('btn-snap-grid')?.addEventListener('click', toggleSnapGrid);

  // ─ Hover glow on background dots ─
  container.addEventListener('mousemove', onBgHover);
  container.addEventListener('mouseleave', clearGlow);

  // ─ Side panel toggle ─
  document.getElementById('canvas-panel-toggle')?.addEventListener('click', toggleCanvasPanel);
}

// ─── TRANSFORM ────────────────────────────────────────────────
function applyTransform() {
  const { zoom, panX, panY } = State.canvas;
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  updateGridBg();
  updateZoomLabel();
  renderEdges();
}

function updateGridBg() {
  const { zoom, panX, panY } = State.canvas;
  const size = 28 * zoom;
  bgEl.style.backgroundSize = `${size}px ${size}px`;
  bgEl.style.backgroundPosition = `${panX % size}px ${panY % size}px`;
}

function updateZoomLabel() {
  if (zoomLabel) zoomLabel.textContent = Math.round(State.canvas.zoom * 100) + '%';
}

// ─── MOUSE ────────────────────────────────────────────────────
function onMouseDown(e) {
  const target = e.target;

  // Right click → context menu on node
  if (e.button === 2) {
    const nodeEl = target.closest('.canvas-node');
    if (nodeEl) showNodeCtxMenu(e, nodeEl.dataset.id);
    const edgeEl = target.closest('.canvas-edge-hit');
    if (edgeEl) showEdgeCtxMenu(e, edgeEl.dataset.id);
    return;
  }
  if (e.button !== 0) return;

  // Pan mode
  if (isSpaceDown || target === bgEl || target.id === 'canvas-bg') {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = State.canvas.panX;
    panOriginY = State.canvas.panY;
    document.getElementById('canvas-view').style.cursor = 'grabbing';
    return;
  }

  // Node drag
  const nodeEl = target.closest('.canvas-node');
  if (nodeEl) {
    const id = nodeEl.dataset.id;
    const multi = e.shiftKey;

    if (!State.canvas.selectedIds.has(id)) {
      State.selectNode(id, multi);
    }

    isDragging = true;
    dragNodeId = id;
    const rect = nodeEl.getBoundingClientRect();
    const container = document.getElementById('canvas-view').getBoundingClientRect();
    dragOffsetX = (e.clientX - container.left - State.canvas.panX) / State.canvas.zoom - parseFloat(nodeEl.style.left);
    dragOffsetY = (e.clientY - container.top - State.canvas.panY) / State.canvas.zoom - parseFloat(nodeEl.style.top);
    nodeEl.classList.add('dragging');
    return;
  }

  // Group drag
  const groupEl = target.closest('.canvas-group');
  if (groupEl && target === groupEl.querySelector('.group-header')) {
    // group drag logic handled similarly — simplified here
    return;
  }

  // Selection box
  if (!e.shiftKey) State.deselectAll();
  isSelecting = true;
  const container = document.getElementById('canvas-view').getBoundingClientRect();
  selStartX = e.clientX - container.left;
  selStartY = e.clientY - container.top;
  selBox.style.cssText = `display:block;left:${selStartX}px;top:${selStartY}px;width:0;height:0;`;
}

const throttledMouseMove = throttle(_onMouseMoveRaw, 16);
function onMouseMove(e) { throttledMouseMove(e); }

function _onMouseMoveRaw(e) {
  const container = document.getElementById('canvas-view').getBoundingClientRect();

  if (isPanning) {
    State.canvas.panX = panOriginX + (e.clientX - panStartX);
    State.canvas.panY = panOriginY + (e.clientY - panStartY);
    applyTransform();
    return;
  }

  if (isDragging && dragNodeId) {
    const worldX = (e.clientX - container.left - State.canvas.panX) / State.canvas.zoom;
    const worldY = (e.clientY - container.top  - State.canvas.panY) / State.canvas.zoom;
    let newX = worldX - dragOffsetX;
    let newY = worldY - dragOffsetY;

    if (State.canvas.snapToGrid) {
      newX = snap(newX, State.canvas.gridSize);
      newY = snap(newY, State.canvas.gridSize);
    }

    // If multi-selected, move all
    const selectedIds = [...State.canvas.selectedIds];
    if (selectedIds.length > 1 && selectedIds.includes(dragNodeId)) {
      const node = State.canvas.nodes.find(n => n.id === dragNodeId);
      if (node) {
        const dx = newX - node.x;
        const dy = newY - node.y;
        selectedIds.forEach(sid => {
          const sn = State.canvas.nodes.find(n => n.id === sid);
          if (sn) { sn.x += dx; sn.y += dy; syncNodeEl(sid); }
        });
      }
    } else {
      const node = State.canvas.nodes.find(n => n.id === dragNodeId);
      if (node) { node.x = newX; node.y = newY; syncNodeEl(dragNodeId); }
    }
    renderEdges();
    return;
  }

  if (isSelecting) {
    const cx = e.clientX - container.left;
    const cy = e.clientY - container.top;
    const x = Math.min(cx, selStartX), y = Math.min(cy, selStartY);
    const w = Math.abs(cx - selStartX), h = Math.abs(cy - selStartY);
    selBox.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  }
}

function onMouseUp(e) {
  if (isPanning) {
    isPanning = false;
    document.getElementById('canvas-view').style.cursor = isSpaceDown ? 'grab' : 'default';
  }

  if (isDragging) {
    isDragging = false;
    document.querySelector(`.canvas-node[data-id="${dragNodeId}"]`)?.classList.remove('dragging');
    dragNodeId = null;
  }

  if (isSelecting) {
    isSelecting = false;
    selBox.style.display = 'none';
    finishBoxSelect();
  }
}

function finishBoxSelect() {
  const container = document.getElementById('canvas-view').getBoundingClientRect();
  const selRect = selBox.getBoundingClientRect();
  const newSelected = new Set();

  State.canvas.nodes.forEach(node => {
    const el = document.querySelector(`.canvas-node[data-id="${node.id}"]`);
    if (!el) return;
    const nr = el.getBoundingClientRect();
    if (nr.left < selRect.right && nr.right > selRect.left &&
        nr.top < selRect.bottom && nr.bottom > selRect.top) {
      newSelected.add(node.id);
    }
  });

  State.canvas.selectedIds = newSelected;
  State.emit('canvas:selection:change', [...newSelected]);
}

// ─── ZOOM ─────────────────────────────────────────────────────
function onWheel(e) {
  e.preventDefault();
  const container = document.getElementById('canvas-view').getBoundingClientRect();
  const cx = (e.clientX - container.left) / container.width;
  const cy = (e.clientY - container.top)  / container.height;
  const dir = e.deltaY < 0 ? 1 : -1;
  zoomAt(cx, cy, dir);
}

function zoomAt(cx, cy, dir) {
  const container = document.getElementById('canvas-view').getBoundingClientRect();
  const oldZoom = State.canvas.zoom;
  const newZoom = clamp(oldZoom + dir * ZOOM_STEP * oldZoom, MIN_ZOOM, MAX_ZOOM);
  const scale = newZoom / oldZoom;
  const pivotX = cx * container.width;
  const pivotY = cy * container.height;
  State.canvas.panX = pivotX + (State.canvas.panX - pivotX) * scale;
  State.canvas.panY = pivotY + (State.canvas.panY - pivotY) * scale;
  State.canvas.zoom = newZoom;
  applyTransform();
}

export function resetView() {
  State.canvas.zoom = 1;
  State.canvas.panX = 40;
  State.canvas.panY = 40;
  applyTransform();
}

export function fitToScreen() {
  const nodes = State.canvas.nodes;
  if (!nodes.length) { resetView(); return; }
  const container = document.getElementById('canvas-view').getBoundingClientRect();
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...xs) + 200, maxY = Math.max(...ys) + 100;
  const w = maxX - minX, h = maxY - minY;
  const padding = 60;
  const zoomX = (container.width - padding * 2) / w;
  const zoomY = (container.height - padding * 2) / h;
  const zoom = clamp(Math.min(zoomX, zoomY), MIN_ZOOM, MAX_ZOOM);
  State.canvas.zoom = zoom;
  State.canvas.panX = padding - minX * zoom;
  State.canvas.panY = padding - minY * zoom;
  applyTransform();
}

// ─── HOVER GLOW ───────────────────────────────────────────────
let glowEl = null;
function onBgHover(e) {
  if (!bgEl) return;
  const rect = bgEl.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (!glowEl) {
    glowEl = document.createElement('div');
    glowEl.style.cssText = `position:absolute;pointer-events:none;border-radius:50%;background:radial-gradient(circle, rgba(90,191,232,0.18) 0%, transparent 70%);transition:opacity 0.1s;z-index:1`;
    bgEl.appendChild(glowEl);
  }
  const r = 120;
  glowEl.style.width  = r * 2 + 'px';
  glowEl.style.height = r * 2 + 'px';
  glowEl.style.left   = (x - r) + 'px';
  glowEl.style.top    = (y - r) + 'px';
  glowEl.style.opacity = '1';
}
function clearGlow() { if (glowEl) glowEl.style.opacity = '0'; }

// ─── SIDE PANEL ───────────────────────────────────────────────
let panelOpen = true;

function toggleCanvasPanel() {
  const panel = document.getElementById('canvas-side-panel');
  if (!panel) return;
  panelOpen = !panelOpen;
  panel.style.transform = panelOpen ? 'translateX(0)' : 'translateX(-100%)';
  const icon = document.getElementById('canvas-panel-toggle')?.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = panelOpen ? 'chevron_left' : 'chevron_right';
}

async function initSidePanel() {
  const projList = document.getElementById('canvas-proj-list');
  const empList  = document.getElementById('canvas-emp-list');
  if (!projList && !empList) return;

  try {
    const [emps, projs] = await Promise.all([
      State.employees.length ? State.employees : getEmployees(),
      State.projects.length  ? State.projects  : getProjects(),
    ]);

    if (projList) {
      projList.innerHTML = projs.length
        ? projs.map(p => `
          <div class="canvas-panel-item" draggable="true"
            ondragstart="window._canvasDragStart(event,'project','${p.id}')"
            onclick="window._addProjToCanvas('${p.id}')"
            title="Click or drag to canvas">
            <span class="material-symbols-outlined" style="font-size:14px;color:#5abfe8">folder</span>
            <span style="font-size:0.78rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.project_name)}</span>
          </div>`).join('')
        : `<div style="padding:12px;font-size:0.75rem;color:var(--gl-on-surface-4)">No projects</div>`;
    }

    if (empList) {
      empList.innerHTML = emps.length
        ? emps.map(e => {
            const bg = avatarColor(e.name), fc = avatarTextColor(e.name);
            return `
              <div class="canvas-panel-item" draggable="true"
                ondragstart="window._canvasDragStart(event,'employee','${e.id}')"
                onclick="window._addToCanvasById('${e.id}')"
                title="Click or drag to canvas">
                <div style="width:20px;height:20px;border-radius:50%;background:${bg};color:${fc};display:flex;align-items:center;justify-content:center;font-size:0.55rem;font-weight:700;flex-shrink:0">${initials(e.name)}</div>
                <span style="font-size:0.78rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(e.name)}</span>
                <span style="font-size:9px;color:${e.availability ? '#3dd68c' : 'var(--gl-on-surface-4)'}">●</span>
              </div>`;
          }).join('')
        : `<div style="padding:12px;font-size:0.75rem;color:var(--gl-on-surface-4)">No employees</div>`;
    }
  } catch {}
}

window._canvasDragStart = function(e, type, id) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ type, id }));
};

// ─── GRID SNAP ────────────────────────────────────────────────
function toggleSnapGrid() {
  State.canvas.snapToGrid = !State.canvas.snapToGrid;
  const btn = document.getElementById('btn-snap-grid');
  if (btn) btn.classList.toggle('active', State.canvas.snapToGrid);
}

// ─── RENDER NODES ─────────────────────────────────────────────
export function renderNodes() {
  // Remove nodes no longer in state
  const existingIds = new Set(State.canvas.nodes.map(n => n.id));
  world.querySelectorAll('.canvas-node').forEach(el => {
    if (!existingIds.has(el.dataset.id)) el.remove();
  });

  State.canvas.nodes.forEach(node => {
    let el = world.querySelector(`.canvas-node[data-id="${node.id}"]`);
    if (!el) {
      el = createNodeElement(node);
      world.appendChild(el);
    }
    el.style.left = node.x + 'px';
    el.style.top  = node.y + 'px';
  });
}

function createNodeElement(node) {
  const emp = State.employees.find(e => e.id === node.empId) || {};
  const el = document.createElement('div');
  el.className = 'canvas-node';
  el.dataset.id = node.id;

  const avail = emp.availability;
  const availBadge = avail
    ? `<span class="badge badge-available" style="font-size:10px;padding:1px 6px">● Available</span>`
    : `<span class="badge badge-unavailable" style="font-size:10px;padding:1px 6px">● Busy</span>`;

  const skills = (emp.skills || []).slice(0, 4).map(s =>
    `<span class="chip">${escHtml(s.skill_name)}</span>`
  ).join('');

  const rating = emp.rating ? `<span style="font-size:11px;color:var(--gl-tertiary)">★ ${emp.rating}</span>` : '';

  const bg   = avatarColor(emp.name || '?');
  const fc   = avatarTextColor(emp.name || '?');
  const init = initials(emp.name || '?');

  el.innerHTML = `
    <div class="node-header">
      <div class="node-avatar" style="background:${bg};color:${fc}">${init}</div>
      <div style="flex:1;min-width:0">
        <div class="node-name truncate">${escHtml(emp.name || 'Unknown')}</div>
        <div class="node-role truncate">${escHtml(emp.role || '')}</div>
      </div>
    </div>
      <div class="node-body">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
        ${availBadge}
        ${rating}
      </div>
      <div class="node-chips">${skills}</div>
    </div>
    <div class="node-footer">
      <span class="chip" style="font-size:10px">${escHtml(emp.team || 'No team')}</span>
      <div style="margin-left:auto;display:flex;gap:4px">
        <button class="btn btn-ghost btn-icon" title="Connect" onclick="window._startConnect('${node.id}')">
          <span class="material-symbols-outlined" style="font-size:14px">cable</span>
        </button>
        <button class="btn btn-ghost btn-icon" title="Inspect" onclick="window._inspectNode('${node.id}')">
          <span class="material-symbols-outlined" style="font-size:14px">open_in_new</span>
        </button>
      </div>
    </div>
    <!-- Edge port bubbles (shown on hover via CSS) -->
    <div class="node-port node-port-t" data-node="${node.id}" title="Connect from top"></div>
    <div class="node-port node-port-r" data-node="${node.id}" title="Connect from right"></div>
    <div class="node-port node-port-b" data-node="${node.id}" title="Connect from bottom"></div>
    <div class="node-port node-port-l" data-node="${node.id}" title="Connect from left"></div>`;

  el.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    State.selectNode(node.id, e.shiftKey);
    State.emit('inspector:open', { type: 'employee', data: emp });
  });

  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    showNodeCtxMenu(e, node.id);
  });

  return el;
}

function syncNodeEl(id) {
  const node = State.canvas.nodes.find(n => n.id === id);
  if (!node) return;
  const el = world.querySelector(`.canvas-node[data-id="${id}"]`);
  if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
}

function updateSelectionStyles(selectedIds) {
  world.querySelectorAll('.canvas-node').forEach(el => {
    el.classList.toggle('selected', selectedIds.includes(el.dataset.id));
  });
}

// ─── RENDER EDGES ─────────────────────────────────────────────
export function renderEdges() {
  // Remove old edge elements
  svgLayer.querySelectorAll('.canvas-edge-group').forEach(e => e.remove());

  State.canvas.edges.forEach(edge => {
    const fromNode = State.canvas.nodes.find(n => n.id === edge.fromId);
    const toNode   = State.canvas.nodes.find(n => n.id === edge.toId);
    if (!fromNode || !toNode) return;

    const nodeW = 200, nodeH = 100;
    const x1 = fromNode.x + nodeW / 2;
    const y1 = fromNode.y + nodeH / 2;
    const x2 = toNode.x   + nodeW / 2;
    const y2 = toNode.y   + nodeH / 2;

    // Bezier control points
    const dx = x2 - x1, dy = y2 - y1;
    const cx1 = x1 + dx * 0.4, cy1 = y1;
    const cx2 = x2 - dx * 0.4, cy2 = y2;

    const d = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
    const isManager = edge.type === 'manager';
    const marker = isManager ? 'url(#arrowhead-primary)' : 'url(#arrowhead)';
    const stroke  = isManager ? 'var(--gl-primary)' : 'var(--gl-outline-3)';
    const width   = isManager ? '2' : '1.5';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('canvas-edge-group');

    // Hit area (invisible wide path)
    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.setAttribute('d', d);
    hitPath.setAttribute('stroke', 'transparent');
    hitPath.setAttribute('stroke-width', '12');
    hitPath.setAttribute('fill', 'none');
    hitPath.className = 'canvas-edge-hit';
    hitPath.dataset.id = edge.id;
    hitPath.style.cursor = 'pointer';
    hitPath.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      showEdgeCtxMenu(ev, edge.id);
    });

    // Visible path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', width);
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', marker);
    path.classList.add('canvas-edge');

    // Optional label
    if (State.settings.showEdgeLabels && edge.label) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', mx); label.setAttribute('y', my - 6);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', 'var(--gl-on-surface-4)');
      label.setAttribute('font-size', '10');
      label.textContent = edge.label;
      g.appendChild(label);
    }

    g.appendChild(path);
    g.appendChild(hitPath);
    svgLayer.appendChild(g);
  });
}

// ─── CONTEXT MENUS ────────────────────────────────────────────
function showNodeCtxMenu(e, nodeId) {
  showContextMenu(e.clientX, e.clientY, [
    { icon: 'open_in_new', label: 'Inspect',      action: () => window._inspectNode(nodeId) },
    { icon: 'cable',       label: 'Connect to…',  action: () => window._startConnect(nodeId) },
    { icon: 'content_copy',label: 'Duplicate',    action: () => duplicateNode(nodeId) },
    'divider',
    { icon: 'delete',      label: 'Remove from canvas', action: () => State.removeCanvasNode(nodeId), danger: true },
  ]);
}

function showEdgeCtxMenu(e, edgeId) {
  showContextMenu(e.clientX, e.clientY, [
    { icon: 'delete', label: 'Delete connection', action: () => State.removeCanvasEdge(edgeId), danger: true },
  ]);
}

// ─── CONNECT NODES (Hierarchy-Aware) ─────────────────────────
window._startConnect = function(fromId) {
  isConnecting = true;
  connectFromId = fromId;
  const container = document.getElementById('canvas-view');
  container.style.cursor = 'crosshair';

  // Ask what role this connection represents
  const role = prompt('Connection type: manager | teamlead | member', 'member');
  if (!role) { cancel(); return; }
  const normalRole = role.trim().toLowerCase();

  showToastMsg('Click a node to connect, or Escape to cancel.');

  function onNodeClick(e) {
    const nodeEl = e.target.closest('.canvas-node');
    if (!nodeEl) { cancel(); return; }
    const toId = nodeEl.dataset.id;
    if (toId === fromId) { cancel(); return; }

    // Hierarchy enforcement — prompt for target project
    const projId = prompt('Enter project ID to assign this connection (leave blank for generic link):')?.trim() || null;

    if (projId) {
      if (!projectAssignments[projId]) {
        projectAssignments[projId] = { managerId: null, teamLeadId: null, memberIds: [] };
      }
      const asgn = projectAssignments[projId];

      if (normalRole === 'manager') {
        if (asgn.managerId && asgn.managerId !== toId) {
          showToastMsg('This project already has a manager!');
          cancel(); return;
        }
        asgn.managerId = toId;
      } else if (normalRole === 'teamlead') {
        if (asgn.teamLeadId && asgn.teamLeadId !== toId) {
          showToastMsg('This project already has a team lead!');
          cancel(); return;
        }
        asgn.teamLeadId = toId;
      } else {
        asgn.memberIds.push(toId);
      }
    }

    const edgeType  = normalRole === 'manager' ? 'manager' : normalRole === 'teamlead' ? 'teamlead' : 'member';
    const edgeLabel = normalRole === 'manager' ? 'Manager' : normalRole === 'teamlead' ? 'Team Lead' : 'Member';
    State.addCanvasEdge({ id: uid(), fromId, toId, type: edgeType, label: edgeLabel });
    cancel();
  }

  function onKey(e) { if (e.key === 'Escape') cancel(); }

  function cancel() {
    isConnecting = false; connectFromId = null;
    container.style.cursor = 'default';
    container.removeEventListener('click', onNodeClick);
    window.removeEventListener('keydown', onKey);
  }

  setTimeout(() => {
    container.addEventListener('click', onNodeClick);
    window.addEventListener('keydown', onKey);
  }, 100);
};

function showToastMsg(msg) {
  const existing = document.getElementById('canvas-hint');
  if (existing) existing.remove();
  const hint = document.createElement('div');
  hint.id = 'canvas-hint';
  hint.style.cssText = `
    position:absolute;top:16px;left:50%;transform:translateX(-50%);
    background:var(--gl-surface-high);border:1px solid var(--gl-primary);
    border-radius:var(--r-full);padding:7px 16px;font-size:0.8rem;
    color:var(--gl-on-surface-2);z-index:25;box-shadow:var(--shadow-md);`;
  hint.textContent = msg;
  document.getElementById('canvas-view').appendChild(hint);
  setTimeout(() => hint.remove(), 4000);
}

// ─── ADD NODE ─────────────────────────────────────────────────
export function addEmployeeToCanvas(emp) {
  const existing = State.canvas.nodes.find(n => n.empId === emp.id);
  if (existing) return;

  // Layout: auto-position in a grid
  const idx = State.canvas.nodes.length;
  const cols = 4;
  const col = idx % cols, row = Math.floor(idx / cols);
  const x = 40 + col * 240;
  const y = 40 + row * 160;

  State.addCanvasNode({ id: uid(), empId: emp.id, x, y });
}

// ─── GROUPS ───────────────────────────────────────────────────
export function addProjectGroup(proj) {
  const existing = world.querySelector(`.canvas-group[data-proj="${proj.id}"]`);
  if (existing) return;

  const idx = State.canvas.groups.length;
  const x = 40 + idx * 340;
  const y = 300;

  const group = document.createElement('div');
  group.className = 'canvas-group';
  group.dataset.proj = proj.id;
  group.style.cssText = `left:${x}px;top:${y}px;width:300px;height:180px;`;

  const statusColors = {
    active: 'var(--gl-primary)', planning: 'var(--gl-secondary)',
    on_hold: 'var(--gl-warning)', completed: 'var(--gl-success)',
  };
  const sc = statusColors[proj.status] || 'var(--gl-neutral)';

  group.innerHTML = `
    <div class="group-header" style="cursor:grab">
      <div style="width:10px;height:10px;border-radius:50%;background:${sc};flex-shrink:0"></div>
      <div class="group-title">${escHtml(proj.project_name)}</div>
      <span class="badge badge-neutral" style="margin-left:auto;font-size:10px">${escHtml(proj.status || 'active')}</span>
    </div>
    <div style="padding:8px 16px;font-size:0.72rem;color:var(--gl-on-surface-4)">
      ${escHtml(proj.client_name || 'No client')} · Drop employees here
    </div>`;

  world.appendChild(group);
  State.canvas.groups.push({ id: uid(), projId: proj.id, x, y, w: 300, h: 180, nodeIds: [] });
}

// ─── DELETE SELECTED ──────────────────────────────────────────
function deleteSelected() {
  [...State.canvas.selectedIds].forEach(id => State.removeCanvasNode(id));
}

function duplicateNode(id) {
  const node = State.canvas.nodes.find(n => n.id === id);
  if (!node) return;
  State.addCanvasNode({ id: uid(), empId: node.empId, x: node.x + 30, y: node.y + 30 });
}

// ─── EXPOSE GLOBAL ────────────────────────────────────────────
window._inspectNode = function(nodeId) {
  const node = State.canvas.nodes.find(n => n.id === nodeId);
  if (!node) return;
  const emp = State.employees.find(e => e.id === node.empId);
  if (emp) State.emit('inspector:open', { type: 'employee', data: emp });
};

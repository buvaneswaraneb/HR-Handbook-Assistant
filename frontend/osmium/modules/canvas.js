// ============================================================
// canvas.js — Infinite 2D Canvas Engine
// Pan · Zoom · Node Drag · Multi-select · Edges · Groups
// Side Panel · Hover Glow · Edge Bubbles · Hierarchy
// ============================================================

import { State } from '../utils/state.js';
import { uid, clamp, snap, throttle } from '../utils/helpers.js?v=20260509-3';
import { showContextMenu, showToast } from './ui.js';
import { escHtml, initials, avatarColor, avatarTextColor } from '../utils/helpers.js?v=20260509-3';
import { getEmployees, getProjects, assignToProject } from './api.js?v=20260509-5';

let world, svgLayer, bgEl, zoomLabel, selBox;
let isPanning = false, isSpaceDown = false;
let isDragging = false, dragNodeId = null, dragOffsetX = 0, dragOffsetY = 0;
let isSelecting = false, selStartX = 0, selStartY = 0;
let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
let isConnecting = false, connectFromId = null, connectPreviewPath = null;

const MIN_ZOOM = 0.15, MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.1;
const PROJECT_NODE_W = 240;
const PROJECT_NODE_H = 112;
const EMPLOYEE_NODE_W = 116;
const EMPLOYEE_NODE_H = 118;
const EMPLOYEE_ORB_R = 40;

// ─── INIT ─────────────────────────────────────────────────────
export function initCanvas() {
  const container = document.getElementById('canvas-view');
  bgEl = document.getElementById('canvas-bg');
  world = document.getElementById('canvas-world');
  svgLayer = document.getElementById('canvas-svg-layer');
  zoomLabel = document.getElementById('canvas-zoom-label');
  selBox = document.getElementById('selection-box');

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
  container.addEventListener('dragover', e => e.preventDefault());
  container.addEventListener('drop', onCanvasDrop);

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
    if (e.key === 'Escape' && isConnecting) cancelConnectionDrag();
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

  const portEl = target.closest('.node-port');
  if (portEl) {
    e.preventDefault();
    e.stopPropagation();
    startConnectionDrag(portEl.dataset.node, e);
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
    const worldY = (e.clientY - container.top - State.canvas.panY) / State.canvas.zoom;
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

  if (isConnecting && connectFromId) {
    updateConnectionPreview(e);
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
  if (isConnecting) {
    finishConnectionDrag(e);
    return;
  }

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

function startConnectionDrag(fromId, e) {
  if (!fromId) return;
  isConnecting = true;
  connectFromId = fromId;
  State.selectNode(fromId);
  document.getElementById('canvas-view').style.cursor = 'crosshair';

  connectPreviewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  connectPreviewPath.setAttribute('stroke', 'var(--gl-primary)');
  connectPreviewPath.setAttribute('stroke-width', '2');
  connectPreviewPath.setAttribute('fill', 'none');
  connectPreviewPath.setAttribute('stroke-dasharray', '6 5');
  connectPreviewPath.setAttribute('marker-end', 'url(#arrowhead-primary)');
  connectPreviewPath.classList.add('canvas-edge-preview');
  svgLayer.appendChild(connectPreviewPath);
  updateConnectionPreview(e);
  showToastMsg('Drag to an employee or project node to connect.');
}

function updateConnectionPreview(e) {
  if (!connectPreviewPath || !connectFromId) return;
  const fromNode = State.canvas.nodes.find(n => n.id === connectFromId);
  if (!fromNode) return;
  const end = screenToWorld(e.clientX, e.clientY);
  const start = getConnectionPoint(fromNode, { x: end.x, y: end.y, type: 'point' });
  connectPreviewPath.setAttribute('d', edgePath(start, end));
}

function finishConnectionDrag(e) {
  const targetEl = e.target.closest('.canvas-node');
  const toId = targetEl?.dataset.id;
  if (toId && toId !== connectFromId) {
    connectNodes(connectFromId, toId);
  }
  cancelConnectionDrag();
}

function cancelConnectionDrag() {
  isConnecting = false;
  connectFromId = null;
  connectPreviewPath?.remove();
  connectPreviewPath = null;
  document.getElementById('canvas-view').style.cursor = isSpaceDown ? 'grab' : 'default';
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
  const cy = (e.clientY - container.top) / container.height;
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
  const maxX = Math.max(...nodes.map(n => n.x + getNodeSize(n).w));
  const maxY = Math.max(...nodes.map(n => n.y + getNodeSize(n).h));
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
    glowEl.style.cssText = `position:absolute;pointer-events:none;border-radius:50%;background:rgba(90,191,232,0.08);box-shadow:0 0 42px 28px rgba(90,191,232,0.08);transition:opacity 0.1s;z-index:1`;
    bgEl.appendChild(glowEl);
  }
  const r = 120;
  glowEl.style.width = r * 2 + 'px';
  glowEl.style.height = r * 2 + 'px';
  glowEl.style.left = (x - r) + 'px';
  glowEl.style.top = (y - r) + 'px';
  glowEl.style.opacity = '1';
}
function clearGlow() { if (glowEl) glowEl.style.opacity = '0'; }

async function onCanvasDrop(e) {
  e.preventDefault();
  let payload = null;
  try {
    payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
  } catch {
    return;
  }
  const point = screenToWorld(e.clientX, e.clientY);
  if (payload.type === 'employee') {
    const emps = State.employees.length ? State.employees : await getEmployees();
    const emp = emps.find(item => item.id === payload.id);
    if (emp) addEmployeeToCanvasAt(emp, point.x - EMPLOYEE_NODE_W / 2, point.y - EMPLOYEE_ORB_R);
  } else if (payload.type === 'project') {
    const projs = State.projects.length ? State.projects : await getProjects();
    const proj = projs.find(item => item.id === payload.id);
    if (proj) addProjectNodeToCanvas(proj, point.x - PROJECT_NODE_W / 2, point.y - PROJECT_NODE_H / 2);
  }
}

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
  const empList = document.getElementById('canvas-emp-list');
  if (!projList && !empList) return;

  try {
    const [emps, projs] = await Promise.all([
      State.employees.length ? State.employees : getEmployees(),
      State.projects.length ? State.projects : getProjects(),
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
                <span style="font-size:9px;color:${e.availability ? '#3dd68c' : '#f5574a'}">●</span>
              </div>`;
        }).join('')
        : `<div style="padding:12px;font-size:0.75rem;color:var(--gl-on-surface-4)">No employees</div>`;
    }
  } catch { }
}

window._canvasDragStart = function (e, type, id) {
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
    const renderKey = canvasNodeRenderKey(node);
    if (el && el.dataset.renderKey !== renderKey) {
      el.remove();
      el = null;
    }
    if (!el) {
      el = createNodeElement(node);
      el.dataset.renderKey = renderKey;
      world.appendChild(el);
    }
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
  });
}

function canvasNodeRenderKey(node) {
  if (node.type === 'project') {
    const proj = State.projects.find(p => p.id === node.projectId) || {};
    const connectedCount = State.canvas.edges.filter(edge => edge.fromId === node.id || edge.toId === node.id).length;
    return ['project', node.projectId, proj.project_name, proj.client_name, proj.status, proj.percent_complete, connectedCount].join('|');
  }
  const emp = getEmployeeForNode(node);
  return ['employee', node.empId, emp.name, emp.role, emp.availability, node.projectRole].join('|');
}

function createNodeElement(node) {
  if (node.type === 'project') return createProjectNodeElement(node);

  const emp = getEmployeeForNode(node);
  const el = document.createElement('div');
  el.className = `canvas-node canvas-node-employee${node.projectRole ? ` canvas-node-${node.projectRole}` : ''}`;
  el.dataset.id = node.id;

  const avail = emp.availability;
  const bg = avatarColor(emp.name || '?');
  const fc = avatarTextColor(emp.name || '?');
  const init = initials(emp.name || '?');
  const projectRole = canvasRoleLabel(node.projectRole);

  el.innerHTML = `
    <div class="employee-node-orb" style="background:${bg};color:${fc}">
      <span>${init}</span>
      <span class="node-status-dot ${avail ? 'available' : 'unavailable'}" title="${avail ? 'Available' : 'Unavailable'}"></span>
      ${projectRole ? `<span class="node-role-token">${escHtml(projectRole)}</span>` : ''}
    </div>
    <div class="employee-node-label">
      <div class="employee-node-name truncate">${escHtml(emp.name || 'Unknown')}</div>
      <div class="employee-node-sub truncate">${escHtml(emp.role || 'Employee')}</div>
    </div>
    <div class="employee-node-actions">
      <button class="node-mini-action" title="Connect" onclick="window._startConnect('${node.id}')">
        <span class="material-symbols-outlined" style="font-size:13px">cable</span>
      </button>
      <button class="node-mini-action" title="Inspect" onclick="window._inspectNode('${node.id}')">
        <span class="material-symbols-outlined" style="font-size:13px">open_in_new</span>
      </button>
    </div>
    <div class="node-port node-port-t" data-node="${node.id}" title="Drag to connect"></div>
    <div class="node-port node-port-r" data-node="${node.id}" title="Drag to connect"></div>
    <div class="node-port node-port-b" data-node="${node.id}" title="Drag to connect"></div>
    <div class="node-port node-port-l" data-node="${node.id}" title="Drag to connect"></div>`;

  el.addEventListener('click', e => {
    if (e.target.closest('button,.node-port')) return;
    State.selectNode(node.id, e.shiftKey);
    const projectLink = getConnectedProjectForEmployee(node.id);
    if (projectLink) {
      showRoleMenu(e, node.id, projectLink);
    } else {
      State.emit('inspector:open', { type: 'employee', data: emp });
    }
  });

  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    showNodeCtxMenu(e, node.id);
  });

  return el;
}

function canvasRoleLabel(role) {
  return {
    manager: 'Manager',
    teamlead: 'Team Lead',
    team_lead: 'Team Lead',
    member: 'Member',
    hr: 'HR',
    pending: 'Assign Role',
  }[role] || '';
}

function createProjectNodeElement(node) {
  const proj = State.projects.find(p => p.id === node.projectId) || {};
  const el = document.createElement('div');
  el.className = 'canvas-node canvas-node-project';
  el.dataset.id = node.id;

  const status = String(proj.status || 'active').toLowerCase();
  const isActive = status === 'active';
  const sc = isActive ? 'var(--gl-success)' : 'var(--gl-error)';
  const pct = proj.percent_complete ?? 0;
  const connectedCount = State.canvas.edges.filter(edge =>
    edge.fromId === node.id || edge.toId === node.id
  ).length || (Array.isArray(proj.team) ? proj.team.length : 0);

  el.innerHTML = `
    <div class="project-node-topline">
      <div class="project-node-icon">
        <span class="material-symbols-outlined" style="font-size:18px">folder_managed</span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="project-node-name truncate">${escHtml(proj.project_name || 'Project')}</div>
        <div class="project-node-sub truncate">${escHtml(proj.client_name || 'HR project')}</div>
      </div>
      <span class="project-status-dot" style="background:${sc}" title="${escHtml(proj.status || 'active')}"></span>
    </div>
    <div class="project-node-meta">
      <span>${connectedCount} connected</span>
      <span>${pct}%</span>
    </div>
    <div class="project-node-progress">
      <div style="width:${pct}%;background:${sc}"></div>
    </div>
    <div class="project-node-footer">
      <span>${escHtml(proj.status || 'active')}</span>
      <button class="node-mini-action" title="Inspect" onclick="window._inspectNode('${node.id}')">
        <span class="material-symbols-outlined" style="font-size:13px">open_in_new</span>
      </button>
    </div>
    <div class="node-port node-port-t" data-node="${node.id}" title="Drag to connect"></div>
    <div class="node-port node-port-r" data-node="${node.id}" title="Drag to connect"></div>
    <div class="node-port node-port-b" data-node="${node.id}" title="Drag to connect"></div>
    <div class="node-port node-port-l" data-node="${node.id}" title="Drag to connect"></div>`;

  el.addEventListener('click', e => {
    if (e.target.closest('button,.node-port')) return;
    State.selectNode(node.id, e.shiftKey);
    State.emit('inspector:open', { type: 'project', data: proj });
  });

  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    showNodeCtxMenu(e, node.id);
  });

  return el;
}

function getEmployeeForNode(node) {
  const emp = State.employees.find(e => e.id === node.empId);
  if (emp) return emp;
  return {
    id: node.empId,
    name: node.name || 'Unknown',
    role: node.role || node.projectRole || '',
    availability: node.availability ?? true,
    team: node.team || '',
    skills: [],
  };
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

function getNodeSize(node) {
  return node?.type === 'project'
    ? { w: PROJECT_NODE_W, h: PROJECT_NODE_H }
    : { w: EMPLOYEE_NODE_W, h: EMPLOYEE_NODE_H };
}

function getNodeCenter(node) {
  if (node.type === 'point') return { x: node.x, y: node.y };
  if (node.type === 'project') {
    return { x: node.x + PROJECT_NODE_W / 2, y: node.y + PROJECT_NODE_H / 2 };
  }
  return { x: node.x + EMPLOYEE_NODE_W / 2, y: node.y + EMPLOYEE_ORB_R + 4 };
}

function getConnectionPoint(node, towardNode) {
  const center = getNodeCenter(node);
  const toward = getNodeCenter(towardNode);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;

  if (node.type !== 'project') {
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: center.x + (dx / len) * EMPLOYEE_ORB_R,
      y: center.y + (dy / len) * EMPLOYEE_ORB_R,
    };
  }

  const halfW = PROJECT_NODE_W / 2;
  const halfH = PROJECT_NODE_H / 2;
  const scale = Math.min(
    Math.abs(dx) ? halfW / Math.abs(dx) : Infinity,
    Math.abs(dy) ? halfH / Math.abs(dy) : Infinity,
  );
  const safeScale = Number.isFinite(scale) ? scale : 0;
  return {
    x: center.x + dx * safeScale,
    y: center.y + dy * safeScale,
  };
}

function edgePath(start, end) {
  const dx = end.x - start.x;
  const curve = Math.max(70, Math.min(180, Math.abs(dx) * 0.45));
  const cx1 = start.x + (dx >= 0 ? curve : -curve);
  const cy1 = start.y;
  const cx2 = end.x - (dx >= 0 ? curve : -curve);
  const cy2 = end.y;
  return `M ${start.x} ${start.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${end.x} ${end.y}`;
}

function screenToWorld(clientX, clientY) {
  const container = document.getElementById('canvas-view').getBoundingClientRect();
  return {
    x: (clientX - container.left - State.canvas.panX) / State.canvas.zoom,
    y: (clientY - container.top - State.canvas.panY) / State.canvas.zoom,
  };
}

// ─── RENDER EDGES ─────────────────────────────────────────────
export function renderEdges() {
  // Remove old edge elements
  svgLayer.querySelectorAll('.canvas-edge-group').forEach(e => e.remove());

  State.canvas.edges.forEach(edge => {
    const fromNode = State.canvas.nodes.find(n => n.id === edge.fromId);
    const toNode = State.canvas.nodes.find(n => n.id === edge.toId);
    if (!fromNode || !toNode) return;

    const start = getConnectionPoint(fromNode, toNode);
    const end = getConnectionPoint(toNode, fromNode);
    const d = edgePath(start, end);
    const isManager = edge.type === 'manager';
    const isProject = edge.type === 'project';
    const isPending = edge.type === 'pending';
    const marker = (isManager || isProject || isPending) ? 'url(#arrowhead-primary)' : 'url(#arrowhead)';
    const stroke = isProject ? 'var(--gl-secondary)' : isManager ? 'var(--gl-success)' : isPending ? 'var(--gl-primary)' : 'var(--gl-outline-3)';
    const width = (isManager || isProject || isPending) ? '2' : '1.5';

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
    if (edge.type) path.classList.add(edge.type);

    // Optional label
    if (State.settings.showEdgeLabels && edge.label) {
      const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
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
    { icon: 'open_in_new', label: 'Inspect', action: () => window._inspectNode(nodeId) },
    { icon: 'cable', label: 'Connect to…', action: () => window._startConnect(nodeId) },
    { icon: 'content_copy', label: 'Duplicate', action: () => duplicateNode(nodeId) },
    'divider',
    { icon: 'delete', label: 'Remove from canvas', action: () => State.removeCanvasNode(nodeId), danger: true },
  ]);
}

function showEdgeCtxMenu(e, edgeId) {
  showContextMenu(e.clientX, e.clientY, [
    { icon: 'delete', label: 'Delete connection', action: () => State.removeCanvasEdge(edgeId), danger: true },
  ]);
}

// ─── CONNECT NODES (Project → Employee) ──────────────────────
window._startConnect = function (fromId) {
  const node = State.canvas.nodes.find(n => n.id === fromId);
  if (!node) return;
  showToastMsg('Drag from a blue port to connect nodes. Release on a target node.');
};

function connectNodes(fromId, toId) {
  const fromNode = State.canvas.nodes.find(n => n.id === fromId);
  const toNode = State.canvas.nodes.find(n => n.id === toId);
  if (!fromNode || !toNode) return;

  const projectNode = fromNode.type === 'project' ? fromNode : toNode.type === 'project' ? toNode : null;
  const employeeNode = fromNode.type !== 'project' ? fromNode : toNode.type !== 'project' ? toNode : null;

  if (!projectNode || !employeeNode?.empId) {
    State.addCanvasEdge({ id: uid(), fromId, toId, type: 'link', label: '' });
    showToast('Connected nodes.');
    return;
  }

  const existing = State.canvas.edges.find(edge =>
    (edge.fromId === projectNode.id && edge.toId === employeeNode.id) ||
    (edge.fromId === employeeNode.id && edge.toId === projectNode.id)
  );
  if (existing) {
    showToast('This employee is already connected to the project.');
    return;
  }

  employeeNode.projectRole = employeeNode.projectRole || 'pending';
  State.addCanvasEdge({
    id: uid(),
    fromId: projectNode.id,
    toId: employeeNode.id,
    type: 'pending',
    label: 'Assign role',
    projectId: projectNode.projectId,
    employeeId: employeeNode.empId,
  });
  renderNodes();
  showToast('Connected. Click the employee node to assign their project role.');
}

function getConnectedProjectForEmployee(employeeNodeId) {
  for (const edge of State.canvas.edges) {
    if (edge.fromId !== employeeNodeId && edge.toId !== employeeNodeId) continue;
    const otherId = edge.fromId === employeeNodeId ? edge.toId : edge.fromId;
    const projectNode = State.canvas.nodes.find(node => node.id === otherId && node.type === 'project');
    if (projectNode?.projectId) return { edge, projectNode };
  }
  return null;
}

function showRoleMenu(e, employeeNodeId, projectLink) {
  const employeeNode = State.canvas.nodes.find(node => node.id === employeeNodeId);
  const emp = getEmployeeForNode(employeeNode || {});
  const project = State.projects.find(item => item.id === projectLink.projectNode.projectId);
  showContextMenu(e.clientX, e.clientY, [
    { icon: 'admin_panel_settings', label: `Manager for ${project?.project_name || 'project'}`, action: () => assignConnectedEmployeeRole(projectLink, employeeNode, emp, 'manager') },
    { icon: 'supervisor_account', label: 'Team Lead', action: () => assignConnectedEmployeeRole(projectLink, employeeNode, emp, 'team_lead') },
    { icon: 'person', label: 'Member', action: () => assignConnectedEmployeeRole(projectLink, employeeNode, emp, 'member') },
    'divider',
    { icon: 'open_in_new', label: 'Inspect employee', action: () => State.emit('inspector:open', { type: 'employee', data: emp }) },
  ]);
}

async function assignConnectedEmployeeRole(projectLink, employeeNode, emp, role) {
  if (!projectLink?.projectNode?.projectId || !employeeNode?.empId) return;
  try {
    const updatedProject = await assignToProject(projectLink.projectNode.projectId, {
      employee_id: employeeNode.empId,
      role_in_project: role,
    });
    const normalized = role === 'team_lead' ? 'teamlead' : role;
    employeeNode.projectRole = normalized;
    projectLink.edge.type = normalized;
    projectLink.edge.label = canvasRoleLabel(normalized);
    projectLink.edge.projectId = projectLink.projectNode.projectId;
    projectLink.edge.employeeId = employeeNode.empId;

    if (updatedProject?.id) {
      const idx = State.projects.findIndex(project => project.id === updatedProject.id);
      if (idx >= 0) State.projects.splice(idx, 1, updatedProject);
      else State.projects.push(updatedProject);
    }
    await getEmployees({ cache: false }).catch(() => null);
    await getProjects().catch(() => null);
    renderNodes();
    renderEdges();
    initSidePanel();
    State.emit('data:projects:refresh');
    State.emit('data:employees:refresh');
    showToast(`${emp.name || 'Employee'} assigned as ${canvasRoleLabel(normalized)}.`);
  } catch (err) {
    showToast(err.message || 'Could not assign role.', 'error');
  }
}

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

function addEmployeeToCanvasAt(emp, x, y) {
  const existing = State.canvas.nodes.find(n => n.empId === emp.id);
  if (existing) {
    existing.x = x;
    existing.y = y;
    syncNodeEl(existing.id);
    renderEdges();
    State.selectNode(existing.id);
    return;
  }
  State.addCanvasNode({ id: uid(), empId: emp.id, x, y });
}

function addProjectNodeToCanvas(proj, x, y) {
  const existing = State.canvas.nodes.find(n => n.type === 'project' && n.projectId === proj.id);
  if (existing) {
    existing.x = x;
    existing.y = y;
    syncNodeEl(existing.id);
    renderEdges();
    State.selectNode(existing.id);
    return;
  }
  State.addCanvasNode({ id: uid(), type: 'project', projectId: proj.id, x, y });
}

export async function addProjectTreeToCanvas(proj) {
  if (!proj?.id) return;

  if (!State.employees.length) {
    try { await getEmployees(); } catch {}
  }

  const existingRoot = State.canvas.nodes.find(n => n.type === 'project' && n.projectId === proj.id);
  if (existingRoot) {
    State.selectNode(existingRoot.id);
    fitToScreenIfVisible();
    return;
  }

  const treeIndex = State.canvas.nodes.filter(n => n.type === 'project').length;
  const rootX = 80 + treeIndex * 90;
  const rootY = 80 + treeIndex * 70;
  const peopleX = rootX + 360;
  const rowGap = 132;

  const projectNode = {
    id: uid(),
    type: 'project',
    projectId: proj.id,
    x: rootX,
    y: rootY + rowGap,
  };
  State.addCanvasNode(projectNode);

  const team = Array.isArray(proj.team) ? proj.team : [];
  if (!team.length) {
    showToast('Project node added. Drag employee nodes onto it to connect.');
    renderNodes();
    renderEdges();
    return;
  }

  const startY = rootY + rowGap - ((team.length - 1) * rowGap) / 2;
  team.forEach((member, idx) => {
    const projectRole = member.role_in_project === 'team_lead' ? 'teamlead' : member.role_in_project;
    const childNode = nodeFromTeamMember(member, peopleX, startY + idx * rowGap, projectRole);
    State.addCanvasNode(childNode);
    State.addCanvasEdge({
      id: uid(),
      fromId: projectNode.id,
      toId: childNode.id,
      type: projectRole,
      label: canvasRoleLabel(projectRole),
      projectId: proj.id,
      employeeId: member.employee_id,
    });
  });

  renderNodes();
  renderEdges();
  fitToScreenIfVisible();
}

function fitToScreenIfVisible() {
  const container = document.getElementById('canvas-view');
  const rect = container?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  fitToScreen();
}

function nodeFromTeamMember(member, x, y, projectRole) {
  return {
    id: uid(),
    empId: member.employee_id,
    x,
    y,
    projectRole,
    name: member.name || member.employee_name,
    role: member.role,
    availability: member.availability,
  };
}

// ─── GROUPS ───────────────────────────────────────────────────
export function addProjectGroup(proj) {
  addProjectTreeToCanvas(proj);
  return;

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
window._inspectNode = function (nodeId) {
  const node = State.canvas.nodes.find(n => n.id === nodeId);
  if (!node) return;
  if (node.type === 'project') {
    const proj = State.projects.find(p => p.id === node.projectId);
    if (proj) State.emit('inspector:open', { type: 'project', data: proj });
    return;
  }
  State.emit('inspector:open', { type: 'employee', data: getEmployeeForNode(node) });
};

// ============================================================
// canvas.js — Infinite 2D Canvas Engine
// Pan · Zoom · Node Drag · Multi-select · Edges · Groups
// Side Panel · Hover Glow · Edge Bubbles · Hierarchy
// ============================================================

import { State } from '../utils/state.js';
import { showContextMenu, showToast } from './ui.js';
import {
  uid,
  clamp,
  snap,
  throttle,
  escHtml,
  initials,
  avatarColor,
  avatarTextColor,
  projectRoleCoverage,
  projectRoleRequirementKind,
  projectRoleTextMatches,
  projectRoleTokens,
} from '../utils/helpers.js?v=20260516-roles';
import { getEmployees, getProjects, assignToProject, unassignFromProject } from './api.js?v=20260516-railway';

let world, svgLayer, bgEl, zoomLabel, selBox;
let isPanning = false, isSpaceDown = false;
let isDragging = false, dragNodeId = null, dragOffsetX = 0, dragOffsetY = 0;
let isSelecting = false, selStartX = 0, selStartY = 0;
let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
let isConnecting = false, connectFromId = null, connectSnapTargetId = null, connectPreviewPath = null;
let hoveredEmployeeNodeId = null, hoveredEdgeDeleteEmployeeId = null;
const aiAssigningProjectNodeIds = new Set();
let lastMissingRoleNoticeKey = '';
let lastProjectTapNodeId = null;
let lastProjectTapAt = 0;

const MIN_ZOOM = 0.15, MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.1;
const DOUBLE_TAP_MS = 320;
const PROJECT_NODE_W = 240;
const PROJECT_NODE_H = 128;
const EMPLOYEE_NODE_W = 116;
const EMPLOYEE_NODE_H = 118;
const EMPLOYEE_ORB_R = 40;
const EDGE_DELETE_SIZE = 18;
const CONNECT_SNAP_RADIUS = 44;

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
        <polygon points="0 0, 8 3, 0 6" fill="var(--canvas-edge-muted)" />
      </marker>
      <marker id="arrowhead-primary" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="var(--canvas-edge-strong)" />
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
  const transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  world.style.transform = transform;
  svgLayer.style.transform = 'none';
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

  if (target.closest('button,input,textarea,select,a,[data-canvas-control]')) {
    return;
  }

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

  const snapTarget = getConnectionSnapTarget(e.clientX, e.clientY, connectFromId);
  connectSnapTargetId = snapTarget?.id || null;
  updateConnectionSnapStyles();

  let start;
  let end;
  if (snapTarget) {
    start = worldToCanvasPoint(getConnectionPoint(fromNode, snapTarget));
    end = worldToCanvasPoint(getConnectionPoint(snapTarget, fromNode));
  } else {
    const worldEnd = screenToWorld(e.clientX, e.clientY);
    end = clientToCanvasPoint(e.clientX, e.clientY);
    start = worldToCanvasPoint(getConnectionPoint(fromNode, { x: worldEnd.x, y: worldEnd.y, type: 'point' }));
  }
  connectPreviewPath.setAttribute('d', edgePath(start, end));
}

function getConnectionSnapTarget(clientX, clientY, fromId) {
  let best = null;
  let bestDistance = Infinity;

  State.canvas.nodes.forEach(node => {
    if (node.id === fromId) return;
    const el = world.querySelector(`.canvas-node[data-id="${node.id}"]`);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = node.type === 'project'
      ? rect.top + rect.height / 2
      : rect.top + EMPLOYEE_ORB_R * State.canvas.zoom;

    const insideExpandedBox =
      clientX >= rect.left - CONNECT_SNAP_RADIUS &&
      clientX <= rect.right + CONNECT_SNAP_RADIUS &&
      clientY >= rect.top - CONNECT_SNAP_RADIUS &&
      clientY <= rect.bottom + CONNECT_SNAP_RADIUS;
    const distance = Math.hypot(clientX - cx, clientY - cy);

    if (insideExpandedBox && distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  });

  return best;
}

function updateConnectionSnapStyles() {
  world?.querySelectorAll('.canvas-node').forEach(el => {
    el.classList.toggle('connect-target', Boolean(connectSnapTargetId && el.dataset.id === connectSnapTargetId));
  });
}

function finishConnectionDrag(e) {
  e.preventDefault();
  e.stopPropagation();
  const fromId = connectFromId;
  const targetEl = e.target.closest('.canvas-node');
  const snapTarget = getConnectionSnapTarget(e.clientX, e.clientY, fromId);
  const toId = targetEl?.dataset.id || snapTarget?.id || connectSnapTargetId;
  const menuPoint = { x: e.clientX, y: e.clientY };
  cancelConnectionDrag();
  if (toId && toId !== fromId) {
    setTimeout(() => connectNodes(fromId, toId, { openRoleMenu: true, menuPoint }), 80);
  }
}

function cancelConnectionDrag() {
  isConnecting = false;
  connectFromId = null;
  connectSnapTargetId = null;
  updateConnectionSnapStyles();
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
    const emp = emps.find(item => sameId(item.id, payload.id));
    if (emp) addEmployeeToCanvasAt(emp, point.x - EMPLOYEE_NODE_W / 2, point.y - EMPLOYEE_ORB_R);
  } else if (payload.type === 'project') {
    const projs = State.projects.length ? State.projects : await getProjects();
    const proj = projs.find(item => sameId(item.id, payload.id));
    if (proj) await addProjectNodeToCanvas(proj, point.x - PROJECT_NODE_W / 2, point.y - PROJECT_NODE_H / 2);
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

    notifyMissingProjectRoles(projs);

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

function notifyMissingProjectRoles(projects, { force = false } = {}) {
  if (!State.settings?.notifyOnActivity && !force) return;
  const gaps = (projects || [])
    .map(project => ({ project, coverage: projectRoleCoverage(project) }))
    .filter(item => item.coverage.hasMissing);

  if (!gaps.length) {
    if (!force) lastMissingRoleNoticeKey = '';
    return;
  }

  const noticeKey = gaps
    .map(({ project, coverage }) => `${project.id || project.project_name}:${coverage.missing.join(',')}`)
    .sort()
    .join('|');
  if (!force && lastMissingRoleNoticeKey === noticeKey) return;
  lastMissingRoleNoticeKey = noticeKey;

  if (gaps.length === 1) {
    const { project, coverage } = gaps[0];
    showToast(`${project.project_name || 'Project'} is missing roles: ${coverage.summary}.`, 'warning', 7000);
    return;
  }

  const preview = gaps.slice(0, 2)
    .map(({ project, coverage }) => `${project.project_name || 'Project'} (${coverage.summary})`)
    .join('; ');
  const more = gaps.length > 2 ? ` and ${gaps.length - 2} more` : '';
  showToast(`${gaps.length} projects have missing roles: ${preview}${more}.`, 'warning', 8000);
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
  world.querySelectorAll('.canvas-edge-delete').forEach(el => {
    if (!State.canvas.edges.some(edge => edge.id === el.dataset.edgeId)) el.remove();
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
    const proj = State.projects.find(p => sameId(p.id, node.projectId)) || {};
    const connectedCount = State.canvas.edges.filter(edge => edge.fromId === node.id || edge.toId === node.id).length;
    const roleGap = projectRoleCoverage(proj).missing.join(',');
    return ['project', node.projectId, proj.project_name, proj.client_name, proj.status, proj.percent_complete, connectedCount, node.childrenHidden, roleGap].join('|');
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
    e.stopPropagation();
    State.selectNode(node.id, e.shiftKey);
    const projectLink = getConnectedProjectForEmployee(node.id);
    if (projectLink) {
      showRoleMenu(e, node.id, projectLink);
    } else {
      State.emit('inspector:open', { type: 'employee', data: emp });
    }
  });

  el.addEventListener('mouseenter', () => {
    hoveredEmployeeNodeId = node.id;
    updateEdgeDeleteVisibility();
  });

  el.addEventListener('mouseleave', event => {
    const nextDelete = event.relatedTarget?.closest?.('.canvas-edge-delete');
    if (nextDelete?.dataset.employeeNodeId === node.id) return;
    if (hoveredEmployeeNodeId === node.id) hoveredEmployeeNodeId = null;
    updateEdgeDeleteVisibility();
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
  const proj = State.projects.find(p => sameId(p.id, node.projectId)) || {};
  const el = document.createElement('div');
  const isAiAssigning = aiAssigningProjectNodeIds.has(node.id);
  const childrenHidden = node.childrenHidden === true;
  const roleCoverage = projectRoleCoverage(proj);
  const roleWarningAction = roleCoverage.hasMissing ? `
      <span class="node-mini-action project-role-warning" data-canvas-control tabindex="0" aria-label="${escHtml(roleCoverage.detail)}" title="${escHtml(roleCoverage.detail)}" onmousedown="event.stopPropagation()" onclick="event.preventDefault(); event.stopPropagation();">
        <span class="material-symbols-outlined">warning</span>
        <span class="project-role-warning-tooltip">
          <strong>Missing roles</strong>
          <span>${escHtml(roleCoverage.summary)}</span>
          <em>${escHtml(roleCoverage.detail)}</em>
        </span>
      </span>` : '';
  el.className = `canvas-node canvas-node-project${isAiAssigning ? ' ai-generating' : ''}${childrenHidden ? ' children-hidden' : ''}`;
  el.dataset.id = node.id;

  const status = String(proj.status || 'active').toLowerCase();
  const isActive = status === 'active';
  const sc = isActive ? 'var(--gl-success)' : 'var(--gl-error)';
  const pct = proj.percent_complete ?? 0;
  const visibleConnectionCount = State.canvas.edges.filter(edge =>
    edge.fromId === node.id || edge.toId === node.id
  ).length;
  const teamCount = Array.isArray(proj.team) ? proj.team.length : 0;
  const connectedCount = visibleConnectionCount || teamCount;
  const childCountLabel = childrenHidden ? `${connectedCount} hidden` : `${connectedCount} connected`;

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
      <span>${childCountLabel}</span>
      <span>${pct}%</span>
    </div>
    <div class="project-node-progress">
      <div style="width:${pct}%;background:${sc}"></div>
    </div>
    <div class="project-node-footer">
      <span>${escHtml(proj.status || 'active')}</span>
      <div class="project-node-actions">
        ${roleWarningAction}
        <button class="node-mini-action canvas-ai-assign-btn${isAiAssigning ? ' is-loading' : ''}" data-canvas-control title="AI assign available team" onmousedown="event.stopPropagation()" onclick="event.preventDefault(); event.stopPropagation(); window._aiAssignProjectNode('${node.id}')" ${isAiAssigning ? 'disabled' : ''}>
          <img class="ai-input-icon-dark" src="icon/ai_input_dark.svg" alt="">
          <img class="ai-input-icon-light" src="icon/ai_input_light.svg" alt="">
        </button>
        <button class="node-mini-action" data-canvas-control title="Inspect" onmousedown="event.stopPropagation()" onclick="event.preventDefault(); event.stopPropagation(); window._inspectNode('${node.id}')">
          <span class="material-symbols-outlined" style="font-size:13px">open_in_new</span>
        </button>
      </div>
    </div>
    <div class="node-port node-port-t" data-node="${node.id}" title="Drag to connect"></div>
    <div class="node-port node-port-r" data-node="${node.id}" title="Drag to connect"></div>
    <div class="node-port node-port-b" data-node="${node.id}" title="Drag to connect"></div>
    <div class="node-port node-port-l" data-node="${node.id}" title="Drag to connect"></div>`;

  let clickTimer = null;
  el.addEventListener('click', e => {
    if (e.target.closest('button,.node-port')) return;
    e.stopPropagation();

    const now = Date.now();
    const isDoubleTap = e.detail > 1 ||
      (lastProjectTapNodeId === node.id && now - lastProjectTapAt <= DOUBLE_TAP_MS);
    lastProjectTapNodeId = node.id;
    lastProjectTapAt = now;

    if (isDoubleTap) {
      clearTimeout(clickTimer);
      lastProjectTapAt = 0;
      toggleProjectChildren(node, proj);
      return;
    }

    clearTimeout(clickTimer);
    clickTimer = setTimeout(async () => {
      State.selectNode(node.id, e.shiftKey);
      const latest = node.childrenHidden
        ? (State.projects.find(p => sameId(p.id, node.projectId)) || proj)
        : await syncProjectTeamToCanvas(proj, node).catch(() => proj);
      State.emit('inspector:open', { type: 'project', data: latest || proj });
    }, DOUBLE_TAP_MS);
  });

  el.addEventListener('dblclick', e => {
    e.preventDefault();
    e.stopPropagation();
  });

  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    showNodeCtxMenu(e, node.id);
  });

  return el;
}

function getEmployeeForNode(node) {
  const emp = State.employees.find(e => sameId(e.id, node.empId));
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
  updateEdgeDeleteVisibility(selectedIds);
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
  return { x: node.x + EMPLOYEE_NODE_W / 2, y: node.y + EMPLOYEE_ORB_R };
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

function clientToCanvasPoint(clientX, clientY) {
  const container = document.getElementById('canvas-view').getBoundingClientRect();
  return {
    x: clientX - container.left,
    y: clientY - container.top,
  };
}

function worldToCanvasPoint(point) {
  return {
    x: point.x * State.canvas.zoom + State.canvas.panX,
    y: point.y * State.canvas.zoom + State.canvas.panY,
  };
}

function normId(value) {
  return value === null || value === undefined ? '' : String(value);
}

function sameId(a, b) {
  const left = normId(a);
  return Boolean(left && left === normId(b));
}

function teamMemberEmployeeId(member) {
  return normId(member?.employee_id || member?.employee?.id || member?.id);
}

function normalizeProjectRole(role) {
  const value = role === 'team_lead' ? 'teamlead' : String(role || 'member').toLowerCase();
  return ['manager', 'teamlead', 'member', 'hr', 'pending'].includes(value) ? value : 'pending';
}

// ─── RENDER EDGES ─────────────────────────────────────────────
export function renderEdges() {
  // Remove old edge elements
  svgLayer.querySelectorAll('.canvas-edge-group').forEach(e => e.remove());
  const visibleEdgeIds = new Set(State.canvas.edges.map(edge => edge.id));
  world.querySelectorAll('.canvas-edge-delete').forEach(el => {
    if (!visibleEdgeIds.has(el.dataset.edgeId)) el.remove();
  });

  State.canvas.edges.forEach(edge => {
    const fromNode = State.canvas.nodes.find(n => n.id === edge.fromId);
    const toNode = State.canvas.nodes.find(n => n.id === edge.toId);
    if (!fromNode || !toNode) return;

    const start = worldToCanvasPoint(getConnectionPoint(fromNode, toNode));
    const end = worldToCanvasPoint(getConnectionPoint(toNode, fromNode));
    const d = edgePath(start, end);
    const isProjectConnection = Boolean(edge.projectId) ||
      ['project', 'manager', 'teamlead', 'team_lead', 'member', 'pending'].includes(edge.type);
    const marker = isProjectConnection ? 'url(#arrowhead-primary)' : 'url(#arrowhead)';
    const stroke = isProjectConnection ? 'var(--canvas-edge-strong)' : 'var(--canvas-edge-muted)';
    const width = isProjectConnection ? '2' : '1.5';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('canvas-edge-group');

    // Hit area (invisible wide path)
    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.setAttribute('d', d);
    hitPath.setAttribute('stroke', 'transparent');
    hitPath.setAttribute('stroke-width', '12');
    hitPath.setAttribute('fill', 'none');
    hitPath.setAttribute('class', 'canvas-edge-hit');
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
    path.setAttribute('stroke-dasharray', '7 7');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
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
    renderEdgeDeleteControl(edge, fromNode, toNode);
  });
}

function renderEdgeDeleteControl(edge, fromNode, toNode) {
  if (!isProjectEmployeeEdge(edge, fromNode, toNode)) return;

  let btn = world.querySelector(`.canvas-edge-delete[data-edge-id="${edge.id}"]`);
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'canvas-edge-delete';
    btn.dataset.edgeId = edge.id;
    btn.title = 'Delete connection';
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:12px">close</span>';
    btn.addEventListener('mousedown', event => event.stopPropagation());
    btn.addEventListener('mouseenter', () => {
      hoveredEdgeDeleteEmployeeId = btn.dataset.employeeNodeId || null;
      updateEdgeDeleteVisibility();
    });
    btn.addEventListener('mouseleave', event => {
      const nextEmployee = event.relatedTarget?.closest?.('.canvas-node-employee');
      if (nextEmployee?.dataset.id === btn.dataset.employeeNodeId) return;
      if (hoveredEdgeDeleteEmployeeId === btn.dataset.employeeNodeId) hoveredEdgeDeleteEmployeeId = null;
      updateEdgeDeleteVisibility();
    });
    btn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      deleteCanvasConnection(edge.id);
    });
    world.appendChild(btn);
  }

  const employeeNode = fromNode.type === 'project' ? toNode : fromNode;
  const projectNode = fromNode.type === 'project' ? fromNode : toNode;
  btn.dataset.employeeNodeId = employeeNode.id;
  btn.hidden = !shouldShowEdgeDelete(employeeNode.id);

  const employeeCenter = getNodeCenter(employeeNode);
  const projectCenter = getNodeCenter(projectNode);
  const dx = projectCenter.x - employeeCenter.x;
  const dy = projectCenter.y - employeeCenter.y;
  const len = Math.hypot(dx, dy) || 1;
  const anchor = {
    x: employeeCenter.x + (dx / len) * (EMPLOYEE_ORB_R + 1),
    y: employeeCenter.y + (dy / len) * (EMPLOYEE_ORB_R + 1),
  };

  btn.style.left = `${anchor.x - EDGE_DELETE_SIZE / 2}px`;
  btn.style.top = `${anchor.y - EDGE_DELETE_SIZE / 2}px`;
}

function updateEdgeDeleteVisibility(selectedIds = [...State.canvas.selectedIds]) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  world?.querySelectorAll('.canvas-edge-delete').forEach(btn => {
    const edge = State.canvas.edges.find(item => item.id === btn.dataset.edgeId);
    if (!edge) {
      btn.remove();
      return;
    }

    const fromNode = State.canvas.nodes.find(node => node.id === edge.fromId);
    const toNode = State.canvas.nodes.find(node => node.id === edge.toId);
    if (!fromNode || !toNode || !isProjectEmployeeEdge(edge, fromNode, toNode)) {
      btn.hidden = true;
      return;
    }

    const employeeNode = fromNode.type === 'project' ? toNode : fromNode;
    btn.dataset.employeeNodeId = employeeNode.id;
    btn.hidden = !shouldShowEdgeDelete(employeeNode.id, selected);
  });
}

function shouldShowEdgeDelete(employeeNodeId, selected = State.canvas.selectedIds) {
  return (
    selected.has(employeeNodeId) ||
    hoveredEmployeeNodeId === employeeNodeId ||
    hoveredEdgeDeleteEmployeeId === employeeNodeId
  );
}

function isProjectEmployeeEdge(edge, fromNode, toNode) {
  const linksProjectEmployee =
    (fromNode.type === 'project' && toNode?.empId) ||
    (toNode.type === 'project' && fromNode?.empId);
  return Boolean(edge.projectId || linksProjectEmployee);
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
    { icon: 'delete', label: 'Delete connection', action: () => deleteCanvasConnection(edgeId), danger: true },
  ]);
}

// ─── CONNECT NODES (Project → Employee) ──────────────────────
window._startConnect = function (fromId) {
  const node = State.canvas.nodes.find(n => n.id === fromId);
  if (!node) return;
  showToastMsg('Drag from a blue port to connect nodes. Release on a target node.');
};

function connectNodes(fromId, toId, options = {}) {
  const fromNode = State.canvas.nodes.find(n => n.id === fromId);
  const toNode = State.canvas.nodes.find(n => n.id === toId);
  if (!fromNode || !toNode) return;

  const projectNode = fromNode.type === 'project' ? fromNode : toNode.type === 'project' ? toNode : null;
  const employeeNode = fromNode.type !== 'project' ? fromNode : toNode.type !== 'project' ? toNode : null;

  if (!projectNode || !employeeNode?.empId) {
    showToast('Connect a project node to an employee node.', 'error');
    return;
  }

  const existing = findProjectEmployeeEdge(projectNode.projectId, employeeNode.empId, projectNode.id, employeeNode.id);
  if (existing) {
    updateProjectEmployeeEdge(existing, projectNode, employeeNode, existing.type || 'pending');
    renderNodes();
    renderEdges();
    if (options.openRoleMenu) {
      openRoleMenuForConnection(projectNode, employeeNode, existing, options.menuPoint);
    } else {
      showToast('This employee is already connected to the project.');
    }
    return;
  }

  const edge = ensureProjectEmployeeEdge(projectNode, employeeNode, 'pending');
  renderNodes();
  renderEdges();

  if (options.openRoleMenu) {
    openRoleMenuForConnection(projectNode, employeeNode, edge, options.menuPoint);
  } else {
    showToast('Connected. Click the employee node to assign their project role.');
  }
}

function openRoleMenuForConnection(projectNode, employeeNode, edge, menuPoint = null) {
  const point = menuPoint || getNodeMenuPoint(employeeNode);
  const emp = getEmployeeForNode(employeeNode);
  showRoleMenuAt(point.x, point.y, employeeNode, emp, { edge, projectNode });
}

function ensureProjectEmployeeEdge(projectNode, employeeNode, role = 'pending') {
  const edge = findProjectEmployeeEdge(projectNode.projectId, employeeNode.empId, projectNode.id, employeeNode.id) || {
    id: uid(),
  };
  const isNew = !State.canvas.edges.includes(edge);
  updateProjectEmployeeEdge(edge, projectNode, employeeNode, role);
  if (isNew) State.canvas.edges.push(edge);
  State.emit('canvas:edges:change', State.canvas.edges);
  return edge;
}

function updateProjectEmployeeEdge(edge, projectNode, employeeNode, role = 'pending') {
  const normalized = normalizeProjectRole(role || 'pending');
  edge.fromId = projectNode.id;
  edge.toId = employeeNode.id;
  edge.type = normalized;
  edge.label = canvasRoleLabel(normalized) || 'Assign role';
  edge.projectId = projectNode.projectId;
  edge.employeeId = employeeNode.empId;
  employeeNode.projectRole = normalized;
  return edge;
}

function findProjectEmployeeEdge(projectId, employeeId, projectNodeId = null, employeeNodeId = null) {
  const pid = normId(projectId);
  const eid = normId(employeeId);
  return State.canvas.edges.find(edge => {
    const edgeEmployeeId = normId(edge.employeeId) || getEdgeEmployeeId(edge);
    if (pid && edge.projectId && !sameId(edge.projectId, pid)) return false;
    if (eid && edgeEmployeeId && edgeEmployeeId !== eid) return false;

    const connectsExactNodes = projectNodeId && employeeNodeId && (
      (edge.fromId === projectNodeId && edge.toId === employeeNodeId) ||
      (edge.fromId === employeeNodeId && edge.toId === projectNodeId)
    );

    return connectsExactNodes || (
      pid &&
      eid &&
      sameId(edge.projectId, pid) &&
      edgeEmployeeId === eid
    );
  });
}

function getEdgeEmployeeId(edge) {
  if (edge.employeeId) return normId(edge.employeeId);
  const fromNode = State.canvas.nodes.find(node => node.id === edge.fromId);
  const toNode = State.canvas.nodes.find(node => node.id === edge.toId);
  const employeeNode = fromNode?.type === 'project' ? toNode : fromNode;
  return normId(employeeNode?.empId);
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
  showRoleMenuAt(e.clientX, e.clientY, employeeNode, emp, projectLink);
}

function showRoleMenuAt(x, y, employeeNode, emp, projectLink) {
  const project = State.projects.find(item => sameId(item.id, projectLink.projectNode.projectId));
  showContextMenu(x, y, [
    { icon: 'admin_panel_settings', label: `Manager for ${project?.project_name || 'project'}`, action: () => assignConnectedEmployeeRole(projectLink, employeeNode, emp, 'manager') },
    { icon: 'supervisor_account', label: 'Team Lead', action: () => assignConnectedEmployeeRole(projectLink, employeeNode, emp, 'team_lead') },
    { icon: 'person', label: 'Member', action: () => assignConnectedEmployeeRole(projectLink, employeeNode, emp, 'member') },
    'divider',
    { icon: 'open_in_new', label: 'Inspect employee', action: () => State.emit('inspector:open', { type: 'employee', data: emp }) },
  ]);
}

function getNodeMenuPoint(node) {
  const el = world.querySelector(`.canvas-node[data-id="${node.id}"]`);
  const rect = el?.getBoundingClientRect();
  if (!rect) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + Math.min(rect.height, EMPLOYEE_ORB_R * State.canvas.zoom + 14),
  };
}

async function assignConnectedEmployeeRole(projectLink, employeeNode, emp, role) {
  if (!projectLink?.projectNode?.projectId || !employeeNode?.empId) return;
  const normalized = normalizeProjectRole(role);
  const previousEdge = projectLink.edge ? { ...projectLink.edge } : null;
  const previousRole = employeeNode.projectRole;
  const edge = ensureProjectEmployeeEdge(projectLink.projectNode, employeeNode, normalized);
  projectLink.edge = edge;
  renderNodes();
  renderEdges();

  try {
    const updatedProject = await assignToProject(projectLink.projectNode.projectId, {
      employee_id: employeeNode.empId,
      role_in_project: role,
    });
    if (Array.isArray(updatedProject?.team) && !projectHasAssignment(updatedProject, employeeNode.empId, normalized)) {
      throw new Error('Assignment was not saved.');
    }

    if (updatedProject?.id) {
      const idx = State.projects.findIndex(project => sameId(project.id, updatedProject.id));
      if (idx >= 0) State.projects.splice(idx, 1, updatedProject);
      else State.projects.push(updatedProject);
    }
    await getEmployees({ cache: false }).catch(() => null);
    await getProjects().catch(() => null);
    renderNodes();
    renderEdges();
    initSidePanel();
    notifyMissingProjectRoles([updatedProject], { force: true });
    State.emit('data:projects:refresh');
    State.emit('data:employees:refresh');
    showToast(`${emp.name || 'Employee'} assigned as ${canvasRoleLabel(normalized)}.`);
  } catch (err) {
    revertOptimisticAssignment(edge, previousEdge, employeeNode, previousRole);
    showToast(err.message || 'Could not assign role.', 'error');
  }
}

async function aiAssignProjectTeam(nodeId) {
  const projectNode = State.canvas.nodes.find(node => node.id === nodeId && node.type === 'project');
  if (!projectNode?.projectId || aiAssigningProjectNodeIds.has(nodeId)) return;

  setProjectAiAssigning(nodeId, true);
  showToast('AI is matching available employees to this project...', 'info', 2200);

  try {
    const [employees, projects] = await Promise.all([
      getEmployees({ cache: false }),
      getProjects({ cache: false }),
    ]);
    const project = projects.find(item => sameId(item.id, projectNode.projectId)) ||
      State.projects.find(item => sameId(item.id, projectNode.projectId));

    if (!project) {
      showToast('Project could not be found.', 'error');
      return;
    }

    const plan = buildAiProjectAssignmentPlan(project, employees);
    if (!plan.length) {
      showToast("No suitable available employees found for this project's missing roles.", 'warning');
      return;
    }

    const successful = [];
    const failed = [];
    let updatedProject = project;

    for (const item of plan) {
      try {
        updatedProject = await assignToProject(projectNode.projectId, {
          employee_id: item.employee.id,
          role_in_project: item.role,
        });
        if (updatedProject?.id) upsertStateProject(updatedProject);
        successful.push(item);
      } catch (err) {
        failed.push({ item, message: err.message || 'Could not assign employee.' });
      }
    }

    await getEmployees({ cache: false }).catch(() => null);
    const refreshedProjects = await getProjects({ cache: false }).catch(() => null);
    const finalProject = refreshedProjects?.find(item => sameId(item.id, projectNode.projectId)) || updatedProject;
    if (finalProject?.id) upsertStateProject(finalProject);
    notifyMissingProjectRoles([finalProject], { force: true });

    if (!successful.length) {
      showToast(failed[0]?.message || 'AI could not assign this team.', 'error');
      return;
    }

    projectNode.childrenHidden = false;
    await syncProjectTeamToCanvas(finalProject, projectNode);
    renderNodes();
    renderEdges();
    initSidePanel();
    fitToScreenIfVisible();
    State.emit('data:projects:refresh');
    State.emit('data:employees:refresh');

    const assignmentPreview = successful.slice(0, 3)
      .map(item => `${item.roleLabel}: ${item.employee.name}`)
      .join('; ');
    const moreText = successful.length > 3 ? ` and ${successful.length - 3} more` : '';
    showToast(`AI assigned ${successful.length} matching role${successful.length === 1 ? '' : 's'}: ${assignmentPreview}${moreText}.`);
    if (failed.length) {
      showToast(`${failed.length} recommendation${failed.length === 1 ? '' : 's'} could not be saved.`, 'warning');
    }
  } catch (err) {
    showToast(err.message || 'AI assignment failed.', 'error');
  } finally {
    setProjectAiAssigning(nodeId, false);
  }
}

function setProjectAiAssigning(nodeId, busy) {
  if (busy) aiAssigningProjectNodeIds.add(nodeId);
  else aiAssigningProjectNodeIds.delete(nodeId);
  const el = world?.querySelector(`.canvas-node[data-id="${nodeId}"]`);
  el?.classList.toggle('ai-generating', busy);
  const btn = el?.querySelector('.canvas-ai-assign-btn');
  if (btn) {
    btn.disabled = busy;
    btn.classList.toggle('is-loading', busy);
  }
}

function buildAiProjectAssignmentPlan(project, employees) {
  const team = Array.isArray(project.team) ? project.team : [];
  const assignedIds = new Set(team.map(teamMemberEmployeeId).filter(Boolean));
  const selectedIds = new Set(assignedIds);
  const skillTags = cleanAiTags(project.required_skills || []);
  const missingRoles = projectRoleCoverage(project).missing;
  const pool = employees.filter(emp => isEmployeeAvailableForAiProject(emp, project.id, assignedIds));
  const plannedTeam = [...team];
  const plan = [];

  const addPick = target => {
    const pick = pickBestAiCandidate(
      pool,
      selectedIds,
      emp => target.filter(emp),
      emp => evaluateAiCandidateForRequirement(emp, target, skillTags),
    );
    if (!pick) return null;
    selectedIds.add(normId(pick.emp.id));
    plan.push({
      employee: pick.emp,
      role: target.assignmentRole,
      roleLabel: target.roleLabel,
      confidence: pick.confidence,
    });
    plannedTeam.push({
      employee_id: pick.emp.id,
      name: pick.emp.name,
      role: pick.emp.role,
      role_in_project: target.assignmentRole,
      availability: pick.emp.availability,
    });
    return pick.emp;
  };

  const targets = missingRoles.length
    ? missingRoles.map(projectAssignmentTarget).filter(Boolean)
    : fallbackUnstaffedProjectTargets(project, team, skillTags);

  targets.forEach(target => {
    const stillMissing = projectRoleCoverage({ ...project, team: plannedTeam }).missing;
    if (!stillMissing.includes(target.roleLabel)) return;
    addPick(target);
  });

  return plan;
}

function projectAssignmentTarget(roleLabel) {
  const kind = projectRoleRequirementKind(roleLabel);
  if (kind === 'manager') {
    return {
      kind,
      roleLabel,
      assignmentRole: 'manager',
      filter: emp => isManagerEmployee(emp),
    };
  }
  if (kind === 'teamlead') {
    return {
      kind,
      roleLabel,
      assignmentRole: 'team_lead',
      filter: emp => !isManagerEmployee(emp) && hasTeamLeadSignal(emp),
    };
  }
  if (kind === 'hr') {
    return {
      kind,
      roleLabel,
      assignmentRole: 'hr',
      filter: emp => !isManagerEmployee(emp),
    };
  }
  if (kind === 'member') {
    return {
      kind,
      roleLabel,
      assignmentRole: 'member',
      filter: emp => !isManagerEmployee(emp),
    };
  }
  return {
    kind,
    roleLabel,
    assignmentRole: 'member',
    filter: emp => !isManagerEmployee(emp),
  };
}

function fallbackUnstaffedProjectTargets(project, team, skillTags) {
  const hasRoleRequirements = cleanAiTags(project.required_roles || []).length > 0;
  if (hasRoleRequirements || team.length || !skillTags.length) return [];
  return [{
    kind: 'specialist',
    roleLabel: skillTags[0],
    assignmentRole: 'member',
    filter: emp => !isManagerEmployee(emp),
  }];
}

function pickBestAiCandidate(pool, selectedIds, filter, evaluate) {
  return pool
    .filter(emp => emp?.id && !selectedIds.has(normId(emp.id)) && filter(emp))
    .map(emp => ({ emp, ...evaluate(emp) }))
    .filter(item => item.qualified)
    .sort((a, b) => b.score - a.score || String(a.emp.name || '').localeCompare(String(b.emp.name || '')))[0] || null;
}

function isEmployeeAvailableForAiProject(emp, projectId, assignedIds) {
  if (!emp?.id || assignedIds.has(normId(emp.id)) || emp.availability !== true) return false;
  if (isManagerEmployee(emp)) return true;
  return !(emp.projects || []).some(project => !sameId(project.project_id, projectId));
}

function isManagerEmployee(emp) {
  return String(emp?.role || '').trim().toLowerCase().replace(/[_-]+/g, ' ').split(/\s+/).includes('manager');
}

function cleanAiTags(values) {
  const seen = new Set();
  const tags = [];
  (values || []).forEach(value => {
    const tag = String(value || '').trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags;
}

function evaluateAiCandidateForRequirement(emp, target, skillTags) {
  const text = employeeAiText(emp);
  const roleMatch = projectRoleTextMatches(target.roleLabel, emp.role);
  const requirementSkillScore = directSkillScore(emp, target.roleLabel);
  const requirementTokenHits = tokenHits(target.roleLabel, text);
  const projectSkillScore = skillTags.reduce((sum, skill) => sum + directSkillScore(emp, skill), 0);
  const projectSkillHits = skillTags.reduce((sum, skill) => sum + tokenHits(skill, text), 0);
  const hasRelevantProjectSkill = projectSkillScore > 0 || projectSkillHits > 0;
  const hasRequirementSkill = !roleRequiresExplicitLead(target.roleLabel) &&
    (requirementSkillScore > 0 || requirementTokenHits >= requiredTokenThreshold(target.roleLabel));

  let qualified = false;
  if (target.assignmentRole === 'manager') {
    qualified = isManagerEmployee(emp) && (roleMatch || target.kind === 'manager');
  } else if (target.assignmentRole === 'team_lead') {
    qualified = hasTeamLeadSignal(emp) && (roleMatch || target.kind === 'teamlead' || hasRelevantProjectSkill);
  } else if (target.assignmentRole === 'hr') {
    qualified = roleMatch || /\b(hr|human resources)\b/i.test(normalizedRoleText(emp.role));
  } else if (target.kind === 'member') {
    qualified = hasRelevantProjectSkill || roleMatch || requirementSkillScore > 0;
  } else {
    qualified = roleMatch || hasRequirementSkill;
  }

  const score = scoreAiCandidate(emp, target.roleLabel, skillTags, target.assignmentRole) +
    (roleMatch ? 90 : 0) +
    requirementSkillScore * 36 +
    requirementTokenHits * 18 +
    projectSkillScore * 12 +
    (qualified ? 25 : 0);

  return {
    qualified,
    score,
    confidence: qualified ? Math.min(100, Math.round(score / 2)) : 0,
  };
}

function hasTeamLeadSignal(emp) {
  return /\b(team\s*)?lead(er)?\b|\btech(nical)?\s*lead(er)?\b/i.test(normalizedRoleText(emp?.role));
}

function roleRequiresExplicitLead(roleLabel) {
  return /\blead(er)?\b/i.test(normalizedRoleText(roleLabel));
}

function normalizedRoleText(value) {
  return String(value || '').replace(/[_-]+/g, ' ');
}

function requiredTokenThreshold(roleLabel) {
  return Math.min(2, Math.max(1, projectRoleTokens(roleLabel).filter(token => token.length > 1).length));
}

function scoreAiCandidate(emp, roleLabel, skillTags, projectRole) {
  const text = employeeAiText(emp);
  const rating = Number(emp.rating) || 0;
  const exp = Number(emp.total_experience_years) || 0;
  const roleHits = tokenHits(roleLabel, text);
  const skillHits = skillTags.reduce((sum, skill) => sum + tokenHits(skill, text), 0);
  const directSkillHits = skillTags.reduce((sum, skill) => sum + directSkillScore(emp, skill), 0);
  const skillExp = (emp.skills || []).reduce((sum, skill) => sum + (Number(skill.experience_years_with_skill) || 0), 0);

  let score = rating * 12 + Math.min(exp, 20) * 2 + roleHits * 16 + skillHits * 5 + directSkillHits * 18 + Math.min(skillExp, 16) * 1.5;
  if (projectRole === 'team_lead') {
    score += rating * 14 + Math.min(exp, 24) * 3 + (/\blead(er)?\b/.test(text) ? 18 : 0);
  }
  if (projectRole === 'manager') {
    score += rating * 10 + Math.min(exp, 25) * 2 + (isManagerEmployee(emp) ? 60 : 0);
  }
  return score;
}

function employeeAiText(emp) {
  return [
    emp.name,
    emp.role,
    emp.team,
    ...(emp.skills || []).flatMap(skill => [skill.skill_name, skill.name, skill.notes]),
    ...(emp.experience || []).flatMap(item => [item.job_title, item.company_name, item.description]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function tokenHits(value, text) {
  return meaningfulTokens(value).reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
}

function directSkillScore(emp, requiredSkill) {
  const tokens = meaningfulTokens(requiredSkill);
  if (!tokens.length) return 0;
  return (emp.skills || []).reduce((score, skill) => {
    const name = String(skill.skill_name || skill.name || '').toLowerCase();
    const matched = tokens.some(token => name.includes(token));
    if (!matched) return score;
    return score + 1 + (Number(skill.skill_level) || 0) / 5;
  }, 0);
}

function meaningfulTokens(value) {
  return projectRoleTokens(value).filter(token => token.length > 1);
}

function upsertStateProject(project) {
  const idx = State.projects.findIndex(item => sameId(item.id, project.id));
  if (idx >= 0) State.projects.splice(idx, 1, project);
  else State.projects.push(project);
}

function projectHasAssignment(project, employeeId, normalizedRole) {
  return project.team.some(member =>
    sameId(teamMemberEmployeeId(member), employeeId) &&
    normalizeProjectRole(member.role_in_project) === normalizedRole
  );
}

function revertOptimisticAssignment(edge, previousEdge, employeeNode, previousRole) {
  if (previousEdge) {
    Object.assign(edge, previousEdge);
  } else {
    State.canvas.edges = State.canvas.edges.filter(item => item.id !== edge.id);
    world.querySelector(`.canvas-edge-delete[data-edge-id="${edge.id}"]`)?.remove();
  }

  if (previousRole === undefined) delete employeeNode.projectRole;
  else employeeNode.projectRole = previousRole;

  State.emit('canvas:edges:change', State.canvas.edges);
  renderNodes();
  renderEdges();
}

async function deleteCanvasConnection(edgeId) {
  const edge = State.canvas.edges.find(item => item.id === edgeId);
  if (!edge) return;

  const fromNode = State.canvas.nodes.find(node => node.id === edge.fromId);
  const toNode = State.canvas.nodes.find(node => node.id === edge.toId);
  const projectNode = fromNode?.type === 'project' ? fromNode : toNode?.type === 'project' ? toNode : null;
  const employeeNode = fromNode?.type === 'project' ? toNode : fromNode;
  const shouldPersist = Boolean(edge.projectId && edge.employeeId && edge.type !== 'pending');

  try {
    if (shouldPersist) {
      const updatedProject = await unassignFromProject(edge.projectId, edge.employeeId);
      if (updatedProject?.id) {
        const idx = State.projects.findIndex(project => sameId(project.id, updatedProject.id));
        if (idx >= 0) State.projects.splice(idx, 1, updatedProject);
        else State.projects.push(updatedProject);
      }
      await getEmployees({ cache: false }).catch(() => null);
      await getProjects().catch(() => null);
    }

    State.removeCanvasEdge(edgeId);
    world.querySelector(`.canvas-edge-delete[data-edge-id="${edgeId}"]`)?.remove();

    if (employeeNode && !hasProjectConnection(employeeNode.id, edgeId)) {
      delete employeeNode.projectRole;
    }
    normalizeProjectConnectionRoles();

    renderNodes();
    renderEdges();
    initSidePanel();
    State.emit('data:projects:refresh');
    State.emit('data:employees:refresh');
    showToast(projectNode ? 'Project connection removed.' : 'Connection removed.');
  } catch (err) {
    showToast(err.message || 'Could not delete connection.', 'error');
  }
}

async function toggleProjectChildren(projectNode, project = null) {
  if (!projectNode?.projectId) return;
  State.selectNode(projectNode.id);

  const hasVisibleChildren = State.canvas.edges.some(edge =>
    edgeBelongsToProject(edge, projectNode, normId(projectNode.projectId))
  );

  if (projectNode.childrenHidden || !hasVisibleChildren) {
    projectNode.childrenHidden = false;
    const latest = project ||
      State.projects.find(item => sameId(item.id, projectNode.projectId)) ||
      { id: projectNode.projectId };
    await syncProjectTeamToCanvas(latest, projectNode);
    renderNodes();
    renderEdges();
    fitToScreenIfVisible();
    showToast('Project children shown.', 'info', 1800);
    return;
  }

  projectNode.childrenHidden = true;
  hideProjectChildren(projectNode);
  renderNodes();
  renderEdges();
  showToast('Project children hidden.', 'info', 1800);
}

function hideProjectChildren(projectNode) {
  const projectId = normId(projectNode.projectId);
  const removableNodeIds = new Set();
  const removedEdgeIds = new Set();

  State.canvas.edges.forEach(edge => {
    if (!edgeBelongsToProject(edge, projectNode, projectId)) return;
    removedEdgeIds.add(edge.id);
    const employeeNode = getProjectEdgeEmployeeNode(edge);
    if (
      employeeNode &&
      sameId(employeeNode.projectChildOf, projectId) &&
      !hasOtherCanvasConnections(employeeNode.id, projectId)
    ) {
      removableNodeIds.add(employeeNode.id);
    }
  });

  State.canvas.edges = State.canvas.edges.filter(edge => !removedEdgeIds.has(edge.id));
  State.canvas.nodes = State.canvas.nodes.filter(node => !removableNodeIds.has(node.id));
  removableNodeIds.forEach(id => State.canvas.selectedIds.delete(id));
  removedEdgeIds.forEach(id => world?.querySelector(`.canvas-edge-delete[data-edge-id="${id}"]`)?.remove());
  normalizeProjectConnectionRoles();
  State.emit('canvas:nodes:change', State.canvas.nodes);
  State.emit('canvas:edges:change', State.canvas.edges);
}

function getProjectEdgeEmployeeNode(edge) {
  const fromNode = State.canvas.nodes.find(node => node.id === edge.fromId);
  const toNode = State.canvas.nodes.find(node => node.id === edge.toId);
  return fromNode?.type === 'project' ? toNode : fromNode;
}

function hasOtherCanvasConnections(nodeId, projectId) {
  return State.canvas.edges.some(edge => {
    if (edge.fromId !== nodeId && edge.toId !== nodeId) return false;
    return !sameId(edge.projectId, projectId);
  });
}

function hasProjectConnection(employeeNodeId, ignoredEdgeId = null) {
  return State.canvas.edges.some(edge => {
    if (edge.id === ignoredEdgeId) return false;
    if (edge.fromId !== employeeNodeId && edge.toId !== employeeNodeId) return false;
    const otherId = edge.fromId === employeeNodeId ? edge.toId : edge.fromId;
    return State.canvas.nodes.some(node => node.id === otherId && node.type === 'project');
  });
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
  const existing = State.canvas.nodes.find(n => sameId(n.empId, emp.id));
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
  const existing = State.canvas.nodes.find(n => sameId(n.empId, emp.id));
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

async function addProjectNodeToCanvas(proj, x, y) {
  const existing = State.canvas.nodes.find(n => n.type === 'project' && sameId(n.projectId, proj.id));
  if (existing) {
    existing.childrenHidden = false;
    existing.x = x;
    existing.y = y;
    syncNodeEl(existing.id);
    await syncProjectTeamToCanvas(proj, existing);
    notifyMissingProjectRoles([State.projects.find(item => sameId(item.id, proj.id)) || proj], { force: true });
    State.selectNode(existing.id);
    return;
  }
  const node = { id: uid(), type: 'project', projectId: proj.id, x, y };
  State.addCanvasNode(node);
  const latest = await syncProjectTeamToCanvas(proj, node);
  notifyMissingProjectRoles([latest || proj], { force: true });
  State.selectNode(node.id);
}

export async function addProjectTreeToCanvas(proj) {
  if (!proj?.id) return;

  if (!State.employees.length) {
    try { await getEmployees(); } catch {}
  }

  const existingRoot = State.canvas.nodes.find(n => n.type === 'project' && sameId(n.projectId, proj.id));
  if (existingRoot) {
    existingRoot.childrenHidden = false;
    const latest = await syncProjectTeamToCanvas(proj, existingRoot);
    notifyMissingProjectRoles([latest || proj], { force: true });
    State.selectNode(existingRoot.id);
    fitToScreenIfVisible();
    return;
  }

  const treeIndex = State.canvas.nodes.filter(n => n.type === 'project').length;
  const rootX = 80 + treeIndex * 90;
  const rootY = 80 + treeIndex * 70;
  const rowGap = 132;

  const projectNode = {
    id: uid(),
    type: 'project',
    projectId: proj.id,
    childrenHidden: false,
    x: rootX,
    y: rootY + rowGap,
  };
  State.addCanvasNode(projectNode);

  const latest = await syncProjectTeamToCanvas(proj, projectNode);
  notifyMissingProjectRoles([latest || proj], { force: true });
  const team = Array.isArray(latest?.team) ? latest.team : [];
  if (!team.length) {
    showToast('Project node added. Drag employee nodes onto it to connect.');
    renderNodes();
    renderEdges();
    return;
  }

  renderNodes();
  renderEdges();
  fitToScreenIfVisible();
}

async function syncProjectTeamToCanvas(proj, projectNode) {
  if (!proj?.id || !projectNode) return proj;

  let latest = proj;
  try {
    const list = await getProjects({ cache: false });
    latest = list.find(item => sameId(item.id, proj.id)) || proj;
  } catch {
    latest = State.projects.find(item => sameId(item.id, proj.id)) || proj;
  }

  if (latest?.id) {
    const idx = State.projects.findIndex(project => sameId(project.id, latest.id));
    if (idx >= 0) State.projects.splice(idx, 1, latest);
    else State.projects.push(latest);
  }

  const projectId = normId(latest?.id || proj.id);
  const team = (Array.isArray(latest?.team) ? latest.team : [])
    .filter(member => teamMemberEmployeeId(member));
  const teamEmployeeIds = new Set(team.map(teamMemberEmployeeId));

  if (projectNode.childrenHidden) {
    hideProjectChildren(projectNode);
    return latest;
  }

  resetProjectConnectionEdges(projectNode, projectId, teamEmployeeIds);

  const peopleX = projectNode.x + 360;
  const rowGap = 132;
  const startY = projectNode.y + PROJECT_NODE_H / 2 - EMPLOYEE_ORB_R - ((team.length - 1) * rowGap) / 2;

  team.forEach((member, idx) => {
    const employeeId = teamMemberEmployeeId(member);
    const projectRole = normalizeProjectRole(member.role_in_project);
    let employeeNode = findEmployeeNodeForProject(projectId, employeeId);

    employeeNode ||= State.canvas.nodes.find(node => sameId(node.empId, employeeId));
    if (!employeeNode) {
      employeeNode = nodeFromTeamMember(member, peopleX, startY + idx * rowGap, projectRole, projectId);
      State.canvas.nodes.push(employeeNode);
    } else {
      employeeNode.projectRole = projectRole;
      employeeNode.name = member.name || member.employee_name || employeeNode.name;
      employeeNode.role = member.role || employeeNode.role;
      employeeNode.availability = member.availability ?? employeeNode.availability;
    }

    let edge = findProjectEmployeeEdge(projectId, employeeId, projectNode.id, employeeNode.id);

    if (edge) {
      edge.fromId = projectNode.id;
      edge.toId = employeeNode.id;
      edge.type = projectRole;
      edge.label = canvasRoleLabel(projectRole);
      edge.projectId = projectId;
      edge.employeeId = employeeId;
    } else {
      State.canvas.edges.push({
        id: uid(),
        fromId: projectNode.id,
        toId: employeeNode.id,
        type: projectRole,
        label: canvasRoleLabel(projectRole),
        projectId,
        employeeId,
      });
    }
  });

  normalizeProjectConnectionRoles();
  State.emit('canvas:nodes:change', State.canvas.nodes);
  State.emit('canvas:edges:change', State.canvas.edges);
  return latest;
}

function resetProjectConnectionEdges(projectNode, projectId, teamEmployeeIds) {
  const seenAssigned = new Set();
  State.canvas.edges = State.canvas.edges.filter(edge => {
    if (!edgeBelongsToProject(edge, projectNode, projectId)) return true;

    const employeeId = getEdgeEmployeeId(edge);
    const isPending = edge.type === 'pending';
    if (!employeeId) return false;

    if (!teamEmployeeIds.has(employeeId)) {
      return isPending;
    }

    if (seenAssigned.has(employeeId)) {
      world.querySelector(`.canvas-edge-delete[data-edge-id="${edge.id}"]`)?.remove();
      return false;
    }

    seenAssigned.add(employeeId);
    return true;
  });
}

function edgeBelongsToProject(edge, projectNode, projectId) {
  if (sameId(edge.projectId, projectId)) return true;
  return edge.fromId === projectNode.id || edge.toId === projectNode.id;
}

function findEmployeeNodeForProject(projectId, employeeId) {
  const edge = findProjectEmployeeEdge(projectId, employeeId);
  if (!edge) return null;
  const fromNode = State.canvas.nodes.find(node => node.id === edge.fromId);
  const toNode = State.canvas.nodes.find(node => node.id === edge.toId);
  const employeeNode = fromNode?.type === 'project' ? toNode : fromNode;
  return employeeNode?.empId ? employeeNode : null;
}

function normalizeProjectConnectionRoles() {
  State.canvas.nodes.forEach(node => {
    if (!node.empId) return;
    const edge = State.canvas.edges.find(item =>
      (item.fromId === node.id || item.toId === node.id) &&
      isProjectEmployeeEdge(
        item,
        State.canvas.nodes.find(n => n.id === item.fromId) || {},
        State.canvas.nodes.find(n => n.id === item.toId) || {},
      )
    );

    if (edge) node.projectRole = normalizeProjectRole(edge.type || 'pending');
    else delete node.projectRole;
  });
}

function fitToScreenIfVisible() {
  const container = document.getElementById('canvas-view');
  const rect = container?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  fitToScreen();
}

function nodeFromTeamMember(member, x, y, projectRole, projectId) {
  return {
    id: uid(),
    empId: teamMemberEmployeeId(member),
    x,
    y,
    projectRole,
    projectChildOf: projectId,
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
    const proj = State.projects.find(p => sameId(p.id, node.projectId));
    if (proj) State.emit('inspector:open', { type: 'project', data: proj });
    return;
  }
  State.emit('inspector:open', { type: 'employee', data: getEmployeeForNode(node) });
};

window._aiAssignProjectNode = function (nodeId) {
  aiAssignProjectTeam(nodeId);
};

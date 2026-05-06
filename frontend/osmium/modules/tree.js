// ============================================================
// tree.js — Org Tree View (Hierarchy Visualization)
// ============================================================

import { State } from '../utils/state.js';
import { getEmployees, getOrgTree } from './api.js';
import { escHtml, initials, avatarColor, avatarTextColor, emptyState } from '../utils/helpers.js';
import { showToast } from './ui.js';

export function initTree() {
  State.on('view:tree', loadTree);
}

async function loadTree() {
  const container = document.getElementById('tree-view-container');
  if (!container) return;

  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;gap:10px;color:var(--gl-on-surface-4)"><span class="spinner"></span> Building org chart…</div>`;

  try {
    // Get all employees and build a tree client-side from manager_id refs
    const emps = State.employees.length ? State.employees : await getEmployees();
    if (!emps.length) {
      container.innerHTML = emptyState('account_tree', 'No employees', 'Add employees to see the org chart.');
      return;
    }

    const tree = buildTree(emps);

    container.innerHTML = `
      <div style="margin-bottom:20px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--gl-on-surface);letter-spacing:-0.02em">Org Chart</div>
          <div style="font-size:0.8rem;color:var(--gl-on-surface-3);margin-top:2px">${emps.length} employees · click to expand</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="window._expandAllTree()">Expand All</button>
          <button class="btn btn-secondary btn-sm" onclick="window._collapseAllTree()">Collapse All</button>
        </div>
      </div>
      <div id="tree-root" style="overflow-x:auto;padding-bottom:24px">
        ${renderTreeLevel(tree, true)}
      </div>`;
  } catch (e) {
    container.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem">${escHtml(e.message)}</div>`;
  }
}

function buildTree(emps) {
  const map = {};
  emps.forEach(e => { map[e.id] = { ...e, children: [] }; });
  const roots = [];
  emps.forEach(e => {
    if (e.manager_id && map[e.manager_id]) {
      map[e.manager_id].children.push(map[e.id]);
    } else {
      roots.push(map[e.id]);
    }
  });
  return roots;
}

function renderTreeLevel(nodes, isRoot = false) {
  if (!nodes.length) return '';
  return `
    <div style="display:flex;gap:32px;flex-wrap:${isRoot ? 'wrap' : 'nowrap'};align-items:flex-start;${isRoot ? '' : 'padding-left:32px;border-left:2px solid var(--gl-outline-2);margin-left:16px;padding-top:8px;'}">
      ${nodes.map(node => renderTreeNode(node)).join('')}
    </div>`;
}

function renderTreeNode(node) {
  const hasChildren = node.children && node.children.length > 0;
  const bg = avatarColor(node.name);
  const fc = avatarTextColor(node.name);
  const init = initials(node.name);
  const expanded = State.treeExpanded[node.id] !== false; // default expanded
  const avail = node.availability;

  return `
    <div class="tree-node" id="tnode-${node.id}" style="display:flex;flex-direction:column;align-items:flex-start">
      <div class="tree-node-card" onclick="window._toggleTreeNode('${node.id}')"
        style="display:flex;align-items:center;gap:10px;background:var(--gl-surface);border:1px solid var(--gl-outline);
          border-radius:var(--r-md);padding:10px 14px;cursor:pointer;transition:all 0.15s;max-width:240px;
          ${avail ? '' : 'opacity:0.7'}">
        <div style="width:34px;height:34px;border-radius:50%;background:${bg};color:${fc};
          display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;flex-shrink:0">${init}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.83rem;font-weight:600;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(node.name)}</div>
          <div style="font-size:0.7rem;color:var(--gl-on-surface-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(node.role || '—')}</div>
          <div style="display:flex;align-items:center;gap:4px;margin-top:3px">
            <span style="width:6px;height:6px;border-radius:50%;background:${avail ? 'var(--gl-success)' : 'var(--gl-error)'}"></span>
            <span style="font-size:0.65rem;color:var(--gl-on-surface-4)">${escHtml(node.team || '')}</span>
          </div>
        </div>
        ${hasChildren ? `
          <span id="tnode-toggle-${node.id}" style="font-size:14px;color:var(--gl-on-surface-4);transition:transform 0.2s;transform:rotate(${expanded ? 90 : 0}deg)" class="material-symbols-outlined">
            chevron_right
          </span>` : ''}
      </div>
      ${hasChildren ? `
        <div id="tnode-children-${node.id}" style="display:${expanded ? 'block' : 'none'};margin-top:0">
          ${renderTreeLevel(node.children)}
        </div>` : ''}
    </div>`;
}

window._toggleTreeNode = function(id) {
  const children = document.getElementById(`tnode-children-${id}`);
  const toggle   = document.getElementById(`tnode-toggle-${id}`);
  if (!children) return;
  const isOpen = children.style.display !== 'none';
  children.style.display = isOpen ? 'none' : 'block';
  if (toggle) toggle.style.transform = `rotate(${isOpen ? 0 : 90}deg)`;
  State.treeExpanded[id] = !isOpen;
};

window._expandAllTree = function() {
  document.querySelectorAll('[id^="tnode-children-"]').forEach(el => { el.style.display = 'block'; });
  document.querySelectorAll('[id^="tnode-toggle-"]').forEach(el => { el.style.transform = 'rotate(90deg)'; });
};

window._collapseAllTree = function() {
  document.querySelectorAll('[id^="tnode-children-"]').forEach(el => { el.style.display = 'none'; });
  document.querySelectorAll('[id^="tnode-toggle-"]').forEach(el => { el.style.transform = 'rotate(0deg)'; });
};

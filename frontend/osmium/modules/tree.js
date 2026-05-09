// ============================================================
// tree.js — Org Tree View (Horizontal Hierarchy)
// Root managers flow left to right into reports and team members.
// ============================================================

import { State } from '../utils/state.js';
import { getEmployees } from './api.js?v=20260509-2';
import { escHtml, initials, avatarColor, avatarTextColor, emptyState } from '../utils/helpers.js';

export function initTree() {
  State.on('view:tree', loadTree);
  State.on('data:employees:refresh', () => {
    if (State.currentView === 'tree') loadTree();
  });
  State.on('data:projects:refresh', () => {
    if (State.currentView === 'tree') loadTree();
  });
}

async function loadTree() {
  const container = document.getElementById('tree-view-container');
  if (!container) return;

  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;gap:10px;color:var(--gl-on-surface-4)"><span class="spinner"></span> Building org chart...</div>`;

  try {
    const emps = await getEmployees();
    if (!emps.length) {
      container.innerHTML = emptyState('account_tree', 'No employees', 'Add employees to see the org chart.');
      return;
    }

    renderOrgTree(container, buildTree(emps), emps);
  } catch (e) {
    container.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem">${escHtml(e.message)}</div>`;
  }
}

function buildTree(emps) {
  const byId = new Map(emps.map(emp => [emp.id, { ...emp, children: [] }]));
  const hasParent = new Set();

  byId.forEach(node => {
    const parentId = byId.has(node.manager_id) ? node.manager_id : byId.has(node.team_lead_id) ? node.team_lead_id : null;
    if (!parentId || parentId === node.id) return;
    byId.get(parentId).children.push(node);
    hasParent.add(node.id);
  });

  const referencedParents = new Set();
  emps.forEach(emp => {
    if (emp.manager_id) referencedParents.add(emp.manager_id);
    if (emp.team_lead_id) referencedParents.add(emp.team_lead_id);
  });

  const roots = [...byId.values()]
    .filter(node => !hasParent.has(node.id))
    .sort((a, b) => rootRank(a, referencedParents) - rootRank(b, referencedParents) || (a.name || '').localeCompare(b.name || ''));

  const sortChildren = node => {
    node.children.sort((a, b) => childRank(a, node.id) - childRank(b, node.id) || (a.name || '').localeCompare(b.name || ''));
    node.children.forEach(sortChildren);
  };
  roots.forEach(sortChildren);

  return roots;
}

function rootRank(node, referencedParents) {
  if (referencedParents.has(node.id)) return 0;
  if (!node.manager_id && !node.team_lead_id) return 1;
  return 2;
}

function childRank(node, parentId) {
  if (node.manager_id === parentId) return 0;
  if (node.team_lead_id === parentId) return 1;
  return 2;
}

function renderOrgTree(container, roots, emps) {
  container.innerHTML = `
    <div class="org-tree-header">
      <div>
        <div style="font-size:1.4rem;font-weight:700;color:var(--gl-on-surface);letter-spacing:-0.02em">Org Tree</div>
        <div style="font-size:0.8rem;color:var(--gl-on-surface-3);margin-top:2px">${emps.length} employees · ${roots.length} root${roots.length > 1 ? 's' : ''}</div>
      </div>
    </div>
    <div class="org-tree-horizontal">
      ${roots.map(root => renderTreeNode(root, new Set(), 0)).join('')}
    </div>`;
}

function renderTreeNode(node, path, depth) {
  if (path.has(node.id)) return '';
  const nextPath = new Set(path);
  nextPath.add(node.id);

  const children = node.children || [];
  return `
    <div class="org-h-node${children.length ? ' has-children' : ''} depth-${Math.min(depth, 4)}">
      ${renderTreeCard(node, depth, children.length)}
      ${children.length ? `
        <div class="org-h-children">
          ${children.map(child => renderTreeNode(child, nextPath, depth + 1)).join('')}
        </div>` : ''}
    </div>`;
}

function renderTreeCard(node, depth, childCount) {
  const bg = avatarColor(node.name);
  const fc = avatarTextColor(node.name);
  const init = initials(node.name);
  const avail = node.availability;
  const skills = Array.isArray(node.skills) ? node.skills.slice(0, 3) : [];
  const assignment = Array.isArray(node.projects) && node.projects.length ? node.projects[0] : null;
  const accent = ['#5abfe8', '#3dd68c', '#f5a623', '#f5574a', '#b48ae8'][depth % 5];

  return `
    <div class="tree-node-card-h" style="border-left-color:${accent}" onclick="window._editEmployee?.('${node.id}')">
      ${assignment ? `
        <div class="tree-node-assignment" title="${escHtml(`${assignment.project_name || 'Project'} / ${assignment.role_in_project || 'member'}`)}">
          ${escHtml(assignment.project_name || 'Project')} / ${escHtml((assignment.role_in_project || 'member').replace('_', ' '))}
        </div>` : ''}
      <div style="display:flex;align-items:center;gap:9px">
        <div style="width:36px;height:36px;border-radius:50%;background:${bg};color:${fc};display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;flex-shrink:0">${init}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.84rem;font-weight:700;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(node.name || 'Unknown')}</div>
          <div style="font-size:0.68rem;color:var(--gl-on-surface-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(node.role || '—')}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px">
        <span style="width:6px;height:6px;border-radius:50%;background:${avail ? '#3dd68c' : '#f5574a'};flex-shrink:0"></span>
        <span style="font-size:0.65rem;color:var(--gl-on-surface-4)">${escHtml(node.team || '—')}</span>
        ${childCount ? `<span style="margin-left:auto;font-size:0.65rem;color:${accent};font-weight:700">${childCount} report${childCount > 1 ? 's' : ''}</span>` : ''}
      </div>
      ${skills.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:8px">
        ${skills.map(s => `<span style="font-size:10px;padding:1px 6px;border-radius:var(--r-full);background:${accent}18;color:${accent};border:1px solid ${accent}33">${escHtml(typeof s === 'string' ? s : s.skill_name)}</span>`).join('')}
      </div>` : ''}
    </div>`;
}

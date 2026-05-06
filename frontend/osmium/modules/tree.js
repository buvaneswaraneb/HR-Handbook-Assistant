// ============================================================
// tree.js — Org Tree View (Horizontal Row Layout, Static)
// Each row = one hierarchy level. Lines connect parent→child.
// ============================================================

import { State } from '../utils/state.js';
import { getEmployees } from './api.js';
import { escHtml, initials, avatarColor, avatarTextColor, emptyState } from '../utils/helpers.js';

export function initTree() {
  State.on('view:tree', loadTree);
}

async function loadTree() {
  const container = document.getElementById('tree-view-container');
  if (!container) return;

  container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;gap:10px;color:var(--gl-on-surface-4)"><span class="spinner"></span> Building org chart…</div>`;

  try {
    const emps = State.employees.length ? State.employees : await getEmployees();
    if (!emps.length) {
      container.innerHTML = emptyState('account_tree', 'No employees', 'Add employees to see the org chart.');
      return;
    }

    // Build hierarchy levels
    const levels = buildLevels(emps);
    renderOrgTree(container, levels, emps);
  } catch (e) {
    container.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem">${escHtml(e.message)}</div>`;
  }
}

// ─── BUILD LEVEL BUCKETS ──────────────────────────────────────
function buildLevels(emps) {
  const empMap = {};
  emps.forEach(e => { empMap[e.id] = { ...e, children: [] }; });

  // Assign children
  emps.forEach(e => {
    if (e.manager_id && empMap[e.manager_id]) {
      empMap[e.manager_id].children.push(empMap[e.id]);
    }
  });

  // BFS to assign levels
  const levelMap = {};
  const roots = emps.filter(e => !e.manager_id || !empMap[e.manager_id]);

  const queue = roots.map(r => ({ node: empMap[r.id], level: 0 }));
  const visited = new Set();

  while (queue.length) {
    const { node, level } = queue.shift();
    if (visited.has(node.id)) continue;
    visited.add(node.id);

    if (!levelMap[level]) levelMap[level] = [];
    levelMap[level].push(node);

    node.children.forEach(child => {
      queue.push({ node: child, level: level + 1 });
    });
  }

  // Any unvisited nodes (orphans / circular refs) go in last level
  const allVisited = new Set(Object.values(levelMap).flat().map(n => n.id));
  const orphans = emps.filter(e => !allVisited.has(e.id));
  if (orphans.length) {
    const maxLevel = Math.max(...Object.keys(levelMap).map(Number), 0) + 1;
    levelMap[maxLevel] = orphans.map(e => empMap[e.id]);
  }

  return levelMap;
}

// ─── RENDER TREE ──────────────────────────────────────────────
function renderOrgTree(container, levelMap, emps) {
  const levelCount = Object.keys(levelMap).length;
  const levelLabels = ['Executive / CEO', 'Managers', 'Team Leads', 'Team Members', 'Contributor'];

  container.innerHTML = `
    <div style="margin-bottom:24px;display:flex;align-items:center;justify-content:space-between">
      <div>
        <div style="font-size:1.4rem;font-weight:700;color:var(--gl-on-surface);letter-spacing:-0.02em">Org Chart</div>
        <div style="font-size:0.8rem;color:var(--gl-on-surface-3);margin-top:2px">${emps.length} employees · ${levelCount} level${levelCount > 1 ? 's' : ''}</div>
      </div>
    </div>
    <div id="org-tree-rows" style="display:flex;flex-direction:column;gap:0;overflow-x:auto;padding-bottom:32px">
      ${Object.keys(levelMap).sort((a,b)=>+a-+b).map(lvl => {
        const nodes = levelMap[lvl];
        const label = levelLabels[+lvl] || `Level ${+lvl + 1}`;
        return renderLevelRow(+lvl, label, nodes, levelMap);
      }).join('')}
    </div>`;
}

function renderLevelRow(level, label, nodes, levelMap) {
  const isLast = !levelMap[level + 1];
  const levelColors = ['#5abfe8', '#3dd68c', '#f5a623', '#f5574a', '#b48ae8'];
  const accentColor = levelColors[level % levelColors.length];

  const nodeCards = nodes.map(node => renderTreeCard(node, accentColor)).join('');

  return `
    <div class="org-level-row" style="position:relative;display:flex;flex-direction:column;align-items:center">
      <!-- Level label -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;align-self:flex-start;padding-left:8px">
        <div style="width:4px;height:18px;border-radius:2px;background:${accentColor}"></div>
        <span style="font-size:0.68rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${accentColor}">${escHtml(label)}</span>
        <span style="font-size:0.68rem;color:var(--gl-on-surface-4)">${nodes.length} member${nodes.length > 1 ? 's' : ''}</span>
      </div>

      <!-- Node row -->
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px;width:100%;padding:0 8px">
        ${nodeCards}
      </div>

      <!-- Connector line to next level -->
      ${!isLast ? `
        <div style="width:2px;height:32px;background:var(--gl-outline-2);margin:12px 0;position:relative">
          <div style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);width:8px;height:8px;border-radius:50%;background:var(--gl-outline-3)"></div>
        </div>` : '<div style="height:32px"></div>'}
    </div>`;
}

function renderTreeCard(node, accentColor) {
  const bg   = avatarColor(node.name);
  const fc   = avatarTextColor(node.name);
  const init = initials(node.name);
  const avail = node.availability;
  const skills = Array.isArray(node.skills) ? node.skills.slice(0, 3) : [];

  return `
    <div class="tree-node-card-h"
      style="background:var(--gl-surface);border:1px solid var(--gl-outline);border-top:2px solid ${accentColor};border-radius:var(--r-md);padding:12px 14px;min-width:160px;max-width:200px;transition:all 0.15s;cursor:default"
      onmouseenter="this.style.boxShadow='var(--shadow-md)';this.style.borderColor='${accentColor}'"
      onmouseleave="this.style.boxShadow='';this.style.borderColor='var(--gl-outline)';this.style.borderTopColor='${accentColor}'">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="width:34px;height:34px;border-radius:50%;background:${bg};color:${fc};display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;flex-shrink:0">${init}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.82rem;font-weight:700;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(node.name)}</div>
          <div style="font-size:0.68rem;color:var(--gl-on-surface-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(node.role || '—')}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="width:6px;height:6px;border-radius:50%;background:${avail ? '#3dd68c' : '#f5574a'};flex-shrink:0"></span>
        <span style="font-size:0.65rem;color:var(--gl-on-surface-4)">${escHtml(node.team || '—')}</span>
      </div>
      ${skills.length ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:8px">
        ${skills.map(s => `<span style="font-size:10px;padding:1px 6px;border-radius:var(--r-full);background:${accentColor}18;color:${accentColor};border:1px solid ${accentColor}33">${escHtml(typeof s === 'string' ? s : s.skill_name)}</span>`).join('')}
      </div>` : ''}
    </div>`;
}

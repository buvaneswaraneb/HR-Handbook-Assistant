// ============================================================
// tree.js — Org Tree View (Horizontal Hierarchy)
// Root managers flow left to right into reports and team members.
// ============================================================

import { State } from '../utils/state.js';
import { getEmployees } from './api.js?v=20260512-3';
import { escHtml, initials, avatarColor, avatarTextColor, emptyState } from '../utils/helpers.js?v=20260509-3';

export function initTree() {
  State.on('view:tree', loadTree);
  State.on('data:employees:refresh', () => {
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
  const insights = buildOrgInsights(roots, emps);
  container.innerHTML = `
    <div class="org-tree-header">
      <div>
        <div class="org-tree-title">Org Tree</div>
        <div class="org-tree-subtitle">${emps.length} employees / ${roots.length} root${roots.length > 1 ? 's' : ''} / ${insights.assigned} assigned</div>
      </div>
      <div class="org-tree-actions">
        <button class="btn btn-secondary btn-sm" onclick="window._refreshOrgTree?.()">
          <span class="material-symbols-outlined" style="font-size:14px">refresh</span>
          Refresh
        </button>
        <button class="btn btn-primary btn-sm" onclick="window._askOrgAI?.()">
          <span class="material-symbols-outlined" style="font-size:14px">auto_awesome</span>
          Ask AI
        </button>
      </div>
    </div>
    ${renderOrgAiLens(insights)}
    <div class="org-tree-horizontal">
      ${roots.map(root => renderTreeNode(root, new Set(), 0)).join('')}
    </div>`;
}

function buildOrgInsights(roots, emps) {
  const managers = emps.filter(emp => /\bmanager\b/i.test(emp.role || ''));
  const assigned = emps.filter(emp => Array.isArray(emp.projects) && emp.projects.length).length;
  const available = emps.filter(emp => !!emp.availability).length;
  const busy = emps.length - available;
  const teams = new Map();
  emps.forEach(emp => {
    const team = emp.team || 'No team';
    const current = teams.get(team) || { total: 0, available: 0 };
    current.total += 1;
    if (emp.availability) current.available += 1;
    teams.set(team, current);
  });

  const rootLoads = roots
    .map(root => ({ name: root.name || 'Unknown', count: countReports(root) }))
    .sort((a, b) => b.count - a.count);
  const busiestRoot = rootLoads[0] || null;
  const understaffedTeams = [...teams.entries()]
    .map(([name, data]) => ({ name, ...data, busy: data.total - data.available }))
    .filter(team => team.total >= 2 && team.available === 0)
    .sort((a, b) => b.total - a.total);

  const recommendations = [];
  if (understaffedTeams.length) {
    recommendations.push(`${understaffedTeams[0].name} has no available contributors right now.`);
  }
  if (busiestRoot && busiestRoot.count >= 5) {
    recommendations.push(`${busiestRoot.name} carries the widest reporting span with ${busiestRoot.count} reports.`);
  }
  if (available > 0) {
    recommendations.push(`${available} employee${available > 1 ? 's' : ''} can absorb new work.`);
  }
  if (!recommendations.length) {
    recommendations.push('Structure is balanced across the visible teams.');
  }

  const riskLevel = understaffedTeams.length || busy > available ? 'Watch' : 'Stable';
  const score = emps.length ? Math.round((available / emps.length) * 100) : 0;
  return { total: emps.length, managers: managers.length, assigned, available, busy, roots: roots.length, score, riskLevel, recommendations, busiestRoot };
}

function countReports(node) {
  return (node.children || []).reduce((sum, child) => sum + 1 + countReports(child), 0);
}

function renderOrgAiLens(insights) {
  return `
    <div class="org-ai-lens">
      <div class="org-ai-primary">
        <div class="org-ai-mark">
          <span class="material-symbols-outlined">auto_awesome</span>
        </div>
        <div>
          <div class="org-ai-eyebrow">AI Org Lens</div>
          <div class="org-ai-headline">${insights.riskLevel} / ${insights.score}% available capacity</div>
        </div>
      </div>
      <div class="org-ai-metrics">
        ${orgMetric('group', insights.total, 'People')}
        ${orgMetric('supervisor_account', insights.managers, 'Managers')}
        ${orgMetric('work', insights.assigned, 'Assigned')}
        ${orgMetric('person_check', insights.available, 'Available')}
      </div>
      <div class="org-ai-recs">
        ${insights.recommendations.slice(0, 3).map(item => `
          <div class="org-ai-rec">
            <span class="material-symbols-outlined">tips_and_updates</span>
            <span>${escHtml(item)}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function orgMetric(icon, value, label) {
  return `
    <div class="org-ai-metric">
      <span class="material-symbols-outlined">${icon}</span>
      <strong>${escHtml(String(value))}</strong>
      <span>${escHtml(label)}</span>
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
        <div class="org-h-bridge">
          <span>${countReports(node)}</span>
        </div>
        <div class="org-h-children">
          ${children.map(child => renderTreeNode(child, nextPath, depth + 1)).join('')}
        </div>` : ''}
    </div>`;
}

function renderTreeCard(node, depth, childCount) {
  const avail = node.availability;
  const assignment = Array.isArray(node.projects) && node.projects.length ? node.projects[0] : null;
  const accent = [
    'rgb(90, 191, 232)',
    'rgb(61, 214, 140)',
    'rgb(245, 166, 35)',
    'rgb(245, 87, 74)',
    'rgb(180, 138, 232)',
  ][depth % 5];
  const teamLabel = node.team || (childCount ? 'Leadership' : 'Team member');
  const projectLabel = assignment?.project_name || assignment?.project_id || 'Unassigned';
  const avatar = renderNodeAvatar(node);

  return `
    <div class="tree-node-card-h${depth === 0 ? ' is-root' : ''}" style="--node-accent:${accent}" onclick="window._openEmpInspector?.('${node.id}')">
      <div class="tree-node-main">
        ${avatar}
        <div style="flex:1;min-width:0">
          <div class="tree-node-name">${escHtml(node.name || 'Unknown')}</div>
          <div class="tree-node-role">${escHtml(node.role || '-')}</div>
          <div class="tree-node-subline">
            <span class="tree-node-status ${avail ? 'is-available' : 'is-busy'}"><span></span>${avail ? 'Available' : 'Busy'}</span>
            <span class="tree-node-team">${escHtml(teamLabel)}</span>
          </div>
        </div>
      </div>
      <div class="tree-node-details">
        <span class="tree-node-assignment" title="${escHtml(projectLabel)}">
          <span class="material-symbols-outlined">work</span>
          ${escHtml(projectLabel)}
        </span>
      </div>
    </div>`;
}

function renderNodeAvatar(node) {
  const name = node.name || '?';
  const bg = avatarColor(name);
  const fc = avatarTextColor(name);
  if (node.avatar_url) {
    return `
      <div class="tree-node-avatar" style="background:${bg};color:${fc}">
        <img
          src="${escHtml(node.avatar_url)}"
          alt=""
          referrerpolicy="no-referrer"
          onerror="this.remove();this.parentElement.textContent='${escHtml(initials(name))}';"
        >
      </div>`;
  }
  return `<div class="tree-node-avatar" style="background:${bg};color:${fc}">${escHtml(initials(name))}</div>`;
}

window._refreshOrgTree = loadTree;

window._askOrgAI = function() {
  window.switchViewGlobal?.('ai');
  window.setTimeout(() => {
    const input = document.getElementById('ai-input');
    if (!input) return;
    input.value = 'Analyze the current org tree. Highlight overloaded managers, available capacity, and project staffing risks.';
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, 80);
};

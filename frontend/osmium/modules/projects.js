// ============================================================
// projects.js — Projects View
// ============================================================

import { State } from '../utils/state.js';
import { getProjects, createProject, getProjectTeam, assignToProject } from './api.js';
import { escHtml, fmtDate, statusBadge, initials, avatarColor, avatarTextColor, emptyState, skeletonRows } from '../utils/helpers.js';
import { showToast, openModal, closeModal } from './ui.js';
import { addProjectGroup } from './canvas.js';

export function initProjects() {
  State.on('view:projects', loadProjects);
  document.getElementById('add-proj-form')?.addEventListener('submit', e => { e.preventDefault(); submitProject(); });
}

export async function loadProjects() {
  const list = document.getElementById('projects-list');
  if (!list) return;
  list.innerHTML = skeletonRows(4, '80px');

  try {
    const projects = await getProjects();
    if (!projects.length) {
      list.innerHTML = emptyState('folder_off', 'No projects yet', 'Create your first project to get started.');
      return;
    }

    list.innerHTML = projects.map(p => projectRow(p)).join('');
  } catch (e) {
    list.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem">${escHtml(e.message)}</div>`;
  }
}

function projectRow(p) {
  const pct  = p.percent_complete || 0;
  const days = p.days_remaining;
  const daysLabel = days === null ? '—' : days < 0 ? `Overdue ${Math.abs(days)}d` : days === 0 ? 'Due today' : `${days}d left`;
  const isUrgent = days !== null && days <= 3;
  const statusCls = statusBadge(p.status);
  const team = p.team || [];

  return `
    <div class="card" style="padding:18px;margin-bottom:12px;transition:all 0.2s;${isUrgent ? 'border-left:3px solid var(--gl-error)' : ''}">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="width:40px;height:40px;border-radius:var(--r-md);background:var(--gl-primary-muted);
          display:flex;align-items:center;justify-content:center;color:var(--gl-primary);flex-shrink:0">
          <span class="material-symbols-outlined">folder</span>
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <div style="font-size:0.95rem;font-weight:700;color:var(--gl-on-surface)">${escHtml(p.project_name)}</div>
            <span class="badge ${statusCls}">${escHtml(p.status || 'active')}</span>
            ${isUrgent ? '<span class="badge badge-error">Urgent</span>' : ''}
          </div>
          ${p.project_description ? `<div style="font-size:0.78rem;color:var(--gl-on-surface-3);margin-bottom:8px;line-height:1.4">${escHtml(p.project_description.slice(0,120))}${p.project_description.length > 120 ? '…' : ''}</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:0.75rem;color:var(--gl-on-surface-4)">
            ${p.client_name ? `<span><span style="color:var(--gl-on-surface-3)">Client:</span> ${escHtml(p.client_name)}</span>` : ''}
            <span><span style="color:var(--gl-on-surface-3)">End:</span> ${fmtDate(p.end_date)}</span>
            <span style="color:${isUrgent ? 'var(--gl-error)' : 'var(--gl-on-surface-4)'};font-weight:${isUrgent ? 600 : 400}">${daysLabel}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0">
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary btn-sm" onclick="window._openProjInspector('${p.id}')">
              <span class="material-symbols-outlined" style="font-size:14px">info</span>
            </button>
            <button class="btn btn-ghost btn-sm" title="Add to canvas" onclick="window._addProjToCanvas('${p.id}')">
              <span class="material-symbols-outlined" style="font-size:14px">add_box</span>
            </button>
          </div>
          <div style="display:flex;align-items:center;-space-x-2:0">
            ${team.slice(0,4).map(m => {
              const bg = avatarColor(m.name || '?'), fc = avatarTextColor(m.name || '?');
              return `<div title="${escHtml(m.name||'')}" style="width:26px;height:26px;border-radius:50%;background:${bg};color:${fc};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;border:2px solid var(--gl-surface-lowest);margin-left:-6px;first:margin-left:0">${initials(m.name||'?')}</div>`;
            }).join('')}
            ${team.length > 4 ? `<div style="width:26px;height:26px;border-radius:50%;background:var(--gl-surface-highest);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:var(--gl-on-surface-3);border:2px solid var(--gl-surface-lowest);margin-left:-6px">+${team.length-4}</div>` : ''}
          </div>
        </div>
      </div>
      <!-- Progress bar -->
      <div style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:0.7rem;color:var(--gl-on-surface-4)">Progress</span>
          <span style="font-size:0.7rem;font-weight:600;color:var(--gl-on-surface-3)">${pct}%</span>
        </div>
        <div style="height:5px;background:var(--gl-surface-high);border-radius:var(--r-full);overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--gl-primary);border-radius:var(--r-full);transition:width 0.6s"></div>
        </div>
      </div>
    </div>`;
}

async function submitProject() {
  const get = id => document.getElementById(id)?.value?.trim() || null;
  const pct = parseInt(document.getElementById('proj-pct')?.value || '0');

  const body = {
    project_name: get('proj-name'),
    client_name: get('proj-client'),
    client_email: get('proj-client-email'),
    project_description: get('proj-desc'),
    start_date: get('proj-start'),
    end_date: get('proj-end'),
    status: document.getElementById('proj-status')?.value || 'active',
    percent_complete: isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct)),
  };

  if (!body.project_name) { showToast('Project name required.', 'error'); return; }

  const btn = document.getElementById('proj-submit-btn');
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }

  try {
    await createProject(body);
    showToast('Project created!');
    closeModal('add-project-modal');
    loadProjects();
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) { btn.textContent = 'Create Project'; btn.disabled = false; } }
}

window._openProjInspector = async function(projId) {
  const proj = State.projects.find(p => p.id === projId);
  if (proj) State.emit('inspector:open', { type: 'project', data: proj });
};

window._addProjToCanvas = function(projId) {
  const proj = State.projects.find(p => p.id === projId);
  if (proj) { addProjectGroup(proj); showToast('Added project group to canvas'); }
};

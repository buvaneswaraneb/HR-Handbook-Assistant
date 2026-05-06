// ============================================================
// projects.js — Projects View
// ============================================================

import { State } from '../utils/state.js';
import { getEmployees, getProjects, createProject, assignToProject } from './api.js';
import { escHtml, fmtDate, statusBadge, initials, avatarColor, avatarTextColor, emptyState, skeletonRows } from '../utils/helpers.js';
import { showToast, openModal, closeModal } from './ui.js';
import { addProjectGroup } from './canvas.js';

// Tag state
let projSkillTags = [];
let projRoleTags  = [];
let projMemberIds = new Set();

export function initProjects() {
  State.on('view:projects', loadProjects);
  document.getElementById('add-proj-form')?.addEventListener('submit', e => {
    e.preventDefault();
    submitProject();
  });

  // Skill & role tag inputs
  initTagInput('proj-skill-input', 'proj-skill-tags', () => projSkillTags, v => { projSkillTags = v; });
  initTagInput('proj-role-input',  'proj-role-tags',  () => projRoleTags,  v => { projRoleTags  = v; });

  // Member chip selector
  document.getElementById('proj-member-search')?.addEventListener('input', filterMemberSearch);
}

function initTagInput(inputId, tagsId, getArr, setArr) {
  const input = document.getElementById(inputId);
  const tagsEl = document.getElementById(tagsId);
  if (!input || !tagsEl) return;

  const renderTags = () => {
    tagsEl.innerHTML = getArr().map((t, i) =>
      `<span class="skill-tag">${escHtml(t)}<button type="button" onclick="window._removeTag('${inputId}',${i})">×</button></span>`
    ).join('');
  };

  input.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !getArr().includes(val)) {
        setArr([...getArr(), val]);
        renderTags();
      }
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && getArr().length) {
      setArr(getArr().slice(0, -1));
      renderTags();
    }
  });

  window[`_tagRef_${inputId}`] = { getArr, setArr, renderTags };
}

window._removeTag = function(inputId, idx) {
  const ref = window[`_tagRef_${inputId}`];
  if (!ref) return;
  ref.setArr(ref.getArr().filter((_, i) => i !== idx));
  ref.renderTags();
};

async function populateProjDropdowns() {
  try {
    const emps = State.employees.length ? State.employees : await getEmployees();
    const managerSel = document.getElementById('proj-manager');
    const teamLeadSel = document.getElementById('proj-teamlead');
    const memberList  = document.getElementById('proj-member-list');

    const opts = `<option value="">— None —</option>` +
      emps.map(e => `<option value="${e.id}">${escHtml(e.name)} – ${escHtml(e.role || '—')}</option>`).join('');

    if (managerSel) managerSel.innerHTML = opts;
    if (teamLeadSel) teamLeadSel.innerHTML = opts;

    if (memberList) {
      memberList.innerHTML = emps.map(e => {
        const bg = avatarColor(e.name);
        const fc = avatarTextColor(e.name);
        return `
          <label class="member-select-item" data-name="${escHtml((e.name || '').toLowerCase())}">
            <input type="checkbox" value="${e.id}" onchange="window._toggleMember('${e.id}')">
            <div style="width:28px;height:28px;border-radius:50%;background:${bg};color:${fc};display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;flex-shrink:0">${initials(e.name)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:0.82rem;font-weight:600;color:var(--gl-on-surface)">${escHtml(e.name)}</div>
              <div style="font-size:0.68rem;color:var(--gl-on-surface-4)">${escHtml(e.role || '—')}</div>
            </div>
          </label>`;
      }).join('');
    }
  } catch {}
}

window._toggleMember = function(empId) {
  if (projMemberIds.has(empId)) projMemberIds.delete(empId);
  else projMemberIds.add(empId);
};

function filterMemberSearch() {
  const q = document.getElementById('proj-member-search')?.value.toLowerCase() || '';
  document.querySelectorAll('.member-select-item').forEach(el => {
    el.style.display = el.dataset.name?.includes(q) ? '' : 'none';
  });
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

  const requiredSkills = (p.required_skills || []).slice(0, 4).map(s =>
    `<span class="chip" style="font-size:10px;background:#5abfe822;border-color:#5abfe844;color:#5abfe8">${escHtml(s)}</span>`
  ).join('');

  return `
    <div class="card" style="padding:18px;margin-bottom:12px;transition:all 0.2s;${isUrgent ? 'border-left:3px solid #f5574a' : ''}">
      <div style="display:flex;align-items:flex-start;gap:14px">
        <div style="width:40px;height:40px;border-radius:var(--r-md);background:rgba(90,191,232,0.12);
          display:flex;align-items:center;justify-content:center;color:#5abfe8;flex-shrink:0">
          <span class="material-symbols-outlined">folder</span>
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <div style="font-size:0.95rem;font-weight:700;color:var(--gl-on-surface)">${escHtml(p.project_name)}</div>
            <span class="badge ${statusCls}">${escHtml(p.status || 'active')}</span>
            ${isUrgent ? '<span class="badge badge-error">Urgent</span>' : ''}
          </div>
          ${p.project_description ? `<div style="font-size:0.78rem;color:var(--gl-on-surface-3);margin-bottom:8px;line-height:1.4">${escHtml(p.project_description.slice(0,120))}${p.project_description.length > 120 ? '…' : ''}</div>` : ''}
          ${requiredSkills ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${requiredSkills}</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:0.75rem;color:var(--gl-on-surface-4)">
            ${p.client_name ? `<span><span style="color:var(--gl-on-surface-3)">Client:</span> ${escHtml(p.client_name)}</span>` : ''}
            <span><span style="color:var(--gl-on-surface-3)">End:</span> ${fmtDate(p.end_date)}</span>
            <span style="color:${isUrgent ? '#f5574a' : 'var(--gl-on-surface-4)'};font-weight:${isUrgent ? 600 : 400}">${daysLabel}</span>
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
          <div style="display:flex;align-items:center">
            ${team.slice(0,4).map(m => {
              const bg = avatarColor(m.name || '?'), fc = avatarTextColor(m.name || '?');
              return `<div title="${escHtml(m.name||'')}" style="width:26px;height:26px;border-radius:50%;background:${bg};color:${fc};display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;border:2px solid var(--gl-surface-lowest);margin-left:-6px">${initials(m.name||'?')}</div>`;
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
          <div style="height:100%;width:${pct}%;background:#5abfe8;border-radius:var(--r-full);transition:width 0.6s"></div>
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
    required_skills: projSkillTags,
    required_roles: projRoleTags,
    manager_id:   get('proj-manager') || null,
    team_lead_id: get('proj-teamlead') || null,
    member_ids:   [...projMemberIds],
  };

  if (!body.project_name) { showToast('Project name required.', 'error'); return; }

  const btn = document.getElementById('proj-submit-btn');
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }

  try {
    const created = await createProject(body);
    // Assign members if any
    if (body.member_ids.length && created?.id) {
      try {
        await assignToProject(created.id, { member_ids: body.member_ids, manager_id: body.manager_id, team_lead_id: body.team_lead_id });
      } catch {}
    }
    showToast('Project created!');
    closeModal('add-project-modal');
    projSkillTags = [];
    projRoleTags = [];
    projMemberIds = new Set();
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

// Called when project modal opens
window._onAddProjectModalOpen = populateProjDropdowns;

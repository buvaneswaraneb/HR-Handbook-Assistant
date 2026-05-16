// ============================================================
// projects.js — Projects View
// ============================================================

import { State } from '../utils/state.js';
import { getEmployees, getProjects, getProject, createProject, updateProject, deleteProject, suggestProjectRequirements, suggestProjectSummary } from './api.js?v=20260516-railway';
import { escHtml, fmtDate, statusBadge, initials, avatarColor, avatarTextColor, emptyState, skeletonRows } from '../utils/helpers.js?v=20260509-3';
import { showToast, openModal, closeModal } from './ui.js';
import { addProjectTreeToCanvas } from './canvas.js?v=20260516-no-auto-fit';

// Tag state
let projSkillTags = [];
let projRoleTags  = [];
let projMemberIds = new Set();
let allowProjectModalClose = false;
let editingProjectId = null;

function isManagerEmployee(emp) {
  return /\bmanager\b/i.test(String(emp?.role || '').trim());
}

function isAssignableNonManager(emp) {
  return !isManagerEmployee(emp) && !!emp?.availability && !(emp?.projects || []).length;
}

export function initProjects() {
  State.on('view:projects', loadProjects);
  State.on('data:projects:refresh', () => { if (State.currentView === 'projects') loadProjects(); });
  document.getElementById('add-proj-form')?.addEventListener('submit', e => {
    e.preventDefault();
    submitProject();
  });

  // Skill & role tag inputs
  initTagInput('proj-skill-input', 'proj-skill-tags', () => projSkillTags, v => { projSkillTags = v; });
  initTagInput('proj-role-input',  'proj-role-tags',  () => projRoleTags,  v => { projRoleTags  = v; });
  document.getElementById('proj-ai-skills-btn')?.addEventListener('click', () => generateProjectRequirements('skills'));
  document.getElementById('proj-ai-roles-btn')?.addEventListener('click', () => generateProjectRequirements('roles'));
  document.getElementById('proj-ai-summary-btn')?.addEventListener('click', generateProjectSummary);

  // Member chip selector
  document.getElementById('proj-member-search')?.addEventListener('input', filterMemberSearch);
  document.getElementById('proj-manager')?.addEventListener('change', renderAssignmentSummary);
  document.getElementById('proj-teamlead')?.addEventListener('change', renderAssignmentSummary);
}

function initTagInput(inputId, tagsId, getArr, setArr) {
  const input = document.getElementById(inputId);
  const tagsEl = document.getElementById(tagsId);
  if (!input || !tagsEl) return;
  const placeholder = input.getAttribute('placeholder') || '';
  const wrap = input.closest('.skill-tag-wrap');

  const renderTags = () => {
    tagsEl.innerHTML = getArr().map((t, i) =>
      `<span class="skill-tag">${escHtml(t)}<button type="button" onclick="window._removeTag('${inputId}',${i})">×</button></span>`
    ).join('');
    input.placeholder = getArr().length ? '' : placeholder;
    wrap?.classList.toggle('has-tags', getArr().length > 0);
  };

  wrap?.addEventListener('click', e => {
    if (!e.target.closest('.ai-field-btn') && !e.target.closest('.skill-tag button')) input.focus();
  });

  input.addEventListener('focus', () => wrap?.classList.add('is-editing'));
  input.addEventListener('blur', () => {
    if (!input.value.trim()) wrap?.classList.remove('is-editing');
  });

  input.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !getArr().includes(val)) {
        setArr([...getArr(), val]);
        renderTags();
      }
      input.value = '';
      wrap?.classList.add('is-editing');
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

function projectFormHasDraft() {
  if (editingProjectId) return true;
  const value = id => document.getElementById(id)?.value?.trim() || '';
  return !!(
    value('proj-name') ||
    value('proj-client') ||
    value('proj-client-email') ||
    value('proj-start') ||
    value('proj-end') ||
    value('proj-pct') ||
    value('proj-desc') ||
    value('proj-manager') ||
    value('proj-teamlead') ||
    value('proj-member-search') ||
    projSkillTags.length ||
    projRoleTags.length ||
    projMemberIds.size
  );
}

function dismissProjectClosePrompt() {
  document.getElementById('project-close-confirm')?.remove();
}

function showProjectClosePrompt({
  title = 'Close project draft?',
  copy = 'Your project details are still in progress.',
  onClose = null,
} = {}) {
  if (document.getElementById('project-close-confirm')) return;
  const prompt = document.createElement('div');
  prompt.id = 'project-close-confirm';
  prompt.className = 'project-close-confirm';
  prompt.innerHTML = `
    <div class="project-close-card" role="dialog" aria-modal="true" aria-labelledby="project-close-title">
      <div class="project-close-icon">
        <span class="material-symbols-outlined">draft</span>
      </div>
      <div id="project-close-title" class="project-close-title">${escHtml(title)}</div>
      <div class="project-close-copy">${escHtml(copy)}</div>
      <div class="project-close-actions">
        <button type="button" class="btn btn-ghost" id="project-close-resume">Resume</button>
        <button type="button" class="btn btn-primary" id="project-close-discard">Close</button>
      </div>
    </div>`;

  document.body.appendChild(prompt);
  document.getElementById('project-close-resume')?.addEventListener('click', dismissProjectClosePrompt);
  document.getElementById('project-close-discard')?.addEventListener('click', () => {
    dismissProjectClosePrompt();
    if (onClose) {
      onClose();
      return;
    }
    allowProjectModalClose = true;
    closeModal('add-project-modal');
    allowProjectModalClose = false;
    editingProjectId = null;
    resetProjectForm();
  });
}

window._showProjectClosePrompt = showProjectClosePrompt;

window._onAddProjectModalCloseRequest = function() {
  if (allowProjectModalClose || !projectFormHasDraft()) {
    dismissProjectClosePrompt();
    return true;
  }
  showProjectClosePrompt();
  return false;
};

function projectRequirementPayload(target) {
  const value = id => document.getElementById(id)?.value?.trim() || '';
  return {
    target,
    project_name: value('proj-name'),
    client_name: value('proj-client'),
    project_description: value('proj-desc'),
    existing_skills: projSkillTags,
    existing_roles: projRoleTags,
  };
}

function projectSummaryPayload() {
  const value = id => document.getElementById(id)?.value?.trim() || '';
  return {
    project_name: value('proj-name'),
    client_name: value('proj-client'),
    project_description: value('proj-desc'),
    required_skills: projSkillTags,
    required_roles: projRoleTags,
  };
}

function mergeUniqueTags(current, incoming) {
  const seen = new Set(current.map(item => item.toLowerCase()));
  const next = [...current];
  (incoming || []).forEach(item => {
    const clean = String(item || '').trim().replace(/,$/, '');
    if (!clean || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    next.push(clean);
  });
  return next.slice(0, 12);
}

function pulseGeneratedEl(el) {
  el?.classList.add('ai-generated');
  setTimeout(() => el?.classList.remove('ai-generated'), 1200);
}

function pulseGeneratedWrap(wrap) {
  pulseGeneratedEl(wrap);
}

async function generateProjectSummary() {
  const button = document.getElementById('proj-ai-summary-btn');
  const wrap = document.getElementById('proj-desc-wrap');
  const input = document.getElementById('proj-desc');
  const payload = projectSummaryPayload();
  const hasContext = payload.project_name || payload.project_description || payload.client_name || payload.required_skills.length || payload.required_roles.length;
  if (!hasContext) {
    showToast('Add project details before using AI summary.', 'warning');
    document.getElementById('proj-name')?.focus();
    return;
  }

  button?.classList.add('is-loading');
  if (button) button.disabled = true;
  wrap?.classList.add('ai-generating');

  try {
    const data = await suggestProjectSummary(payload);
    if (input && data.summary) {
      input.value = data.summary;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    pulseGeneratedEl(wrap);
    showToast('Project description refined.');
  } catch (e) {
    showToast(`AI summary failed: ${e.message}`, 'error');
  } finally {
    wrap?.classList.remove('ai-generating');
    button?.classList.remove('is-loading');
    if (button) button.disabled = false;
  }
}

async function generateProjectRequirements(target) {
  const button = document.getElementById(target === 'skills' ? 'proj-ai-skills-btn' : 'proj-ai-roles-btn');
  const wrap = document.getElementById(target === 'skills' ? 'proj-skill-wrap' : 'proj-role-wrap');
  const payload = projectRequirementPayload(target);
  const hasContext = payload.project_name || payload.project_description || payload.client_name;
  if (!hasContext) {
    showToast('Add a project name or description before using AI.', 'warning');
    document.getElementById('proj-name')?.focus();
    return;
  }

  button?.classList.add('is-loading');
  if (button) button.disabled = true;
  wrap?.classList.add('ai-generating');

  try {
    const data = await suggestProjectRequirements(payload);
    if (target === 'skills') {
      projSkillTags = mergeUniqueTags(projSkillTags, data.required_skills);
      window['_tagRef_proj-skill-input']?.setArr(projSkillTags);
      window['_tagRef_proj-skill-input']?.renderTags();
    } else {
      projRoleTags = mergeUniqueTags(projRoleTags, data.required_roles);
      window['_tagRef_proj-role-input']?.setArr(projRoleTags);
      window['_tagRef_proj-role-input']?.renderTags();
    }
    pulseGeneratedWrap(wrap);
    showToast(target === 'skills' ? 'Required skills generated.' : 'Roles needed generated.');
  } catch (e) {
    showToast(`AI suggestion failed: ${e.message}`, 'error');
  } finally {
    wrap?.classList.remove('ai-generating');
    button?.classList.remove('is-loading');
    if (button) button.disabled = false;
  }
}

async function populateProjDropdowns() {
  try {
    const emps = await getEmployees({ cache: false });
    const managerSel = document.getElementById('proj-manager');
    const teamLeadSel = document.getElementById('proj-teamlead');
    const memberList  = document.getElementById('proj-member-list');
    const editingProject = editingProjectId ? State.projects.find(p => p.id === editingProjectId) : null;
    const assignedIds = new Set((editingProject?.team || []).map(m => m.employee_id).filter(Boolean));

    const managerOpts = `<option value="">— None —</option>` +
      emps
        .filter(isManagerEmployee)
        .map(e => `<option value="${e.id}">${escHtml(e.name)} – ${escHtml(e.role || '—')}</option>`)
        .join('');

    const contributorOpts = `<option value="">— None —</option>` +
      emps
        .filter(e => !isManagerEmployee(e) && (isAssignableNonManager(e) || assignedIds.has(e.id)))
        .map(e => `<option value="${e.id}">${escHtml(e.name)} – ${escHtml(e.role || '—')}</option>`)
        .join('');

    if (managerSel) {
      managerSel.innerHTML = managerOpts;
      managerSel.title = emps.some(isManagerEmployee) ? '' : 'Create an employee with role Manager first';
    }
    if (teamLeadSel) teamLeadSel.innerHTML = contributorOpts;

    if (memberList) {
      const eligibleMembers = emps.filter(e => !isManagerEmployee(e) && (isAssignableNonManager(e) || assignedIds.has(e.id)));
      memberList.innerHTML = eligibleMembers.length ? eligibleMembers.map(e => {
        const bg = avatarColor(e.name);
        const fc = avatarTextColor(e.name);
        return `
          <label class="member-select-item" data-name="${escHtml((e.name || '').toLowerCase())}">
            <input type="checkbox" value="${e.id}" onchange="window._toggleMember('${e.id}')" ${projMemberIds.has(e.id) ? 'checked' : ''}>
            <div style="width:28px;height:28px;border-radius:50%;background:${bg};color:${fc};display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;flex-shrink:0">${initials(e.name)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:0.82rem;font-weight:600;color:var(--gl-on-surface)">${escHtml(e.name)}</div>
              <div style="font-size:0.68rem;color:var(--gl-on-surface-4)">${escHtml(e.role || '—')}</div>
            </div>
          </label>`;
      }).join('') : `<div style="font-size:0.74rem;color:var(--gl-on-surface-4)">No available contributors right now.</div>`;
    }
    if (!emps.some(isManagerEmployee) && memberList) {
      memberList.insertAdjacentHTML('afterbegin', `
        <div style="font-size:0.74rem;color:var(--gl-warning);margin-bottom:8px">
          No managers available. Add an employee with role Manager to fill the manager field.
        </div>`);
    }
    renderAssignmentSummary();
  } catch {}
}

window._toggleMember = function(empId) {
  if (projMemberIds.has(empId)) projMemberIds.delete(empId);
  else projMemberIds.add(empId);
  renderAssignmentSummary();
};

function employeeName(id) {
  return State.employees.find(e => e.id === id)?.name || 'Selected employee';
}

function renderAssignmentSummary() {
  const el = document.getElementById('proj-assignment-summary');
  if (!el) return;
  const managerId = document.getElementById('proj-manager')?.value || '';
  const leadId = document.getElementById('proj-teamlead')?.value || '';
  const chips = [];
  if (managerId) chips.push(`<span class="chip" style="border-color:#5abfe844;color:#5abfe8">Manager: ${escHtml(employeeName(managerId))}</span>`);
  if (leadId) chips.push(`<span class="chip" style="border-color:#f5a62344;color:#f5a623">Lead: ${escHtml(employeeName(leadId))}</span>`);
  [...projMemberIds].forEach(id => chips.push(`<span class="chip">Member: ${escHtml(employeeName(id))}<button type="button" onclick="window._toggleMember('${id}')" style="margin-left:5px;border:none;background:transparent;color:inherit;cursor:pointer">×</button></span>`));
  el.innerHTML = chips.length ? chips.join('') : '<span style="font-size:0.72rem;color:var(--gl-on-surface-4)">No assignments selected yet.</span>';
}

function filterMemberSearch() {
  const q = document.getElementById('proj-member-search')?.value.toLowerCase() || '';
  document.querySelectorAll('.member-select-item').forEach(el => {
    el.style.display = el.dataset.name?.includes(q) ? '' : 'none';
  });
}

function resetProjectForm() {
  document.getElementById('add-proj-form')?.reset();
  projSkillTags = [];
  projRoleTags = [];
  projMemberIds = new Set();
  window['_tagRef_proj-skill-input']?.renderTags();
  window['_tagRef_proj-role-input']?.renderTags();
  const status = document.getElementById('proj-status');
  const pct = document.getElementById('proj-pct');
  const search = document.getElementById('proj-member-search');
  if (status) status.value = 'active';
  if (pct) pct.value = '';
  if (search) search.value = '';
  const title = document.getElementById('proj-modal-title');
  const submit = document.getElementById('proj-submit-btn');
  if (title) title.textContent = 'New Project';
  if (submit) submit.textContent = 'Create Project';
  document.querySelectorAll('#proj-member-list input[type="checkbox"]').forEach(input => {
    input.checked = false;
  });
  renderAssignmentSummary();
}

function setProjectFormValues(project) {
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  };
  const team = project?.team || [];
  const manager = team.find(m => m.role_in_project === 'manager');
  const lead = team.find(m => m.role_in_project === 'team_lead');
  const members = team.filter(m => !['manager', 'team_lead'].includes(m.role_in_project));

  set('proj-name', project.project_name);
  set('proj-client', project.client_name);
  set('proj-client-email', project.client_email);
  set('proj-desc', project.project_description);
  set('proj-start', project.start_date);
  set('proj-end', project.end_date);
  set('proj-status', project.status || 'active');
  set('proj-pct', project.percent_complete ?? '');
  set('proj-manager', manager?.employee_id || '');
  set('proj-teamlead', lead?.employee_id || '');

  projSkillTags = [...(project.required_skills || [])];
  projRoleTags = [...(project.required_roles || [])];
  projMemberIds = new Set(members.map(m => m.employee_id).filter(Boolean));
  window['_tagRef_proj-skill-input']?.renderTags();
  window['_tagRef_proj-role-input']?.renderTags();
  document.querySelectorAll('#proj-member-list input[type="checkbox"]').forEach(input => {
    input.checked = projMemberIds.has(input.value);
  });

  const title = document.getElementById('proj-modal-title');
  const submit = document.getElementById('proj-submit-btn');
  if (title) title.textContent = 'Edit Project';
  if (submit) submit.textContent = 'Update Project';
  renderAssignmentSummary();
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
    <div class="card" style="padding:18px;margin-bottom:12px;transition:all 0.2s;cursor:pointer;${isUrgent ? 'border-left:3px solid #f5574a' : ''}"
      onclick="window._openProjectInspector('${p.id}')"
      onmouseenter="this.style.transform='translateY(-1px)'"
      onmouseleave="this.style.transform='translateY(0)'">
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
            <button class="btn btn-secondary btn-sm" title="View project details" onclick="event.stopPropagation();window._openProjectInspector('${p.id}')">
              <span class="material-symbols-outlined" style="font-size:14px">info</span>
              Details
            </button>
            <button class="btn btn-ghost btn-sm" title="Edit project" onclick="event.stopPropagation();window._editProject('${p.id}')">
              <span class="material-symbols-outlined" style="font-size:14px">edit</span>
            </button>
            <button class="btn btn-ghost btn-sm" title="Add to canvas" onclick="event.stopPropagation();window._addProjToCanvas('${p.id}')">
              <span class="material-symbols-outlined" style="font-size:14px">add_box</span>
            </button>
            <button class="btn btn-ghost btn-sm" title="Delete project" onclick="event.stopPropagation();window._deleteProject('${p.id}')">
              <span class="material-symbols-outlined" style="font-size:14px;color:var(--gl-error)">delete</span>
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
    team_member_ids: [...projMemberIds],
  };

  if (!body.project_name) { showToast('Project name required.', 'error'); return; }
  if (body.manager_id && body.team_lead_id && body.manager_id === body.team_lead_id) { showToast('Manager and team leader must be separate employees.', 'error'); return; }
  if (body.manager_id && body.team_member_ids.includes(body.manager_id)) { showToast('Manager cannot also be assigned as a team member.', 'error'); return; }
  if (body.team_lead_id && body.team_member_ids.includes(body.team_lead_id)) { showToast('Team leader cannot also be assigned as a team member.', 'error'); return; }

  const btn = document.getElementById('proj-submit-btn');
  if (btn) { btn.textContent = editingProjectId ? 'Updating…' : 'Creating…'; btn.disabled = true; }

  try {
    const saved = editingProjectId
      ? await updateProject(editingProjectId, body)
      : await createProject(body);
    showToast(editingProjectId ? 'Project updated!' : 'Project created!');
    if (saved?.id) {
      const idx = State.projects.findIndex(p => p.id === saved.id);
      if (idx >= 0) State.projects.splice(idx, 1, saved);
      else State.projects.push(saved);
    }
    editingProjectId = null;
    allowProjectModalClose = true;
    closeModal('add-project-modal');
    allowProjectModalClose = false;
    resetProjectForm();
    State.emit('data:projects:refresh');
    State.emit('data:employees:refresh');
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) { btn.textContent = editingProjectId ? 'Update Project' : 'Create Project'; btn.disabled = false; } }
}

window._openProjectInspector = async function(projId) {
  const fallback = State.projects.find(p => p.id === projId) || null;
  const proj = await getProject(projId).catch(() => fallback);
  if (proj) {
    State.emit('inspector:open', { type: 'project', data: proj });
  } else {
    showToast('Project details not found.', 'error');
  }
};

window._editProject = async function(projId) {
  let proj = State.projects.find(p => p.id === projId);
  if (!proj) {
    const projects = await getProjects({ cache: false }).catch(() => []);
    proj = projects.find(p => p.id === projId);
  }
  if (!proj) {
    showToast('Project not found.', 'error');
    return;
  }
  editingProjectId = projId;
  openModal('add-project-modal');
};

window._deleteProject = async function(projId) {
  const proj = State.projects.find(p => p.id === projId);
  const name = proj?.project_name || 'this project';
  if (!confirm(`Delete ${name} permanently?`)) return;
  try {
    await deleteProject(projId);
    showToast('Project deleted.');
    State.set('projects', State.projects.filter(p => p.id !== projId));
    State.emit('data:projects:refresh');
    State.emit('data:employees:refresh');
    if (State.inspectorTarget?.type === 'project' && State.inspectorTarget?.data?.id === projId) {
      State.emit('inspector:close');
    }
  } catch (e) {
    showToast(e.message || 'Could not delete project.', 'error');
  }
};

window._addProjToCanvas = async function(projId) {
  let proj = State.projects.find(p => p.id === projId);
  if (!proj) {
    const projects = await getProjects({ cache: false }).catch(() => []);
    proj = projects.find(p => p.id === projId);
  }
  if (!proj) {
    showToast('Project not found.', 'error');
    return;
  }
  window.switchViewGlobal?.('canvas');
  await addProjectTreeToCanvas(proj);
  showToast('Project added to canvas');
};

// Called when project modal opens
window._onAddProjectModalOpen = async function() {
  let project = editingProjectId ? State.projects.find(p => p.id === editingProjectId) : null;
  if (editingProjectId && !project) {
    const projects = await getProjects({ cache: false }).catch(() => []);
    project = projects.find(p => p.id === editingProjectId);
  }
  resetProjectForm();
  await populateProjDropdowns();
  if (editingProjectId && project) setProjectFormValues(project);
};

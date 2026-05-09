// ============================================================
// employees.js — Employees List/Grid View
// ============================================================

import { State } from '../utils/state.js';
import {
  getEmployees, getEmployee, searchEmployees, createEmployee, updateEmployee, deleteEmployee,
  getProjects, assignToProject, unassignFromProject, resolveLinkedInAvatar
} from './api.js?v=20260509-3';
import { escHtml, ratingStars, avatarMarkup, initials, fmtDate, emptyState, skeletonRows } from '../utils/helpers.js';
import { showToast, openModal, closeModal } from './ui.js';
import { addEmployeeToCanvas } from './canvas.js';

// Structured skill rows: name, level, optional years
let empSkillRows = [{ skill_name: '', skill_level: 3, experience_years_with_skill: null }];
let editingEmployeeId = null;
let suppressEmployeeModalReset = false;
let availableProjects = [];
let editingEmployeeProjects = [];

export function initEmployees() {
  State.on('view:employees', loadEmployees);
  State.on('data:employees:refresh', () => { if (State.currentView === 'employees') loadEmployees(); });
  document.getElementById('emp-search-btn')?.addEventListener('click', doSearch);
  document.getElementById('emp-reset-btn')?.addEventListener('click', resetEmployeeSearch);
  ['emp-search-skill', 'emp-search-team', 'emp-search-avail', 'emp-search-rating'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  });
  document.getElementById('emp-search-avail')?.addEventListener('change', doSearch);
  document.getElementById('add-emp-form')?.addEventListener('submit', e => { e.preventDefault(); submitEmployee(); });
  document.getElementById('new-emp-avatar')?.addEventListener('input', e => updateAvatarPreview(e.target.value));
  document.getElementById('new-emp-role')?.addEventListener('input', () => renderProjectAssignmentSection());
  document.getElementById('new-emp-linkedin')?.addEventListener('input', e => {
    if (_looksLikeDirectImageUrl(e.target.value)) {
      const avatarInput = document.getElementById('new-emp-avatar');
      if (avatarInput && !avatarInput.value.trim()) {
        avatarInput.value = e.target.value.trim();
        updateAvatarPreview(avatarInput.value);
      }
    }
  });

  renderEmpSkillRows();
}

function renderEmpSkillRows() {
  const wrap = document.getElementById('emp-skill-rows');
  if (!wrap) return;
  wrap.innerHTML = empSkillRows.map((row, idx) => `
    <div style="display:grid;grid-template-columns:1fr 110px 110px 32px;gap:8px;align-items:center">
      <input class="input" placeholder="Skill name" value="${escHtml(row.skill_name || '')}" oninput="window._updateEmpSkillRow(${idx}, 'skill_name', this.value)">
      <select class="select" onchange="window._updateEmpSkillRow(${idx}, 'skill_level', this.value)">
        ${[1,2,3,4,5].map(level => `<option value="${level}" ${Number(row.skill_level) === level ? 'selected' : ''}>Level ${level}</option>`).join('')}
      </select>
      <input class="input" type="number" step="0.5" min="0" placeholder="Years" value="${row.experience_years_with_skill ?? ''}" oninput="window._updateEmpSkillRow(${idx}, 'experience_years_with_skill', this.value)">
      <button type="button" class="btn btn-ghost btn-icon btn-sm" title="Remove skill" onclick="window._removeEmpSkillRow(${idx})"><span class="material-symbols-outlined" style="font-size:16px">close</span></button>
    </div>`).join('');
}

window._addEmpSkillRow = function() {
  empSkillRows.push({ skill_name: '', skill_level: 3, experience_years_with_skill: null });
  renderEmpSkillRows();
};

window._updateEmpSkillRow = function(idx, key, value) {
  const row = empSkillRows[idx];
  if (!row) return;
  if (key === 'skill_level') row[key] = parseInt(value || '3', 10);
  else if (key === 'experience_years_with_skill') row[key] = value === '' ? null : parseFloat(value);
  else row[key] = value;
};

window._removeEmpSkillRow = function(idx) {
  empSkillRows = empSkillRows.filter((_, i) => i !== idx);
  if (!empSkillRows.length) empSkillRows.push({ skill_name: '', skill_level: 3, experience_years_with_skill: null });
  renderEmpSkillRows();
};

async function populateProjectOptions() {
  try {
    availableProjects = await getProjects();
  } catch {
    availableProjects = [];
  }
  renderProjectAssignmentSection();
}

function renderAvatar(emp, size = 44) {
  return avatarMarkup(emp.name || '?', emp.avatar_url, { size, shadow: 'var(--shadow-sm)' });
}

function updateAvatarPreview(url) {
  const preview = document.getElementById('new-emp-avatar-preview');
  const img = document.getElementById('new-emp-avatar-preview-img');
  const shell = document.getElementById('new-emp-avatar-preview-shell');
  const text = document.getElementById('new-emp-avatar-preview-text');
  const subtext = document.getElementById('new-emp-avatar-preview-subtext');
  const name = document.getElementById('new-emp-name')?.value?.trim() || '?';
  const fallback = initials(name);
  if (!preview || !img || !shell || !text || !subtext) return;
  if (!url) {
    preview.style.display = 'none';
    img.removeAttribute('src');
    img.style.display = 'none';
    shell.textContent = fallback;
    return;
  }
  preview.style.display = 'flex';
  shell.textContent = fallback;
  text.textContent = 'Loading preview...';
  subtext.textContent = '';
  img.style.display = 'none';
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  img.onload = () => {
    shell.textContent = '';
    img.style.display = 'block';
    text.textContent = 'Profile photo preview';
    subtext.textContent = '';
  };
  img.onerror = () => {
    img.removeAttribute('src');
    img.style.display = 'none';
    shell.textContent = fallback;
    text.textContent = 'Could not preview this image here';
    subtext.textContent = 'You can still use Fetch Profile Photo to copy it into Cloudinary.';
  };
}

function _looksLikeDirectImageUrl(value) {
  try {
    const url = new URL(value.trim());
    return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function renderProjectAssignmentSection() {
  const section = document.getElementById('emp-project-assignment-section');
  const projectSel = document.getElementById('emp-assign-project');
  const roleSel = document.getElementById('emp-assign-role');
  const list = document.getElementById('emp-project-list');
  if (!section || !projectSel || !list || !roleSel) return;

  const currentEmployee = editingEmployeeId
    ? (State.employees.find(emp => emp.id === editingEmployeeId) || null)
    : null;
  const employeeRole = (document.getElementById('new-emp-role')?.value || currentEmployee?.role || '').trim().toLowerCase();
  const isManager = employeeRole === 'manager';
  const hasExistingAssignments = editingEmployeeProjects.length > 0;

  section.style.display = editingEmployeeId ? 'block' : 'none';
  if (!editingEmployeeId) {
    list.innerHTML = '';
    projectSel.innerHTML = '<option value="">Select project</option>';
    return;
  }

  roleSel.innerHTML = isManager
    ? '<option value="manager">Manager</option>'
    : '<option value="team_lead">Team Lead</option><option value="member">Member</option>';

  const visibleProjects = isManager
    ? availableProjects
    : hasExistingAssignments
      ? availableProjects.filter(project => editingEmployeeProjects.some(item => item.project_id === project.id))
      : availableProjects.filter(project => !editingEmployeeProjects.some(item => item.project_id === project.id));

  const options = visibleProjects.map(project => {
    const assigned = editingEmployeeProjects.find(item => item.project_id === project.id);
    const suffix = assigned ? ` (${assigned.role_in_project.replace('_', ' ')})` : '';
    return `<option value="${project.id}">${escHtml(project.project_name)}${escHtml(suffix)}</option>`;
  }).join('');
  projectSel.innerHTML = `<option value="">Select project</option>${options}`;

  const helper = !isManager && hasExistingAssignments
    ? `<div style="font-size:0.74rem;color:var(--gl-on-surface-4);margin-bottom:8px">Non-managers stay on one project at a time.</div>`
    : '';

  list.innerHTML = helper + (editingEmployeeProjects.length
    ? editingEmployeeProjects.map(project => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:var(--gl-surface-high);border:1px solid var(--gl-outline);border-radius:var(--r-md)">
        <div style="min-width:0">
          <div style="font-size:0.82rem;font-weight:600;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(project.project_name || 'Untitled Project')}</div>
          <div style="font-size:0.72rem;color:var(--gl-on-surface-4);text-transform:capitalize">${escHtml((project.role_in_project || 'member').replace('_', ' '))}</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" style="flex-shrink:0" title="Unassign from project" onclick="window._unassignEditingEmployeeFromProject?.('${project.project_id}')">
          <span class="material-symbols-outlined" style="font-size:14px">person_remove</span>
          Unassign
        </button>
      </div>`)
        .join('')
    : `<div style="font-size:0.76rem;color:var(--gl-on-surface-4)">No project assignments yet.</div>`);
}

export async function loadEmployees() {
  const grid = document.getElementById('employees-grid');
  if (!grid) return;
  grid.innerHTML = skeletonRows(6, '120px');

  try {
    const emps = await getEmployees();
    renderEmployeeGrid(emps);
  } catch (e) {
    grid.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem;grid-column:span 3">Failed: ${escHtml(e.message)}</div>`;
  }
}

async function doSearch() {
  const skill = document.getElementById('emp-search-skill')?.value.trim();
  const team  = document.getElementById('emp-search-team')?.value.trim();
  const avail = document.getElementById('emp-search-avail')?.value;
  const rating = document.getElementById('emp-search-rating')?.value;

  const grid = document.getElementById('employees-grid');
  grid.innerHTML = skeletonRows(3, '120px');

  try {
    const results = await searchEmployees({ skill, team, availability: avail, min_rating: rating });
    State.set('employees', results);
    renderEmployeeGrid(results);
  } catch (e) {
    grid.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem;grid-column:span 3">${escHtml(e.message)}</div>`;
  }
}

function resetEmployeeSearch() {
  ['emp-search-skill', 'emp-search-team', 'emp-search-rating'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const avail = document.getElementById('emp-search-avail');
  if (avail) avail.value = '';
  loadEmployees();
}

function renderEmployeeGrid(emps) {
  const grid = document.getElementById('employees-grid');
  if (!grid) return;

  if (!emps.length) {
    grid.innerHTML = `<div style="grid-column:span 3">${emptyState('group_off', 'No employees found', 'Try adjusting your filters.')}</div>`;
    return;
  }

  grid.innerHTML = emps.map(emp => employeeCard(emp)).join('');
}

function employeeCard(emp) {
  const avail = emp.availability;
  const skills = (emp.skills || []).slice(0, 5).map(s =>
    `<span class="chip">${escHtml(typeof s === 'string' ? s : s.skill_name)}</span>`
  ).join('');

  return `
    <div class="card" style="padding:16px;cursor:pointer;transition:all 0.2s"
      onclick="window._openEmpInspector('${emp.id}')"
      onmouseenter="this.style.transform='translateY(-2px)'"
      onmouseleave="this.style.transform='translateY(0)'">
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
        ${renderAvatar(emp, 44)}
        <div style="flex:1;min-width:0">
          <div style="font-size:0.9rem;font-weight:700;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(emp.name || '—')}</div>
          <div style="font-size:0.78rem;color:var(--gl-on-surface-3)">${escHtml(emp.role || '—')}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:5px">
            <span class="badge ${avail ? 'badge-available' : 'badge-unavailable'}" style="font-size:10px">${avail ? '● Available' : '● Busy'}</span>
            <span class="chip" style="font-size:10px">${escHtml(emp.team || 'No team')}</span>
          </div>
        </div>
        ${emp.rating ? `<span style="font-size:0.78rem;color:#f5a623;font-weight:600;flex-shrink:0">★ ${emp.rating}</span>` : ''}
      </div>
      ${skills ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">${skills}</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:auto">
        <button class="btn btn-secondary btn-sm" style="flex:1" onclick="event.stopPropagation();window._openEmpInspector('${emp.id}')">
          <span class="material-symbols-outlined">info</span> Details
        </button>
        <button class="btn btn-ghost btn-icon btn-sm" title="Edit Employee"
          onclick="event.stopPropagation();window._editEmployee('${emp.id}')">
          <span class="material-symbols-outlined" style="font-size:16px">edit</span>
        </button>
        <button class="btn btn-ghost btn-icon btn-sm" title="Delete Employee"
          onclick="event.stopPropagation();window._deleteEmployee('${emp.id}')">
          <span class="material-symbols-outlined" style="font-size:16px;color:var(--gl-error)">delete</span>
        </button>
        <button class="btn btn-ghost btn-icon btn-sm" title="Add to Canvas"
          onclick="event.stopPropagation();window._addToCanvasById('${emp.id}')">
          <span class="material-symbols-outlined" style="font-size:16px">add_box</span>
        </button>
      </div>
    </div>`;
}

async function submitEmployee() {
  const get = id => document.getElementById(id)?.value?.trim() || null;

  const body = {
    name:   get('new-emp-name'),
    email:  get('new-emp-email'),
    role:   get('new-emp-role'),
    team:   get('new-emp-team'),
    avatar_url: get('new-emp-avatar'),
    rating: parseFloat(get('new-emp-rating') || '0') || null,
    total_experience_years: parseFloat(get('new-emp-exp') || '0') || null,
    availability: document.getElementById('new-emp-avail')?.checked ?? true,
    linkedin_url: get('new-emp-linkedin'),
    work_start_time: get('new-emp-start') || null,
    work_end_time:   get('new-emp-end') || null,
    skills: empSkillRows
      .filter(s => s.skill_name?.trim())
      .map(s => ({
        skill_name: s.skill_name.trim(),
        skill_level: Number(s.skill_level) || 3,
        experience_years_with_skill: Number.isFinite(Number(s.experience_years_with_skill)) ? Number(s.experience_years_with_skill) : null,
      })),
  };

  if (!body.name) { showToast('Name is required.', 'error'); return; }
  if (!body.email) { showToast('Email is required.', 'error'); return; }

  const btn = document.getElementById('add-emp-btn');
  if (btn) { btn.textContent = editingEmployeeId ? 'Saving…' : 'Creating…'; btn.disabled = true; }

  try {
    if (editingEmployeeId) {
      await updateEmployee(editingEmployeeId, body);
      showToast('Employee updated!');
    } else {
      await createEmployee(body);
      showToast('Employee created!');
    }
    closeModal('add-employee-modal');
    resetEmployeeForm();
    State.emit('data:employees:refresh');
    State.emit('data:projects:refresh');
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) { btn.textContent = editingEmployeeId ? 'Save Changes' : 'Create Employee'; btn.disabled = false; } }
}

function resetEmployeeForm() {
  editingEmployeeId = null;
  editingEmployeeProjects = [];
  document.getElementById('add-emp-form')?.reset();
  document.getElementById('new-emp-start').value = '09:00';
  document.getElementById('new-emp-end').value = '18:00';
  document.getElementById('new-emp-avail').checked = true;
  document.getElementById('emp-modal-title').textContent = 'Add Employee';
  document.getElementById('add-emp-btn').textContent = 'Create Employee';
  empSkillRows = [{ skill_name: '', skill_level: 3, experience_years_with_skill: null }];
  renderEmpSkillRows();
  updateAvatarPreview('');
  renderProjectAssignmentSection();
}

async function openEditEmployeeModal(empId) {
  const emp = await getEmployee(empId);
  editingEmployeeId = empId;
  document.getElementById('emp-modal-title').textContent = 'Edit Employee';
  document.getElementById('add-emp-btn').textContent = 'Save Changes';
  document.getElementById('new-emp-name').value = emp.name || '';
  document.getElementById('new-emp-email').value = emp.email || '';
  document.getElementById('new-emp-role').value = emp.role || '';
  document.getElementById('new-emp-team').value = emp.team || '';
  document.getElementById('new-emp-rating').value = emp.rating ?? '';
  document.getElementById('new-emp-exp').value = emp.total_experience_years ?? '';
  document.getElementById('new-emp-start').value = emp.work_start_time || '09:00';
  document.getElementById('new-emp-end').value = emp.work_end_time || '18:00';
  document.getElementById('new-emp-linkedin').value = emp.linkedin_url || emp.avatar_url || '';
  document.getElementById('new-emp-avatar').value = emp.avatar_url || '';
  document.getElementById('new-emp-avail').checked = !!emp.availability;
  updateAvatarPreview(emp.avatar_url || '');
  editingEmployeeProjects = emp.projects || [];
  empSkillRows = (emp.skills || []).length
    ? emp.skills.map(s => ({
      skill_name: s.skill_name || '',
      skill_level: s.skill_level || 3,
      experience_years_with_skill: s.experience_years_with_skill ?? null,
    }))
    : [{ skill_name: '', skill_level: 3, experience_years_with_skill: null }];
  renderEmpSkillRows();
  await populateProjectOptions();
  suppressEmployeeModalReset = true;
  openModal('add-employee-modal');
}

async function removeEmployee(empId) {
  const emp = State.employees.find(e => e.id === empId) || await getEmployee(empId).catch(() => null);
  if (!confirm(`Delete ${emp?.name || 'this employee'} permanently?`)) return;
  await deleteEmployee(empId);
  if (State.inspectorTarget?.type === 'employee' && State.inspectorTarget?.data?.id === empId) {
    document.getElementById('inspector-close')?.click();
  }
  showToast('Employee deleted.');
  State.emit('data:employees:refresh');
  State.emit('data:projects:refresh');
}

// ─── GLOBAL HANDLERS ──────────────────────────────────────────
window._openEmpInspector = async function(empId) {
  const emp = State.employees.find(e => e.id === empId) || await getEmployee(empId).catch(() => null);
  if (emp) State.emit('inspector:open', { type: 'employee', data: emp });
};

window._editEmployee = async function(empId) {
  try {
    await openEditEmployeeModal(empId);
  } catch (e) {
    showToast(e.message, 'error');
  }
};

window._deleteEmployee = async function(empId) {
  try {
    await removeEmployee(empId);
  } catch (e) {
    showToast(e.message, 'error');
  }
};

window._addToCanvasById = function(empId) {
  const emp = State.employees.find(e => e.id === empId);
  if (emp) { addEmployeeToCanvas(emp); showToast('Added to canvas'); }
};

window._fillAvatarFromLinkedIn = async function() {
  const linkedinUrl = document.getElementById('new-emp-linkedin')?.value.trim();
  if (!linkedinUrl) {
    showToast('Add a profile photo URL first.', 'error');
    return;
  }
  try {
    const result = await resolveLinkedInAvatar(linkedinUrl);
    const avatarInput = document.getElementById('new-emp-avatar');
    if (avatarInput) avatarInput.value = result.avatar_url || '';
    updateAvatarPreview(result.avatar_url || '');
    showToast('Profile image applied.');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

window._assignEditingEmployeeToProject = async function() {
  if (!editingEmployeeId) return;
  const projectId = document.getElementById('emp-assign-project')?.value;
  const role = document.getElementById('emp-assign-role')?.value || 'member';
  if (!projectId) {
    showToast('Select a project first.', 'error');
    return;
  }

  try {
    await assignToProject(projectId, { employee_id: editingEmployeeId, role_in_project: role });
    const project = availableProjects.find(item => item.id === projectId);
    const existingIndex = editingEmployeeProjects.findIndex(item => item.project_id === projectId);
    const assignment = {
      project_id: projectId,
      project_name: project?.project_name || 'Untitled Project',
      role_in_project: role,
    };
    if (existingIndex >= 0) editingEmployeeProjects.splice(existingIndex, 1, assignment);
    else editingEmployeeProjects.push(assignment);
    if ((document.getElementById('new-emp-role')?.value || '').trim().toLowerCase() !== 'manager') {
      document.getElementById('new-emp-avail').checked = false;
    }
    renderProjectAssignmentSection();
    showToast('Employee assigned to project.');
    State.emit('data:employees:refresh');
    State.emit('data:projects:refresh');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

window._unassignEditingEmployeeFromProject = async function(projectId) {
  if (!editingEmployeeId || !projectId) return;
  const project = editingEmployeeProjects.find(item => item.project_id === projectId);
  const projectName = project?.project_name || 'this project';
  if (!confirm(`Unassign this employee from ${projectName}?`)) return;

  try {
    await unassignFromProject(projectId, editingEmployeeId);
    editingEmployeeProjects = editingEmployeeProjects.filter(item => item.project_id !== projectId);
    document.getElementById('new-emp-avail').checked = true;
    await populateProjectOptions();
    renderProjectAssignmentSection();
    showToast('Employee unassigned from project.');
    State.emit('data:employees:refresh');
    State.emit('data:projects:refresh');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

window._onAddEmployeeModalOpen = function() {
  if (suppressEmployeeModalReset) {
    suppressEmployeeModalReset = false;
    return;
  }
  resetEmployeeForm();
  populateProjectOptions();
};

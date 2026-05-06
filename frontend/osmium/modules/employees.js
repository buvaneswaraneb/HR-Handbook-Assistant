// ============================================================
// employees.js — Employees List/Grid View
// ============================================================

import { State } from '../utils/state.js';
import { getEmployees, searchEmployees, createEmployee } from './api.js';
import { escHtml, ratingStars, initials, avatarColor, avatarTextColor, fmtDate, emptyState, skeletonRows } from '../utils/helpers.js';
import { showToast, openModal, closeModal } from './ui.js';
import { addEmployeeToCanvas } from './canvas.js';

// Tag input state for skills
let empSkillTags = [];

export function initEmployees() {
  State.on('view:employees', loadEmployees);
  State.on('data:employees:refresh', () => { if (State.currentView === 'employees') loadEmployees(); });
  document.getElementById('emp-search-btn')?.addEventListener('click', doSearch);
  document.getElementById('emp-reset-btn')?.addEventListener('click', loadEmployees);
  document.getElementById('emp-search-skill')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  document.getElementById('add-emp-form')?.addEventListener('submit', e => { e.preventDefault(); submitEmployee(); });

  // Skills tag input
  initSkillTagInput('emp-skill-input', 'emp-skill-tags', () => empSkillTags, v => { empSkillTags = v; });

  // Populate manager / team lead dropdowns when modal opens
  document.querySelector('[onclick*="add-employee-modal"]')?.addEventListener('click', populateEmpDropdowns);
}

function initSkillTagInput(inputId, tagsId, getArr, setArr) {
  const input = document.getElementById(inputId);
  const tagsEl = document.getElementById(tagsId);
  if (!input || !tagsEl) return;

  const renderTags = () => {
    tagsEl.innerHTML = getArr().map((t, i) =>
      `<span class="skill-tag">${escHtml(t)}<button type="button" onclick="this.parentElement.remove();window._removeSkillTag('${inputId}',${i})">×</button></span>`
    ).join('');
  };

  window[`_removeSkillTag_${inputId}`] = (idx) => {
    setArr(getArr().filter((_, i) => i !== idx));
    renderTags();
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
}

export async function populateEmpDropdowns() {
  try {
    const emps = State.employees.length ? State.employees : await getEmployees();
    const managerSel = document.getElementById('new-emp-manager');
    const teamLeadSel = document.getElementById('new-emp-teamlead');
    const opts = `<option value="">— None —</option>` +
      emps.map(e => `<option value="${e.id}">${escHtml(e.name)} (${escHtml(e.role || '—')})</option>`).join('');
    if (managerSel) managerSel.innerHTML = opts;
    if (teamLeadSel) teamLeadSel.innerHTML = opts;
  } catch {}
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
    renderEmployeeGrid(results);
  } catch (e) {
    grid.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem;grid-column:span 3">${escHtml(e.message)}</div>`;
  }
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
  const bg   = avatarColor(emp.name);
  const fc   = avatarTextColor(emp.name);
  const init = initials(emp.name);
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
        <div style="width:44px;height:44px;border-radius:50%;background:${bg};color:${fc};
          display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;
          flex-shrink:0;box-shadow:var(--shadow-sm)">${init}</div>
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
    rating: parseFloat(get('new-emp-rating') || '0') || null,
    total_experience_years: parseFloat(get('new-emp-exp') || '0') || null,
    availability: document.getElementById('new-emp-avail')?.checked ?? true,
    linkedin_url: get('new-emp-linkedin'),
    work_start_time: get('new-emp-start') || null,
    work_end_time:   get('new-emp-end') || null,
    manager_id:   get('new-emp-manager') || null,
    team_lead_id: get('new-emp-teamlead') || null,
    skills: empSkillTags,
  };

  if (!body.name) { showToast('Name is required.', 'error'); return; }

  const btn = document.getElementById('add-emp-btn');
  if (btn) { btn.textContent = 'Creating…'; btn.disabled = true; }

  try {
    await createEmployee(body);
    showToast('Employee created!');
    closeModal('add-employee-modal');
    empSkillTags = [];
    document.getElementById('emp-skill-tags').innerHTML = '';
    loadEmployees();
    State.emit('data:employees:refresh');
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) { btn.textContent = 'Create Employee'; btn.disabled = false; } }
}

// ─── GLOBAL HANDLERS ──────────────────────────────────────────
window._openEmpInspector = async function(empId) {
  const emp = State.employees.find(e => e.id === empId);
  if (emp) State.emit('inspector:open', { type: 'employee', data: emp });
};

window._addToCanvasById = function(empId) {
  const emp = State.employees.find(e => e.id === empId);
  if (emp) { addEmployeeToCanvas(emp); showToast('Added to canvas'); }
};

window._removeSkillTag = function(inputId, idx) {
  empSkillTags = empSkillTags.filter((_, i) => i !== idx);
  const tagsEl = document.getElementById('emp-skill-tags');
  if (tagsEl) tagsEl.innerHTML = empSkillTags.map((t, i) =>
    `<span class="skill-tag">${escHtml(t)}<button type="button" onclick="window._removeSkillTag('emp-skill-input',${i})">×</button></span>`
  ).join('');
};

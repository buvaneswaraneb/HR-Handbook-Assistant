// ============================================================
// inspector.js — Right-side Inspector Panel
// Shows full employee/project details + inline edit
// ============================================================

import { State } from '../utils/state.js';
import { escHtml, fmtDate, ratingStars, initials, avatarColor, avatarTextColor, statusBadge } from '../utils/helpers.js';
import { showToast } from './ui.js';
import { patchAvailability, addSkill } from './api.js';

let panel, body;

export function initInspector() {
  panel = document.getElementById('inspector');
  body  = document.getElementById('inspector-body');

  document.getElementById('inspector-close')?.addEventListener('click', closeInspector);

  State.on('inspector:open', ({ type, data }) => {
    State.set('inspectorOpen', true);
    State.set('inspectorTarget', { type, data });
    panel.classList.add('open');
    if (type === 'employee') renderEmployee(data);
    if (type === 'project')  renderProject(data);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && State.inspectorOpen) closeInspector();
  });
}

function closeInspector() {
  panel.classList.remove('open');
  State.set('inspectorOpen', false);
}

// ─── EMPLOYEE INSPECTOR ───────────────────────────────────────
function renderEmployee(emp) {
  const bg   = avatarColor(emp.name);
  const fc   = avatarTextColor(emp.name);
  const init = initials(emp.name);
  const avail = emp.availability;

  body.innerHTML = `
    <!-- Avatar + name -->
    <div style="text-align:center;padding:8px 0 20px">
      <div style="width:64px;height:64px;border-radius:50%;background:${bg};color:${fc};
        display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;
        margin:0 auto 12px;box-shadow:var(--shadow-md)">${init}</div>
      <div style="font-size:1rem;font-weight:700;color:var(--gl-on-surface)">${escHtml(emp.name || '—')}</div>
      <div style="font-size:0.82rem;color:var(--gl-on-surface-3);margin-top:2px">${escHtml(emp.role || '—')}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;flex-wrap:wrap">
        <span class="badge ${avail ? 'badge-available' : 'badge-unavailable'}" id="avail-badge">
          ${avail ? '● Available' : '● Busy'}
        </span>
        <span class="chip">${escHtml(emp.team || 'No team')}</span>
        ${emp.rating ? `<span style="font-size:0.8rem;color:var(--gl-tertiary)">★ ${emp.rating}</span>` : ''}
      </div>
    </div>

    <!-- Quick info -->
    <div class="inspector-section">
      <div class="inspector-section-title">Details</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${infoCell('Email', emp.email || '—')}
        ${infoCell('Experience', emp.total_experience_years ? emp.total_experience_years + ' yrs' : '—')}
        ${infoCell('Started', fmtDate(emp.project_joined_date))}
        ${infoCell('Ends', fmtDate(emp.project_end_date))}
        ${infoCell('Hours', emp.work_start_time ? `${emp.work_start_time} – ${emp.work_end_time}` : '—')}
        ${emp.linkedin_url ? `<div style="grid-column:span 2"><a href="${escHtml(emp.linkedin_url)}" target="_blank" style="font-size:0.78rem;color:var(--gl-primary)">LinkedIn Profile ↗</a></div>` : ''}
      </div>
    </div>

    <!-- Availability toggle -->
    <div class="inspector-section">
      <div class="inspector-section-title">Availability</div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0">
        <span style="font-size:0.83rem;color:var(--gl-on-surface-2)">Mark as available</span>
        <label class="toggle">
          <input type="checkbox" id="avail-toggle" ${avail ? 'checked' : ''} onchange="window._toggleAvail('${emp.id}', this.checked)">
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
      </div>
    </div>

    <!-- Skills -->
    <div class="inspector-section">
      <div class="inspector-section-title">Skills</div>
      ${(emp.skills || []).length ? (emp.skills.map(s => `
        <div class="skill-bar-wrap">
          <span class="skill-bar-label truncate" title="${escHtml(s.skill_name)}">${escHtml(s.skill_name)}</span>
          <div class="skill-bar-track"><div class="skill-bar-fill-el" style="width:${(s.skill_level / 5) * 100}%"></div></div>
          <span class="skill-bar-val">${s.skill_level}/5</span>
        </div>`).join(''))
      : '<div style="color:var(--gl-on-surface-4);font-size:0.8rem">No skills listed.</div>'}

      <!-- Add skill inline -->
      <div style="margin-top:12px">
        <div style="display:flex;gap:6px">
          <input id="new-skill-name" class="input" style="flex:1" placeholder="Skill name">
          <input id="new-skill-level" class="input" style="width:52px" type="number" min="1" max="5" placeholder="1–5">
          <button class="btn btn-primary btn-sm" onclick="window._addSkill('${emp.id}')">+</button>
        </div>
      </div>
    </div>

    <!-- Experience -->
    <div class="inspector-section">
      <div class="inspector-section-title">Experience</div>
      ${(emp.experience || []).length
        ? emp.experience.map(ex => `
          <div style="margin-bottom:10px;padding:10px;background:var(--gl-surface-high);border-radius:var(--r-md);border:1px solid var(--gl-outline)">
            <div style="font-size:0.83rem;font-weight:600;color:var(--gl-on-surface)">${escHtml(ex.job_title || '—')}</div>
            <div style="font-size:0.75rem;color:var(--gl-on-surface-3)">${escHtml(ex.company_name || '—')} · ${fmtDate(ex.start_date)} – ${fmtDate(ex.end_date)}</div>
            ${ex.description ? `<div style="font-size:0.75rem;color:var(--gl-on-surface-4);margin-top:4px">${escHtml(ex.description)}</div>` : ''}
          </div>`).join('')
        : '<div style="color:var(--gl-on-surface-4);font-size:0.8rem">No experience entries.</div>'}
    </div>

    <!-- Assigned projects -->
    ${(emp.projects || []).length ? `
    <div class="inspector-section">
      <div class="inspector-section-title">Projects</div>
      ${emp.projects.map(p => `
        <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--gl-outline)">
          <span class="material-symbols-outlined" style="font-size:16px;color:var(--gl-primary)">folder</span>
          <span style="font-size:0.82rem;color:var(--gl-on-surface-2)">${escHtml(p.project_name || p)}</span>
        </div>`).join('')}
    </div>` : ''}`;
}

// ─── PROJECT INSPECTOR ────────────────────────────────────────
function renderProject(proj) {
  const pct = proj.percent_complete || 0;
  const days = proj.days_remaining;
  const daysLabel = days === null ? '—' : days < 0 ? `Overdue ${Math.abs(days)}d` : days === 0 ? 'Due today' : `${days}d left`;

  body.innerHTML = `
    <div style="padding:8px 0 20px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:40px;height:40px;border-radius:var(--r-md);background:var(--gl-primary-muted);
          display:flex;align-items:center;justify-content:center;color:var(--gl-primary)">
          <span class="material-symbols-outlined">folder</span>
        </div>
        <div>
          <div style="font-size:1rem;font-weight:700;color:var(--gl-on-surface)">${escHtml(proj.project_name)}</div>
          <span class="badge ${statusBadge(proj.status)}">${escHtml(proj.status || 'active')}</span>
        </div>
      </div>
      ${proj.project_description ? `<div style="font-size:0.82rem;color:var(--gl-on-surface-3);line-height:1.5">${escHtml(proj.project_description)}</div>` : ''}
    </div>

    <div class="inspector-section">
      <div class="inspector-section-title">Progress</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:0.78rem;color:var(--gl-on-surface-3)">Completion</span>
        <span style="font-size:0.78rem;font-weight:600;color:var(--gl-on-surface)">${pct}%</span>
      </div>
      <div style="height:8px;background:var(--gl-surface-high);border-radius:var(--r-full);overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--gl-primary);border-radius:var(--r-full);transition:width 0.6s var(--ease-out)"></div>
      </div>
    </div>

    <div class="inspector-section">
      <div class="inspector-section-title">Timeline</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${infoCell('Start', fmtDate(proj.start_date))}
        ${infoCell('End', fmtDate(proj.end_date))}
        ${infoCell('Deadline', daysLabel)}
        ${infoCell('Client', proj.client_name || '—')}
        ${proj.client_email ? infoCell('Client Email', proj.client_email) : ''}
      </div>
    </div>

    ${(proj.team || []).length ? `
    <div class="inspector-section">
      <div class="inspector-section-title">Team (${proj.team.length})</div>
      ${proj.team.map(m => {
        const bg = avatarColor(m.name || '?');
        const fc = avatarTextColor(m.name || '?');
        return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--gl-outline)">
          <div style="width:28px;height:28px;border-radius:50%;background:${bg};color:${fc};
            display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;flex-shrink:0">
            ${initials(m.name || '?')}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:0.82rem;font-weight:600;color:var(--gl-on-surface) truncate">${escHtml(m.name || '—')}</div>
            <div style="font-size:0.72rem;color:var(--gl-on-surface-4)">${escHtml(m.role_in_project || m.role || '—')}</div>
          </div>
          <span class="badge ${m.availability ? 'badge-available' : 'badge-unavailable'}" style="font-size:9px">
            ${m.availability ? '●' : '●'}
          </span>
        </div>`;
      }).join('')}
    </div>` : ''}`;
}

// ─── HELPERS ──────────────────────────────────────────────────
function infoCell(label, value) {
  return `<div>
    <div style="font-size:0.68rem;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--gl-on-surface-4);margin-bottom:2px">${label}</div>
    <div style="font-size:0.82rem;color:var(--gl-on-surface-2)">${escHtml(value)}</div>
  </div>`;
}

// ─── GLOBAL HANDLERS ──────────────────────────────────────────
window._toggleAvail = async function(empId, val) {
  try {
    await patchAvailability(empId, val);
    const badge = document.getElementById('avail-badge');
    if (badge) {
      badge.className = 'badge ' + (val ? 'badge-available' : 'badge-unavailable');
      badge.textContent = val ? '● Available' : '● Busy';
    }
    showToast(`Availability updated`);
    State.emit('data:employees:refresh');
  } catch (e) {
    showToast(e.message, 'error');
  }
};

window._addSkill = async function(empId) {
  const name  = document.getElementById('new-skill-name')?.value.trim();
  const level = parseInt(document.getElementById('new-skill-level')?.value || '3');
  if (!name) { showToast('Skill name required', 'error'); return; }
  try {
    await addSkill(empId, { skill_name: name, skill_level: level });
    showToast('Skill added!');
    document.getElementById('new-skill-name').value = '';
    document.getElementById('new-skill-level').value = '';
    State.emit('data:employees:refresh');
  } catch (e) { showToast(e.message, 'error'); }
};

// ============================================================
// dashboard.js — Dashboard View
// Analytics · Calendar Placeholder · Deadlines
// ============================================================

import { State } from '../utils/state.js';
import { getAnalytics, getProjects } from './api.js';
import { escHtml, fmtDate } from '../utils/helpers.js';

// ─── INIT ─────────────────────────────────────────────────────
export function initDashboard() {
  State.on('view:dashboard', loadDashboard);
}

export async function loadDashboard() {
  await Promise.all([loadAnalytics(), loadDeadlines(), loadCalendarWidget()]);
}

// ─── ANALYTICS ────────────────────────────────────────────────
async function loadAnalytics() {
  try {
    const data = await getAnalytics();
    animateCount('metric-employees', data.total_employees ?? 0);
    animateCount('metric-projects',  data.total_projects ?? data.active_projects ?? 0);
    animateCount('metric-assignments', data.active_assignments ?? data.assignments ?? data.assigned_employees ?? 0);
    animateCount('metric-available', data.available ?? 0);
    animateCount('metric-on-leave',  data.on_leave ?? 0);

    const pct = data.total_employees > 0
      ? Math.round((data.available / data.total_employees) * 100)
      : 0;
    const el = document.getElementById('metric-available-pct');
    if (el) el.textContent = pct + '% of total';

  } catch {
    ['metric-employees','metric-projects','metric-assignments','metric-available','metric-on-leave']
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  }
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = target;
}

// ─── DEADLINES ────────────────────────────────────────────────
async function loadDeadlines() {
  const el = document.getElementById('deadlines-list');
  if (!el) return;

  try {
    const projects = await getProjects();
    const sorted = projects
      .filter(p => p.days_remaining !== null && !['completed','cancelled'].includes(p.status))
      .sort((a, b) => a.days_remaining - b.days_remaining)
      .slice(0, 5);

    if (!sorted.length) {
      el.innerHTML = `<div style="color:var(--gl-on-surface-4);font-size:0.82rem">No upcoming deadlines.</div>`;
      return;
    }

    el.innerHTML = sorted.map(p => {
      const days = p.days_remaining;
      const label = days < 0 ? `Overdue ${Math.abs(days)}d`
                  : days === 0 ? 'Due today'
                  : `Due in ${days}d`;
      const pct = p.percent_complete || 0;
      const isUrgent = days <= 3;
      const isWarn   = days <= 7 && days > 3;

      return `
        <div style="padding:10px 12px;border-radius:var(--r-md);background:var(--gl-surface-high);
          border-left:3px solid ${isUrgent ? '#f5574a' : isWarn ? '#f5a623' : 'var(--gl-outline-2)'};
          cursor:pointer;transition:all 0.15s;margin-bottom:6px"
          onclick="window.switchViewGlobal('projects')"
          onmouseenter="this.style.background='var(--gl-surface-highest)'"
          onmouseleave="this.style.background='var(--gl-surface-high)'">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div style="font-size:0.82rem;font-weight:600;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:65%">${escHtml(p.project_name)}</div>
            <span style="font-size:0.72rem;color:${isUrgent ? '#f5574a' : isWarn ? '#f5a623' : 'var(--gl-on-surface-4)'}; font-weight:600;flex-shrink:0">${label}</span>
          </div>
          <div style="height:4px;background:var(--gl-surface-bright);border-radius:var(--r-full);overflow:hidden">
            <div style="height:100%;width:${pct}%;background:#5abfe8;border-radius:var(--r-full)"></div>
          </div>
          <div style="font-size:0.7rem;color:var(--gl-on-surface-4);margin-top:4px">${pct}% complete</div>
        </div>`;
    }).join('');
  } catch {
    el.innerHTML = `<div style="color:var(--gl-on-surface-4);font-size:0.82rem">Could not load deadlines.</div>`;
  }
}

// ─── GOOGLE CALENDAR PLACEHOLDER ─────────────────────────────
async function loadCalendarWidget() {
  const el = document.getElementById('calendar-widget');
  if (!el) return;

  const today = new Date();
  const dateHeader = document.getElementById('calendar-date-header');
  if (dateHeader) {
    dateHeader.textContent = today.toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  el.innerHTML = `
    <div style="padding:18px;text-align:center;color:var(--gl-on-surface-4)">
      <span class="material-symbols-outlined" style="font-size:30px;display:block;margin-bottom:8px;color:#4285f4">calendar_month</span>
      <div style="font-size:0.86rem;font-weight:700;color:var(--gl-on-surface);margin-bottom:4px">Google Calendar Sync</div>
      <div style="font-size:0.76rem;margin-bottom:12px">Coming Soon</div>
      <button class="btn btn-secondary btn-sm" disabled style="opacity:0.55;cursor:not-allowed">
        <span class="material-symbols-outlined" style="font-size:14px">sync_disabled</span>
        Connect Calendar
      </button>
    </div>`;
}

window._syncCalendar = function() {
  import('./ui.js').then(({ showToast }) => showToast('Google Calendar Sync is coming soon.'));
};

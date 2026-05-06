// ============================================================
// dashboard.js — Dashboard View
// Analytics · Google Calendar · Skill Coverage · Deadlines
// ============================================================

import { State } from '../utils/state.js';
import { getAnalytics, getProjects, getCalendarEvents, syncGoogleCalendar } from './api.js';
import { escHtml, fmtDate, daysUntil, urgencyBorderClass, relTime, eventIcon, deptColor, emptyState } from '../utils/helpers.js';

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
    animateCount('metric-projects',  data.active_projects ?? 0);
    animateCount('metric-available', data.available ?? 0);
    animateCount('metric-on-leave',  data.on_leave ?? 0);

    const pct = data.total_employees > 0
      ? Math.round((data.available / data.total_employees) * 100)
      : 0;
    const el = document.getElementById('metric-available-pct');
    if (el) el.textContent = pct + '% of total';

    // Render skill coverage in the lower section (replaces activity feed)
    renderSkillChart(data.skill_coverage || []);
  } catch {
    ['metric-employees','metric-projects','metric-available','metric-on-leave']
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  }
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = target;
}

function renderSkillChart(coverage) {
  const container = document.getElementById('skill-chart');
  if (!container) return;
  if (!coverage.length) {
    container.innerHTML = `<div style="color:var(--gl-on-surface-4);font-size:0.82rem;text-align:center;padding:32px 0">No skill coverage data yet.<br><span style="font-size:0.72rem">Add employees with skills to see coverage.</span></div>`;
    return;
  }

  const maxVal = Math.max(...coverage.map(s => Math.max(s.required, s.actual)), 1);
  let gaps = [];
  let html = '';

  coverage.forEach(s => {
    const reqPct = Math.round((s.required / maxVal) * 100);
    const actPct = Math.round((s.actual   / maxVal) * 100);
    const gap = s.actual < s.required;
    if (gap) gaps.push(s.skill_name);

    html += `
      <div style="display:flex;flex-direction:column;align-items:center;gap:5px;flex:1;min-width:48px"
           title="${escHtml(s.skill_name)}: Required ${s.required}, Actual ${s.actual}">
        <div style="width:100%;height:160px;display:flex;align-items:flex-end;gap:3px">
          <div style="flex:1;background:var(--gl-surface-high);border-radius:4px 4px 0 0;height:100%;display:flex;align-items:flex-end;overflow:hidden">
            <div style="width:100%;border-radius:4px 4px 0 0;background:${gap ? '#f5574a' : '#3dd68c'};height:${actPct}%;transition:height 0.7s var(--ease-out)"></div>
          </div>
          <div style="flex:1;background:var(--gl-surface-high);border-radius:4px 4px 0 0;height:100%;display:flex;align-items:flex-end;overflow:hidden;opacity:0.4">
            <div style="width:100%;border-radius:4px 4px 0 0;background:#5abfe8;height:${reqPct}%;transition:height 0.7s var(--ease-out)"></div>
          </div>
        </div>
        <div style="font-size:10px;font-weight:600;color:var(--gl-on-surface-4);text-align:center;letter-spacing:0.02em">${escHtml(s.skill_name)}</div>
        <div style="font-size:10px;color:var(--gl-on-surface-4)">${s.actual}/${s.required}</div>
      </div>`;
  });

  container.innerHTML = `<div style="display:flex;align-items:flex-end;gap:8px;padding:0 8px;height:200px">${html}</div>`;

  const alertEl = document.getElementById('skill-gap-alert');
  const gapText = document.getElementById('skill-gap-text');
  if (alertEl && gapText) {
    alertEl.style.display = gaps.length ? 'flex' : 'none';
    gapText.textContent = gaps.join(', ') + (gaps.length ? ' are under-resourced.' : '');
  }
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

// ─── GOOGLE CALENDAR WIDGET ────────────────────────────────────
async function loadCalendarWidget() {
  const el = document.getElementById('calendar-widget');
  if (!el) return;

  // Render today's date header
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' });
  const dateHeader = document.getElementById('calendar-date-header');
  if (dateHeader) dateHeader.textContent = dateStr;

  try {
    const todayStr = today.toISOString().slice(0, 10);
    const events = await getCalendarEvents(todayStr);
    renderCalendarEvents(el, events);
  } catch {
    // Show offline state — calendar not connected
    renderCalendarOffline(el);
  }
}

function renderCalendarEvents(el, events) {
  if (!events || !events.length) {
    el.innerHTML = `
      <div style="padding:20px;text-align:center;color:var(--gl-on-surface-4)">
        <span class="material-symbols-outlined" style="font-size:32px;display:block;margin-bottom:8px;opacity:0.4">event_available</span>
        <div style="font-size:0.82rem">No events today</div>
      </div>`;
    return;
  }

  el.innerHTML = events.slice(0, 6).map(ev => {
    const start = ev.start_time ? new Date(ev.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    const end = ev.end_time ? new Date(ev.end_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--gl-outline)">
        <div style="width:3px;height:36px;border-radius:2px;background:#5abfe8;flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.83rem;font-weight:600;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(ev.title)}</div>
          <div style="font-size:0.72rem;color:var(--gl-on-surface-4)">${start}${end ? ' – ' + end : ''}</div>
        </div>
      </div>`;
  }).join('');
}

function renderCalendarOffline(el) {
  el.innerHTML = `
    <div style="padding:16px;text-align:center;color:var(--gl-on-surface-4)">
      <span class="material-symbols-outlined" style="font-size:28px;display:block;margin-bottom:8px;color:var(--gl-on-surface-4)">calendar_month</span>
      <div style="font-size:0.8rem;margin-bottom:12px">Google Calendar not synced</div>
      <button class="btn btn-sm" style="background:#4285f4;color:#fff;border:none;cursor:pointer" onclick="window._syncCalendar?.()">
        <span class="material-symbols-outlined" style="font-size:14px">sync</span>
        Connect Calendar
      </button>
    </div>`;
}

window._syncCalendar = async function() {
  const btn = document.querySelector('#calendar-widget button');
  if (btn) btn.textContent = 'Syncing…';
  try {
    await syncGoogleCalendar();
    await loadCalendarWidget();
    const { showToast } = await import('./ui.js');
    showToast('Calendar synced!');
  } catch (e) {
    const { showToast } = await import('./ui.js');
    showToast('Calendar sync failed: ' + e.message, 'error');
    if (btn) btn.textContent = 'Connect Calendar';
  }
};

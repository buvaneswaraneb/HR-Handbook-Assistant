// ============================================================
// dashboard.js — Dashboard View
// Analytics · Calendar Placeholder · Deadlines
// ============================================================

import { State } from '../utils/state.js';
import { getAnalytics, getProjects, getLeaveRecords } from './api.js?v=20260512-3';
import { dateKey, escHtml, parseLocalDate, todayLocalDate } from '../utils/helpers.js?v=20260509-3';

let dashboardLoadPromise = null;

// ─── INIT ─────────────────────────────────────────────────────
export function initDashboard() {
  State.on('view:dashboard', loadDashboard);
}

export async function loadDashboard() {
  if (dashboardLoadPromise) return dashboardLoadPromise;

  dashboardLoadPromise = (async () => {
    const [analyticsResult, projectsResult, leaveResult] = await Promise.allSettled([
      getAnalytics(),
      getProjects(),
      getLeaveRecords(),
    ]);

    if (analyticsResult.status === 'fulfilled') {
      renderAnalytics(analyticsResult.value);
    } else {
      renderAnalyticsError();
    }

    if (projectsResult.status === 'fulfilled') {
      renderDeadlines(projectsResult.value);
    } else {
      renderDeadlinesError();
    }

    loadCalendarWidget();
    renderDashboardLeaveHeatmapFromResults(leaveResult, analyticsResult);
  })();

  try {
    await dashboardLoadPromise;
  } finally {
    dashboardLoadPromise = null;
  }
}

// ─── ANALYTICS ────────────────────────────────────────────────
function renderAnalytics(data) {
  animateCount('metric-employees', data.total_employees ?? 0);
  animateCount('metric-projects', data.live_projects ?? data.active_projects ?? data.total_projects ?? 0);
  animateCount('metric-completed-projects', data.completed_projects ?? 0);
  animateCount('metric-assignments', data.active_assignments ?? data.assignments ?? data.assigned_employees ?? 0);
  animateCount('metric-available', data.available ?? 0);
  animateCount('metric-on-leave', data.on_leave ?? 0);

  const pct = data.total_employees > 0
    ? Math.round((data.available / data.total_employees) * 100)
    : 0;
  const el = document.getElementById('metric-available-pct');
  if (el) el.textContent = pct + '% of total';
}

function renderAnalyticsError() {
  ['metric-employees', 'metric-projects', 'metric-completed-projects', 'metric-assignments', 'metric-available', 'metric-on-leave']
    .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '-'; });
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = target;
}

// ─── LEAVE HEATMAP ───────────────────────────────────────────
function renderDashboardLeaveHeatmapFromResults(leaveResult, analyticsResult) {
  const el = document.getElementById('dashboard-leave-heatmap');
  if (!el) return;

  if (leaveResult.status !== 'fulfilled') {
    el.innerHTML = `<div style="color:var(--gl-error);font-size:0.82rem">Could not load leave heatmap.</div>`;
    return;
  }

  const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : {};
  renderDashboardLeaveHeatmap(el, leaveResult.value, analytics.total_employees || 1);
}

function renderDashboardLeaveHeatmap(el, records, totalEmployees) {
  const today = todayLocalDate();
  const todayKey = dateKey(today);
  const leaveByDate = {};

  records.forEach(rec => {
    if (!rec.start_date || !rec.end_date) return;
    const start = parseLocalDate(rec.start_date);
    const end = parseLocalDate(rec.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = dateKey(d);
      leaveByDate[key] = (leaveByDate[key] || 0) + 1;
    }
  });

  const pastWeeks = 18;
  const futureWeeks = 8;
  const totalWeeks = pastWeeks + futureWeeks;

  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 7 * (pastWeeks - 1));
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const weeks = [];
  const cursor = new Date(startDate);
  for (let wi = 0; wi < totalWeeks; wi++) {
    const week = [];
    for (let di = 0; di < 7; di++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let monthLabels = '';
  let previousMonth = -1;
  weeks.forEach((week, wi) => {
    const month = week[0].getMonth();
    if (month !== previousMonth) {
      monthLabels += `<div style="grid-column:${wi + 2};grid-row:1;font-size:10px;color:var(--gl-on-surface-4);white-space:nowrap">${monthNames[month]}</div>`;
      previousMonth = month;
    }
  });

  const cells = weeks.flatMap((week, wi) => week.map((day, di) => {
    const key = dateKey(day);
    const count = leaveByDate[key] || 0;
    const pct = totalEmployees ? (count / totalEmployees) * 100 : 0;
    const isFuture = day > today;
    const isToday = key === todayKey;
    const bg = count === 0 ? 'var(--gl-surface-high)'
      : pct < 10 ? '#3dd68c'
        : pct < 25 ? '#f5a623'
          : '#f5574a';
    const opacity = isFuture ? '0.45' : '1';
    return `<div
      title="${escHtml(`${key}: ${count ? `${count} on leave` : 'No leaves'}`)}"
      style="grid-column:${wi + 2};grid-row:${di + 2};width:13px;height:13px;border-radius:2px;background:${bg};opacity:${opacity};border:${isToday ? '2px solid var(--gl-primary)' : '1px solid var(--gl-outline)'}">
    </div>`;
  })).join('');

  const activeToday = leaveByDate[todayKey] || 0;
  el.innerHTML = `
    <div style="width:100%">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:0.82rem;font-weight:700;color:var(--gl-on-surface)">${activeToday} on leave today</div>
          <div style="font-size:0.72rem;color:var(--gl-on-surface-4)">Last ${pastWeeks} weeks + next ${futureWeeks} · today outlined</div>
        </div>
        <div style="display:flex;align-items:center;gap:5px;font-size:0.68rem;color:var(--gl-on-surface-4)">
          <span>Less</span>
          <span style="width:11px;height:11px;border-radius:2px;background:var(--gl-surface-high);border:1px solid var(--gl-outline);display:inline-block"></span>
          <span style="width:11px;height:11px;border-radius:2px;background:#3dd68c;display:inline-block"></span>
          <span style="width:11px;height:11px;border-radius:2px;background:#f5a623;display:inline-block"></span>
          <span style="width:11px;height:11px;border-radius:2px;background:#f5574a;display:inline-block"></span>
          <span>More</span>
        </div>
      </div>
      <div style="overflow-x:auto;padding-bottom:4px">
        <div style="display:grid;grid-template-columns:24px repeat(${weeks.length}, 13px);grid-template-rows:16px repeat(7, 13px);gap:3px;min-width:max-content">
          ${monthLabels}
          <div style="grid-column:1;grid-row:3;font-size:10px;color:var(--gl-on-surface-4);text-align:right;padding-right:5px">Mon</div>
          <div style="grid-column:1;grid-row:5;font-size:10px;color:var(--gl-on-surface-4);text-align:right;padding-right:5px">Wed</div>
          <div style="grid-column:1;grid-row:7;font-size:10px;color:var(--gl-on-surface-4);text-align:right;padding-right:5px">Fri</div>
          ${cells}
        </div>
      </div>
    </div>`;
}

// ─── DEADLINES ────────────────────────────────────────────────
function renderDeadlines(projects) {
  const el = document.getElementById('deadlines-list');
  if (!el) return;
  const criticalEl = document.getElementById('deadline-critical-count');

  const openDeadlines = projects.filter(p => {
    const status = String(p.status || '').toLowerCase();
    const days = Number(p.days_remaining);
    const pct = Number(p.percent_complete || 0);
    return Number.isFinite(days)
      && !['completed', 'cancelled'].includes(status)
      && pct < 100;
  });
  const criticalCount = openDeadlines.filter(p => Number(p.days_remaining) <= 3).length;
  if (criticalEl) criticalEl.textContent = `${criticalCount} Critical`;

  const sorted = openDeadlines
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
    const pct = Math.max(0, Math.min(100, Number(p.percent_complete || 0)));
    const isUrgent = days <= 3;
    const isWarn = days <= 7 && days > 3;

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
}

function renderDeadlinesError() {
  const el = document.getElementById('deadlines-list');
  const criticalEl = document.getElementById('deadline-critical-count');
  if (criticalEl) criticalEl.textContent = '- Critical';
  if (el) el.innerHTML = `<div style="color:var(--gl-on-surface-4);font-size:0.82rem">Could not load deadlines.</div>`;
}

// ─── GOOGLE CALENDAR ────────────────────────────────────────
async function loadCalendarWidget() {
  const el = document.getElementById('calendar-widget');
  if (!el) return;

  const dateHeader = document.getElementById('calendar-date-header');
  if (dateHeader) dateHeader.textContent = 'Feature turned off';

  el.innerHTML = `
    <div style="min-height:160px;display:flex;align-items:center;justify-content:center;text-align:center;padding:22px;color:var(--gl-on-surface-4);background:#211c2b">
      <div>
        <span class="material-symbols-outlined" style="font-size:30px;display:block;margin-bottom:8px;color:#4285f4">calendar_month</span>
        <div style="font-size:0.9rem;font-weight:800;color:var(--gl-on-surface);margin-bottom:5px">Google Calendar Sync</div>
        <div style="font-size:0.78rem;line-height:1.55">Feature turned off. Google Calendar sync will be added in a future update.</div>
      </div>
    </div>`;
}

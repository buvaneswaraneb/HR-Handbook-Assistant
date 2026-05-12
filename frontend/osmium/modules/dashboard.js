// ============================================================
// dashboard.js — Dashboard View
// Analytics · Calendar Placeholder · Deadlines
// ============================================================

import { State } from '../utils/state.js';
import { getAnalytics, getProjects, getLeaveRecords, getGoogleCalendarStatus, getGoogleCalendarEvents, syncCalendarEvents, getGoogleCalendarAuthUrl, handleGoogleCalendarCallback } from './api.js?v=20260510-4';
import { showToast } from './ui.js';
import { dateKey, escHtml, fmtDate, parseLocalDate, todayLocalDate } from '../utils/helpers.js?v=20260509-3';

function hasCalendarAuthToken() {
  return Boolean(State.auth?.accessToken);
}

function frontendAuthUrl() {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  return url.toString();
}

// ─── INIT ─────────────────────────────────────────────────────
export function initDashboard() {
  State.on('view:dashboard', loadDashboard);
  checkGoogleCalendarCallback();
}

async function checkGoogleCalendarCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  
  if (!code || !state) return;
  
  try {
    await handleGoogleCalendarCallback(code, state);
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (err) {
    console.error('Google Calendar callback failed:', err);
  }
}

export async function loadDashboard() {
  await Promise.all([loadAnalytics(), loadDeadlines(), loadCalendarWidget(), loadDashboardLeaveHeatmap()]);
}

// ─── ANALYTICS ────────────────────────────────────────────────
async function loadAnalytics() {
  try {
    const data = await getAnalytics();
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

  } catch {
    ['metric-employees', 'metric-projects', 'metric-completed-projects', 'metric-assignments', 'metric-available', 'metric-on-leave']
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  }
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = target;
}

// ─── LEAVE HEATMAP ───────────────────────────────────────────
async function loadDashboardLeaveHeatmap() {
  const el = document.getElementById('dashboard-leave-heatmap');
  if (!el) return;

  try {
    const [records, analytics] = await Promise.all([
      getLeaveRecords({ cache: false }),
      getAnalytics().catch(() => ({})),
    ]);
    renderDashboardLeaveHeatmap(el, records, analytics.total_employees || 1);
  } catch (err) {
    el.innerHTML = `<div style="color:var(--gl-error);font-size:0.82rem">Could not load leave heatmap.</div>`;
  }
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
async function loadDeadlines() {
  const el = document.getElementById('deadlines-list');
  if (!el) return;
  const criticalEl = document.getElementById('deadline-critical-count');

  try {
    const projects = await getProjects();
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
  } catch {
    if (criticalEl) criticalEl.textContent = '— Critical';
    el.innerHTML = `<div style="color:var(--gl-on-surface-4);font-size:0.82rem">Could not load deadlines.</div>`;
  }
}

// ─── GOOGLE CALENDAR ────────────────────────────────────────
async function loadCalendarWidget() {
  const el = document.getElementById('calendar-widget');
  if (!el) return;

  const today = new Date();
  const dateHeader = document.getElementById('calendar-date-header');
  if (dateHeader) {
    dateHeader.textContent = today.toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  if (!hasCalendarAuthToken()) {
    renderSevenDayCalendar(el, [], {
      title: 'Google Calendar Sync',
      message: 'Sign in again to connect your calendar.',
      actionLabel: 'Sign in',
      actionIcon: 'login',
      action: "document.getElementById('auth-email')?.focus()",
    });
    return;
  }

  try {
    const status = await getGoogleCalendarStatus();
    
    if (!status.connected) {
      renderSevenDayCalendar(el, [], {
        title: 'Connect Calendar',
        message: 'Connect to view your calendar events.',
        actionLabel: 'Connect',
        actionIcon: 'link',
        action: 'window._connectGoogleCalendar()',
      });
      return;
    }

    // Calendar is connected, load events
    const response = await getGoogleCalendarEvents(7);
    const events = response.events || [];
    renderSevenDayCalendar(el, events);
  } catch (err) {
    if (isAuthError(err)) {
      renderSevenDayCalendar(el, [], {
        title: 'Google Calendar Sync',
        message: 'Sign in again to connect your calendar.',
        actionLabel: 'Sign in',
        actionIcon: 'login',
        action: "document.getElementById('auth-email')?.focus()",
      });
      return;
    }
    console.error('Failed to load calendar widget:', err);
    renderSevenDayCalendar(el, [], {
      title: 'Calendar Error',
      message: 'Could not load calendar.',
      actionLabel: 'Try Again',
      actionIcon: 'sync',
      action: 'window._syncGoogleCalendar()',
    });
  }
}

function isAuthError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('unauthorized') || msg.includes('invalid or expired token') || msg.includes('401');
}

function renderSevenDayCalendar(el, events = [], notice = null) {
  const today = todayLocalDate();
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today);
    day.setDate(today.getDate() + i);
    return day;
  });
  const eventsByDay = groupEventsByDay(events, days);

  const dayColumns = days.map(day => {
    const key = dateKey(day);
    const dayEvents = eventsByDay[key] || [];
    const isToday = key === dateKey(today);
    const dayName = day.toLocaleDateString('en-GB', { weekday: 'short' });
    const monthName = day.toLocaleDateString('en-GB', { month: 'short' });
    const eventPills = dayEvents.length
      ? dayEvents.slice(0, 3).map(calendarEventPill).join('')
      : `<div style="font-size:0.68rem;color:var(--gl-on-surface-4);margin-top:10px">No events</div>`;
    const moreCount = dayEvents.length - 3;

    return `
      <div style="min-width:126px;min-height:154px;background:#211c2b;border-right:1px solid var(--gl-outline);border-top:${isToday ? '2px solid #4285f4' : '1px solid var(--gl-outline)'};padding:10px 8px 9px;display:flex;flex-direction:column">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
          <div style="font-size:0.68rem;font-weight:700;color:${isToday ? '#4285f4' : 'var(--gl-on-surface-4)'};text-transform:uppercase">${dayName}</div>
          <div style="text-align:right">
            <div style="font-size:1.22rem;line-height:1;font-weight:800;color:${isToday ? '#4285f4' : 'var(--gl-on-surface)'}">${day.getDate()}</div>
            <div style="font-size:0.62rem;color:var(--gl-on-surface-4);margin-top:2px">${monthName}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;min-width:0">
          ${eventPills}
          ${moreCount > 0 ? `<div style="font-size:0.66rem;color:var(--gl-on-surface-4);padding:0 4px">+${moreCount} more</div>` : ''}
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="position:relative;overflow-x:auto;border-radius:0 0 var(--r-lg) var(--r-lg);padding-bottom:2px">
      <div style="display:grid;grid-template-columns:repeat(7, minmax(126px, 1fr));min-width:882px;background:#211c2b">
        ${dayColumns}
      </div>
      ${notice ? `
        <div style="position:absolute;inset:1px 0 2px 0;display:flex;align-items:center;justify-content:center;background:rgba(31,31,34,0.72);backdrop-filter:blur(3px)">
          <div style="text-align:center;color:var(--gl-on-surface-4);padding:14px 18px;border-radius:var(--r-md);background:rgba(44,44,48,0.88);border:1px solid var(--gl-outline)">
            <span class="material-symbols-outlined" style="font-size:26px;display:block;margin-bottom:6px;color:#4285f4">calendar_month</span>
            <div style="font-size:0.86rem;font-weight:700;color:var(--gl-on-surface);margin-bottom:3px">${escHtml(notice.title)}</div>
            <div style="font-size:0.74rem;margin-bottom:10px">${escHtml(notice.message)}</div>
            <button class="btn btn-secondary btn-sm" onclick="${notice.action}">
              <span class="material-symbols-outlined" style="font-size:14px">${escHtml(notice.actionIcon)}</span>
              ${escHtml(notice.actionLabel)}
            </button>
          </div>
        </div>` : ''}
    </div>`;
}

function groupEventsByDay(events, days) {
  const dayKeys = new Set(days.map(dateKey));
  return events.reduce((acc, evt) => {
    if (!evt.start_time) return acc;
    const start = parseCalendarDateTime(evt.start_time);
    if (!start) return acc;
    const key = dateKey(start);
    if (!dayKeys.has(key)) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(evt);
    return acc;
  }, {});
}

function parseCalendarDateTime(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseLocalDate(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calendarEventPill(evt) {
  const start = parseCalendarDateTime(evt.start_time);
  const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(evt.start_time || '');
  const time = start && !isAllDay
    ? start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : 'All day';
  return `
    <div data-url="${escHtml(evt.event_url || '')}"
      onclick="if(this.dataset.url) window.open(this.dataset.url, '_blank')"
      title="${escHtml(`${time} · ${evt.title || 'Untitled'}`)}"
      style="height:24px;border-radius:12px;background:#1f6f48;color:#35d07f;display:flex;align-items:center;gap:4px;padding:0 8px;font-size:0.72rem;font-weight:700;line-height:1;min-width:0;cursor:${evt.event_url ? 'pointer' : 'default'};overflow:hidden">
      <span class="material-symbols-outlined" style="font-size:12px;flex:0 0 auto">calendar_month</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(evt.title || 'Untitled')}</span>
    </div>`;
}

window._connectGoogleCalendar = async function () {
  if (!hasCalendarAuthToken()) {
    showToast('Sign in again before connecting Calendar.', 'error');
    return;
  }
  try {
    const callbackUrl = frontendAuthUrl();
    const response = await getGoogleCalendarAuthUrl(callbackUrl);
    const popup = window.open(response.authorization_url, 'google-calendar-auth', 'width=600,height=600');
    
    if (!popup) {
      showToast('Popup blocked. Please allow popups for this site.', 'error');
      return;
    }

    // Poll for callback completion
    const pollInterval = setInterval(async () => {
      if (popup.closed) {
        clearInterval(pollInterval);
        await new Promise(r => setTimeout(r, 1000));
        await loadCalendarWidget();
        showToast('Calendar connected! Your events will load shortly.', 'success');
      }
    }, 500);
  } catch (err) {
    showToast('Failed to connect Google Calendar: ' + (err.message || 'Unknown error'), 'error');
  }
};

window._syncGoogleCalendar = async function () {
  if (!hasCalendarAuthToken()) {
    showToast('Sign in again before syncing Calendar.', 'error');
    return;
  }
  let btn = null;
  try {
    btn = window.event?.target?.closest('button') || null;
    if (btn) btn.disabled = true;
    
    await syncCalendarEvents();
    showToast('Calendar synced successfully!', 'success');
    await loadCalendarWidget();
  } catch (err) {
    showToast('Sync failed: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

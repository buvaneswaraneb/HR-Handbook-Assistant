// ============================================================
// dashboard.js — Dashboard View
// Analytics · Calendar Placeholder · Deadlines
// ============================================================

import { State } from '../utils/state.js';
import { getAnalytics, getProjects, getLeaveRecords, getGoogleCalendarStatus, getGoogleCalendarEvents, syncCalendarEvents, getGoogleCalendarAuthUrl, handleGoogleCalendarCallback } from './api.js?v=20260509-5';
import { showToast } from './ui.js';
import { dateKey, escHtml, fmtDate, parseLocalDate, todayLocalDate } from '../utils/helpers.js?v=20260509-3';

const FRONTEND_AUTH_URL = 'https://buvaneswaraneb.github.io/HR-Handbook-Assistant';

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
    animateCount('metric-projects', data.total_projects ?? data.active_projects ?? 0);
    animateCount('metric-assignments', data.active_assignments ?? data.assignments ?? data.assigned_employees ?? 0);
    animateCount('metric-available', data.available ?? 0);
    animateCount('metric-on-leave', data.on_leave ?? 0);

    const pct = data.total_employees > 0
      ? Math.round((data.available / data.total_employees) * 100)
      : 0;
    const el = document.getElementById('metric-available-pct');
    if (el) el.textContent = pct + '% of total';

  } catch {
    ['metric-employees', 'metric-projects', 'metric-assignments', 'metric-available', 'metric-on-leave']
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

  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 7 * 17);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const weeks = [];
  const cursor = new Date(startDate);
  for (let wi = 0; wi < 18; wi++) {
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
          <div style="font-size:0.72rem;color:var(--gl-on-surface-4)">Last 18 weeks · today outlined</div>
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

  try {
    const projects = await getProjects();
    const sorted = projects
      .filter(p => p.days_remaining !== null && !['completed', 'cancelled'].includes(p.status))
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

  if (!State.auth?.accessToken || !State.authProfile) {
    renderCalendarSignedOut(el);
    return;
  }

  try {
    const status = await getGoogleCalendarStatus();
    
    if (!status.connected) {
      // Show connect button
      el.innerHTML = `
        <div style="padding:18px;text-align:center;color:var(--gl-on-surface-4)">
          <span class="material-symbols-outlined" style="font-size:30px;display:block;margin-bottom:8px;color:#4285f4">calendar_month</span>
          <div style="font-size:0.86rem;font-weight:700;color:var(--gl-on-surface);margin-bottom:4px">Google Calendar Sync</div>
          <div style="font-size:0.76rem;margin-bottom:12px">Connect to view your calendar events</div>
          <button class="btn btn-secondary btn-sm" onclick="window._connectGoogleCalendar()">
            <span class="material-symbols-outlined" style="font-size:14px">link</span>
            Connect Calendar
          </button>
        </div>`;
      return;
    }

    // Calendar is connected, load events
    const response = await getGoogleCalendarEvents(30);
    const events = response.events || [];

    if (events.length === 0) {
      el.innerHTML = `
        <div style="padding:18px;text-align:center;color:var(--gl-on-surface-4)">
          <span class="material-symbols-outlined" style="font-size:30px;display:block;margin-bottom:8px;color:#4285f4">calendar_month</span>
          <div style="font-size:0.86rem;font-weight:700;color:var(--gl-on-surface);margin-bottom:4px">No upcoming events</div>
          <button class="btn btn-secondary btn-sm" onclick="window._syncGoogleCalendar()">
            <span class="material-symbols-outlined" style="font-size:14px">sync</span>
            Refresh
          </button>
        </div>`;
      return;
    }

    // Display events
    const eventList = events.slice(0, 5).map(evt => {
      const start = new Date(evt.start_time);
      const end = new Date(evt.end_time);
      const dateStr = start.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
      const timeStr = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      
      return `
        <div style="padding:12px 14px;border-radius:var(--r-md);background:var(--gl-surface-high);
          border-left:3px solid #4285f4;cursor:pointer;margin-bottom:6px;transition:all 0.15s"
          onmouseenter="this.style.background='var(--gl-surface-highest)'"
          onmouseleave="this.style.background='var(--gl-surface-high)'"
          onclick="${evt.event_url ? `window.open('${evt.event_url}', '_blank')` : ''} ">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <div style="font-size:0.82rem;font-weight:600;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%">${escHtml(evt.title)}</div>
            <span style="font-size:0.7rem;color:var(--gl-on-surface-3);flex-shrink:0">${dateStr}</span>
          </div>
          <div style="font-size:0.75rem;color:var(--gl-on-surface-4)">${timeStr}</div>
          ${evt.description ? `<div style="font-size:0.72rem;color:var(--gl-on-surface-4);margin-top:4px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${escHtml(evt.description)}</div>` : ''}
        </div>`;
    }).join('');

    el.innerHTML = `
      <div style="padding:0">
        <div style="padding:12px 14px;border-bottom:1px solid var(--gl-outline);display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:0.8rem;font-weight:600;color:var(--gl-on-surface-3)">UPCOMING EVENTS</div>
          <button class="btn btn-icon btn-sm" onclick="window._syncGoogleCalendar()" style="padding:4px;min-width:32px">
            <span class="material-symbols-outlined" style="font-size:16px">sync</span>
          </button>
        </div>
        <div style="padding:12px 14px;max-height:280px;overflow-y:auto">
          ${eventList}
        </div>
      </div>`;
  } catch (err) {
    if (isAuthError(err)) {
      renderCalendarSignedOut(el);
      return;
    }
    console.error('Failed to load calendar widget:', err);
    el.innerHTML = `
      <div style="padding:18px;text-align:center;color:var(--gl-on-surface-4)">
        <span class="material-symbols-outlined" style="font-size:30px;display:block;margin-bottom:8px;color:#4285f4">calendar_month</span>
        <div style="font-size:0.86rem;font-weight:700;color:var(--gl-on-surface);margin-bottom:4px">Calendar Error</div>
        <div style="font-size:0.76rem;margin-bottom:12px">Could not load calendar</div>
        <button class="btn btn-secondary btn-sm" onclick="window._connectGoogleCalendar()">
          <span class="material-symbols-outlined" style="font-size:14px">link</span>
          Try Again
        </button>
      </div>`;
  }
}

function isAuthError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('unauthorized') || msg.includes('invalid or expired token') || msg.includes('401');
}

function renderCalendarSignedOut(el) {
  el.innerHTML = `
    <div style="padding:18px;text-align:center;color:var(--gl-on-surface-4)">
      <span class="material-symbols-outlined" style="font-size:30px;display:block;margin-bottom:8px;color:#4285f4">calendar_month</span>
      <div style="font-size:0.86rem;font-weight:700;color:var(--gl-on-surface);margin-bottom:4px">Google Calendar Sync</div>
      <div style="font-size:0.76rem;margin-bottom:12px">Sign in again to connect your calendar.</div>
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('auth-email')?.focus()">
        <span class="material-symbols-outlined" style="font-size:14px">login</span>
        Sign in
      </button>
    </div>`;
}

window._connectGoogleCalendar = async function () {
  if (!State.auth?.accessToken || !State.authProfile) {
    showToast('Sign in again before connecting Calendar.', 'error');
    return;
  }
  try {
    const callbackUrl = FRONTEND_AUTH_URL;
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
  if (!State.auth?.accessToken || !State.authProfile) {
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

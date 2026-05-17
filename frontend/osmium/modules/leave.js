// ============================================================
// leave.js — Leave Management View
// Calendar heatmap (GitHub-style) + Leave List
// ============================================================

import { State } from '../utils/state.js';
import { getAnalytics, getLeaveRecords, createLeaveRecord, deleteLeaveRecord, getEmployees } from './api.js?v=20260517-local-api';
import { dateKey, escHtml, fmtDate, emptyState, parseLocalDate, skeletonRows, todayLocalDate } from '../utils/helpers.js?v=20260509-3';
import { showToast, openModal, closeModal } from './ui.js';

export function initLeave() {
  State.on('view:leave', loadLeave);
  State.on('data:leave:refresh', () => { if (State.currentView === 'leave') loadLeave(); });
  document.getElementById('add-leave-form')?.addEventListener('submit', e => {
    e.preventDefault();
    submitLeave();
  });
  
  // Populate employee dropdown when modal opens
  document.querySelector('[onclick*="add-leave-modal"]')?.addEventListener('click', populateLeaveEmployeeDropdown);
}

async function populateLeaveEmployeeDropdown() {
  try {
    const emps = await getEmployees({ cache: false });
    const select = document.getElementById('leave-emp-select');
    if (!select) return;
    
    const opts = `<option value="">— Select Employee —</option>` +
      emps.map(e => `<option value="${e.id}">${escHtml(e.name)} (${escHtml(e.role || '—')})</option>`).join('');
    select.innerHTML = opts;
  } catch (e) {
    console.error('Failed to populate employee dropdown:', e);
  }
}

export async function loadLeave() {
  await Promise.all([loadLeaveCalendar(), loadLeaveList()]);
}

// ─── CALENDAR HEATMAP ─────────────────────────────────────────
async function loadLeaveCalendar(options = {}) {
  const container = document.getElementById('leave-calendar');
  if (!container) return;

  try {
    const [records, analytics] = await Promise.all([
      getLeaveRecords(options),
      getAnalytics().catch(() => ({}))
    ]);

    const totalEmployees = analytics.total_employees || 1;
    const currentYear = new Date().getFullYear();
    renderCalendarHeatmap(container, records, totalEmployees, currentYear);
  } catch (e) {
    container.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem">Could not load calendar: ${escHtml(e.message)}</div>`;
  }
}

function renderCalendarHeatmap(container, records, totalEmployees, selectedYear) {
  const controls = document.getElementById('leave-calendar-controls');

  // Build a map: date string → count of people on leave
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

  // Generate calendar from Dec 1 (previous year) to Dec 31 (selected year)
  const startDate = new Date(selectedYear - 1, 11, 1); // Dec 1 of previous year
  const endDate = new Date(selectedYear, 11, 31);     // Dec 31 of selected year
  
  // Align start to Sunday
  startDate.setDate(startDate.getDate() - startDate.getDay());
  
  const today = todayLocalDate();
  const todayKey = dateKey(today);

  const weeks = [];
  let current = new Date(startDate);
  while (current <= endDate) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
  }

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let monthLabels = '';
  let prevMonth = -1;
  weeks.forEach((week, wi) => {
    const m = week[0].getMonth();
    if (m !== prevMonth) {
      const monthOffset = m === 11 ? 'padding-left:8px;' : '';
      monthLabels += `<div style="grid-column:${wi + 2};grid-row:1;font-size:10px;color:var(--gl-on-surface-4);padding-bottom:4px;${monthOffset}">${months[m]}</div>`;
      prevMonth = m;
    }
  });

  const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let dayLabelsHtml = '';
  [1,3,5].forEach(d => {
    dayLabelsHtml += `<div style="grid-column:1;grid-row:${d + 2};font-size:10px;color:var(--gl-on-surface-4);text-align:right;padding-right:6px;line-height:13px">${dayLabels[d]}</div>`;
  });

  let cellsHtml = '';
  weeks.forEach((week, wi) => {
    week.forEach((day, di) => {
      const key = dateKey(day);
      const count = leaveByDate[key] || 0;
      const pct = (count / totalEmployees) * 100;
      const isPast = day < today;
      const isFuture = day > today;

      let bg, title, opacity = '1';
      
      if (count === 0) {
        bg = isFuture ? 'var(--gl-surface-high)' : 'var(--gl-surface-high)';
        title = `${key}: No leaves`;
        if (isFuture) opacity = '0.5';
      } else if (pct < 5) {
        bg = '#3dd68c';  // green
        title = `${key}: ${count} on leave (${pct.toFixed(1)}%)`;
        if (isFuture) opacity = '0.6';
      } else if (pct < 10) {
        bg = '#f5a623';  // yellow
        title = `${key}: ${count} on leave (${pct.toFixed(1)}%)`;
        if (isFuture) opacity = '0.6';
      } else {
        bg = '#f5574a';  // red
        title = `${key}: ${count} on leave (${pct.toFixed(1)}%)`;
        if (isFuture) opacity = '0.6';
      }

      cellsHtml += `<div
        data-date="${key}"
        ${key === todayKey ? 'data-today="true"' : ''}
        style="grid-column:${wi + 2};grid-row:${di + 2};width:13px;height:13px;border-radius:2px;background:${bg};opacity:${opacity};cursor:${count > 0 ? 'pointer' : 'default'};transition:opacity 0.15s;border:${key === todayKey ? '2px solid var(--gl-primary)' : isPast ? '1px solid var(--gl-on-surface-4)' : '1px solid transparent'}"
        title="${escHtml(title)}"
        onmouseenter="this.style.opacity='${isFuture ? '0.8' : '0.7'}'"
        onmouseleave="this.style.opacity='${opacity}'">
      </div>`;
    });
  });

  // Year selector
  const currentYear = new Date().getFullYear();
  const yearOptions = [];
  for (let y = currentYear - 2; y <= currentYear + 1; y++) {
    const nextY = y + 1;
    yearOptions.push(`<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y} - ${nextY}</option>`);
  }

  const yearSelectorHtml = `
    <div style="display:flex;align-items:center;gap:8px">
      <label style="font-size:0.82rem;font-weight:600;color:var(--gl-on-surface-2);white-space:nowrap">Calendar Year:</label>
      <select style="width:auto;min-width:142px;padding:6px 30px 6px 10px;border-radius:4px;border:1px solid var(--gl-outline-2);background:var(--gl-surface-high);color:var(--gl-on-surface);font-size:0.83rem" onchange="window._changeLeaveCalendarYear(this.value)">
        ${yearOptions.join('')}
      </select>
    </div>`;
  if (controls) controls.innerHTML = yearSelectorHtml;

  // Legend with past/future indicators
  const legendHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px 22px;margin-top:12px;font-size:11px;color:var(--gl-on-surface-4);flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto;white-space:nowrap">
        <span style=padding-left:40px;>Less</span>
        <div style="display:flex;align-items:center;justify-content:flex-start;gap:10px">
          <div style="width:13px;height:13px;border-radius:2px;background:var(--gl-surface-high);border:1px solid var(--gl-on-surface-4)"></div>
          <div style="width:13px;height:13px;border-radius:2px;background:#3dd68c;border:1px solid var(--gl-on-surface-4)"></div>
          <div style="width:13px;height:13px;border-radius:2px;background:#f5a623;border:1px solid var(--gl-on-surface-4)"></div>
          <div style="width:13px;height:13px;border-radius:2px;background:#f5574a;border:1px solid var(--gl-on-surface-4)"></div>
        </div>
        <span>More</span>
      </div>
      <span style="border-left:10px ;solid var(--gl-on-surface-4);padding-left:40px">Past (outlined) · Future (dimmed)</span>
    </div>`;

  container.innerHTML = `
    <div style="overflow-x:auto;padding-bottom:4px">
      <div style="display:grid;grid-template-columns:28px repeat(${weeks.length}, 13px);grid-template-rows:16px repeat(7, 13px);gap:2px;min-width:fit-content">
        ${monthLabels}
        ${dayLabelsHtml}
        ${cellsHtml}
      </div>
    </div>
    ${legendHtml}`;

  requestAnimationFrame(() => {
    const todayCell = container.querySelector('[data-today="true"]');
    todayCell?.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
}

window._changeLeaveCalendarYear = async function(year) {
  const container = document.getElementById('leave-calendar');
  const [records, analytics] = await Promise.all([
    getLeaveRecords(),
    getAnalytics().catch(() => ({})),
  ]);
  const totalEmployees = analytics.total_employees || 1;
  renderCalendarHeatmap(container, records, totalEmployees, parseInt(year));
};


// ─── LEAVE LIST ───────────────────────────────────────────────
async function loadLeaveList(options = {}) {
  const list = document.getElementById('leave-list');
  if (!list) return;
  list.innerHTML = skeletonRows(5, '56px');

  try {
    const records = await getLeaveRecords(options);
    if (!records.length) {
      list.innerHTML = emptyState('event_busy', 'No leave records', 'Add leave records to track absences.');
      return;
    }
    list.innerHTML = records.map(r => leaveRow(r)).join('');
  } catch (e) {
    list.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem">${escHtml(e.message)}</div>`;
  }
}

function leaveRow(r) {
  const today = todayLocalDate();
  const start = parseLocalDate(r.start_date);
  const end = parseLocalDate(r.end_date);
  const isActive = start <= today && end >= today;
  const isUpcoming = start > today;

  const statusColor = isActive ? 'var(--gl-warning)' : isUpcoming ? 'var(--gl-info)' : 'var(--gl-on-surface-4)';
  const statusLabel = isActive ? 'On Leave' : isUpcoming ? 'Upcoming' : 'Past';

  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

  return `
    <div class="card" style="padding:12px 16px;display:flex;align-items:center;gap:14px;margin-bottom:8px">
      <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};flex-shrink:0;box-shadow:0 0 6px ${statusColor}"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.88rem;font-weight:600;color:var(--gl-on-surface)">${escHtml(r.employee_name || '—')}</div>
        <div style="font-size:0.72rem;color:var(--gl-on-surface-4)">${fmtDate(r.start_date)} → ${fmtDate(r.end_date)} · ${days} day${days > 1 ? 's' : ''} · ${escHtml(r.leave_type || 'Annual')}</div>
      </div>
      <span style="font-size:0.72rem;font-weight:600;color:${statusColor};background:${statusColor}18;padding:2px 10px;border-radius:var(--r-full)">${statusLabel}</span>
      <button class="btn btn-ghost btn-icon" title="Delete" onclick="window._deleteLeave('${r.id}')">
        <span class="material-symbols-outlined" style="font-size:16px;color:var(--gl-error)">delete</span>
      </button>
    </div>`;
}

// ─── SUBMIT LEAVE ─────────────────────────────────────────────
async function submitLeave() {
  const get = id => document.getElementById(id)?.value?.trim() || null;
  const body = {
    employee_name: get('leave-emp-name'),
    employee_id: get('leave-emp-select') || null,
    start_date: get('leave-start'),
    end_date: get('leave-end'),
    leave_type: get('leave-type') || 'Annual',
  };

  if (!body.start_date || !body.end_date) { showToast('Dates required.', 'error'); return; }
  if (parseLocalDate(body.start_date) > parseLocalDate(body.end_date)) { showToast('End date must be on or after the start date.', 'error'); return; }
  if (!body.employee_name && !body.employee_id) { showToast('Employee required.', 'error'); return; }

  const btn = document.getElementById('leave-submit-btn');
  if (btn) { btn.textContent = 'Adding…'; btn.disabled = true; }

  try {
    await createLeaveRecord(body);
    showToast('Leave record added!');
    closeModal('add-leave-modal');
    await Promise.all([loadLeaveCalendar({ cache: false }), loadLeaveList({ cache: false })]);
    State.emit('data:employees:refresh');
    State.emit('data:projects:refresh');
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) { btn.textContent = 'Add Leave'; btn.disabled = false; } }
}

window._deleteLeave = async function(id) {
  if (!confirm('Delete this leave record?')) return;
  try {
    await deleteLeaveRecord(id);
    showToast('Leave record deleted.');
    await Promise.all([loadLeaveCalendar({ cache: false }), loadLeaveList({ cache: false })]);
    State.emit('data:employees:refresh');
    State.emit('data:projects:refresh');
  } catch (e) { showToast(e.message, 'error'); }
};

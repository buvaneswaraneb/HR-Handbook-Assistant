// ============================================================
// leave.js — Leave Management View
// Calendar heatmap (GitHub-style) + Leave List
// ============================================================

import { State } from '../utils/state.js';
import { getLeaveRecords, createLeaveRecord, deleteLeaveRecord } from './api.js';
import { escHtml, fmtDate, emptyState, skeletonRows } from '../utils/helpers.js';
import { showToast, openModal, closeModal } from './ui.js';

export function initLeave() {
  State.on('view:leave', loadLeave);
  document.getElementById('add-leave-form')?.addEventListener('submit', e => {
    e.preventDefault();
    submitLeave();
  });
}

export async function loadLeave() {
  await Promise.all([loadLeaveCalendar(), loadLeaveList()]);
}

// ─── CALENDAR HEATMAP ─────────────────────────────────────────
async function loadLeaveCalendar() {
  const container = document.getElementById('leave-calendar');
  if (!container) return;

  try {
    const [records, analytics] = await Promise.all([
      getLeaveRecords(),
      fetch(State.apiBase + '/analytics/summary').then(r => r.json()).catch(() => ({}))
    ]);

    const totalEmployees = analytics.total_employees || 1;
    renderCalendarHeatmap(container, records, totalEmployees);
  } catch (e) {
    container.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem">Could not load calendar: ${escHtml(e.message)}</div>`;
  }
}

function renderCalendarHeatmap(container, records, totalEmployees) {
  // Build a map: date string → count of people on leave
  const leaveByDate = {};
  records.forEach(rec => {
    if (!rec.start_date || !rec.end_date) return;
    const start = new Date(rec.start_date);
    const end = new Date(rec.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      leaveByDate[key] = (leaveByDate[key] || 0) + 1;
    }
  });

  // Render last 52 weeks
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);
  // Align to Sunday
  startDate.setDate(startDate.getDate() - startDate.getDay());

  const weeks = [];
  let current = new Date(startDate);
  while (current <= today) {
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
      monthLabels += `<div style="grid-column:${wi + 2};grid-row:1;font-size:10px;color:var(--gl-on-surface-4);padding-bottom:4px">${months[m]}</div>`;
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
      const key = day.toISOString().slice(0, 10);
      const count = leaveByDate[key] || 0;
      const pct = (count / totalEmployees) * 100;
      const isFuture = day > today;

      let bg, title;
      if (isFuture || day < startDate) {
        bg = 'var(--gl-surface-high)';
        title = '';
      } else if (count === 0) {
        bg = 'var(--gl-surface-high)';
        title = `${key}: No leaves`;
      } else if (pct < 5) {
        bg = '#3dd68c';  // green
        title = `${key}: ${count} on leave (${pct.toFixed(1)}%)`;
      } else if (pct < 10) {
        bg = '#f5a623';  // yellow
        title = `${key}: ${count} on leave (${pct.toFixed(1)}%)`;
      } else {
        bg = '#f5574a';  // red
        title = `${key}: ${count} on leave (${pct.toFixed(1)}%)`;
      }

      cellsHtml += `<div
        style="grid-column:${wi + 2};grid-row:${di + 2};width:13px;height:13px;border-radius:2px;background:${bg};cursor:${count > 0 ? 'pointer' : 'default'};transition:opacity 0.15s"
        title="${escHtml(title)}"
        onmouseenter="this.style.opacity='0.7'"
        onmouseleave="this.style.opacity='1'">
      </div>`;
    });
  });

  // Legend
  const legendHtml = `
    <div style="display:flex;align-items:center;gap:12px;margin-top:12px;font-size:11px;color:var(--gl-on-surface-4)">
      <span>Less</span>
      <div style="width:13px;height:13px;border-radius:2px;background:var(--gl-surface-high)"></div>
      <div style="width:13px;height:13px;border-radius:2px;background:#3dd68c"></div>
      <div style="width:13px;height:13px;border-radius:2px;background:#f5a623"></div>
      <div style="width:13px;height:13px;border-radius:2px;background:#f5574a"></div>
      <span>More</span>
      <span style="margin-left:8px">Green: 1–5% · Yellow: 5–9% · Red: ≥10%</span>
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
}

// ─── LEAVE LIST ───────────────────────────────────────────────
async function loadLeaveList() {
  const list = document.getElementById('leave-list');
  if (!list) return;
  list.innerHTML = skeletonRows(5, '56px');

  try {
    const records = await getLeaveRecords();
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
  const today = new Date();
  const start = new Date(r.start_date);
  const end = new Date(r.end_date);
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
  if (!body.employee_name && !body.employee_id) { showToast('Employee required.', 'error'); return; }

  const btn = document.getElementById('leave-submit-btn');
  if (btn) { btn.textContent = 'Adding…'; btn.disabled = true; }

  try {
    await createLeaveRecord(body);
    showToast('Leave record added!');
    closeModal('add-leave-modal');
    loadLeave();
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) { btn.textContent = 'Add Leave'; btn.disabled = false; } }
}

window._deleteLeave = async function(id) {
  if (!confirm('Delete this leave record?')) return;
  try {
    await deleteLeaveRecord(id);
    showToast('Leave record deleted.');
    loadLeave();
  } catch (e) { showToast(e.message, 'error'); }
};

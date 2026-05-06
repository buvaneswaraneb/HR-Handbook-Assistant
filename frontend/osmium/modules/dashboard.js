// ============================================================
// dashboard.js — Dashboard View
// Analytics · Skill Chart · Deadlines · Activity Feed
// ============================================================

import { State } from '../utils/state.js';
import { getAnalytics, getProjects, getActivityFeed } from './api.js';
import { escHtml, fmtDate, daysUntil, urgencyBorderClass, relTime, eventIcon, deptColor, emptyState } from '../utils/helpers.js';

// ─── INIT ─────────────────────────────────────────────────────
export function initDashboard() {
  State.on('view:dashboard', loadDashboard);
}

export async function loadDashboard() {
  await Promise.all([loadAnalytics(), loadDeadlines(), loadActivityFeed(null)]);
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

    renderSkillChart(data.skill_coverage || []);
  } catch {
    ['metric-employees','metric-projects','metric-available','metric-on-leave']
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
    document.getElementById('skill-chart')?.replaceChildren();
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
    container.innerHTML = `<div style="color:var(--gl-on-surface-4);font-size:0.82rem;text-align:center;padding:32px 0">No skill coverage data.</div>`;
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
            <div style="width:100%;border-radius:4px 4px 0 0;background:${gap ? 'var(--gl-error)' : 'var(--gl-primary)'};height:${actPct}%;transition:height 0.7s var(--ease-out)"></div>
          </div>
          <div style="flex:1;background:var(--gl-surface-high);border-radius:4px 4px 0 0;height:100%;display:flex;align-items:flex-end;overflow:hidden;opacity:0.4">
            <div style="width:100%;border-radius:4px 4px 0 0;background:var(--gl-primary);height:${reqPct}%;transition:height 0.7s var(--ease-out)"></div>
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
          border-left:3px solid ${isUrgent ? 'var(--gl-error)' : isWarn ? 'var(--gl-warning)' : 'var(--gl-outline-2)'};
          cursor:pointer;transition:all 0.15s;margin-bottom:6px"
          onclick="window.switchViewGlobal('projects')"
          onmouseenter="this.style.background='var(--gl-surface-highest)'"
          onmouseleave="this.style.background='var(--gl-surface-high)'">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div style="font-size:0.82rem;font-weight:600;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:65%">${escHtml(p.project_name)}</div>
            <span style="font-size:0.72rem;color:${isUrgent ? 'var(--gl-error)' : isWarn ? 'var(--gl-warning)' : 'var(--gl-on-surface-4)'}; font-weight:600;flex-shrink:0">${label}</span>
          </div>
          <div style="height:4px;background:var(--gl-surface-bright);border-radius:var(--r-full);overflow:hidden">
            <div style="height:100%;width:${pct}%;background:var(--gl-primary);border-radius:var(--r-full)"></div>
          </div>
          <div style="font-size:0.7rem;color:var(--gl-on-surface-4);margin-top:4px">${pct}% complete</div>
        </div>`;
    }).join('');
  } catch {
    el.innerHTML = `<div style="color:var(--gl-on-surface-4);font-size:0.82rem">Could not load deadlines.</div>`;
  }
}

// ─── ACTIVITY FEED ────────────────────────────────────────────
export async function loadActivityFeed(department) {
  const el = document.getElementById('activity-feed');
  if (!el) return;

  // Update filter buttons
  ['all','engineering','design','hr'].forEach(d => {
    const btn = document.getElementById(`feed-btn-${d}`);
    if (!btn) return;
    const active = (!department && d === 'all') || (department?.toLowerCase() === d);
    btn.style.background = active ? 'var(--gl-primary-muted)' : 'var(--gl-surface-high)';
    btn.style.color = active ? 'var(--gl-primary-light)' : 'var(--gl-on-surface-3)';
  });

  el.innerHTML = `<div style="padding:24px;display:flex;align-items:center;gap:10px;color:var(--gl-on-surface-4)"><span class="spinner-sm spinner"></span> Loading…</div>`;

  try {
    const items = await getActivityFeed(department, 9);
    if (!items.length) {
      el.innerHTML = emptyState('history', 'No activity yet', 'Events will appear here as your team works.');
      return;
    }

    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0">
      ${items.slice(0, 6).map(item => {
        const col = deptColor(item.department);
        return `
          <div style="padding:16px;border-right:1px solid var(--gl-outline);border-bottom:1px solid var(--gl-outline)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div style="width:8px;height:32px;border-radius:4px;background:${col};flex-shrink:0"></div>
              <div>
                <div style="font-size:0.82rem;font-weight:600;color:var(--gl-on-surface);line-height:1.3">${escHtml(item.title || '')}</div>
                <div style="font-size:0.7rem;color:var(--gl-on-surface-4)">${escHtml(item.department || '')} · ${relTime(item.created_at)}</div>
              </div>
            </div>
            ${item.description ? `<div style="font-size:0.75rem;color:var(--gl-on-surface-3);line-height:1.5">${escHtml(item.description)}</div>` : ''}
          </div>`;
      }).join('')}
    </div>`;
  } catch {
    el.innerHTML = emptyState('history', 'Could not load activity', 'Check API connection.');
  }
}

// expose for inline onclick
window.loadActivityFeedGlobal = loadActivityFeed;

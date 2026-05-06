// ============================================================
// helpers.js — Shared Utility Functions
// Osmium ERM · Glacier Design System
// ============================================================

export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateShort(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function fmtBytes(b) {
  if (!b) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export function relTime(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const days = Math.floor(h / 24);
  if (days < 30) return days + 'd ago';
  return fmtDate(d);
}

export function daysUntil(d) {
  if (!d) return null;
  return Math.ceil((new Date(d) - Date.now()) / 86400000);
}

export function urgencyClass(days) {
  if (days === null || days === undefined) return '';
  if (days <= 3)  return 'badge-error';
  if (days <= 7)  return 'badge-warning';
  if (days <= 14) return 'badge-tertiary';
  return 'badge-neutral';
}

export function urgencyBorderClass(days) {
  if (days === null || days === undefined) return '';
  if (days <= 3)  return 'border-l-4 border-l-[var(--gl-error)]';
  if (days <= 7)  return 'border-l-4 border-l-[var(--gl-warning)]';
  return '';
}

export function statusBadge(s) {
  const map = {
    active:    'badge-primary',
    planning:  'badge-neutral',
    on_hold:   'badge-warning',
    completed: 'badge-available',
    cancelled: 'badge-error',
  };
  return map[s] || 'badge-neutral';
}

export function eventIcon(type) {
  const icons = {
    employee_joined:    'person_add',
    employee_left:      'person_remove',
    file_uploaded:      'upload_file',
    project_milestone:  'flag',
    skill_added:        'psychology',
    project_created:    'create_new_folder',
    project_assigned:   'assignment_ind',
  };
  return icons[type] || 'circle';
}

export function deptColor(dept) {
  const map = {
    Engineering: 'var(--gl-primary)',
    Design:      'var(--gl-tertiary)',
    HR:          'var(--gl-secondary)',
    Product:     'var(--gl-warning)',
  };
  return map[dept] || 'var(--gl-neutral)';
}

export function ratingStars(rating) {
  if (!rating) return '—';
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  let html = '';
  for (let i = 0; i < 5; i++) {
    if (i < full) html += '<span class="material-symbols-outlined" style="font-size:13px;color:var(--gl-tertiary);font-variation-settings:\'FILL\' 1">star</span>';
    else if (i === full && half) html += '<span class="material-symbols-outlined" style="font-size:13px;color:var(--gl-tertiary);font-variation-settings:\'FILL\' 1">star_half</span>';
    else html += '<span class="material-symbols-outlined" style="font-size:13px;color:var(--gl-outline-2)">star</span>';
  }
  return html;
}

export function initials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export function avatarColor(name) {
  const colors = [
    'var(--gl-primary-muted)', 'var(--gl-tertiary-muted)',
    'var(--gl-secondary-muted)', 'var(--gl-info-muted)',
    'var(--gl-success-muted)',
  ];
  let hash = 0;
  for (const c of String(name)) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

export function avatarTextColor(name) {
  const colors = [
    'var(--gl-primary-light)', 'var(--gl-tertiary)',
    'var(--gl-secondary)', 'var(--gl-info)',
    'var(--gl-success)',
  ];
  let hash = 0;
  for (const c of String(name)) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

export function uid() {
  return Math.random().toString(36).slice(2, 11);
}

export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

export function snap(val, grid) {
  return Math.round(val / grid) * grid;
}

export function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

export function throttle(fn, limit) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= limit) { last = now; fn(...args); }
  };
}

/** Render a loading skeleton row */
export function skeletonRows(n = 4, height = '40px') {
  return Array.from({ length: n }, () =>
    `<div style="height:${height};border-radius:var(--r-md);background:var(--gl-surface-high);animation:pulse 1.5s ease-in-out infinite;margin-bottom:8px;"></div>`
  ).join('');
}

export function emptyState(icon, title, subtitle) {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;gap:12px;color:var(--gl-on-surface-4);text-align:center;">
      <span class="material-symbols-outlined" style="font-size:48px;color:var(--gl-outline-3)">${icon}</span>
      <div style="font-size:0.9rem;font-weight:600;color:var(--gl-on-surface-3)">${escHtml(title)}</div>
      ${subtitle ? `<div style="font-size:0.8rem">${escHtml(subtitle)}</div>` : ''}
    </div>`;
}

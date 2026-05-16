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
  return parseLocalDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateShort(d) {
  if (!d) return '—';
  return parseLocalDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function parseLocalDate(value) {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(value);
}

export function dateKey(value) {
  const d = parseLocalDate(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocalDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
  return String(s || 'active').toLowerCase() === 'active'
    ? 'badge-available'
    : 'badge-unavailable';
}

export function projectRoleCoverage(project) {
  const required = uniqueClean(project?.required_roles || []);
  const team = Array.isArray(project?.team) ? project.team : [];
  const covered = [];
  const missing = [];

  required.forEach(role => {
    if (projectHasRoleCoverage(role, team)) covered.push(role);
    else missing.push(role);
  });

  return {
    required,
    covered,
    missing,
    hasMissing: missing.length > 0,
    summary: missing.join(', '),
    detail: missing.length
      ? `Missing roles: ${missing.join(', ')}. Needed: assign ${missing.length === 1 ? 'an employee' : 'employees'} for ${missing.join(', ')}.`
      : 'All required roles are covered.',
  };
}

function uniqueClean(values) {
  const seen = new Set();
  const out = [];
  values.forEach(value => {
    const clean = String(value || '').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
}

function projectHasRoleCoverage(requiredRole, team) {
  const kind = projectRoleRequirementKind(requiredRole);
  if (kind === 'manager') {
    return team.some(member => normalizeAssignmentRole(member?.role_in_project) === 'manager');
  }
  if (kind === 'teamlead') {
    return team.some(member => normalizeAssignmentRole(member?.role_in_project) === 'teamlead');
  }
  if (kind === 'hr') {
    return team.some(member =>
      normalizeAssignmentRole(member?.role_in_project) === 'hr' ||
      projectRoleTextMatches(requiredRole, member?.role)
    );
  }
  if (kind === 'member') {
    return team.some(member => ['member', 'hr', 'teamlead'].includes(normalizeAssignmentRole(member?.role_in_project)));
  }
  return team.some(member => projectRoleTextMatches(requiredRole, member?.role));
}

export function projectRoleRequirementKind(role) {
  const text = normalizeProjectRoleText(role);
  if (/\bmanager\b|\bproject\s*manage(r|ment)?\b/.test(text)) return 'manager';
  if (/\bteam\s*lead(er)?\b|\btech(nical)?\s*lead(er)?\b/.test(text)) return 'teamlead';
  if (/\bhr\b|\bhuman resources\b/.test(text)) return 'hr';
  if (/\bmember\b|\bcontributor\b/.test(text)) return 'member';
  return 'specialist';
}

function normalizeAssignmentRole(role) {
  const value = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['team_lead', 'teamlead', 'lead', 'leader'].includes(value)) return 'teamlead';
  if (['manager', 'member', 'hr', 'pending'].includes(value)) return value;
  return value || 'pending';
}

export function projectRoleTextMatches(requiredRole, actualRole) {
  const required = normalizeProjectRoleText(requiredRole);
  const actual = normalizeProjectRoleText(actualRole);
  if (!required || !actual) return false;
  if (actual.includes(required) || required.includes(actual)) return true;

  const requiredCore = coreRoleTokens(required);
  const actualCore = coreRoleTokens(actual);
  if (
    requiredCore.some(token => ['lead', 'leader'].includes(token)) &&
    !actualCore.some(token => ['lead', 'leader', 'teamlead'].includes(token))
  ) {
    return false;
  }

  const requiredTokens = projectRoleTokens(required);
  const actualTokens = new Set(projectRoleTokens(actual));
  if (!requiredTokens.length || !actualTokens.size) return false;

  const hits = requiredTokens.filter(token => actualTokens.has(token)).length;
  return requiredTokens.length <= 2
    ? hits === requiredTokens.length
    : hits / requiredTokens.length >= 0.7;
}

export function normalizeProjectRoleText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function projectRoleTokens(value) {
  const stop = new Set(['and', 'for', 'the', 'with', 'role', 'roles', 'needed', 'project']);
  const tokens = coreRoleTokens(value)
    .filter(token => !stop.has(token));
  return expandRoleTokens(tokens);
}

function coreRoleTokens(value) {
  return normalizeProjectRoleText(value)
    .split(' ')
    .map(token => token.trim())
    .filter(Boolean);
}

function expandRoleTokens(tokens) {
  const out = new Set(tokens);
  tokens.forEach(token => {
    const aliases = {
      qa: ['quality', 'assurance', 'test', 'testing'],
      quality: ['qa'],
      assurance: ['qa'],
      frontend: ['front', 'end'],
      front: ['frontend'],
      backend: ['back', 'end'],
      back: ['backend'],
      fullstack: ['full', 'stack', 'frontend', 'backend'],
      developer: ['dev', 'engineer'],
      dev: ['developer', 'engineer'],
      engineer: ['developer'],
      manage: ['manager', 'management'],
      management: ['manager', 'manage'],
      manager: ['manage', 'management'],
      hr: ['human', 'resources'],
      human: ['hr'],
      resources: ['hr'],
    }[token] || [];
    aliases.forEach(alias => out.add(alias));
  });
  return [...out];
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

export function avatarMarkup(name, avatarUrl, options = {}) {
  const {
    size = 44,
    fontSize = size >= 60 ? '1.5rem' : '1rem',
    border = '1px solid var(--gl-outline-2)',
    shadow = 'var(--shadow-sm)',
  } = options;

  const bg = avatarColor(name || '?');
  const fc = avatarTextColor(name || '?');
  const init = initials(name || '?');

  if (avatarUrl) {
    return `
      <div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0;background:${bg};color:${fc};border:${border};box-shadow:${shadow}">
        <img
          src="${escHtml(avatarUrl)}"
          alt=""
          referrerpolicy="no-referrer"
          style="width:100%;height:100%;object-fit:cover;display:block"
          onerror="this.remove();this.parentElement.style.display='flex';this.parentElement.style.alignItems='center';this.parentElement.style.justifyContent='center';this.parentElement.style.fontSize='${fontSize}';this.parentElement.style.fontWeight='700';this.parentElement.textContent='${escHtml(init)}';"
        >
      </div>`;
  }

  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${fc};
    display:flex;align-items:center;justify-content:center;font-size:${fontSize};font-weight:700;
    flex-shrink:0;border:${border};box-shadow:${shadow}">${init}</div>`;
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

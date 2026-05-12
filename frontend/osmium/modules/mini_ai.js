// ============================================================
// mini_ai.js — Floating workspace assistant
// Employee, project, and dashboard context without opening AI view
// ============================================================

import { State } from '../utils/state.js';
import {
  askWorkspaceAI,
  getActivityFeed,
  getAnalytics,
  getEmployees,
  getLeaveRecords,
  getProjects,
} from './api.js?v=20260512-1';
import { escHtml } from '../utils/helpers.js?v=20260509-3';
import { showToast } from './ui.js';

const CONTEXT_TTL = 5 * 60 * 1000;
const MINI_HISTORY_LIMIT = 10;

let miniWindowEl, miniMessagesEl, miniInputEl, miniContextEl, miniToggleEl;
let miniMessages = [];
let workspaceContextCache = null;
let isMiniSending = false;

export function initMiniAI() {
  miniWindowEl = document.getElementById('mini-ai-window');
  miniMessagesEl = document.getElementById('mini-ai-messages');
  miniInputEl = document.getElementById('mini-ai-input');
  miniContextEl = document.getElementById('mini-ai-context-state');
  miniToggleEl = document.getElementById('mini-ai-toggle');

  if (!miniWindowEl || !miniMessagesEl || !miniInputEl) return;

  document.getElementById('mini-ai-close')?.addEventListener('click', closeMiniAI);
  document.getElementById('mini-ai-send')?.addEventListener('click', e => {
    e.preventDefault();
    sendMiniQuestion();
  });
  document.getElementById('mini-ai-refresh')?.addEventListener('click', async e => {
    e.preventDefault();
    clearWorkspaceContextCache();
    await getWorkspaceContext(true);
    showToast('Mini AI context refreshed.');
  });

  miniInputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMiniQuestion();
    }
  });

  document.querySelectorAll('.mini-ai-chip[data-q]').forEach(chip => {
    chip.addEventListener('click', () => {
      miniInputEl.value = chip.dataset.q || '';
      miniInputEl.focus();
    });
  });

  State.on('change:currentView', syncMiniVisibility);
  ['change:employees', 'change:projects', 'data:employees:refresh', 'data:projects:refresh', 'data:leave:refresh']
    .forEach(event => State.on(event, clearWorkspaceContextCache));

  window.toggleAIWindow = toggleMiniAI;
  window.openAIWindow = openMiniAI;
  syncMiniVisibility(State.currentView);
  renderMiniMessages();
}

function contextCacheKey() {
  const id = State.auth?.workplaceId || State.authProfile?.workplace_id || State.authProfile?.user_id || State.auth?.user?.id || 'anonymous';
  return `osmium_mini_ai_context_${id}`;
}

function clearWorkspaceContextCache() {
  workspaceContextCache = null;
  try { localStorage.removeItem(contextCacheKey()); } catch {}
}

function loadStoredContext() {
  if (workspaceContextCache && Date.now() - workspaceContextCache.fetchedAt < CONTEXT_TTL) {
    if (!workspaceContextCache.context.summary) {
      workspaceContextCache.context.summary = buildWorkspaceSummary(workspaceContextCache.context);
    }
    return workspaceContextCache.context;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(contextCacheKey()) || '{}');
    if (saved.context && Date.now() - saved.fetchedAt < CONTEXT_TTL) {
      if (!saved.context.summary) {
        saved.context.summary = buildWorkspaceSummary(saved.context);
        try { localStorage.setItem(contextCacheKey(), JSON.stringify(saved)); } catch {}
      }
      workspaceContextCache = saved;
      return saved.context;
    }
  } catch {}
  return null;
}

async function getWorkspaceContext(force = false) {
  if (!force) {
    const cached = loadStoredContext();
    if (cached) {
      updateContextState(cached.cached_at, true);
      return cached;
    }
  }

  updateContextState('Refreshing context...', false);
  const [analytics, employees, projects, leave, activity] = await Promise.all([
    getAnalytics().catch(() => ({})),
    getEmployees().catch(() => State.employees || []),
    getProjects().catch(() => State.projects || []),
    getLeaveRecords().catch(() => []),
    getActivityFeed(null, 12).catch(() => []),
  ]);

  const context = {
    page: State.currentView,
    cached_at: new Date().toISOString(),
    analytics: analytics || {},
    employees: compactEmployees(employees || []),
    projects: compactProjects(projects || []),
    leave: compactLeave(leave || []),
    activity: compactActivity(activity || []),
  };
  context.summary = buildWorkspaceSummary(context);

  workspaceContextCache = { fetchedAt: Date.now(), context };
  try { localStorage.setItem(contextCacheKey(), JSON.stringify(workspaceContextCache)); } catch {}
  updateContextState(context.cached_at, false);
  return context;
}

function compactEmployees(employees) {
  return employees.slice(0, 90).map(emp => ({
    id: emp.id,
    name: emp.name,
    email: emp.email,
    role: emp.role,
    team: emp.team,
    availability: emp.availability,
    rating: emp.rating,
    experience_years: emp.total_experience_years,
    skills: (emp.skills || []).slice(0, 8).map(skill => typeof skill === 'string' ? skill : skill.skill_name),
    projects: (emp.projects || []).slice(0, 5).map(project => project.project_name || project.name || project.project_id),
  }));
}

function compactProjects(projects) {
  return projects.slice(0, 70).map(project => ({
    id: project.id,
    name: project.project_name,
    client: project.client_name,
    status: project.status,
    progress: project.percent_complete,
    days_remaining: project.days_remaining,
    start_date: project.start_date,
    end_date: project.end_date,
    required_skills: project.required_skills || [],
    required_roles: project.required_roles || [],
    team: (project.team || []).slice(0, 10).map(member => ({
      name: member.name,
      employee_id: member.employee_id,
      role: member.role_in_project,
    })),
  }));
}

function compactLeave(records) {
  return records.slice(0, 80).map(item => ({
    employee_name: item.employee_name || item.name,
    employee_id: item.employee_id,
    start_date: item.start_date,
    end_date: item.end_date,
    leave_type: item.leave_type,
    status: item.status,
  }));
}

function compactActivity(items) {
  const list = Array.isArray(items?.items) ? items.items : Array.isArray(items) ? items : [];
  return list.slice(0, 16).map(item => ({
    title: item.title || item.message || item.activity_type,
    description: item.description || item.details,
    created_at: item.created_at,
  }));
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function recordDateKey(value) {
  if (!value) return '';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : localDateKey(date);
}

function isActiveLeaveStatus(status) {
  return !['cancelled', 'canceled', 'rejected', 'declined'].includes(String(status || '').toLowerCase());
}

function isDateInRange(dateKey, start, end) {
  const startKey = recordDateKey(start);
  const endKey = recordDateKey(end || start);
  return Boolean(startKey && endKey && dateKey >= startKey && dateKey <= endKey);
}

function leaveDisplayName(item, employeesById) {
  return item.employee_name || employeesById.get(item.employee_id)?.name || 'Unknown employee';
}

function compactEmployeeLine(emp) {
  return {
    id: emp.id,
    name: emp.name,
    role: emp.role,
    team: emp.team,
    skills: (emp.skills || []).slice(0, 5),
  };
}

function buildWorkspaceSummary(context) {
  const employees = context.employees || [];
  const projects = context.projects || [];
  const leave = (context.leave || []).filter(item => isActiveLeaveStatus(item.status));
  const analytics = context.analytics || {};
  const today = localDateKey();
  const employeesById = new Map(employees.map(emp => [emp.id, emp]));

  const absentToday = leave
    .filter(item => isDateInRange(today, item.start_date, item.end_date))
    .map(item => ({
      employee_id: item.employee_id,
      name: leaveDisplayName(item, employeesById),
      leave_type: item.leave_type,
      start_date: recordDateKey(item.start_date),
      end_date: recordDateKey(item.end_date || item.start_date),
      status: item.status,
    }));

  const absentIds = new Set(absentToday.map(item => item.employee_id).filter(Boolean));
  const absentNames = new Set(absentToday.map(item => item.name).filter(Boolean));
  const availableEmployees = employees
    .filter(emp => emp.availability && !absentIds.has(emp.id) && !absentNames.has(emp.name))
    .map(compactEmployeeLine);
  const busyEmployees = employees
    .filter(emp => emp.availability === false)
    .map(compactEmployeeLine);

  const upcomingAbsences = leave
    .filter(item => {
      const start = recordDateKey(item.start_date);
      return start && start >= today && !isDateInRange(today, item.start_date, item.end_date);
    })
    .sort((a, b) => recordDateKey(a.start_date).localeCompare(recordDateKey(b.start_date)))
    .slice(0, 12)
    .map(item => ({
      employee_id: item.employee_id,
      name: leaveDisplayName(item, employeesById),
      leave_type: item.leave_type,
      start_date: recordDateKey(item.start_date),
      end_date: recordDateKey(item.end_date || item.start_date),
      status: item.status,
    }));

  const activeProjects = projects.filter(project => !['completed', 'cancelled', 'canceled'].includes(String(project.status || '').toLowerCase()));
  const criticalProjects = activeProjects
    .filter(project => Number.isFinite(Number(project.days_remaining)) && Number(project.days_remaining) <= 7)
    .sort((a, b) => Number(a.days_remaining) - Number(b.days_remaining))
    .slice(0, 10)
    .map(project => ({
      id: project.id,
      name: project.name,
      status: project.status,
      progress: project.progress,
      days_remaining: project.days_remaining,
    }));

  const skillCounts = new Map();
  employees.forEach(emp => (emp.skills || []).forEach(skill => {
    const key = String(skill || '').trim();
    if (key) skillCounts.set(key, (skillCounts.get(key) || 0) + 1);
  }));

  return {
    as_of: today,
    dashboard_totals: {
      total_employees: analytics.total_employees ?? employees.length,
      available: analytics.available ?? availableEmployees.length,
      busy: employees.filter(emp => emp.availability === false).length,
      on_leave: analytics.on_leave ?? absentToday.length,
      live_projects: analytics.live_projects ?? analytics.active_projects ?? activeProjects.length,
      completed_projects: analytics.completed_projects ?? projects.filter(project => String(project.status || '').toLowerCase() === 'completed').length,
      active_assignments: analytics.active_assignments ?? analytics.assignments ?? analytics.assigned_employees,
    },
    availability: {
      available_count: availableEmployees.length,
      busy_count: busyEmployees.length,
      available_employees: availableEmployees.slice(0, 20),
      busy_employees: busyEmployees.slice(0, 20),
    },
    absences: {
      absent_today_count: absentToday.length,
      absent_today: absentToday,
      upcoming_absences: upcomingAbsences,
    },
    projects: {
      total_count: projects.length,
      active_count: activeProjects.length,
      critical_projects: criticalProjects,
      overdue_projects: criticalProjects.filter(project => Number(project.days_remaining) < 0),
    },
    skills: {
      top_skills: [...skillCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([skill, count]) => ({ skill, count })),
    },
  };
}

function updateContextState(value, fromCache) {
  if (!miniContextEl) return;
  if (!value) {
    miniContextEl.textContent = 'Workspace context';
    return;
  }
  if (value === 'Refreshing context...') {
    miniContextEl.textContent = value;
    return;
  }
  const date = new Date(value);
  const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  miniContextEl.textContent = `${fromCache ? 'Cached' : 'Fresh'} context${time ? ` · ${time}` : ''}`;
}

function syncMiniVisibility(view = State.currentView) {
  const hide = view === 'ai';
  miniToggleEl?.classList.toggle('mini-ai-page-hidden', hide);
  if (hide) closeMiniAI();
}

function openMiniAI() {
  if (State.currentView === 'ai') return;
  miniWindowEl?.classList.add('open');
  renderMiniMessages();
  setTimeout(() => miniInputEl?.focus(), 50);
  getWorkspaceContext().catch(() => updateContextState('Context unavailable', false));
}

function closeMiniAI() {
  miniWindowEl?.classList.remove('open');
}

function toggleMiniAI() {
  if (State.currentView === 'ai') return;
  if (miniWindowEl?.classList.contains('open')) closeMiniAI();
  else openMiniAI();
}

function renderMiniMessages() {
  if (!miniMessagesEl) return;
  if (!miniMessages.length) {
    miniMessagesEl.innerHTML = `
      <div class="mini-ai-msg mini-ai-msg-bot">
        Ask about employees, project deadlines, availability, skills, assignments, or dashboard metrics.
      </div>`;
    return;
  }

  miniMessagesEl.innerHTML = miniMessages.map(item => `
    <div class="mini-ai-msg mini-ai-msg-${item.role}">
      <div style="white-space:pre-wrap">${escHtml(item.content || '')}</div>
    </div>`).join('');
  scrollMiniToBottom();
}

function pushMiniMessage(role, content) {
  miniMessages.push({ role, content });
  if (miniMessages.length > MINI_HISTORY_LIMIT) {
    miniMessages = miniMessages.slice(-MINI_HISTORY_LIMIT);
  }
  renderMiniMessages();
}

function miniHistoryForApi() {
  return miniMessages.slice(-8).map(item => ({
    role: item.role === 'bot' ? 'assistant' : 'user',
    content: item.content || '',
  }));
}

async function sendMiniQuestion() {
  if (isMiniSending) return;
  const question = miniInputEl?.value.trim();
  if (!question) return;

  isMiniSending = true;
  document.body.classList.add('mini-ai-thinking');
  const sendBtn = document.getElementById('mini-ai-send');
  if (sendBtn) sendBtn.disabled = true;

  miniInputEl.value = '';
  pushMiniMessage('user', question);
  const thinkingId = addThinkingMessage();

  try {
    const context = await getWorkspaceContext();
    const data = await askWorkspaceAI(question, context, miniHistoryForApi());
    updateMiniMessage(thinkingId, data.answer || fallbackAnswer(question, context));
  } catch (error) {
    const cached = loadStoredContext();
    updateMiniMessage(thinkingId, fallbackAnswer(question, cached, error));
  } finally {
    isMiniSending = false;
    document.body.classList.remove('mini-ai-thinking');
    if (sendBtn) sendBtn.disabled = false;
    miniInputEl?.focus();
  }
}

function addThinkingMessage() {
  const id = `thinking_${Date.now()}`;
  miniMessages.push({ id, role: 'bot', content: 'Thinking with workspace context...' });
  renderMiniMessages();
  return id;
}

function updateMiniMessage(id, content) {
  const item = miniMessages.find(msg => msg.id === id);
  if (item) item.content = content;
  else miniMessages.push({ role: 'bot', content });
  renderMiniMessages();
}

function fallbackAnswer(question, context, error = null) {
  if (!context) {
    return error?.message
      ? `I could not load the workspace context yet: ${error.message}`
      : 'I could not load the workspace context yet.';
  }

  const q = question.toLowerCase();
  const employees = context.employees || [];
  const projects = context.projects || [];
  const analytics = context.analytics || {};
  const summary = context.summary || buildWorkspaceSummary(context);

  if (/\bavailable|free|bench|open\b/.test(q)) {
    const available = summary.availability?.available_employees?.slice(0, 8) || employees.filter(emp => emp.availability).slice(0, 8);
    if (!available.length) return 'I do not see any available employees in the cached context.';
    return `Available employees:\n${available.map(emp => `- ${emp.name} (${emp.role || 'role unknown'}, ${emp.team || 'no team'})${emp.skills?.length ? ` · ${emp.skills.slice(0, 4).join(', ')}` : ''}`).join('\n')}`;
  }

  if (/\b(absent|absence|absentee|absentees|leave|leaves|on leave|out|ooo|oof|pto|vacation|sick)\b/.test(q)) {
    const absentToday = summary.absences?.absent_today || [];
    const upcoming = summary.absences?.upcoming_absences || [];
    const todayLabel = summary.as_of || localDateKey();
    const todayLines = absentToday.length
      ? absentToday.map(item => `- ${item.name}${item.leave_type ? ` · ${item.leave_type}` : ''} (${item.start_date}${item.end_date && item.end_date !== item.start_date ? ` to ${item.end_date}` : ''})`).join('\n')
      : 'No one is marked absent today in the cached context.';
    const upcomingLines = upcoming.length
      ? `\n\nUpcoming absences:\n${upcoming.slice(0, 6).map(item => `- ${item.name}${item.leave_type ? ` · ${item.leave_type}` : ''} (${item.start_date}${item.end_date && item.end_date !== item.start_date ? ` to ${item.end_date}` : ''})`).join('\n')}`
      : '';
    return `Absences for ${todayLabel}:\n${todayLines}${upcomingLines}`;
  }

  if (/\bdeadline|critical|due|overdue\b/.test(q)) {
    const due = projects
      .filter(project => Number.isFinite(Number(project.days_remaining)) && String(project.status || '').toLowerCase() !== 'completed')
      .sort((a, b) => Number(a.days_remaining) - Number(b.days_remaining))
      .slice(0, 6);
    if (!due.length) return 'I do not see upcoming project deadlines in the cached context.';
    return `Project deadlines:\n${due.map(project => `- ${project.name}: ${deadlineLabel(project.days_remaining)} · ${project.progress || 0}% complete`).join('\n')}`;
  }

  if (/\bproject|projects\b/.test(q)) {
    const active = projects.filter(project => !['completed', 'cancelled'].includes(String(project.status || '').toLowerCase()));
    return `Projects in context: ${projects.length} total, ${active.length} active.\n${active.slice(0, 6).map(project => `- ${project.name}: ${project.status || 'active'} · ${project.progress || 0}% · ${deadlineLabel(project.days_remaining)}`).join('\n')}`;
  }

  if (/\bemployee|employees|team|skill|skills\b/.test(q)) {
    return `Employees in context: ${employees.length}. Available: ${employees.filter(emp => emp.availability).length}. Busy: ${employees.filter(emp => emp.availability === false).length}.\n${employees.slice(0, 6).map(emp => `- ${emp.name}: ${emp.role || 'role unknown'} · ${emp.team || 'no team'}`).join('\n')}`;
  }

  const totals = summary.dashboard_totals || {};
  return `Dashboard snapshot:\n- Employees: ${totals.total_employees ?? analytics.total_employees ?? employees.length}\n- Live projects: ${totals.live_projects ?? analytics.live_projects ?? analytics.active_projects ?? projects.length}\n- Available: ${totals.available ?? employees.filter(emp => emp.availability).length}\n- Busy: ${totals.busy ?? employees.filter(emp => emp.availability === false).length}\n- Absent today: ${summary.absences?.absent_today_count ?? analytics.on_leave ?? 'not loaded'}\nAsk me about employees, projects, availability, absences, skills, or deadlines for a sharper answer.`;
}

function deadlineLabel(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return 'no deadline data';
  if (n < 0) return `overdue by ${Math.abs(n)}d`;
  if (n === 0) return 'due today';
  return `due in ${n}d`;
}

function scrollMiniToBottom() {
  if (miniMessagesEl) miniMessagesEl.scrollTop = miniMessagesEl.scrollHeight;
}

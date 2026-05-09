// ============================================================
// api.js — API Client & Health Check
// Osmium ERM · ERS API v1 + v2
// ============================================================

import { State } from '../utils/state.js';

const DEFAULT_GET_CACHE_TTL = 2 * 60 * 1000;
const cache = new Map();
const pendingGets = new Map();
let cacheVersion = 0;

function normalizedApiBase() {
  return (State.apiBase || '').trim().replace(/\/+$/, '');
}

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${normalizedApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
}

function cloneData(data) {
  if (data === null || data === undefined) return data;
  if (typeof structuredClone === 'function') return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

function cacheKey(path) {
  return `${normalizedApiBase()}${path}`;
}

export function invalidateApiCache(prefixes = []) {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  if (!list.length) {
    cacheVersion += 1;
    cache.clear();
    pendingGets.clear();
    return;
  }

  cacheVersion += 1;
  for (const key of [...cache.keys()]) {
    if (list.some(prefix => key.includes(prefix))) cache.delete(key);
  }
  for (const key of [...pendingGets.keys()]) {
    if (list.some(prefix => key.includes(prefix))) pendingGets.delete(key);
  }
}

function invalidationPrefixes(path) {
  if (path.startsWith('/employees')) return ['/employees', '/projects', '/teams', '/analytics', '/leave'];
  if (path.startsWith('/projects')) return ['/projects', '/employees', '/teams', '/analytics'];
  if (path.startsWith('/files') || path.startsWith('/upload')) return ['/files'];
  if (path.startsWith('/leave')) return ['/leave', '/analytics', '/employees'];
  if (path.startsWith('/activity')) return ['/activity'];
  if (path.startsWith('/auth/google/calendar') || path.startsWith('/calendar')) {
    return ['/auth/google/calendar', '/calendar'];
  }
  if (path.startsWith('/auth')) return ['/auth'];
  return [];
}

function authHeaders() {
  return State.auth?.accessToken ? { Authorization: `Bearer ${State.auth.accessToken}` } : {};
}

async function request(path, opts = {}) {
  const {
    cache: useCache = true,
    cacheTtl = DEFAULT_GET_CACHE_TTL,
    invalidate = null,
    headers = {},
    ...fetchOpts
  } = opts;
  const method = (fetchOpts.method || 'GET').toUpperCase();
  const url = apiUrl(path);
  const key = cacheKey(path);

  if (method === 'GET' && useCache !== false) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.time < cacheTtl) return cloneData(cached.data);

    if (pendingGets.has(key)) return cloneData(await pendingGets.get(key));

    const version = cacheVersion;
    const pending = request(path, { ...fetchOpts, headers, cache: false });
    pendingGets.set(key, pending);
    try {
      const data = await pending;
      if (version === cacheVersion) {
        cache.set(key, { data: cloneData(data), time: Date.now() });
      }
      return cloneData(data);
    } finally {
      pendingGets.delete(key);
    }
  }

  const res = await fetch(url, {
    ...fetchOpts,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    if (res.status === 401) {
      localStorage.removeItem('osmium_auth_session');
      State.set('auth', null);
      State.set('authProfile', null);
      State.resetWorkspaceData?.();
      State.emit('auth:unauthorized');
    }
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  if (method !== 'GET') {
    invalidateApiCache(invalidate || invalidationPrefixes(path));
  }

  if (res.status === 204) return null;
  const data = await res.json();

  return data;
}

// ─── HEALTH ──────────────────────────────────────────────────
export async function loginWithEmail(body) {
  return request('/auth/login', { method: 'POST', body: JSON.stringify(body) });
}

export async function getEmailAuthStatus(email) {
  return request(`/auth/email/status?email=${encodeURIComponent(email)}`);
}

export async function startEmailOtp(email, redirectTo = null) {
  return request('/auth/email/start', { method: 'POST', body: JSON.stringify({ email, redirect_to: redirectTo }) });
}

export async function verifyEmailOtp(email, token) {
  return request('/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, token }) });
}

export async function setAccountPassword(password) {
  return request('/auth/password', { method: 'POST', body: JSON.stringify({ password }) });
}

export async function getAuthProfile() {
  return request('/auth/me');
}

export async function logoutBackend() {
  return request('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
}

export async function checkHealth() {
  try {
    await request('/health', { cache: false });
    State.set('apiConnected', true);
    State.emit('api:status', 'ok');
    return true;
  } catch {
    State.set('apiConnected', false);
    State.emit('api:status', 'error');
    return false;
  }
}

// ─── ANALYTICS ───────────────────────────────────────────────
export async function getAnalytics() {
  return request('/analytics/summary');
}

// ─── EMPLOYEES ───────────────────────────────────────────────
export async function getEmployees() {
  const data = await request('/employees');
  const list = data.employees || data || [];
  State.set('employees', list);
  return list;
}

export async function getEmployee(id) {
  return request(`/employees/${id}`);
}

export async function createEmployee(body) {
  return request('/employees', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateEmployee(id, body) {
  return request(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

export async function deleteEmployee(id) {
  return request(`/employees/${id}`, { method: 'DELETE' });
}

export async function resolveLinkedInAvatar(url) {
  return request(`/employees/linkedin-avatar?url=${encodeURIComponent(url)}`);
}

export async function patchAvailability(id, available) {
  return request(`/employees/${id}/availability`, {
    method: 'PATCH',
    body: JSON.stringify({ availability: available }),
  });
}

export async function searchEmployees(params) {
  const normalized = { ...params };
  if (normalized.availability === 'true') normalized.availability = true;
  if (normalized.availability === 'false') normalized.availability = false;
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(normalized).filter(([, v]) => v !== '' && v !== null && v !== undefined))
  ).toString();
  const data = await request(`/employees/search?${qs}`);
  return data.employees || data || [];
}

export async function addSkill(empId, body) {
  return request(`/employees/${empId}/skills`, { method: 'POST', body: JSON.stringify(body) });
}

export async function addExperience(empId, body) {
  return request(`/employees/${empId}/experience`, { method: 'POST', body: JSON.stringify(body) });
}

// ─── TEAMS ───────────────────────────────────────────────────
export async function getOrgTree(managerId) {
  return request(`/teams/${managerId}/tree`);
}

// ─── PROJECTS ────────────────────────────────────────────────
export async function getProjects() {
  const data = await request('/projects');
  const list = Array.isArray(data) ? data : (data.projects || []);
  State.set('projects', list);
  return list;
}

export async function getProject(id) {
  return request(`/projects/${id}`);
}

export async function createProject(body) {
  return request('/projects', { method: 'POST', body: JSON.stringify(body) });
}

export async function assignToProject(projId, body) {
  return request(`/projects/${projId}/assign`, { method: 'POST', body: JSON.stringify(body) });
}

export async function unassignFromProject(projId, empId) {
  return request(`/projects/${projId}/assign/${empId}`, { method: 'DELETE' });
}

export async function getProjectTeam(projId) {
  return request(`/projects/${projId}/team`);
}

// ─── ACTIVITY ────────────────────────────────────────────────
export async function getActivityFeed(department = null, limit = 9) {
  let url = `/activity/feed?limit=${limit}`;
  if (department) url += `&department=${encodeURIComponent(department)}`;
  return request(url);
}

export async function postActivity(body) {
  return request('/activity/feed', { method: 'POST', body: JSON.stringify(body) });
}

// ─── FILES ───────────────────────────────────────────────────
export async function getFiles(department = null) {
  let url = '/files';
  if (department) url += `?department=${encodeURIComponent(department)}`;
  const files = await request(url);
  if (!department) State.set('files', files);
  return files;
}

export async function uploadFile(formData) {
  const res = await fetch(apiUrl('/upload'), {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  const data = await res.json();
  invalidateApiCache(invalidationPrefixes('/upload'));
  return data;
}

export async function deleteFile(id) {
  return request(`/files/${id}`, { method: 'DELETE' });
}

export async function linkFile(fileId, body) {
  return request(`/files/${fileId}/link`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ─── RAG / AI ─────────────────────────────────────────────────
export async function queryRAG(question, fileIds = []) {
  return request('/query', {
    method: 'POST',
    body: JSON.stringify({ question, file_ids: fileIds }),
  });
}

// ─── LEAVE MANAGEMENT ─────────────────────────────────────────
export async function getLeaveRecords() {
  const data = await request('/leave');
  return Array.isArray(data) ? data : (data.records || []);
}

export async function createLeaveRecord(body) {
  return request('/leave', { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteLeaveRecord(id) {
  return request(`/leave/${id}`, { method: 'DELETE' });
}

// ─── CALENDAR EVENTS ──────────────────────────────────────────
export async function getCalendarEvents(date = null) {
  let url = '/calendar/events';
  if (date) url += `?date=${date}`;
  return request(url);
}

export async function syncGoogleCalendar() {
  return request('/calendar/sync', { method: 'POST', body: JSON.stringify({}) });
}

// ─── GOOGLE CALENDAR INTEGRATION ──────────────────────────────
export async function getGoogleCalendarAuthUrl(redirectUri) {
  return request(`/auth/google/calendar/connect?redirect_uri=${encodeURIComponent(redirectUri)}`, {
    method: 'GET',
  });
}

export async function handleGoogleCalendarCallback(code, state) {
  return request(`/auth/google/calendar/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
}

export async function syncCalendarEvents() {
  return request('/auth/google/calendar/sync', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getGoogleCalendarEvents(days = 30) {
  return request(`/auth/google/calendar/events?days=${days}`);
}

export async function getGoogleCalendarStatus() {
  return request('/auth/google/calendar/status');
}

export async function disconnectGoogleCalendar() {
  return request('/auth/google/calendar/disconnect', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

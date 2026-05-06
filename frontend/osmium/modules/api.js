// ============================================================
// api.js — API Client & Health Check
// Osmium ERM · ERS API v1 + v2
// ============================================================

import { State } from '../utils/state.js';

async function request(path, opts = {}) {
  const url = State.apiBase + path;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── HEALTH ──────────────────────────────────────────────────
export async function checkHealth() {
  try {
    await request('/health');
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

export async function patchAvailability(id, available) {
  return request(`/employees/${id}/availability`, {
    method: 'PATCH',
    body: JSON.stringify({ availability: available }),
  });
}

export async function searchEmployees(params) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined))
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
  return request(url);
}

export async function uploadFile(formData) {
  const res = await fetch(State.apiBase + '/upload', {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
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

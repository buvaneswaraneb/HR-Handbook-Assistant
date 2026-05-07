// ============================================================
// auth.js — Email/Password Authentication
// Osmium ERM · protected shell integration
// ============================================================

import { State } from '../utils/state.js';
import { showToast } from './ui.js';
import { escHtml } from '../utils/helpers.js';
import { getAuthProfile, loginWithEmail, logoutBackend } from './api.js';

export async function initAuth() {
  bindAuthForm();
  restoreEmailSession();
  renderAuthShell();
  return Boolean(State.auth?.accessToken);
}

function bindAuthForm() {
  document.getElementById('auth-email-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    await signInEmail();
  });
  document.getElementById('logout-btn')?.addEventListener('click', logout);
}

function restoreEmailSession() {
  if (State.auth?.accessToken) return;
  const saved = JSON.parse(localStorage.getItem('osmium_auth_session') || 'null');
  if (!saved?.accessToken) return;
  State.set('auth', saved);
  renderAuthShell();
}

function persistSession(auth) {
  localStorage.setItem('osmium_auth_session', JSON.stringify(auth));
}

async function signInEmail() {
  const email = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value || '';
  const btn = document.getElementById('auth-email-btn');
  if (!email || !password) return showToast('Email and password are required.', 'error');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

  try {
    const data = await loginWithEmail({ email, password });
    const auth = {
      provider: 'email',
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: data.expires_at || null,
      user: {
        id: data.user_id,
        email: data.email,
        name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.email,
      },
    };
    State.set('auth', auth);
    persistSession(auth);
    showToast('Signed in successfully.');
    renderAuthShell();
    window.loadDashboardGlobal?.();
  } catch (e) {
    showToast(e.message || 'Sign in failed.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in with email'; }
  }
}

export async function logout() {
  try { await logoutBackend(); } catch {}
  clearSession();
  showToast('Signed out.');
}

function clearSession() {
  localStorage.removeItem('osmium_auth_session');
  State.set('auth', null);
  State.set('authProfile', null);
  renderAuthShell();
}

export function renderAuthShell() {
  const hasAuth = Boolean(State.auth?.accessToken);
  document.body.classList.toggle('auth-required', !hasAuth);
  document.getElementById('auth-screen')?.setAttribute('aria-hidden', hasAuth ? 'true' : 'false');

  const user = State.auth?.user;
  const nameEl = document.getElementById('auth-user-name');
  const emailEl = document.getElementById('auth-user-email');
  const avatarEl = document.getElementById('auth-user-avatar');
  if (nameEl) nameEl.textContent = user?.name || 'Not signed in';
  if (emailEl) emailEl.textContent = user?.email || 'Protected workspace';
  if (avatarEl) avatarEl.innerHTML = user?.avatar
    ? `<img src="${escHtml(user.avatar)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
    : `<span class="material-symbols-outlined" style="font-size:16px">person</span>`;
}

// ============================================================
// auth.js — Backend-mediated Supabase Google OAuth + Email Auth
// Osmium ERM · protected shell integration
// ============================================================

import { State } from '../utils/state.js';
import { showToast } from './ui.js';
import { escHtml } from '../utils/helpers.js';
import { getAuthProfile, loginWithEmail, logoutBackend } from './api.js';

let authPopup = null;
let authReady = false;

/**
 * Decode a JWT payload (base64url) without verifying the signature.
 * Returns the parsed claims object, or {} if it fails.
 */
function decodeJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export async function initAuth() {
  bindAuthForm();
  bindOAuthMessageHandler();

  if (handleOAuthPopupReturn()) return false;

  restoreStoredSession();
  authReady = true;
  renderAuthShell();
  return Boolean(State.auth?.accessToken);
}

function bindAuthForm() {
  document.getElementById('auth-email-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    await signInEmail();
  });
  document.getElementById('auth-google-btn')?.addEventListener('click', signInGoogle);
  document.getElementById('logout-btn')?.addEventListener('click', logout);
}

function bindOAuthMessageHandler() {
  window.addEventListener('message', async event => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== 'osmium:supabase-oauth') return;

    if (event.data.error) {
      showToast(event.data.error, 'error');
      return;
    }

    if (!event.data.accessToken) {
      showToast('Google sign-in did not return a session.', 'error');
      return;
    }

    await applyOAuthSession(event.data);
  });
}

function handleOAuthPopupReturn() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, '') || window.location.search.replace(/^\?/, ''));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresIn = params.get('expires_in');
  const error = params.get('error_description') || params.get('error');

  if (!accessToken && !error) return false;

  if (window.opener) {
    window.opener.postMessage({
      type: 'osmium:supabase-oauth',
      accessToken,
      refreshToken,
      expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + Number(expiresIn) : null,
      error,
    }, window.location.origin);
    window.close();
  }
  return true;
}

async function applyOAuthSession(session) {
  // ── 1. Decode the JWT immediately to get Google identity ──────────────────
  const claims = decodeJwt(session.accessToken);
  // Supabase Google tokens carry user_metadata with name/picture/email
  const meta = claims.user_metadata || claims.app_metadata || {};
  const jwtName  = meta.full_name || meta.name || claims.name || null;
  const jwtEmail = meta.email || claims.email || null;
  const jwtPic   = meta.avatar_url || meta.picture || claims.picture || null;

  const auth = {
    provider: 'google',
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || null,
    expiresAt: session.expiresAt || null,
    user: {
      id: claims.sub || null,
      email: jwtEmail || 'Google account',
      name:  jwtName  || jwtEmail || 'Google account',
      avatar: jwtPic  || null,
    },
  };

  State.set('auth', auth);
  persistSession(auth);
  renderAuthShell();          // show name/avatar immediately from JWT

  // ── 2. Enrich with backend profile (non-blocking) ─────────────────────────
  try {
    const profile = await getAuthProfile();
    State.set('authProfile', profile);
    const nextAuth = {
      ...auth,
      user: {
        id: profile.user_id || auth.user.id,
        email: profile.email || auth.user.email,
        name: [profile.first_name, profile.last_name].filter(Boolean).join(' ')
              || profile.email
              || auth.user.name,
        avatar: profile.avatar_url || auth.user.avatar || null,
      },
    };
    State.set('auth', nextAuth);
    persistSession(nextAuth);
    renderAuthShell();        // update again if backend enriched anything
  } catch {
    // Keep the JWT-backed session even if the profile endpoint is unavailable.
  }

  showToast(`Welcome, ${State.auth.user.name || 'back'}!`);
  window.loadDashboardGlobal?.();
}

function restoreStoredSession() {
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

function signInGoogle() {
  const redirectTo = window.location.origin + window.location.pathname;
  const url = `${State.apiBase}/auth/google/login?redirect_to=${encodeURIComponent(redirectTo)}`;
  const width = 520;
  const height = 680;
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);

  authPopup = window.open(
    url,
    'osmium-google-login',
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );

  if (!authPopup) {
    showToast('Popup blocked. Allow popups for this site and try again.', 'error');
    return;
  }
  authPopup.focus();
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

  // ── Topbar user pill ──────────────────────────────────────────────────────
  const nameEl   = document.getElementById('auth-user-name');
  const emailEl  = document.getElementById('auth-user-email');
  const avatarEl = document.getElementById('auth-user-avatar');
  if (nameEl)  nameEl.textContent  = user?.name  || 'Not signed in';
  if (emailEl) emailEl.textContent = user?.email || 'Protected workspace';
  if (avatarEl) avatarEl.innerHTML = user?.avatar
    ? `<img src="${escHtml(user.avatar)}" alt="${escHtml(user.name || '')}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;border:1.5px solid var(--gl-outline-2)">`
    : `<span class="material-symbols-outlined" style="font-size:16px">person</span>`;

  // ── Auth-screen Google button: reflect signed-in state ───────────────────
  const googleBtn = document.getElementById('auth-google-btn');
  if (googleBtn) {
    if (authReady && !hasAuth) {
      // Signed-out state – restore default button
      googleBtn.disabled = false;
      googleBtn.innerHTML = `
        <span class="material-symbols-outlined" style="font-size:18px;color:#3dd68c">account_circle</span>
        Continue with Google`;
    } else if (hasAuth && user && State.auth?.provider === 'google') {
      // Signed-in via Google – show avatar + name inside the button
      const avatarHtml = user.avatar
        ? `<img src="${escHtml(user.avatar)}" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1.5px solid rgba(255,255,255,0.25)">`
        : `<span class="material-symbols-outlined" style="font-size:18px;color:#3dd68c">account_circle</span>`;
      googleBtn.innerHTML = `
        ${avatarHtml}
        <span style="font-size:0.82rem;font-weight:600">${escHtml(user.name || user.email || 'Google')}</span>
        <span style="font-size:0.72rem;color:var(--gl-on-surface-4);margin-left:2px">✓</span>`;
      googleBtn.disabled = true;
      googleBtn.style.opacity = '0.85';
      googleBtn.style.cursor  = 'default';
    }
  }
}

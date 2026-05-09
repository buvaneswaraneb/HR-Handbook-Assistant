// ============================================================
// auth.js — Backend-mediated Supabase Google OAuth + Email Auth
// Osmium ERM · protected shell integration
// ============================================================

import { State } from '../utils/state.js';
import { showToast } from './ui.js';
import { escHtml } from '../utils/helpers.js';
import { getAuthProfile, getEmailAuthStatus, loginWithEmail, logoutBackend, setAccountPassword, startEmailOtp } from './api.js';

let authPopup = null;
let authReady = false;
let signInResetTimer = null;
let authEmailMode = 'email';

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
  bindUnauthorizedHandler();

  if (await handleOAuthReturn()) return Boolean(State.auth?.accessToken);

  await restoreStoredSession();
  authReady = true;
  renderAuthShell();
  return Boolean(State.auth?.accessToken);
}

function bindAuthForm() {
  document.getElementById('auth-email-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    await signInEmail();
  });
  document.getElementById('auth-email')?.addEventListener('input', resetEmailAuthForm);
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

function bindUnauthorizedHandler() {
  State.on('auth:unauthorized', () => {
    renderAuthShell();
  });
}

async function handleOAuthReturn() {
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
    return true;
  }

  if (error) {
    showToast(error, 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
    return false;
  }

  await applyOAuthSession({
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + Number(expiresIn) : null,
  }, 'email-magic-link');
  window.history.replaceState({}, document.title, window.location.pathname);
  return true;
}

async function applyOAuthSession(session, provider = 'google') {
  // ── 1. Decode the JWT immediately to get Google identity ──────────────────
  const claims = decodeJwt(session.accessToken);
  // Supabase Google tokens carry user_metadata with name/picture/email
  const meta = claims.user_metadata || claims.app_metadata || {};
  const jwtName  = meta.full_name || meta.name || claims.name || null;
  const jwtEmail = meta.email || claims.email || null;
  const jwtPic   = meta.avatar_url || meta.picture || claims.picture || null;

  const auth = {
    provider,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken || null,
    expiresAt: session.expiresAt || null,
    workplaceId: claims.sub || null,
    user: {
      id: claims.sub || null,
      email: jwtEmail || 'Google account',
      name:  jwtName  || jwtEmail || 'Google account',
      avatar: jwtPic  || null,
    },
  };

  setAuthenticatedSession(auth);
  persistSession(auth);
  renderAuthShell();          // show name/avatar immediately from JWT

  // ── 2. Enrich with backend profile ────────────────────────────────────────
  let profile = null;
  try {
    profile = await getAuthProfile();
    State.set('authProfile', profile);
    const nextAuth = {
      ...auth,
      workplaceId: profile.workplace_id || profile.user_id || auth.workplaceId,
      user: {
        id: profile.user_id || auth.user.id,
        email: profile.email || auth.user.email,
        name: [profile.first_name, profile.last_name].filter(Boolean).join(' ')
              || profile.email
              || auth.user.name,
        avatar: profile.avatar_url || auth.user.avatar || null,
      },
    };
    setAuthenticatedSession(nextAuth);
    persistSession(nextAuth);
    renderAuthShell();        // update again if backend enriched anything
  } catch (e) {
    if (provider !== 'email-magic-link') {
      // Keep OAuth sessions usable even if optional profile enrichment fails.
    } else {
      showToast('Set a password to finish sign-in.');
    }
  }

  if (provider === 'email-magic-link') {
    const hasPassword = profile?.password_configured === true;
    if (!hasPassword && !await ensurePasswordConfigured(profile)) {
      return;
    }
  }

  showToast(`Welcome, ${State.auth.user.name || 'back'}!`);
  window.loadDashboardGlobal?.();
}

async function restoreStoredSession() {
  const saved = JSON.parse(localStorage.getItem('osmium_auth_session') || 'null');
  if (!saved?.accessToken) return;

  if (isSessionExpired(saved)) {
    clearSession({ silent: true });
    return;
  }

  setAuthenticatedSession(saved);
  renderAuthShell();

  try {
    const profile = await getAuthProfile();
    State.set('authProfile', profile);
    const nextAuth = {
      ...saved,
      workplaceId: profile.workplace_id || profile.user_id || saved.workplaceId,
      user: {
        ...(saved.user || {}),
        id: profile.user_id || saved.user?.id || null,
        email: profile.email || saved.user?.email || 'Account',
        name: [profile.first_name, profile.last_name].filter(Boolean).join(' ')
              || profile.email
              || saved.user?.name
              || 'Account',
        avatar: profile.avatar_url || saved.user?.avatar || null,
      },
    };
    setAuthenticatedSession(nextAuth);
    persistSession(nextAuth);
  } catch {
    clearSession({ silent: true });
  }
}

function persistSession(auth) {
  localStorage.setItem('osmium_auth_session', JSON.stringify(auth));
}

async function signInEmail() {
  const email = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value || '';
  const btn = document.getElementById('auth-email-btn');
  if (!email) return showToast('Email is required.', 'error');
  if (btn) { btn.disabled = true; btn.textContent = authEmailMode === 'password' ? 'Signing in...' : 'Checking...'; }

  try {
    if (authEmailMode === 'password') {
      if (!password) {
        showToast('Password is required.', 'error');
        return;
      }
      const data = await loginWithEmail({ email, password });
      applyPasswordSession(data);
      return;
    }

    const status = await getEmailAuthStatus(email);
    if (status.password_configured) {
      showPasswordLoginStep();
      return;
    }

    const redirectTo = window.location.origin + window.location.pathname;
    await startEmailOtp(email, redirectTo);
    showToast('Check your inbox for the sign-in link.');
    if (btn) {
      btn.textContent = 'Check your inbox';
      clearTimeout(signInResetTimer);
      signInResetTimer = setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }, 60000);
    }
  } catch (e) {
    showToast(e.message || 'Could not send sign-in link.', 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
    return;
  } finally {
    if (btn?.textContent !== 'Check your inbox') {
      btn.disabled = false;
      btn.textContent = authEmailMode === 'password' ? 'Sign in with password' : 'Sign in';
    }
  }
}

function applyPasswordSession(data) {
  const auth = {
    provider: 'password',
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: data.expires_at || null,
    workplaceId: data.workplace_id || data.user_id,
    user: {
      id: data.user_id,
      email: data.email,
      name: [data.first_name, data.last_name].filter(Boolean).join(' ') || data.email,
    },
  };
  setAuthenticatedSession(auth);
  persistSession(auth);
  showToast('Signed in successfully.');
  renderAuthShell();
  window.loadDashboardGlobal?.();
}

function showPasswordLoginStep() {
  authEmailMode = 'password';
  const wrap = document.getElementById('auth-password-wrap');
  const input = document.getElementById('auth-password');
  const btn = document.getElementById('auth-email-btn');
  const helper = document.getElementById('auth-email-helper');
  if (wrap) wrap.style.display = 'block';
  if (input) {
    input.value = '';
    input.focus();
  }
  if (helper) helper.textContent = 'This account has a password. Enter it to continue.';
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Sign in with password';
  }
}

function resetEmailAuthForm() {
  authEmailMode = 'email';
  clearTimeout(signInResetTimer);
  const wrap = document.getElementById('auth-password-wrap');
  const input = document.getElementById('auth-password');
  const btn = document.getElementById('auth-email-btn');
  const helper = document.getElementById('auth-email-helper');
  if (wrap) wrap.style.display = 'none';
  if (input) input.value = '';
  if (helper) helper.textContent = 'We will email a sign-in link. New users are created after verification.';
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function ensurePasswordConfigured(profile) {
  if (profile?.password_configured) return true;
  return showPasswordSetupDialog();
}

function showPasswordSetupDialog() {
  return new Promise(resolve => {
    let overlay = document.getElementById('auth-password-setup');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'auth-password-setup';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.62);display:flex;align-items:center;justify-content:center;padding:20px';
      overlay.innerHTML = `
        <form id="auth-password-setup-form" class="auth-card" style="width:min(420px,100%);padding:22px" autocomplete="off">
          <div style="font-size:1rem;font-weight:800;color:var(--gl-on-surface);margin-bottom:6px">Create your password</div>
          <div style="font-size:0.8rem;color:var(--gl-on-surface-3);line-height:1.45;margin-bottom:16px">Use this password for future sign-ins. Magic links will still be available for accounts without a password.</div>
          <div class="label">Password</div>
          <input id="setup-password" class="input" type="password" autocomplete="new-password" minlength="8" required>
          <div class="label" style="margin-top:12px">Confirm Password</div>
          <input id="setup-password-confirm" class="input" type="password" autocomplete="new-password" minlength="8" required>
          <button id="setup-password-btn" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:16px" type="submit">Save password</button>
        </form>`;
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';

    const form = document.getElementById('auth-password-setup-form');
    const btn = document.getElementById('setup-password-btn');
    const passwordInput = document.getElementById('setup-password');
    const confirmInput = document.getElementById('setup-password-confirm');
    passwordInput?.focus();
    form.onsubmit = async e => {
      e.preventDefault();
      const password = passwordInput?.value || '';
      const confirm = confirmInput?.value || '';
      if (password.length < 8) return showToast('Password must be at least 8 characters.', 'error');
      if (password !== confirm) return showToast('Passwords do not match.', 'error');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
      }
      try {
        await setAccountPassword(password);
        const profile = await getAuthProfile().catch(() => null);
        if (profile) State.set('authProfile', profile);
        overlay.style.display = 'none';
        showToast('Password saved.');
        resolve(true);
      } catch (err) {
        showToast(err.message || 'Could not save password.', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Save password';
        }
      }
    };
  });
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

function clearSession(options = {}) {
  localStorage.removeItem('osmium_auth_session');
  State.set('auth', null);
  State.set('authProfile', null);
  State.resetWorkspaceData?.();
  renderAuthShell();
  if (!options.silent) window.switchViewGlobal?.('dashboard');
}

function setAuthenticatedSession(auth) {
  const previousWorkplace = State.auth?.workplaceId || State.auth?.user?.id || null;
  const nextWorkplace = auth?.workplaceId || auth?.user?.id || null;
  if (previousWorkplace && nextWorkplace && previousWorkplace !== nextWorkplace) {
    State.resetWorkspaceData?.();
  }
  State.set('auth', auth);
}

function isSessionExpired(auth) {
  if (!auth?.expiresAt) return false;
  const expiresAt = typeof auth.expiresAt === 'number'
    ? auth.expiresAt
    : Math.floor(new Date(auth.expiresAt).getTime() / 1000);
  return Number.isFinite(expiresAt) && expiresAt <= Math.floor(Date.now() / 1000) + 30;
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

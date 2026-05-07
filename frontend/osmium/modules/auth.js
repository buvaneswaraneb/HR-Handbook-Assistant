// ============================================================
// auth.js — Supabase Google Auth + Email Session Handling
// Osmium ERM · protected shell integration
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { State } from '../utils/state.js';
import { showToast } from './ui.js';
import { escHtml } from '../utils/helpers.js';
import { getAuthProfile, loginWithEmail, logoutBackend } from './api.js';

let supabase = null;
let authReady = false;

function getSupabaseConfig() {
  const saved = JSON.parse(localStorage.getItem('osmium_auth_config') || '{}');
  return {
    url: saved.url || window.OSMIUM_SUPABASE_URL || '',
    anonKey: saved.anonKey || window.OSMIUM_SUPABASE_ANON_KEY || '',
  };
}

function ensureSupabaseClient() {
  const { url, anonKey } = getSupabaseConfig();
  State.set('supabaseConfigured', Boolean(url && anonKey));
  if (!url || !anonKey) return null;
  if (!supabase) {
    supabase = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  }
  return supabase;
}

export async function initAuth() {
  bindAuthForm();
  bindConfigForm();
  renderStoredConfig();

  const client = ensureSupabaseClient();
  if (client) {
    const { data } = await client.auth.getSession();
    if (data?.session) await applySession(data.session, 'google');

    client.auth.onAuthStateChange(async (event, session) => {
      if (session) await applySession(session, 'google');
      if (event === 'SIGNED_OUT') clearSession();
    });
  }

  restoreEmailSession();
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

function bindConfigForm() {
  document.getElementById('auth-config-form')?.addEventListener('submit', e => {
    e.preventDefault();
    const url = document.getElementById('auth-supabase-url')?.value.trim() || '';
    const anonKey = document.getElementById('auth-supabase-key')?.value.trim() || '';
    localStorage.setItem('osmium_auth_config', JSON.stringify({ url, anonKey }));
    supabase = null;
    ensureSupabaseClient();
    showToast('Supabase auth configuration saved.');
    renderAuthShell();
  });
}

function renderStoredConfig() {
  const { url, anonKey } = getSupabaseConfig();
  const urlEl = document.getElementById('auth-supabase-url');
  const keyEl = document.getElementById('auth-supabase-key');
  if (urlEl) urlEl.value = url;
  if (keyEl) keyEl.value = anonKey;
}

async function applySession(session, provider) {
  const user = session.user || {};
  const auth = {
    provider,
    accessToken: session.access_token,
    refreshToken: session.refresh_token || null,
    expiresAt: session.expires_at || null,
    user: {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.email || 'Authenticated user',
      avatar: user.user_metadata?.avatar_url || null,
    },
  };
  State.set('auth', auth);
  persistSession(auth);

  try {
    const profile = await getAuthProfile();
    State.set('authProfile', profile);
  } catch {
    // Backend may be offline or JWT secret may not be configured yet.
  }
  renderAuthShell();
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

async function signInGoogle() {
  const client = ensureSupabaseClient();
  if (!client) {
    showToast('Add Supabase URL and anon key before Google sign-in.', 'error');
    document.getElementById('auth-supabase-url')?.focus();
    return;
  }
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) showToast(error.message, 'error');
}

export async function logout() {
  const provider = State.auth?.provider;
  try { await logoutBackend(); } catch {}
  if (provider === 'google') {
    const client = ensureSupabaseClient();
    try { await client?.auth.signOut(); } catch {}
  }
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

  const googleBtn = document.getElementById('auth-google-btn');
  if (googleBtn && authReady) googleBtn.disabled = !State.supabaseConfigured;
}

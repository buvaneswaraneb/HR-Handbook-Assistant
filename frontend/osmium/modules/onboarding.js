// ============================================================
// onboarding.js - First-time guided product tour
// Osmium ERM - Glacier Design System
// ============================================================

import { State } from '../utils/state.js';

const STORAGE_PREFIX = 'osmium_onboarding_v1';
const TOUR_VERSION = 1;
const VIEW_DELAY = 180;
const SPOTLIGHT_PAD = 6;
const VIEWPORT_PAD = 20;
const TOOLTIP_GAP = 14;
const TOOLTIP_W = 340;

let root;
let dimPanels = [];
let spotlight;
let tooltip;
let modal;
let currentIndex = 0;
let active = false;
let pendingStart = null;
let frame = 0;
let rafQueued = false;
let currentTarget = null;
let currentTargetListener = null;
let currentEventListener = null;

const steps = [
  {
    kind: 'welcome',
    title: 'Welcome to Osmium',
    body: "Let's take a quick tour of the platform.",
    icon: 'token',
  },
  {
    view: 'dashboard',
    target: '[data-tour="dashboard-summary"]',
    title: 'Dashboard',
    body: 'Track employee statistics, active projects, leave overview, AI access, and the Google Calendar placeholder from the dashboard.',
    icon: 'dashboard',
  },
  {
    target: '[data-tour="add-employee"]',
    title: 'Add Employee',
    body: 'Start by adding employees to your workspace. Click the "+ Add New" button to open the form, or click Next to skip.',
    icon: 'person_add',
    preferredPlacement: 'right',
    spotlightPad: 2,
    autoAdvanceOnClick: true,
    closeModal: 'add-employee-modal',
    nextIndexOnSkip: 8,
  },
  {
    target: '#add-employee-modal .modal',
    title: 'Employee Profile',
    body: 'This is the employee profile card where you define all details for the new team member.',
    icon: 'id_card',
    spotlightPad: 5,
  },
  {
    target: '#new-emp-name',
    title: 'Full Name',
    body: 'Enter the new employee\'s full name here.',
    icon: 'badge',
  },
  {
    target: '#new-emp-role',
    title: 'Role',
    body: 'Select the employee\'s role. This helps organize the team structure.',
    icon: 'work',
  },
  {
    target: '#new-emp-team',
    title: 'Team',
    body: 'Assign them to a team (e.g. Platform, Design, Marketing).',
    icon: 'groups',
  },
  {
    target: '#add-emp-btn',
    title: 'Create Employee',
    body: 'Click "Create Employee" to save the profile and continue.',
    icon: 'save',
    advanceOnEvent: 'data:employees:refresh',
  },
  {
    view: 'employees',
    target: '[data-tour="employees-list"]',
    title: 'Employee Management',
    body: 'Browse employees, edit profiles, search by skill or team, and keep availability visible for planning.',
    icon: 'group',
  },
  {
    view: 'projects',
    target: '[data-tour="add-project"]',
    title: 'Add Project',
    body: 'Create projects with managers, team leads, team members, required skills, and roles needed for delivery.',
    icon: 'create_new_folder',
    spotlightPad: 5,
  },
  {
    view: 'canvas',
    target: '[data-tour="canvas-workspace"]',
    title: 'Canvas',
    body: 'Use the canvas to visually organize teams and project hierarchies. Drag employee nodes, connect relationships, and assign manager, team lead, or member roles.',
    icon: 'hub',
  },
  {
    view: 'tree',
    target: '[data-tour="org-tree-view"]',
    title: 'Org Tree',
    body: 'Review a static organization structure with manager, team lead, and team member rows in one hierarchy view.',
    icon: 'account_tree',
  },
  {
    view: 'leave',
    target: '[data-tour="leave-overview"]',
    title: 'Leave Management',
    body: 'Understand leave statistics, absence colors, availability awareness, and overview charts for workforce planning.',
    icon: 'event_busy',
  },
  {
    target: '[data-tour="mini-ai"]',
    title: 'Mini AI Shortcut',
    body: 'Open a compact assistant from anywhere in the workspace when you need quick help without leaving your current view.',
    icon: 'auto_awesome',
    preferredPlacement: 'bottom',
    spotlightPad: 7,
    spotlightRadius: '12px',
  },
  {
    view: 'ai',
    target: '[data-tour="hr-handbook-view"]',
    title: 'HR Handbook Assistant',
    body: 'Use the HR Handbook Assistant to upload or attach PDF handbooks, ask policy questions, view citations, preview sources, and continue handbook conversations.',
    icon: 'smart_toy',
    preferredPlacement: 'left',
    spotlightPad: 8,
  },
  {
    kind: 'complete',
    title: "You're ready to start using Osmium.",
    body: 'Explore your workspace, build teams, and use the canvas whenever you want a visual planning view.',
    icon: 'task_alt',
  },
];

export function initOnboarding() {
  ensureRoot();
  window.startOnboardingTour = startOnboardingTour;
  window.restartOnboardingTour = () => startOnboardingTour({ force: true });
  window.simulateFirstTimeOnboarding = simulateFirstTimeOnboarding;
  window.maybeStartOnboardingAfterLogin = maybeStartOnboardingAfterLogin;
  window.completeOnboarding = completeOnboarding;
  window.skipOnboarding = skipOnboarding;

  window.addEventListener('resize', schedulePosition);
  window.addEventListener('scroll', schedulePosition, true);
  document.addEventListener('keydown', onKeyDown);
}

export function maybeStartOnboardingAfterLogin() {
  if (!State.auth?.accessToken || active || hasCompletedOnboarding()) return;
  clearTimeout(pendingStart);
  pendingStart = setTimeout(() => {
    if (!State.auth?.accessToken || hasCompletedOnboarding()) return;
    startOnboardingTour();
  }, 650);
}

export function startOnboardingTour({ force = false } = {}) {
  if (!State.auth?.accessToken && !force) return;
  ensureRoot();
  if (!force && hasCompletedOnboarding()) return;
  clearTimeout(pendingStart);
  active = true;
  currentIndex = 0;
  root.classList.add('active');
  root.setAttribute('aria-hidden', 'false');
  renderStep();
}

export function completeOnboarding(destination = 'dashboard') {
  saveCompletion();
  closeTour();
  if (destination) window.switchViewGlobal?.(destination);
}

export function skipOnboarding() {
  saveCompletion();
  closeTour();
}

export function simulateFirstTimeOnboarding() {
  try { localStorage.removeItem(currentUserKey()); } catch {}
  startOnboardingTour({ force: true });
}

function ensureRoot() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'onboarding-root';
  root.className = 'onboarding-root';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="onboarding-overlay" data-tour-action="block"></div>
    <div class="onboarding-dim onboarding-dim-top"></div>
    <div class="onboarding-dim onboarding-dim-right"></div>
    <div class="onboarding-dim onboarding-dim-bottom"></div>
    <div class="onboarding-dim onboarding-dim-left"></div>
    <div class="onboarding-spotlight" aria-hidden="true"></div>
    <section class="onboarding-tooltip" role="dialog" aria-live="polite" aria-label="Product tour"></section>
    <section class="onboarding-modal" role="dialog" aria-modal="true" aria-label="Product tour"></section>
  `;
  document.body.appendChild(root);
  dimPanels = [...root.querySelectorAll('.onboarding-dim')];
  spotlight = root.querySelector('.onboarding-spotlight');
  tooltip = root.querySelector('.onboarding-tooltip');
  modal = root.querySelector('.onboarding-modal');
}

function currentUserKey() {
  const user = State.auth?.user || {};
  return `${STORAGE_PREFIX}:${user.id || user.email || 'anonymous'}`;
}

function hasCompletedOnboarding() {
  try {
    const saved = JSON.parse(localStorage.getItem(currentUserKey()) || 'null');
    return saved?.hasCompletedOnboarding === true && saved?.version === TOUR_VERSION;
  } catch {
    return false;
  }
}

function saveCompletion() {
  try {
    localStorage.setItem(currentUserKey(), JSON.stringify({
      hasCompletedOnboarding: true,
      completedAt: new Date().toISOString(),
      version: TOUR_VERSION,
    }));
  } catch {}
}

async function renderStep() {
  const step = steps[currentIndex];
  if (!step) return closeTour();

  if (step.view && State.currentView !== step.view) {
    window.switchViewGlobal?.(step.view);
    await wait(VIEW_DELAY);
  }

  if (step.closeModal) {
    window.closeModal?.(step.closeModal);
    await wait(300); // let it animate out
  }

  const isModal = step.kind === 'welcome' || step.kind === 'complete';
  root.classList.toggle('is-modal-step', isModal);
  root.classList.toggle('is-target-step', !isModal);
  root.classList.remove('has-fallback');
  if (isModal) renderModal(step);
  else renderTooltip(step);
}

function renderModal(step) {
  tooltip.classList.remove('visible');
  spotlight.classList.remove('visible');
  hideTargetDimming();
  modal.innerHTML = `
    <div class="onboarding-modal-icon">
      ${(!step.icon || step.icon === 'token') 
          ? '<img src="icon/osmium_logo.svg" alt="Osmium" style="width:24px;height:24px;display:block">' 
          : `<span class="material-symbols-outlined">${step.icon}</span>`}
    </div>
    <h2>${escapeHtml(step.title)}</h2>
    <p>${escapeHtml(step.body)}</p>
    <div class="onboarding-modal-actions">
      ${step.kind === 'complete'
        ? `<button type="button" class="btn btn-secondary" data-tour-action="dashboard">Go to Dashboard</button>
           <button type="button" class="btn btn-primary" data-tour-action="canvas">Open Canvas</button>`
        : `<button type="button" class="btn btn-ghost" data-tour-action="skip">Skip</button>
           <button type="button" class="btn btn-primary" data-tour-action="next">Start Tour</button>`}
    </div>
  `;
  modal.classList.add('visible');
  bindActions(modal);
  modal.querySelector('button:last-child')?.focus({ preventScroll: true });
}

function renderTooltip(step) {
  modal.classList.remove('visible');
  tooltip.innerHTML = `
    <div class="onboarding-tooltip-top">
      <div class="onboarding-tooltip-icon">
        <span class="material-symbols-outlined">${step.icon || 'info'}</span>
      </div>
      <div class="onboarding-progress">${currentIndex}/${steps.length - 2}</div>
    </div>
    <h3>${escapeHtml(step.title)}</h3>
    <p>${escapeHtml(step.body)}</p>
    <div class="onboarding-tooltip-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-tour-action="skip">Skip Tutorial</button>
      <div class="onboarding-nav-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-tour-action="back" ${currentIndex <= 1 ? 'disabled' : ''}>Back</button>
        ${(step.advanceOnEvent || (step.autoAdvanceOnClick && !step.nextIndexOnSkip)) ? '' : `<button type="button" class="btn btn-primary btn-sm" data-tour-action="next">Next</button>`}
      </div>
    </div>
  `;
  bindActions(tooltip);
  tooltip.classList.add('visible');
  requestAnimationFrame(() => {
    positionTargetStep(step);
    tooltip.querySelector('[data-tour-action="next"]')?.focus({ preventScroll: true });
  });
}

function bindActions(container) {
  container.querySelectorAll('[data-tour-action]').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.tourAction;
      if (action === 'next') return nextStep();
      if (action === 'back') return previousStep();
      if (action === 'skip') return skipOnboarding();
      if (action === 'dashboard') return completeOnboarding('dashboard');
      if (action === 'canvas') return completeOnboarding('canvas');
    });
  });
}

function nextStep() {
  const current = steps[currentIndex];
  if (current && current.nextIndexOnSkip !== undefined) {
    if (current.closeModal) {
      const modal = document.getElementById(current.closeModal);
      if (!modal || !modal.classList.contains('open')) {
        currentIndex = current.nextIndexOnSkip;
        renderStep();
        return;
      }
    }
  }

  if (currentIndex >= steps.length - 1) return completeOnboarding('dashboard');
  currentIndex += 1;
  renderStep();
}

function previousStep() {
  if (currentIndex <= 0) return;
  currentIndex -= 1;
  renderStep();
}

function closeTour() {
  active = false;
  clearTimeout(pendingStart);
  
  if (currentTarget && currentTargetListener) {
    currentTarget.removeEventListener('click', currentTargetListener);
    currentTargetListener = null;
  }
  if (currentEventListener) {
    State.off(currentEventListener.event, currentEventListener.handler);
    currentEventListener = null;
  }

  root?.classList.remove('active', 'is-modal-step', 'is-target-step');
  root?.setAttribute('aria-hidden', 'true');
  modal?.classList.remove('visible');
  tooltip?.classList.remove('visible');
  spotlight?.classList.remove('visible');
}

function onKeyDown(event) {
  if (!active) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    skipOnboarding();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    nextStep();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    previousStep();
  }
}

function schedulePosition() {
  if (!active || root?.classList.contains('is-modal-step')) return;
  if (rafQueued) return;
  rafQueued = true;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    rafQueued = false;
    positionTargetStep(steps[currentIndex]);
  });
}

function positionTargetStep(step) {
  const target = findVisibleTarget(step.target);
  
  if (currentTarget && currentTargetListener) {
    currentTarget.removeEventListener('click', currentTargetListener);
    currentTargetListener = null;
  }
  if (currentEventListener) {
    State.off(currentEventListener.event, currentEventListener.handler);
    currentEventListener = null;
  }
  
  currentTarget = target;
  
  if (!target) {
    spotlight.classList.remove('visible');
    hideTargetDimming();
    root.classList.add('has-fallback');
    positionTooltipFallback();
    return;
  }

  if (step.autoAdvanceOnClick) {
    currentTargetListener = () => setTimeout(() => nextStep(), 300);
    target.addEventListener('click', currentTargetListener, { once: true });
  }
  
  if (step.advanceOnEvent) {
    currentEventListener = {
      event: step.advanceOnEvent,
      handler: () => {
        // Wait briefly so UI can update (e.g. modal closes)
        setTimeout(() => nextStep(), 400);
      }
    };
    State.on(currentEventListener.event, currentEventListener.handler);
  }

  root.classList.remove('has-fallback');
  target.scrollIntoView({ block: 'center', inline: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  setTimeout(() => {
    requestAnimationFrame(() => updateTargetPosition(step, target));
  }, prefersReducedMotion() ? 0 : 140);
}

function updateTargetPosition(step, target) {
  const rect = target.getBoundingClientRect();
  const pad = Number.isFinite(step.spotlightPad) ? step.spotlightPad : SPOTLIGHT_PAD;
  const padded = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  spotlight.style.left = `${padded.left}px`;
  spotlight.style.top = `${padded.top}px`;
  spotlight.style.width = `${padded.width}px`;
  spotlight.style.height = `${padded.height}px`;
  spotlight.style.borderRadius = step.spotlightRadius || spotlightRadiusFor(target);
  spotlight.classList.add('visible');
  setTargetDimming(padded);
  positionTooltip(padded, step);
}

function setTargetDimming(rect) {
  const top = dimPanels.find(panel => panel.classList.contains('onboarding-dim-top'));
  const right = dimPanels.find(panel => panel.classList.contains('onboarding-dim-right'));
  const bottom = dimPanels.find(panel => panel.classList.contains('onboarding-dim-bottom'));
  const left = dimPanels.find(panel => panel.classList.contains('onboarding-dim-left'));
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  setPanel(top, 0, 0, vw, rect.top);
  setPanel(right, rect.left + rect.width, rect.top, Math.max(0, vw - rect.left - rect.width), rect.height);
  setPanel(bottom, 0, rect.top + rect.height, vw, Math.max(0, vh - rect.top - rect.height));
  setPanel(left, 0, rect.top, rect.left, rect.height);
}

function setPanel(panel, left, top, width, height) {
  if (!panel) return;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.width = `${width}px`;
  panel.style.height = `${height}px`;
}

function hideTargetDimming() {
  dimPanels.forEach(panel => {
    panel.style.width = '0px';
    panel.style.height = '0px';
  });
}

function findVisibleTarget(selector) {
  if (!selector) return null;
  const targets = [...document.querySelectorAll(selector)];
  return targets.find(el => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }) || null;
}

function positionTooltip(targetRect, step = {}) {
  const tw = Math.min(TOOLTIP_W, window.innerWidth - VIEWPORT_PAD * 2);
  tooltip.style.width = `${tw}px`;

  if (window.innerWidth < 720) {
    tooltip.style.left = `${VIEWPORT_PAD}px`;
    tooltip.style.top = `${Math.max(VIEWPORT_PAD, window.innerHeight - tooltip.offsetHeight - VIEWPORT_PAD)}px`;
    tooltip.style.width = `calc(100vw - ${VIEWPORT_PAD * 2}px)`;
    return;
  }

  const th = tooltip.offsetHeight || 240;
  const placements = orderedPlacements(targetRect, step.preferredPlacement);
  const candidates = placements.map(placement => candidatePosition(placement, targetRect, tw, th));
  const best = candidates.find(candidate => candidateFits(candidate, tw, th)) ||
    candidates.reduce((winner, candidate) => candidate.space > winner.space ? candidate : winner, candidates[0]);

  const maxLeft = Math.max(VIEWPORT_PAD, window.innerWidth - tw - VIEWPORT_PAD);
  const maxTop = Math.max(VIEWPORT_PAD, window.innerHeight - th - VIEWPORT_PAD);
  tooltip.style.left = `${clamp(best.left, VIEWPORT_PAD, maxLeft)}px`;
  tooltip.style.top = `${clamp(best.top, VIEWPORT_PAD, maxTop)}px`;
}

function positionTooltipFallback() {
  tooltip.style.width = `${Math.min(TOOLTIP_W, window.innerWidth - VIEWPORT_PAD * 2)}px`;
  tooltip.style.left = `${Math.max(VIEWPORT_PAD, (window.innerWidth - tooltip.offsetWidth) / 2)}px`;
  tooltip.style.top = `${Math.max(VIEWPORT_PAD, (window.innerHeight - tooltip.offsetHeight) / 2)}px`;
}

function orderedPlacements(targetRect, preferredPlacement) {
  const spaces = {
    right: window.innerWidth - (targetRect.left + targetRect.width) - VIEWPORT_PAD,
    bottom: window.innerHeight - (targetRect.top + targetRect.height) - VIEWPORT_PAD,
    left: targetRect.left - VIEWPORT_PAD,
    top: targetRect.top - VIEWPORT_PAD,
  };
  const order = Object.keys(spaces).sort((a, b) => spaces[b] - spaces[a]);
  if (!preferredPlacement || !Object.prototype.hasOwnProperty.call(spaces, preferredPlacement)) return order;
  return [preferredPlacement, ...order.filter(item => item !== preferredPlacement)];
}

function candidatePosition(placement, targetRect, tw, th) {
  const centerX = targetRect.left + targetRect.width / 2;
  const positions = {
    right: {
      left: targetRect.left + targetRect.width + TOOLTIP_GAP,
      top: targetRect.top,
      space: window.innerWidth - targetRect.left - targetRect.width - VIEWPORT_PAD,
    },
    bottom: {
      left: centerX - tw / 2,
      top: targetRect.top + targetRect.height + TOOLTIP_GAP,
      space: window.innerHeight - targetRect.top - targetRect.height - VIEWPORT_PAD,
    },
    left: {
      left: targetRect.left - tw - TOOLTIP_GAP,
      top: targetRect.top,
      space: targetRect.left - VIEWPORT_PAD,
    },
    top: {
      left: centerX - tw / 2,
      top: targetRect.top - th - TOOLTIP_GAP,
      space: targetRect.top - VIEWPORT_PAD,
    },
  };
  return { placement, ...positions[placement] };
}

function candidateFits(candidate, tw, th) {
  return candidate.left >= VIEWPORT_PAD &&
    candidate.top >= VIEWPORT_PAD &&
    candidate.left + tw <= window.innerWidth - VIEWPORT_PAD &&
    candidate.top + th <= window.innerHeight - VIEWPORT_PAD;
}

function spotlightRadiusFor(target) {
  const radius = window.getComputedStyle(target).borderRadius;
  return radius && radius !== '0px' ? radius : '14px';
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

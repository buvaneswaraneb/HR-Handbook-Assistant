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
let currentNodeId = 'start_tutorial';
let active = false;
let pendingStart = null;
let frame = 0;
let rafQueued = false;
let currentTarget = null;
let currentTargetListener = null;
let currentEventListener = null;
let currentNoTargetListener = null;
let currentNoEventListener = null;

const nodes = {
  start_tutorial: { kind: 'welcome', title: 'Welcome to Osmium', body: "Let's take a quick tour of the platform.", icon: 'token', next: 'dashboard' },
  dashboard: { view: 'dashboard', target: '[data-tour="dashboard-summary"]', title: 'Dashboard', body: 'Track employee statistics, active projects, leave overview, AI access, and the Google Calendar placeholder from the dashboard.', icon: 'dashboard', next: 'add_employee_decision' },
  add_employee_decision: { target: '[data-tour="add-employee"]', title: 'Add Employee', body: 'Start by adding employees to your workspace. Click the "+ Add New" button to open the form, or click Skip to move to Employee Management.', icon: 'person_add', preferredPlacement: 'right', spotlightPad: 2, autoYesOnClick: true, yes: 'selected_full_name_decision', no: 'employee_management', nextIsNo: true },
  selected_full_name_decision: { target: '#add-employee-modal .modal', title: 'Employee Profile', body: 'This is the employee profile card. Click on the Full Name field to begin.', icon: 'id_card', spotlightPad: 5, listenEvent: 'focus', listenTarget: '#new-emp-name', yes: 'play_textbox_tutorial', listenNoEvent: 'click', listenNoTarget: '#add-employee-modal .btn-ghost', no: 'selected_close_button_decision' },
  play_textbox_tutorial: { target: '#new-emp-name', title: 'Full Name', body: 'Enter the new employee\'s full name here. This textbox saves automatically.', icon: 'badge', listenEvent: 'input', listenTarget: '#new-emp-name', yes: 'play_textbox_tutorial_email', next: 'play_textbox_tutorial_email', listenNoEvent: 'click', listenNoTarget: '#add-employee-modal .btn-ghost', no: 'selected_close_button_decision' },
  play_textbox_tutorial_email: { target: '#new-emp-email', title: 'Email', body: 'Enter the employee\'s email address.', icon: 'mail', listenEvent: 'input', listenTarget: '#new-emp-email', yes: 'play_textbox_tutorial_role', next: 'play_textbox_tutorial_role', listenNoEvent: 'click', listenNoTarget: '#add-employee-modal .btn-ghost', no: 'selected_close_button_decision' },
  play_textbox_tutorial_role: { target: '#new-emp-role', title: 'Role', body: 'Select the employee\'s role from the dropdown.', icon: 'work', listenEvent: 'change', listenTarget: '#new-emp-role', yes: 'play_textbox_tutorial_team', next: 'play_textbox_tutorial_team', listenNoEvent: 'click', listenNoTarget: '#add-employee-modal .btn-ghost', no: 'selected_close_button_decision' },
  play_textbox_tutorial_team: { target: '#new-emp-team', title: 'Team', body: 'Enter the team name, like "Platform" or "Design".', icon: 'groups', listenEvent: 'input', listenTarget: '#new-emp-team', yes: 'create_employee_btn_decision', next: 'create_employee_btn_decision', listenNoEvent: 'click', listenNoTarget: '#add-employee-modal .btn-ghost', no: 'selected_close_button_decision' },
  create_employee_btn_decision: { target: '#add-emp-btn', title: 'Create Employee', body: 'Click "Create Employee" to save the profile.', icon: 'save', listenEvent: 'data:employees:refresh', listenTarget: 'global', yes: 'selected_full_name_decision', listenNoEvent: 'invalid', listenNoTarget: '#add-emp-form input', no: 'ask_fill_or_skip' },
  ask_fill_or_skip: { target: '#add-employee-modal .modal', title: 'Validation Failed', body: 'Please fill all required fields, or skip the step.', icon: 'warning', next: 'selected_full_name_decision' },
  selected_close_button_decision: { autoTransition: 'employee_management' },
  employee_management: { view: 'employees', target: '[data-tour="employees-list"]', title: 'Employee Management', body: 'Browse employees, edit profiles, search by skill or team, and keep availability visible for planning.', icon: 'group', next: 'add_project' },
  add_project: { view: 'projects', target: '[data-tour="add-project"]', title: 'Add Project', body: 'Create projects with managers, team leads, team members, required skills, and roles needed for delivery. Click the Add Project button, or Skip to move to Canvas.', icon: 'create_new_folder', spotlightPad: 5, listenEvent: 'click', listenTarget: '[data-tour="add-project"]', yes: 'highlight_whole_window', next: 'highlight_whole_window', no: 'canvas', nextIsNo: true },
  highlight_whole_window: { target: '#add-project-modal .modal', title: 'New Project Window', body: 'Here you can define all details for the new project.', icon: 'folder', next: 'any_textbox_clicked_decision', listenNoEvent: 'click', listenNoTarget: '#add-project-modal .btn-ghost', no: 'canvas' },
  any_textbox_clicked_decision: { target: '#add-project-modal .modal', title: 'New Project Form', body: 'Click on any textbox to learn more, or skip.', icon: 'edit', listenEvent: 'focus', listenTarget: '#add-project-modal input, #add-project-modal textarea', yes: 'play_textbox_tutorial_project', no: 'canvas', listenNoEvent: 'click', listenNoTarget: '#add-project-modal .btn-ghost' },
  play_textbox_tutorial_project: { target: '#proj-name', title: 'Project Name', body: 'Enter the name of the new project. Required fields have a red asterisk.', icon: 'info', listenEvent: 'input', listenTarget: '#proj-name', yes: 'play_textbox_tutorial_proj_client', next: 'play_textbox_tutorial_proj_client', listenNoEvent: 'click', listenNoTarget: '#add-project-modal .btn-ghost', no: 'canvas' },
  play_textbox_tutorial_proj_client: { target: '#proj-client', title: 'Client', body: 'Enter the client name (optional).', icon: 'domain', listenEvent: 'input', listenTarget: '#proj-client', yes: 'play_textbox_tutorial_proj_manager', next: 'play_textbox_tutorial_proj_manager', listenNoEvent: 'click', listenNoTarget: '#add-project-modal .btn-ghost', no: 'canvas' },
  play_textbox_tutorial_proj_manager: { target: '#proj-manager', title: 'Manager', body: 'Assign a manager to lead this project.', icon: 'person', listenEvent: 'change', listenTarget: '#proj-manager', yes: 'skipped_decision', next: 'skipped_decision', listenNoEvent: 'click', listenNoTarget: '#add-project-modal .btn-ghost', no: 'canvas' },
  skipped_decision: { target: '#add-proj-btn', title: 'Create Project', body: 'Click Create Project to finish, or skip to move on.', icon: 'save', yes: 'canvas', listenNoEvent: 'data:projects:refresh', listenNoTarget: 'global', no: 'create_project_completed' },
  create_project_completed: { target: '#add-project-modal .modal', title: 'Success!', body: 'Project created successfully!', icon: 'check_circle', next: 'canvas' },
  canvas: { view: 'canvas', target: '[data-tour="canvas-workspace"]', title: 'Canvas', body: 'Use the canvas to visually organize teams and project hierarchies.', icon: 'hub', listenEvent: 'canvas:selection:change', listenTarget: 'global', yes: 'node_added_decision', next: 'node_added_decision' },
  node_added_decision: { target: '[data-tour="canvas-workspace"]', title: 'Add Node', body: 'Drag a node from the side panel onto the canvas.', icon: 'drag_indicator', listenEvent: 'canvas:nodes:changed', listenTarget: 'global', yes: 'employee_node_decision', nextIsNo: true, no: 'org_tree' },
  employee_node_decision: { target: '[data-tour="canvas-workspace"]', title: 'Node Added', body: 'You added an employee node!', icon: 'person', autoYes: true, yes: 'suggest_add_project_node', no: 'skip_decision' },
  suggest_add_project_node: { target: '[data-tour="canvas-workspace"]', title: 'Project Node', body: 'Now try dragging a project node onto the canvas.', icon: 'folder', listenEvent: 'canvas:nodes:changed', listenTarget: 'global', yes: 'play_project_node_tutorial', nextIsNo: true, no: 'org_tree' },
  play_project_node_tutorial: { target: '[data-tour="canvas-workspace"]', title: 'Project Nodes', body: 'Project nodes show warnings for missing roles, offer AI auto-assignment, and have an inspector.', icon: 'school', listenEvent: 'click', listenTarget: '[data-tour="org-tree-view"]', yes: 'org_tree', next: 'org_tree' },
  skip_decision: { autoTransition: 'org_tree' },
  org_tree: { view: 'tree', target: '[data-tour="org-tree-view"]', title: 'Org Tree', body: 'Review a static organization structure with manager, team lead, and team member rows.', icon: 'account_tree', next: 'osmium_hr_handbook' },
  osmium_hr_handbook: { view: 'ai', target: '[data-tour="hr-handbook-view"]', title: 'HR Handbook Assistant', body: 'Use the HR Handbook Assistant to ask policy questions, view citations, and preview sources.', icon: 'smart_toy', preferredPlacement: 'left', spotlightPad: 8, next: 'mini_ai_chatbot' },
  mini_ai_chatbot: { view: 'dashboard', target: '[data-tour="mini-ai"]', title: 'Mini AI Shortcut', body: 'Open a compact assistant from anywhere. Click it now to open, or skip to finish.', icon: 'auto_awesome', preferredPlacement: 'bottom', spotlightPad: 7, spotlightRadius: '12px', listenEvent: 'click', listenTarget: '[data-tour="mini-ai"]', yes: 'open_mini_highlight_explain', nextIsNo: true, no: 'end' },
  open_mini_highlight_explain: { target: '#mini-ai-window', title: 'Mini AI Panel', body: 'This panel lets you ask questions without leaving your view. Type a message.', icon: 'info', listenEvent: 'input', listenTarget: '#mini-chat-input', yes: 'clicked_textbox_send_decision', next: 'clicked_textbox_send_decision', listenNoEvent: 'click', listenNoTarget: '#mini-ai-close', no: 'end' },
  clicked_textbox_send_decision: { target: '#mini-chat-input', title: 'Send a message', body: 'Press enter to send a message, or click Next to finish.', icon: 'send', listenEvent: 'keydown', listenTarget: '#mini-chat-input', yes: 'end', next: 'end', listenNoEvent: 'click', listenNoTarget: '#mini-ai-close', no: 'end' },
  end: { kind: 'complete', title: "You're ready to start using Osmium.", body: 'Explore your workspace, build teams, and use the canvas whenever you want a visual planning view.', icon: 'task_alt', next: null }
};

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
  currentNodeId = 'start_tutorial';
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
  const step = nodes[currentNodeId];
  if (!step) return closeTour();

  if (step.autoTransition) {
    currentNodeId = step.autoTransition;
    return renderStep();
  }

  if (step.autoYes) {
    currentNodeId = step.yes || step.next;
    return renderStep();
  }

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
      <div class="onboarding-progress">Tutorial</div>
    </div>
    <h3>${escapeHtml(step.title)}</h3>
    <p>${escapeHtml(step.body)}</p>
    <div class="onboarding-tooltip-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-tour-action="skip">Skip Tutorial</button>
      <div class="onboarding-nav-actions">
        ${step.hideNext ? '' : `<button type="button" class="btn btn-primary btn-sm" data-tour-action="next">Next</button>`}
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

function bindActions(tooltipEl) {
  tooltipEl.querySelectorAll('[data-tour-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.target.dataset.tourAction;
      if (action === 'skip') return advanceTo(nodes[currentNodeId]?.no || 'end');
      if (action === 'dashboard') return completeOnboarding('dashboard');
      if (action === 'canvas') return completeOnboarding('canvas');
      if (action === 'next') {
        const step = nodes[currentNodeId];
        if (step && step.nextIsNo) {
          return advanceTo(step.no || 'end');
        }
        let delay = 0;
        if (step && step.listenEvent === 'click' && step.listenTarget && step.listenTarget !== 'global') {
          const el = document.querySelector(step.listenTarget);
          if (el) {
            el.click();
            delay = 400; // Wait for modals/UI to open
          }
        }
        setTimeout(() => advanceTo(step?.next || step?.yes || 'end'), delay);
        return;
      }
    });
  });
}

function advanceTo(nodeId) {
  if (!nodeId || (nodeId === 'end' && !nodes['end'])) {
    return closeTour();
  }
  currentNodeId = nodeId;
  renderStep();
}

function closeTour() {
  active = false;
  clearTimeout(pendingStart);
  
  if (currentTarget && currentTargetListener) {
    const elList = currentTargetListener.els || [currentTarget];
    elList.forEach(el => el?.removeEventListener(currentTargetListener.event, currentTargetListener.handler));
    currentTargetListener = null;
  }
  if (currentNoTargetListener) {
    const elList = currentNoTargetListener.els || [];
    elList.forEach(el => el?.removeEventListener(currentNoTargetListener.event, currentNoTargetListener.handler));
    currentNoTargetListener = null;
  }
  if (currentEventListener) {
    State.off(currentEventListener.event, currentEventListener.handler);
    currentEventListener = null;
  }
  if (currentNoEventListener) {
    State.off(currentNoEventListener.event, currentNoEventListener.handler);
    currentNoEventListener = null;
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
    advanceTo(nodes[currentNodeId]?.no || 'end');
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    advanceTo(nodes[currentNodeId]?.next || nodes[currentNodeId]?.yes || 'end');
  }
}

function schedulePosition() {
  if (!active || root?.classList.contains('is-modal-step')) return;
  if (rafQueued) return;
  rafQueued = true;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    rafQueued = false;
    positionTargetStep(nodes[currentNodeId]);
  });
}

function positionTargetStep(step) {
  const target = findVisibleTarget(step.target);
  
  if (currentTarget && currentTargetListener) {
    const elList = currentTargetListener.els || [currentTarget];
    elList.forEach(el => el?.removeEventListener(currentTargetListener.event, currentTargetListener.handler));
    currentTargetListener = null;
  }
  if (currentNoTargetListener) {
    const elList = currentNoTargetListener.els || [];
    elList.forEach(el => el?.removeEventListener(currentNoTargetListener.event, currentNoTargetListener.handler));
    currentNoTargetListener = null;
  }
  if (currentEventListener) {
    State.off(currentEventListener.event, currentEventListener.handler);
    currentEventListener = null;
  }
  if (currentNoEventListener) {
    State.off(currentNoEventListener.event, currentNoEventListener.handler);
    currentNoEventListener = null;
  }
  
  currentTarget = target;
  
  if (!target) {
    spotlight.classList.remove('visible');
    hideTargetDimming();
    root.classList.add('has-fallback');
    positionTooltipFallback();
    return;
  }

  if (step.listenEvent) {
    if (step.listenTarget === 'global') {
      currentEventListener = {
        event: step.listenEvent,
        handler: (e) => {
          if (step.listenEvent === 'keydown' && e.key !== 'Enter') return;
          setTimeout(() => advanceTo(step.yes || step.next), 400);
        }
      };
      State.on(currentEventListener.event, currentEventListener.handler);
    } else {
      const elList = [...document.querySelectorAll(step.listenTarget)];
      if (elList.length) {
        currentTargetListener = {
          event: step.listenEvent,
          els: elList,
          handler: (e) => {
             if (step.listenEvent === 'keydown' && e.key !== 'Enter') return;
             setTimeout(() => advanceTo(step.yes || step.next), 400);
          }
        };
        elList.forEach(el => el.addEventListener(currentTargetListener.event, currentTargetListener.handler));
      }
    }
  }

  if (step.listenNoEvent) {
    if (step.listenNoTarget === 'global') {
      currentNoEventListener = {
        event: step.listenNoEvent,
        handler: () => setTimeout(() => advanceTo(step.no), 400)
      };
      State.on(currentNoEventListener.event, currentNoEventListener.handler);
    } else {
      const elList = [...document.querySelectorAll(step.listenNoTarget)];
      if (elList.length) {
        currentNoTargetListener = {
          event: step.listenNoEvent,
          els: elList,
          handler: () => setTimeout(() => advanceTo(step.no), 400)
        };
        elList.forEach(el => el.addEventListener(currentNoTargetListener.event, currentNoTargetListener.handler));
      }
    }
  }

  if (step.autoYesOnClick) {
    currentTargetListener = {
      event: 'click',
      els: [target],
      handler: () => setTimeout(() => advanceTo(step.yes || step.next), 300)
    };
    target?.addEventListener('click', currentTargetListener.handler, { once: true });
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

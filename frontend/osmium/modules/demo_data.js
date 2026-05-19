// ============================================================
// demo_data.js - Seed realistic demo workspace data
// Osmium ERM - Glacier Design System
// ============================================================

import { State } from '../utils/state.js';
import { createEmployee, createProject, getEmployees, getProjects, updateProject } from './api.js?v=20260517-local-api';
import { showToast } from './ui.js';

let seeding = false;

const DEMO_EMPLOYEES = [
  {
    key: 'manager',
    name: 'Anil Kumar',
    email: 'osmium.demo+manager@example.com',
    role: 'Engineering Manager',
    team: 'Platform',
    rating: 4.8,
    total_experience_years: 9,
    availability: true,
    skills: [
      { skill_name: 'leadership', skill_level: 5, experience_years_with_skill: 7, notes: 'Delivery planning and stakeholder alignment' },
      { skill_name: 'project_management', skill_level: 5, experience_years_with_skill: 6, notes: 'Cross-functional project ownership' },
    ],
  },
  {
    key: 'lead',
    name: 'Meera Shah',
    email: 'osmium.demo+lead@example.com',
    role: 'Team Lead',
    team: 'Platform',
    rating: 4.7,
    total_experience_years: 7,
    availability: true,
    skills: [
      { skill_name: 'react', skill_level: 5, experience_years_with_skill: 5, notes: 'Frontend architecture and reviews' },
      { skill_name: 'ui_systems', skill_level: 5, experience_years_with_skill: 4, notes: 'Reusable interface patterns' },
    ],
  },
  {
    key: 'fullstack',
    name: 'Arjun Rao',
    email: 'osmium.demo+fullstack@example.com',
    role: 'Full Stack Developer',
    team: 'Platform',
    rating: 4.5,
    total_experience_years: 5,
    availability: true,
    skills: [
      { skill_name: 'fastapi', skill_level: 4, experience_years_with_skill: 3, notes: 'API services and auth flows' },
      { skill_name: 'postgresql', skill_level: 4, experience_years_with_skill: 4, notes: 'Data modelling and queries' },
    ],
  },
  {
    key: 'qa',
    name: 'Priya Menon',
    email: 'osmium.demo+qa@example.com',
    role: 'QA Engineer',
    team: 'Quality',
    rating: 4.4,
    total_experience_years: 4,
    availability: true,
    skills: [
      { skill_name: 'quality_assurance', skill_level: 5, experience_years_with_skill: 4, notes: 'Release validation and regression testing' },
      { skill_name: 'automation', skill_level: 4, experience_years_with_skill: 3, notes: 'Smoke and workflow coverage' },
    ],
  },
  {
    key: 'hr',
    name: 'Kavya Iyer',
    email: 'osmium.demo+hr@example.com',
    role: 'HR Specialist',
    team: 'People Ops',
    rating: 4.6,
    total_experience_years: 6,
    availability: true,
    skills: [
      { skill_name: 'hr_operations', skill_level: 5, experience_years_with_skill: 6, notes: 'Policies, onboarding, and employee support' },
      { skill_name: 'employee_engagement', skill_level: 4, experience_years_with_skill: 4, notes: 'Team health and feedback programs' },
    ],
  },
  {
    key: 'lead2',
    name: 'Nikhil Verma',
    email: 'osmium.demo+lead2@example.com',
    role: 'Team Lead',
    team: 'People Analytics',
    rating: 4.5,
    total_experience_years: 6,
    availability: true,
    skills: [
      { skill_name: 'analytics', skill_level: 5, experience_years_with_skill: 5, notes: 'Dashboards, reporting, and planning metrics' },
      { skill_name: 'ui_systems', skill_level: 4, experience_years_with_skill: 3, notes: 'Operational dashboard workflows' },
    ],
  },
  {
    key: 'coordinator',
    teamLeadKey: 'lead2',
    name: 'Sara Thomas',
    email: 'osmium.demo+coordinator@example.com',
    role: 'Project Coordinator',
    team: 'People Analytics',
    rating: 4.3,
    total_experience_years: 4,
    availability: true,
    skills: [
      { skill_name: 'project_coordination', skill_level: 5, experience_years_with_skill: 4, notes: 'Milestones, reporting, and team follow-up' },
      { skill_name: 'hr_operations', skill_level: 4, experience_years_with_skill: 3, notes: 'People Ops process support' },
    ],
  },
  {
    key: 'qa2',
    teamLeadKey: 'lead2',
    name: 'Dev Patel',
    email: 'osmium.demo+qa2@example.com',
    role: 'QA Analyst',
    team: 'People Analytics',
    rating: 4.2,
    total_experience_years: 3,
    availability: true,
    skills: [
      { skill_name: 'quality_assurance', skill_level: 4, experience_years_with_skill: 3, notes: 'Dashboard acceptance and regression testing' },
      { skill_name: 'automation', skill_level: 3, experience_years_with_skill: 2, notes: 'Lightweight workflow checks' },
    ],
  },
];

const DEMO_PROJECTS = [
  {
    project_name: 'Employee Portal Refresh',
    client_name: 'Osmium Internal',
    client_email: 'peopleops@example.com',
    project_description: 'Modernize the employee portal with profile management, project visibility, and document assisted workflows.',
    start_date: '2026-05-01',
    end_date: '2026-06-28',
    percent_complete: 42,
    status: 'active',
    required_skills: ['react', 'fastapi', 'postgresql', 'quality_assurance', 'hr_operations'],
    required_roles: ['project_manager', 'team_lead', 'lead_developer', 'quality_assurance', 'hr_specialist'],
    managerKey: 'manager',
    teamLeadKey: 'lead',
    memberKeys: ['fullstack', 'qa', 'hr'],
  },
  {
    project_name: 'Leave Insights Dashboard',
    client_name: 'People Ops',
    client_email: 'ops@example.com',
    project_description: 'Build a leave overview dashboard with availability indicators, absence trends, and planning signals.',
    start_date: '2026-05-10',
    end_date: '2026-06-14',
    percent_complete: 18,
    status: 'active',
    required_skills: ['ui_systems', 'hr_operations', 'automation'],
    required_roles: ['project_coordinator', 'team_lead', 'quality_assurance'],
    managerKey: 'manager',
    teamLeadKey: 'lead2',
    memberKeys: ['coordinator', 'qa2'],
  },
];

export function initDemoData() {
  window.seedDemoWorkspaceData = seedDemoWorkspaceData;
}

export async function seedDemoWorkspaceData() {
  if (seeding) return;
  if (!State.auth?.accessToken) {
    showToast('Sign in before adding demo data.', 'warning');
    return;
  }

  seeding = true;
  setDemoButtonBusy(true);
  showToast('Adding demo members and projects...', 'info', 2200);

  try {
    const employees = await getEmployees({ cache: false });
    const employeeByEmail = new Map(employees.map(emp => [String(emp.email || '').toLowerCase(), emp]));
    const demoByKey = {};
    let createdEmployees = 0;

    for (const demo of DEMO_EMPLOYEES) {
      const existing = employeeByEmail.get(demo.email.toLowerCase());
      if (existing) {
        demoByKey[demo.key] = existing;
        continue;
      }

      const body = {
        name: demo.name,
        email: demo.email,
        role: demo.role,
        team: demo.team,
        rating: demo.rating,
        total_experience_years: demo.total_experience_years,
        availability: demo.availability,
        skills: demo.skills,
      };
      if (demo.key !== 'manager' && demoByKey.manager?.id) body.manager_id = demoByKey.manager.id;
      const teamLeadKey = demo.teamLeadKey || 'lead';
      if (!['manager', 'lead', 'lead2'].includes(demo.key) && demoByKey[teamLeadKey]?.id) {
        body.team_lead_id = demoByKey[teamLeadKey].id;
      }

      const created = await createEmployee(body);
      demoByKey[demo.key] = created;
      employeeByEmail.set(demo.email.toLowerCase(), created);
      createdEmployees += 1;
    }

    const projects = await getProjects({ cache: false });
    const projectByName = new Map(projects.map(project => [String(project.project_name || '').toLowerCase(), project]));
    let createdProjects = 0;
    let updatedProjects = 0;

    for (const demoProject of DEMO_PROJECTS) {
      const body = buildProjectBody(demoProject, demoByKey);
      const existing = projectByName.get(demoProject.project_name.toLowerCase());
      if (existing?.id) {
        await updateProject(existing.id, body);
        updatedProjects += 1;
      } else {
        await createProject(body);
        createdProjects += 1;
      }
    }

    await refreshWorkspaceData();
    const verb = createdEmployees || createdProjects ? 'added' : 'refreshed';
    showToast(`Demo workspace ${verb}: ${createdEmployees} members, ${createdProjects} projects, ${updatedProjects} project updates.`, 'success', 5200);
  } catch (error) {
    console.error('Demo data seed failed', error);
    showToast(error.message || 'Could not add demo data.', 'error', 5200);
  } finally {
    seeding = false;
    setDemoButtonBusy(false);
  }
}

function buildProjectBody(project, demoByKey) {
  const manager = demoByKey[project.managerKey];
  const lead = demoByKey[project.teamLeadKey];
  const members = project.memberKeys.map(key => demoByKey[key]?.id).filter(Boolean);

  return {
    project_name: project.project_name,
    client_name: project.client_name,
    client_email: project.client_email,
    project_description: project.project_description,
    start_date: project.start_date,
    end_date: project.end_date,
    percent_complete: project.percent_complete,
    status: project.status,
    required_skills: project.required_skills,
    required_roles: project.required_roles,
    manager_id: manager?.id || null,
    team_lead_id: lead?.id || null,
    team_member_ids: members,
  };
}

async function refreshWorkspaceData() {
  const [employees, projects] = await Promise.all([
    getEmployees({ cache: false }),
    getProjects({ cache: false }),
  ]);
  State.set('employees', employees);
  State.set('projects', projects);
  State.emit('data:employees:refresh');
  State.emit('data:projects:refresh');
  if (State.currentView === 'dashboard') window.loadDashboardGlobal?.();
}

function setDemoButtonBusy(isBusy) {
  const button = document.querySelector('[data-demo-seed]');
  if (!button) return;
  button.disabled = isBusy;
  button.classList.toggle('loading', isBusy);
  const label = button.querySelector('[data-demo-label]');
  if (label) label.textContent = isBusy ? 'Adding Demo Data...' : 'Add Demo Members & Projects';
}

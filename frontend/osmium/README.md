# Osmium Dashboard — Enterprise Resource Management System

## Overview

Osmium is a production-grade, modular enterprise resource management dashboard built as a single-file HTML application with a modular JavaScript architecture via ES module pattern. It connects to the ERS (Employee & Resource System) REST API at `localhost:8000`.

---

## Color System — Glacier Theme

| Token | Hex | Usage |
|---|---|---|
| Primary | `#0981A7` | Actions, highlights, active states |
| Primary Dark | `#065f7a` | Hover/pressed primary |
| Secondary | `#5C7B8C` | Secondary actions, borders |
| Tertiary | `#DA9142` | Warnings, accents, tags |
| Neutral | `#74787B` | Muted text, placeholders |
| Surface | `#131c22` | Card backgrounds |
| Surface Low | `#0e1519` | Page background |
| Surface High | `#1e2d36` | Elevated surfaces |
| On Surface | `#e8f1f5` | Primary text |
| On Surface Variant | `#8fa8b4` | Secondary text |
| Outline | `#2e4452` | Borders |

---

## Project Structure

```
osmium/
├── index.html              # Main entry point — shell, nav, layout
├── README.md               # This file
│
├── styles/
│   └── glacier.css         # Glacier design token CSS variables + base styles
│
├── modules/
│   ├── api.js              # API client, health check, all fetch wrappers
│   ├── canvas.js           # Infinite 2D canvas engine (pan, zoom, grid)
│   ├── nodes.js            # Employee node cards on canvas + connection system
│   ├── inspector.js        # Right-side inspector panel (selected node details)
│   ├── dashboard.js        # Dashboard view: analytics, deadlines, activity feed
│   ├── employees.js        # Employees list/grid view + search/filter
│   ├── projects.js         # Projects list view + assignment
│   ├── files.js            # Files upload/browse view
│   ├── tree.js             # Org tree view (hierarchy visualization)
│   ├── ai.js               # AI assistant window (RAG chat, Claude API)
│   ├── settings.js         # Settings panel (theme, grid, API URL, etc.)
│   └── ui.js               # Shared UI: toasts, modals, spinners, nav
│
└── utils/
    ├── helpers.js          # fmtDate, fmtBytes, relTime, escHtml, etc.
    └── state.js            # Centralized app state store
```

---

## Features

### 🗺️ Infinite Canvas
- Unlimited 2D workspace with pan (click-drag) and zoom (wheel/pinch)
- Dot-grid background synced to zoom/pan
- Fit-to-screen and reset-view toolbar controls
- Snap-to-grid toggle

### 🃏 Node-Based Employee Cards
- Employees rendered as draggable cards on the canvas
- Shows: name, role, team badge, star rating, availability chip, skill tags
- Hover, selected, and context-menu states
- Multi-select with Shift+Click or drag-box

### 🔗 Connection System
- Visual edges between nodes (manager → lead → member)
- Directional arrows showing hierarchy
- Add/remove/reconnect edges via node context menu
- Edge labels for relationship type

### 📦 Project Grouping
- Group employee nodes inside colored project containers
- Project title bar shows name, status, deadline
- Move entire group together
- Collapse/expand groups

### 🔍 Inspector Panel
- Right-side slide-in panel for selected employee or project
- Full detail view: skills, experience, assigned projects
- Inline edit mode
- Shows connected nodes

### 🌳 Tree View (Org Chart)
- Full org hierarchy as a vertical tree
- Click to expand/collapse branches
- Highlight manager chains
- Export-ready layout

### 🤖 AI Assistant Window
- Dedicated floating AI window (not just a side panel)
- Connects to `POST /query` (RAG over HR docs)
- Chat history, source citations, quick-ask chips
- Minimizable, resizable, draggable window

### ⚙️ Settings
- API Base URL configuration
- Light/Dark/System theme toggle
- Grid snap toggle + grid size
- Canvas node density
- Notification preferences
- Reset layout

---

## API Integration

All API calls go through `modules/api.js`. Base URL defaults to `http://localhost:8000`.

| Endpoint | Used By |
|---|---|
| `GET /health` | api.js → connection indicator |
| `GET /analytics/summary` | dashboard.js → metrics + skill chart |
| `GET /employees` | employees.js, canvas/nodes.js |
| `GET /employees/search` | employees.js filter bar |
| `POST /employees` | employees.js add modal |
| `GET /projects` | projects.js, dashboard deadlines |
| `POST /projects` | projects.js add modal |
| `GET /teams/{id}/tree` | tree.js org chart |
| `GET /activity/feed` | dashboard.js activity feed |
| `POST /query` | ai.js RAG assistant |
| `GET /files` | files.js |
| `POST /files/upload` | files.js upload zone |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Space + Drag` | Pan canvas |
| `Ctrl/Cmd + Scroll` | Zoom canvas |
| `Ctrl/Cmd + 0` | Reset canvas view |
| `Ctrl/Cmd + Shift + F` | Fit to screen |
| `Escape` | Deselect / close panel |
| `Ctrl/Cmd + K` | Global search |
| `Ctrl/Cmd + /` | Toggle AI window |
| `Delete` | Remove selected node |
| `G` | Toggle grid snap |

---

## Getting Started

1. Start the ERS backend at `http://localhost:8000`
2. Open `index.html` in a modern browser (no build step required)
3. Configure the API URL in Settings if using a different port

> No npm, no bundler. Pure HTML + CSS + vanilla ES modules.

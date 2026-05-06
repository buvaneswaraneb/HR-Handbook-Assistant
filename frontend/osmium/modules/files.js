// ============================================================
// files.js — Assets & Files View
// ============================================================

import { State } from '../utils/state.js';
import { getFiles, uploadFile, deleteFile } from './api.js';
import { escHtml, fmtBytes, fmtDate, emptyState, skeletonRows } from '../utils/helpers.js';
import { showToast } from './ui.js';

let pendingFile = null;

export function initFiles() {
  State.on('view:files', () => loadFiles(null));

  const dropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('file-input');

  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('dragover',  e => { e.preventDefault(); dropzone.style.borderColor = 'var(--gl-primary)'; });
  dropzone?.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.style.borderColor = '';
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  });

  fileInput?.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileSelect(fileInput.files[0]);
  });
}

function handleFileSelect(file) {
  pendingFile = file;
  const fname = document.getElementById('upload-filename');
  const form  = document.getElementById('upload-form');
  if (fname) fname.textContent = `${file.name} (${fmtBytes(file.size)})`;
  if (form) form.style.display = 'grid';
}

export async function loadFiles(department) {
  const list = document.getElementById('files-list');
  if (!list) return;

  // Update filter buttons
  ['all','engineering','design','hr'].forEach(d => {
    const btn = document.getElementById(`file-btn-${d}`);
    if (!btn) return;
    const active = (!department && d === 'all') || department?.toLowerCase() === d;
    btn.style.background = active ? 'var(--gl-primary-muted)' : 'var(--gl-surface-high)';
    btn.style.color = active ? 'var(--gl-primary-light)' : 'var(--gl-on-surface-3)';
  });

  list.innerHTML = skeletonRows(4, '56px');

  try {
    const files = await getFiles(department);
    if (!files.length) {
      list.innerHTML = emptyState('folder_open', 'No files uploaded yet', 'Drag and drop files above to upload.');
      return;
    }
    list.innerHTML = files.map(f => fileRow(f)).join('');
  } catch (e) {
    list.innerHTML = `<div style="color:var(--gl-error);font-size:0.83rem">${escHtml(e.message)}</div>`;
  }
}

function fileRow(f) {
  const ext = (f.filename || '').split('.').pop().toUpperCase();
  const iconMap = { PDF:'picture_as_pdf', PNG:'image', JPG:'image', JPEG:'image', ZIP:'folder_zip', DOC:'description', DOCX:'description', XLS:'table_chart', XLSX:'table_chart', MP4:'videocam', MP3:'audio_file' };
  const icon = iconMap[ext] || 'insert_drive_file';
  const extColor = { PDF:'var(--gl-error)', PNG:'var(--gl-tertiary)', JPG:'var(--gl-tertiary)', ZIP:'var(--gl-warning)', XLS:'var(--gl-success)', XLSX:'var(--gl-success)' };
  const ic = extColor[ext] || 'var(--gl-secondary)';

  return `
    <div class="card" style="padding:12px 16px;display:flex;align-items:center;gap:14px;margin-bottom:8px">
      <div style="width:38px;height:38px;border-radius:var(--r-md);background:${ic}22;
        display:flex;align-items:center;justify-content:center;color:${ic};flex-shrink:0">
        <span class="material-symbols-outlined">${icon}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:0.85rem;font-weight:600;color:var(--gl-on-surface);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(f.filename)}</div>
        <div style="font-size:0.72rem;color:var(--gl-on-surface-4)">${fmtBytes(f.size_bytes)} · ${escHtml(f.department || 'General')} · ${fmtDate(f.created_at)}</div>
        ${f.description ? `<div style="font-size:0.72rem;color:var(--gl-on-surface-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(f.description)}</div>` : ''}
      </div>
      <span style="font-size:0.68rem;background:var(--gl-surface-high);color:var(--gl-on-surface-3);padding:2px 7px;border-radius:var(--r-full);flex-shrink:0;border:1px solid var(--gl-outline)">${ext}</span>
      <button class="btn btn-ghost btn-icon" title="Delete" onclick="window._deleteFile('${f.id}')">
        <span class="material-symbols-outlined" style="font-size:16px;color:var(--gl-on-surface-4)">delete</span>
      </button>
    </div>`;
}

window._uploadFileSubmit = async function() {
  if (!pendingFile) { showToast('Select a file first.', 'error'); return; }
  const btn = document.getElementById('upload-btn');
  if (btn) { btn.textContent = 'Uploading…'; btn.disabled = true; }

  const form = new FormData();
  form.append('file', pendingFile);
  const dept = document.getElementById('upload-dept')?.value;
  const desc = document.getElementById('upload-desc')?.value?.trim();
  if (dept) form.append('department', dept);
  if (desc) form.append('description', desc);

  try {
    await uploadFile(form);
    showToast('File uploaded!');
    pendingFile = null;
    document.getElementById('upload-form').style.display = 'none';
    document.getElementById('file-input').value = '';
    loadFiles(null);
  } catch (e) { showToast(e.message, 'error'); }
  finally { if (btn) { btn.textContent = 'Upload'; btn.disabled = false; } }
};

window._deleteFile = async function(id) {
  if (!confirm('Delete this file permanently?')) return;
  try {
    await deleteFile(id);
    showToast('File deleted.');
    loadFiles(null);
  } catch (e) { showToast(e.message, 'error'); }
};

window.loadFilesGlobal = loadFiles;

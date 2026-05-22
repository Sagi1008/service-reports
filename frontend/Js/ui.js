import { S, esc, escHtml, fmtDate, fileIcon, formatFileSize, today, apiDeleteAttachment, apiUploadProcedure, apiDeleteProcedure } from './api.js';

/* ================================================================
   SIGNATURE PAD
================================================================ */
function _resizeCanvas(canvas, height) {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = canvas.parentElement.getBoundingClientRect().width || canvas.parentElement.offsetWidth || 680;
    canvas.width  = Math.round(w * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width  = w + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
}

function _initOnePad(canvasId, stateKey, height) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    _resizeCanvas(canvas, height);
    S[stateKey] = new SignaturePad(canvas, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: '#1e293b',
        minWidth: 1.5,
        maxWidth: 3,
    });
    window.addEventListener('resize', () => {
        const pad = S[stateKey];
        if (!pad) return;
        const data = pad.toDataURL();
        _resizeCanvas(canvas, height);
        pad.clear();
        if (data && !data.endsWith(',')) pad.fromDataURL(data);
    });
}

export function initPad() {
    _initOnePad('signatureCanvas',     'pad',         140);
    _initOnePad('customerSigCanvas',   'customerPad', 160);
}

export function clearSignature()         { S.pad         && S.pad.clear();         markUnsaved(); }
export function clearCustomerSignature() { S.customerPad && S.customerPad.clear(); markUnsaved(); }

/* ================================================================
   UNSAVED STATE
================================================================ */
export function markUnsaved() { S.unsaved = true; updateToolbar(); }

export function confirmUnsaved() {
    if (S.unsaved && S.currentId) {
        return confirm('יש שינויים שלא נשמרו. לנטוש?');
    }
    return true;
}

/* ================================================================
   DATES
================================================================ */
export function setTodayDates() {
    document.getElementById('fVisitDate').value = today();
    document.getElementById('fCompDate').value  = today();
}

/* ================================================================
   REPORT MODE
================================================================ */
/* ── shared card renderer ─────────────────────────────────── */
function _buildReportCards(reports) {
    const statusLabel = { pending: 'ממתין', in_progress: 'בתהליך', completed: 'הושלם' };
    const statusClass = { pending: 'dash-status-pending', in_progress: 'dash-status-progress', completed: 'dash-status-done' };
    return reports.map(r => {
        const tasks  = (r.tasks || []).filter(t => t.type !== 'section');
        const done   = tasks.filter(t => t.status === 'performed').length;
        const status = tasks.length === 0    ? 'pending'
                     : done === tasks.length ? 'completed'
                     : done > 0              ? 'in_progress'
                     :                         'pending';
        return `
            <div class="dash-card" onclick="openReport('${esc(r.id)}')">
                <button class="dash-card-delete" title="מחק דוח" onclick="event.stopPropagation();if(confirm('למחוק את הדוח &quot;${esc(r.title||'ללא שם')}&quot;?')){deleteReportById('${esc(r.id)}')}">✕</button>
                <div class="dash-card-title">${esc(r.title || 'ללא שם')}</div>
                ${r.customer  ? `<div class="dash-card-meta">👤 ${esc(r.customer)}</div>`      : ''}
                ${r.site      ? `<div class="dash-card-meta">📍 ${esc(r.site)}</div>`          : ''}
                ${r.visitDate ? `<div class="dash-card-meta">📅 ${fmtDate(r.visitDate)}</div>` : ''}
                <div class="dash-card-footer">
                    <span class="dash-card-tasks">${tasks.length} משימות · ${done} בוצעו</span>
                    <span class="dash-status ${statusClass[status]}">${statusLabel[status]}</span>
                </div>
            </div>`;
    }).join('');
}

function _buildDocCards(docs) {
    return docs.map(a => {
        const icon = fileIcon(a.file_type);
        // Firebase Storage URLs are absolute (no API_BASE prefix needed).
        const url  = esc(a.file_path);
        return `
            <div class="dash-card dash-card-doc" onclick="window.open('${url}','_blank')">
                <button class="dash-card-delete" title="מחק מסמך" onclick="event.stopPropagation();deleteAttachment(${a.id},'${esc(a.filename)}')">✕</button>
                <div class="dash-card-title">${icon} ${esc(a.filename)}</div>
                <div class="dash-card-meta">📅 ${fmtDate(a.created_at)}</div>
                <div class="dash-card-footer">
                    <span class="dash-card-tasks">${esc(a.file_type || 'מסמך')}</span>
                    <span class="dash-status dash-status-doc">📎 מסמך</span>
                </div>
            </div>`;
    }).join('');
}

export async function deleteAttachment(id, filename) {
    if (!confirm(`למחוק את הקובץ "${filename}"?`)) return;
    try {
        await apiDeleteAttachment(id);
        // Remove from cached state
        for (const key of Object.keys(S.attachments)) {
            S.attachments[key] = S.attachments[key].filter(a => a.id !== id);
        }
        toast('הקובץ נמחק', 'error');
        if (S.currentFolder) showFolderContent(S.currentFolder);
    } catch (e) {
        toast('שגיאה במחיקה – בדוק שהשרת פועל', 'error');
    }
}

function _showContentView() {
    S.currentId   = null;
    S.currentMode = 'report';
    S.unsaved     = false;
    document.getElementById('emptyState').style.display    = 'none';
    document.getElementById('reportEditor').style.display  = 'none';
    document.getElementById('dashboardView').style.display = '';
    updateToolbar();
    renderSidebar();
}

function _buildFolderCards(folderNames) {
    return folderNames.map(name => {
        const count = (S.folders[name] || []).filter(id => S.reports[id]).length;
        return `
            <div class="dash-folder-card" onclick="showFolderContent('${esc(name)}')">
                <div class="dash-folder-icon">📁</div>
                <div class="dash-folder-name">${esc(name)}</div>
                <div class="dash-folder-count">${count} דוחות</div>
            </div>`;
    }).join('');
}

export function showDashboard() {
    S.currentFolder = null;
    _showContentView();
    const container = document.getElementById('dashboardView');
    const folderNames = Object.keys(S.folders);
    const reports = Object.values(S.reports)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    let html = `
        <div class="dash-header">
            <h2 class="dash-title">תיקיות</h2>
            <button class="dash-new-folder-btn" onclick="showModal('createFolderModal')">+ תיקייה חדשה</button>
        </div>`;

    if (folderNames.length) {
        html += `<div class="dash-folder-grid">${_buildFolderCards(folderNames)}</div>`;
    } else {
        html += `<p class="dash-folders-empty">אין תיקיות עדיין.</p>`;
    }

    if (reports.length) {
        html += `
            <div class="dash-header" style="margin-top:28px;">
                <h2 class="dash-title">דוחות אחרונים</h2>
                <span class="dash-count">${reports.length} סה"כ</span>
            </div>
            <div class="dash-grid">${_buildReportCards(reports.slice(0, 30))}</div>`;
    } else {
        html += `
            <div class="dash-empty">
                <div class="dash-empty-icon">📋</div>
                <h2>אין דוחות עדיין</h2>
                <p>לחץ <strong>"+ דוח חדש"</strong> כדי להתחיל</p>
            </div>`;
    }

    container.innerHTML = html;
}

export function toggleFolderMenu(e) {
    e.stopPropagation();
    const dd = document.getElementById('folderMenuDropdown');
    if (!dd) return;
    dd.classList.toggle('hidden');
    if (!dd.classList.contains('hidden')) {
        const close = () => { dd.classList.add('hidden'); document.removeEventListener('click', close); };
        setTimeout(() => document.addEventListener('click', close), 0);
    }
}

export function closeFolderMenu() {
    const dd = document.getElementById('folderMenuDropdown');
    if (dd) dd.classList.add('hidden');
}

export function switchFolderTab(tab) {
    document.querySelectorAll('.site-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.site-panel').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.panel !== tab);
    });
}

export async function showFolderContent(folderName) {
    S.currentFolder = folderName;
    _showContentView();
    const container = document.getElementById('dashboardView');

    // Loading skeleton
    container.innerHTML = `
        <div class="site-topbar">
            <button class="site-back-btn" onclick="showDashboard()">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleX(-1)"><polyline points="9 18 15 12 9 6"/></svg>
                חזור לתיקיות
            </button>
            <h2 class="site-title">📁 ${esc(folderName)}</h2>
        </div>
        <div class="dash-empty" style="opacity:.5"><p>טוען...</p></div>`;

    const ids     = (S.folders[folderName] || []).filter(id => S.reports[id]);
    const reports = ids.map(id => S.reports[id])
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const docs    = S.attachments[folderName] || [];
    const tplIds  = Object.keys(S.templates);
    const totalReports = reports.length + docs.length;

    // ── History tab content ───────────────────────────────────────
    let historyHtml = '';
    if (!reports.length && !docs.length) {
        historyHtml = `
            <div class="dash-empty">
                <div class="dash-empty-icon">📂</div>
                <p>תיקייה זו ריקה. צור דוח חדש או הזז דוח קיים לכאן.</p>
            </div>`;
    } else {
        if (reports.length) historyHtml += `<div class="dash-grid">${_buildReportCards(reports)}</div>`;
        if (docs.length)    historyHtml += `
            <div class="dash-section-label" style="margin-top:${reports.length ? '28px' : '0'}">מסמכים</div>
            <div class="dash-grid">${_buildDocCards(docs)}</div>`;
    }

    // ── Templates tab content (folder-specific + global/unlinked) ───
    const safeFolderName = esc(folderName);
    const folderTpls = Object.values(S.templates).filter(t => t.folder === folderName);
    const globalTpls = Object.values(S.templates).filter(t => !t.folder);

    function _tplCard(t) {
        const safeId = esc(t.id);
        return `
            <div class="site-tpl-card">
                <div class="site-tpl-icon">📋</div>
                <div class="site-tpl-info">
                    <div class="site-tpl-name">${esc(t.name)}</div>
                    <div class="site-tpl-meta">${t.tasks?.length || 0} משימות</div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
                    <button class="site-tpl-btn"
                        onclick="createReportFromTemplate('${safeId}','${safeFolderName}')">
                        + דוח
                    </button>
                    <button class="site-tpl-btn"
                        onclick="showTemplateEditor('${safeId}','${safeFolderName}')">
                        ✏️
                    </button>
                    <button class="site-tpl-btn site-tpl-btn-del"
                        onclick="deleteTemplatePrompt('${safeId}')" title="מחק תבנית">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                </div>
            </div>`;
    }

    const newTplBtn = `
        <button class="dash-new-folder-btn" style="margin-bottom:16px"
                onclick="showTemplateEditor(null,'${safeFolderName}')">
            + תבנית חדשה
        </button>`;

    let templatesHtml = newTplBtn;
    const hasAny = folderTpls.length || globalTpls.length;
    if (!hasAny) {
        templatesHtml += `
            <div class="dash-empty">
                <div class="dash-empty-icon">📋</div>
                <p>אין תבניות עדיין. לחץ "+ תבנית חדשה" ליצירה.</p>
            </div>`;
    } else {
        if (folderTpls.length) {
            templatesHtml += `<div class="site-tpl-list">${folderTpls.map(_tplCard).join('')}</div>`;
        }
        if (globalTpls.length) {
            templatesHtml += `
                <div class="dash-section-label" style="margin-top:${folderTpls.length ? '24px' : '0'}">תבניות כלליות</div>
                <div class="site-tpl-list">${globalTpls.map(_tplCard).join('')}</div>`;
        }
    }

    // ── Procedures tab content ────────────────────────────────────
    const proceduresHtml = _buildProceduresPanel(folderName);

    // ── Assemble full view ────────────────────────────────────────
    const safeFN = esc(folderName);
    container.innerHTML = `
        <div class="site-topbar">
            <button class="site-back-btn" onclick="showDashboard()">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleX(-1)"><polyline points="9 18 15 12 9 6"/></svg>
                חזור לתיקיות
            </button>
            <h2 class="site-title">📁 ${esc(folderName)}</h2>
            ${totalReports ? `<span class="dash-count">${totalReports}</span>` : ''}
            <div class="folder-menu-wrap">
                <button class="folder-menu-btn" onclick="toggleFolderMenu(event)" title="אפשרויות">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                </button>
                <div class="folder-menu-dropdown hidden" id="folderMenuDropdown">
                    <button class="folder-menu-item" onclick="closeFolderMenu();renameFolderPrompt('${safeFN}')">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        ערוך שם תיקייה
                    </button>
                    <button class="folder-menu-item folder-menu-item-danger" onclick="closeFolderMenu();deleteFolderPrompt('${safeFN}')">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        מחק תיקייה
                    </button>
                </div>
            </div>
        </div>

        <div class="site-tabs" role="tablist">
            <button class="site-tab active" role="tab" data-tab="history"    onclick="switchFolderTab('history')">היסטוריית דו״חות</button>
            <button class="site-tab"        role="tab" data-tab="templates"  onclick="switchFolderTab('templates')">תבניות</button>
            <button class="site-tab"        role="tab" data-tab="procedures" onclick="switchFolderTab('procedures')">נהלים והנחיות</button>
        </div>

        <div class="site-panel" data-panel="history">${historyHtml}</div>
        <div class="site-panel hidden" data-panel="templates">${templatesHtml}</div>
        <div class="site-panel hidden" data-panel="procedures">${proceduresHtml}</div>`;
}

/* ── Procedures helpers ──────────────────────────────────────────── */
function _buildProceduresPanel(folderName) {
    const procs = (S.procedures[folderName] || [])
        .slice()
        .sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''));
    const safeName = esc(folderName);

    let html = `
        <button class="dash-new-folder-btn" style="margin-bottom:16px"
                onclick="uploadProcedure('${safeName}')">
            + הוסף נוהל
        </button>`;

    if (!procs.length) {
        html += `
            <div class="dash-empty" style="min-height:160px">
                <div class="dash-empty-icon" style="opacity:.3">📄</div>
                <p>אין נהלים מצורפים לאתר זה עדיין.</p>
            </div>`;
    } else {
        html += `<div class="site-tpl-list">` +
            procs.map(p => {
                const icon   = fileIcon(p.file_type);
                const safeId = esc(p.id || '');
                const safeUrl = esc(p.file_path || '');
                return `
                    <div class="site-tpl-card proc-card">
                        <div class="proc-file-icon" onclick="window.open('${safeUrl}','_blank')">${icon}</div>
                        <div class="site-tpl-info proc-info" onclick="window.open('${safeUrl}','_blank')">
                            <div class="site-tpl-name">${esc(p.filename)}</div>
                            <div class="site-tpl-meta">${formatFileSize(p.file_size || 0)} · ${fmtDate(p.uploaded_at)}</div>
                        </div>
                        <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
                            <button class="site-tpl-btn site-tpl-btn-del"
                                onclick="deleteProcedure('${safeId}','${safeName}')" title="מחק">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </button>
                        </div>
                    </div>`;
            }).join('') +
            `</div>`;
    }
    return html;
}

export async function uploadProcedure(folderName) {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type   = 'file';
        input.accept = '.pdf,.doc,.docx,.xls,.xlsx';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.onchange = async (e) => {
            const file = e.target.files[0];
            document.body.removeChild(input);
            if (!file) { resolve(); return; }

            // Show inline loading state in the panel
            const panel = document.querySelector('[data-panel="procedures"]');
            if (panel) {
                panel.innerHTML = `
                    <div class="proc-uploading">
                        <div class="proc-spinner"></div>
                        <span>מעלה מסמך...</span>
                    </div>`;
            }

            try {
                const proc = await apiUploadProcedure(file, folderName);
                if (!S.procedures[folderName]) S.procedures[folderName] = [];
                S.procedures[folderName].unshift(proc);
                if (panel) panel.innerHTML = _buildProceduresPanel(folderName);
                toast('הנוהל הועלה בהצלחה ✓', 'success');
            } catch (err) {
                console.error('[PROC] upload error:', err);
                toast('שגיאה בהעלאת הנוהל', 'error');
                if (panel) panel.innerHTML = _buildProceduresPanel(folderName);
            }
            resolve();
        };

        input.oncancel = () => { document.body.removeChild(input); resolve(); };
        input.click();
    });
}

export async function deleteProcedure(id, folderName) {
    if (!confirm('למחוק נוהל זה?')) return;
    const panel = document.querySelector('[data-panel="procedures"]');
    try {
        await apiDeleteProcedure(id);
        if (S.procedures[folderName]) {
            S.procedures[folderName] = S.procedures[folderName].filter(p => p.id !== id);
        }
        if (panel) panel.innerHTML = _buildProceduresPanel(folderName);
        toast('הנוהל נמחק', 'error');
    } catch (err) {
        console.error('[PROC] delete error:', err);
        toast('שגיאה במחיקה', 'error');
    }
}

export function setReportMode(mode) {
    // mode = 'report' | 'template-editing'
    const isReport = mode === 'report';
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('emptyState').style.display   = 'none';
    document.getElementById('reportEditor').style.display = 'block';
    document.getElementById('cardImages').style.display       = isReport ? '' : 'none';
    document.getElementById('cardTech').style.display         = isReport ? '' : 'none';
    document.getElementById('cardFinalComments').style.display = isReport ? '' : 'none';
    document.getElementById('cardCustomerSig').style.display   = isReport ? '' : 'none';
    document.getElementById('cardDetails').querySelector('#fCustomer').closest('.fg').style.display   = isReport ? '' : 'none';
    document.getElementById('cardDetails').querySelector('#fVisitDate').closest('.fg').style.display  = isReport ? '' : 'none';
    document.getElementById('cardDetails').querySelector('#fNumber').closest('.fg').style.display     = isReport ? '' : 'none';
    // status buttons on tasks
    document.querySelectorAll('.status-btns').forEach(el => el.style.display = isReport ? '' : 'none');
}

/* ================================================================
   TASKS
================================================================ */
export function renderTasks(tasks) {
    document.getElementById('tasksList').innerHTML = '';
    let taskNum = 0;
    tasks.forEach(t => {
        if (t.type === 'section') {
            appendSectionTitle(t);
        } else {
            appendTask(t, ++taskNum);
        }
    });
    updateTaskCount();
}

export function addTask() {
    const id = 'tk_' + (++S.taskCounter);
    appendTask({ id, type: 'task', description: '', status: 'pending', comments: '' }, taskCount() + 1);
    markUnsaved();
    updateTaskCount();
    setTimeout(() => {
        const last = document.querySelector('#tasksList .task-item:last-child .task-desc');
        if (last) last.focus();
    }, 40);
}

export function addSectionTitle() {
    const id = 'sec_' + (++S.taskCounter);
    appendSectionTitle({ id, type: 'section', title: '' });
    markUnsaved();
    setTimeout(() => {
        const last = document.querySelector('#tasksList .section-title-item:last-of-type .section-title-input');
        if (last) last.focus();
    }, 40);
}

export function taskCount() { return document.querySelectorAll('#tasksList .task-item').length; }
export function updateTaskCount() {
    const n = taskCount();
    document.getElementById('taskCountBadge').textContent = n + ' משימות';
}

export function appendSectionTitle(t) {
    const list = document.getElementById('tasksList');
    const div  = document.createElement('div');
    div.className  = 'section-title-item';
    div.dataset.id = t.id;
    div.dataset.type = 'section';
    div.innerHTML = `
        <div class="drag-handle" title="גרור לשינוי סדר">⋮⋮</div>
        <input type="text" class="section-title-input" value="${esc(t.title||'')}"
               placeholder="שם האזור / קטגוריה..." oninput="markUnsaved()">
        <button class="section-del-btn" onclick="this.closest('.section-title-item').remove();markUnsaved()">✕</button>
    `;
    list.appendChild(div);
}

export function appendTask(t, num) {
    const list = document.getElementById('tasksList');
    const cls  = t.status === 'performed' ? 'performed' : t.status === 'not_performed' ? 'not-performed' : '';
    const isReport = S.currentMode === 'report';
    const div = document.createElement('div');
    div.className  = 'task-item ' + cls;
    div.dataset.id = t.id;
    div.dataset.type = 'task';
    div.dataset.status = t.status;
    div.innerHTML = `
        <div class="task-row">
            <div class="drag-handle" title="גרור לשינוי סדר">⋮⋮</div>
            <span class="task-num">${num}</span>
            <input type="text" class="task-desc" value="${esc(t.description)}" placeholder="תיאור המשימה..." oninput="markUnsaved()">
            <div class="status-btns" style="${isReport ? '' : 'display:none'}">
                <button class="sbtn sbtn-yes ${t.status==='performed'?'active':''}" onclick="setStatus(this,'performed')">✓ תקין</button>
                <button class="sbtn sbtn-no  ${t.status==='not_performed'?'active':''}" onclick="setStatus(this,'not_performed')">✗ לא תקין</button>
            </div>
            <button class="task-del-btn" onclick="removeTask(this)">✕</button>
        </div>
        <textarea class="task-comment" placeholder="הערות למשימה זו..." oninput="markUnsaved()">${esc(t.comments)}</textarea>
    `;
    list.appendChild(div);
}

export function setStatus(btn, status) {
    const item = btn.closest('.task-item');
    // Second click on the active button clears the status
    const toggled = item.dataset.status === status ? 'pending' : status;
    item.dataset.status = toggled;
    item.querySelectorAll('.sbtn').forEach(b => b.classList.remove('active'));
    if (toggled !== 'pending') btn.classList.add('active');
    item.classList.remove('performed', 'not-performed');
    if (toggled === 'performed')     item.classList.add('performed');
    if (toggled === 'not_performed') item.classList.add('not-performed');
    markUnsaved();
}

export function removeTask(btn) {
    btn.closest('.task-item').remove();
    // re-number only task items (not section titles)
    let num = 0;
    document.querySelectorAll('#tasksList .task-item').forEach(el => {
        el.querySelector('.task-num').textContent = ++num;
    });
    markUnsaved();
    updateTaskCount();
}

export function collectTasks() {
    const items = document.querySelectorAll('#tasksList .task-item, #tasksList .section-title-item');
    return Array.from(items).map(el => {
        if (el.dataset.type === 'section') {
            return {
                id:    el.dataset.id,
                type:  'section',
                title: el.querySelector('.section-title-input').value,
            };
        }
        return {
            id:          el.dataset.id,
            type:        'task',
            description: el.querySelector('.task-desc').value,
            status:      el.dataset.status || 'pending',
            comments:    el.querySelector('.task-comment').value,
        };
    });
}

/* ================================================================
   IMAGES
================================================================ */
export async function handleImages(e) {
    const r = S.reports[S.currentId];
    if (!r) { console.warn('[IMG] no open report'); return; }
    const files = Array.from(e.target.files);
    console.log('[IMG] files selected:', files.length, files.map(f => `${f.name} (${(f.size/1024/1024).toFixed(1)}MB, ${f.type})`));
    if (!files.length) return;
    e.target.value = '';

    const compressionOptions = {
        maxWidthOrHeight: 1920,
        useWebWorker:     true,
        initialQuality:   0.8,
    };

    for (const file of files) {
        try {
            let blob = file;
            if (file.size > 512 * 1024) { // only compress if > 512 KB
                console.log('[IMG] compressing:', file.name, `${(file.size/1024/1024).toFixed(1)}MB`);
                blob = await imageCompression(file, compressionOptions);
                console.log('[IMG] compressed to:', `${(blob.size/1024/1024).toFixed(1)}MB`);
            }
            const dataUrl = await imageCompression.getDataUrlFromFile(blob);
            r.images.push(dataUrl);
            renderImages(r.images);
            markUnsaved();
        } catch (err) {
            console.error('[IMG] compression/read error for', file.name, err);
            toast('שגיאה בעיבוד התמונה', 'error');
        }
    }
}

export function renderImages(images) {
    const grid = document.getElementById('imagesGrid');
    grid.innerHTML = '';
    images.forEach((src, i) => {
        const div = document.createElement('div');
        div.className = 'image-thumb';
        div.innerHTML = `
            <img src="${src}" alt="תמונה ${i+1}" onclick="openLightbox('${src}')">
            <button class="image-del-btn" onclick="removeImage(${i})">✕</button>
        `;
        grid.appendChild(div);
    });
}

export function removeImage(idx) {
    const r = S.reports[S.currentId];
    if (!r) return;
    r.images.splice(idx, 1);
    renderImages(r.images);
    markUnsaved();
}

export function openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.remove('hidden');
}
export function closeLightbox() { document.getElementById('lightbox').classList.add('hidden'); }

/* ================================================================
   REPORT APPENDICES (read-only view)
================================================================ */
export function renderReportAppendices(appendices) {
    const card = document.getElementById('cardAppendices');
    const list = document.getElementById('reportAppendicesList');
    list.innerHTML = '';
    if (!appendices || appendices.length === 0) {
        card.style.display = 'none';
        return;
    }
    card.style.display = '';
    appendices.forEach(app => {
        const block = document.createElement('div');
        block.className      = 'report-appendix-block';
        block.dataset.appId  = app.id;
        block.dataset.fileData = app.fileData || '';
        block.dataset.fileType = app.fileType || '';
        block.innerHTML = `
            <span class="report-appendix-icon">${fileIcon(app.fileType || '')}</span>
            <div class="report-appendix-info">
                <div class="report-appendix-name">${escHtml(app.fileName || app.title || 'נספח')}</div>
                <div class="report-appendix-meta">${escHtml(app.fileSize || '')}</div>
            </div>
            <button class="btn-open-appendix" onclick="openAppendixFile(this)">📂 פתח</button>
        `;
        list.appendChild(block);
    });
}

export function openAppendixFile(btn) {
    const block    = btn.closest('.report-appendix-block');
    const fileData = block.dataset.fileData;
    const fileType = block.dataset.fileType;
    const fileName = block.querySelector('.report-appendix-name').textContent;
    if (!fileData) { toast('לא נמצא קובץ', 'error'); return; }

    // For images / PDFs — open in new tab directly
    if (fileType.includes('image') || fileType.includes('pdf')) {
        const win = window.open();
        if (fileType.includes('image')) {
            win.document.write(`<html><body style="margin:0;background:#000"><img src="${fileData}" style="max-width:100%;display:block;margin:auto"></body></html>`);
        } else {
            win.document.write(`<html><body style="margin:0"><embed src="${fileData}" type="application/pdf" width="100%" height="100%"></body></html>`);
        }
        return;
    }

    // For Word / Excel / other — trigger download
    const a = document.createElement('a');
    a.href     = fileData;
    a.download = fileName;
    a.click();
}

export function collectReportAppendices() {
    return Array.from(document.querySelectorAll('#reportAppendicesList .report-appendix-block')).map(block => ({
        id:       block.dataset.appId,
        title:    block.querySelector('.report-appendix-name').textContent,
        fileName: block.querySelector('.report-appendix-name').textContent,
        fileSize: block.querySelector('.report-appendix-meta').textContent,
        fileType: block.dataset.fileType,
        fileData: block.dataset.fileData,
    }));
}

/* ================================================================
   TEMPLATE TASK EDITOR
================================================================ */
export function renderTplTasks(tasks) {
    const list = document.getElementById('tplTaskList');
    list.innerHTML = '';
    let num = 0;
    tasks.forEach(t => {
        if (t.type === 'section') appendTplSection(t);
        else appendTplTask(t, ++num);
    });
}

export function appendTplTask(t, num) {
    const list = document.getElementById('tplTaskList');
    const row  = document.createElement('div');
    row.className = 'tpl-task-row';
    row.dataset.type = 'task';
    row.innerHTML = `
        <span style="font-size:10.5px;font-weight:800;color:var(--slate-400);min-width:20px;text-align:center;">${num}</span>
        <input type="text" class="tpl-task-input" value="${esc(t.description||'')}" placeholder="תיאור משימה...">
        <button class="tpl-task-del" onclick="this.parentElement.remove();renumberTplTasks()">✕</button>
    `;
    list.appendChild(row);
}

export function appendTplSection(t) {
    const list = document.getElementById('tplTaskList');
    const div  = document.createElement('div');
    div.className  = 'section-title-item';
    div.dataset.type = 'section';
    div.innerHTML = `
        <input type="text" class="section-title-input" value="${esc(t.title||'')}" placeholder="שם האזור / קטגוריה...">
        <button class="section-del-btn" onclick="this.closest('.section-title-item').remove()">✕</button>
    `;
    list.appendChild(div);
}

export function addTplTask() {
    appendTplTask({ description: '' }, tplTaskCount() + 1);
    setTimeout(() => {
        const list = document.getElementById('tplTaskList');
        const last = list.querySelector('.tpl-task-row:last-child .tpl-task-input');
        if (last) last.focus();
    }, 40);
}

export function addTplSection() {
    appendTplSection({ type: 'section', title: '' });
    setTimeout(() => {
        const list = document.getElementById('tplTaskList');
        const last = list.querySelector('.section-title-item:last-of-type .section-title-input');
        if (last) last.focus();
    }, 40);
}

export function tplTaskCount() {
    return document.querySelectorAll('#tplTaskList .tpl-task-row').length;
}

export function renumberTplTasks() {
    let num = 0;
    document.querySelectorAll('#tplTaskList .tpl-task-row').forEach(row => {
        row.querySelector('span').textContent = ++num;
    });
}

/* ================================================================
   TEMPLATE APPENDIX EDITOR
================================================================ */
export function renderTplAppendices(appendices) {
    const list = document.getElementById('tplAppendicesList');
    list.innerHTML = '';
    (appendices || []).forEach(app => appendTplAppendixBlock(app));
}

export function appendTplAppendixBlock(app) {
    const list = document.getElementById('tplAppendicesList');
    const div  = document.createElement('div');
    div.className     = 'appendix-editor-block';
    div.dataset.appId = app.id;
    div.dataset.fileData = app.fileData || '';
    div.dataset.fileType = app.fileType || '';
    div.innerHTML = `
        <span class="appendix-file-icon">${fileIcon(app.fileType || '')}</span>
        <div class="appendix-file-info">
            <div class="appendix-file-name">${escHtml(app.fileName || app.title || '')}</div>
            <div class="appendix-file-size">${app.fileSize || ''}</div>
        </div>
        <button class="appendix-item-del" onclick="this.closest('.appendix-editor-block').remove()" title="הסר">🗑️</button>
    `;
    list.appendChild(div);
}

export function handleTplAppendixFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const app = {
            id:       'app_' + (++S.taskCounter),
            title:    file.name,
            fileName: file.name,
            fileType: file.type,
            fileSize: formatFileSize(file.size),
            fileData: e.target.result,
        };
        appendTplAppendixBlock(app);
        toast(`הקובץ "${file.name}" צורף ✓`, 'success');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

export function collectTplAppendices() {
    return Array.from(document.querySelectorAll('#tplAppendicesList .appendix-editor-block')).map(block => ({
        id:       block.dataset.appId,
        title:    block.querySelector('.appendix-file-name').textContent,
        fileName: block.querySelector('.appendix-file-name').textContent,
        fileSize: block.querySelector('.appendix-file-size').textContent,
        fileType: block.dataset.fileType,
        fileData: block.dataset.fileData,
    })).filter(a => a.fileData);
}

/* ================================================================
   SIDEBAR
================================================================ */
export function renderSidebar() {
    const c = document.getElementById('sidebarBody');
    c.innerHTML = '';

    // ── Folders + reports ──
    Object.keys(S.folders).forEach(name => {
        const ids = (S.folders[name] || []).filter(id => S.reports[id]);
        const fi  = document.createElement('div');
        fi.className = 'folder-item';

        const reportsHtml = ids.map(id => {
            const r   = S.reports[id];
            const act = id === S.currentId;
            return `<div class="row-item ${act?'active':''}" onclick="openReport('${id}')">
                        <span class="row-icon">📄</span>
                        <span class="row-name">${esc(r.title||'ללא שם')}</span>
                        <div class="rbtns" onclick="event.stopPropagation()">
                            <button class="rbn" title="מחק" onclick="if(confirm('למחוק דוח זה?')){deleteReportById('${id}')}">🗑️</button>
                        </div>
                    </div>`;
        }).join('');

        fi.innerHTML = `
            <div class="folder-hdr" onclick="toggleFolder(this)">
                <span style="font-size:14px">📁</span>
                <span class="folder-name" onclick="event.stopPropagation();showFolderContent('${esc(name)}')">${esc(name)}</span>
                <span class="folder-badge">${ids.length}</span>
                <div class="folder-btns" onclick="event.stopPropagation()">
                    <button class="fbn" title="שנה שם" onclick="renameFolderPrompt('${esc(name)}')">✏️</button>
                    <button class="fbn" title="מחק" onclick="deleteFolderPrompt('${esc(name)}')">🗑️</button>
                </div>
                <span class="folder-chevron">▶</span>
            </div>
            <div class="folder-reports">
                ${reportsHtml || '<div style="padding:5px 7px;font-size:11px;color:#3d506b;">אין דוחות</div>'}
            </div>`;
        c.appendChild(fi);
    });

    // ── Unfiled reports ──
    const unfiled = Object.keys(S.reports).filter(id => {
        const r = S.reports[id];
        return !r.folder || !S.folders[r.folder] || !S.folders[r.folder].includes(id);
    });
    if (unfiled.length) {
        const lbl = document.createElement('div');
        lbl.className = 'sb-label';
        lbl.textContent = 'דו"חות אחרונים';
        c.appendChild(lbl);
        unfiled.forEach(id => {
            const r   = S.reports[id];
            const act = id === S.currentId;
            const d   = document.createElement('div');
            d.className = `row-item ${act?'active':''}`;
            d.innerHTML = `<span class="row-icon">📄</span>
                           <span class="row-name">${esc(r.title||'ללא שם')}</span>
                           <div class="rbtns" onclick="event.stopPropagation()">
                               <button class="rbn" title="מחק" onclick="if(confirm('למחוק?')){deleteReportById('${id}')}">🗑️</button>
                           </div>`;
            d.onclick = () => window.openReport(id);
            c.appendChild(d);
        });
    }

    // ── Templates section ──
    const tplIds = Object.keys(S.templates);
    if (tplIds.length) {
        const hr = document.createElement('hr');
        hr.className = 'sb-divider';
        c.appendChild(hr);

        const lbl = document.createElement('div');
        lbl.className = 'sb-label templates-header';
        lbl.textContent = 'תבניות';
        c.appendChild(lbl);

        tplIds.forEach(id => {
            const t   = S.templates[id];
            const d   = document.createElement('div');
            d.className = 'row-item';
            d.innerHTML = `<span class="row-icon">📋</span>
                           <span class="row-name">${esc(t.name)}</span>
                           <span style="font-size:10px;color:#3d506b;flex-shrink:0;">${t.tasks.length}</span>
                           <div class="rbtns" onclick="event.stopPropagation()">
                               <button class="rbn" title="עריכה" onclick="showTemplateEditor('${id}')">✏️</button>
                               <button class="rbn" title="מחק" onclick="deleteTemplatePrompt('${id}')">🗑️</button>
                           </div>`;
            d.onclick = () => window.createReportFromTemplate(id);
            c.appendChild(d);
        });
    }

    // Empty state
    if (!Object.keys(S.folders).length && !unfiled.length && !tplIds.length) {
        c.innerHTML = '<div style="padding:18px 10px;font-size:12px;color:#3d506b;text-align:center;line-height:1.7;">עדיין אין דוחות.<br>לחץ <strong style="color:#60a5fa;">"+ דוח חדש"</strong> להתחלה.</div>';
    }
}

export function toggleFolder(hdr) { hdr.parentElement.classList.toggle('open'); }

/* ================================================================
   TOOLBAR
================================================================ */
export function updateToolbar() {
    const title   = document.getElementById('toolbarTitle');
    const mode    = document.getElementById('toolbarMode');
    const actions = document.getElementById('toolbarActions');

    if (!S.currentId) {
        title.innerHTML  = 'מערכת דוחות טכנאי שטח';
        mode.innerHTML   = '';
        actions.innerHTML= '';
        return;
    }

    const r   = S.reports[S.currentId];
    const dot = S.unsaved ? '<span class="unsaved-dot"></span>' : '';
    title.innerHTML = dot + esc(r?.title || 'דוח');
    mode.innerHTML  = '';

    actions.innerHTML = `
        <button class="tbtn tbtn-save"     onclick="saveReport()">שמור</button>
        <button class="tbtn tbtn-pdf"      onclick="downloadPDF()">PDF</button>
        <button class="tbtn tbtn-share"    onclick="showShareModal()">שתף</button>
        <button class="tbtn tbtn-template" onclick="showSaveAsTemplate()">שמור כתבנית</button>
        <button class="tbtn tbtn-folder"   onclick="showMoveFolderModal()">תיקייה</button>
        <button class="tbtn tbtn-clear"    onclick="clearReport()">נקה</button>
        <button class="tbtn tbtn-delete"   onclick="deleteReportPrompt()">✕ מחק</button>
    `;
}

/* ================================================================
   MODALS & TOASTS
================================================================ */
export function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
export function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

export function openImportAssociationModal() {
    // Reset state
    document.getElementById('docFilePreview').textContent = 'לא נבחר קובץ';
    document.getElementById('docUploadBtn').disabled = true;
    document.getElementById('documentInput').value = '';
    document.getElementById('docTargetFolder').textContent = S.currentFolder || '(ללא תיקייה)';
    showModal('importAssociationModal');
}

export function toast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' '+type : '');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ================================================================
   MOBILE SIDEBAR
================================================================ */
export function toggleMobileSidebar() {
    const sb  = document.querySelector('.sidebar');
    const ov  = document.getElementById('mobileSidebarOverlay');
    const open = sb.classList.toggle('mobile-open');
    ov.classList.toggle('active', open);
}

export function closeMobileSidebar() {
    document.querySelector('.sidebar').classList.remove('mobile-open');
    document.getElementById('mobileSidebarOverlay').classList.remove('active');
}

/* ================================================================
   DRAG & DROP (SortableJS)
================================================================ */
export function initSortable() {
    const list = document.getElementById('tasksList');
    if (!list || typeof Sortable === 'undefined') return;
    // Destroy any existing instance before re-creating
    if (list._sortable) { list._sortable.destroy(); list._sortable = null; }
    list._sortable = Sortable.create(list, {
        animation: 150,
        handle: '.drag-handle',
        delay: 150,
        delayOnTouchOnly: true,
        ghostClass:  'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass:   'sortable-drag',
        onEnd() {
            // Re-number only task items (sections are unnumbered)
            let num = 0;
            list.querySelectorAll('.task-item').forEach(el => {
                el.querySelector('.task-num').textContent = ++num;
            });
            markUnsaved();
        },
    });
}

/* ================================================================
   STATE
================================================================ */
const S = {
    reports:   {},
    folders:   {},      // { folderName: [id, ...] }
    templates: {},      // { id: { id, name, permComments, tasks:[{desc,comments}] } }
    currentId:      null,
    currentMode:    'report',   // 'report' | 'template'
    currentTplId:   null,       // if mode=template, which template is open for editing
    pad:    null,
    taskCounter: 0,
    unsaved: false,
    pendingDeleteFolder: null,
    pendingRenameFolder: null,
    importParsed: null,   // { name, tasks }
};

/* ================================================================
   STORAGE
================================================================ */
function persist() {
    localStorage.setItem('trs_v2', JSON.stringify({
        reports:     S.reports,
        folders:     S.folders,
        templates:   S.templates,
        taskCounter: S.taskCounter,
    }));
}

function hydrate() {
    try {
        const raw = localStorage.getItem('trs_v2');
        if (!raw) {
            // migrate from v1 if exists
            const v1 = localStorage.getItem('trs_v1');
            if (v1) {
                const d = JSON.parse(v1);
                S.reports     = d.reports     || {};
                S.folders     = d.folders     || {};
                S.taskCounter = d.taskCounter || 0;
            }
            return;
        }
        const d = JSON.parse(raw);
        S.reports     = d.reports     || {};
        S.folders     = d.folders     || {};
        S.templates   = d.templates   || {};
        S.taskCounter = d.taskCounter || 0;
    } catch { /* first run */ }
}

/* ================================================================
   UTILS
================================================================ */
function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function today(){ return new Date().toISOString().split('T')[0]; }
function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
const escHtml = esc;
function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('he-IL'); } catch { return d; }
}

/* ================================================================
   INIT
================================================================ */
// Cached logo base64 – loaded once at startup so html2canvas can embed it
let LOGO_DATA_URL = null;

function preloadLogo() {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            try { LOGO_DATA_URL = c.toDataURL('image/png'); } catch { LOGO_DATA_URL = null; }
            resolve();
        };
        img.onerror = () => { LOGO_DATA_URL = null; resolve(); };
        // cache-bust to avoid tainted-canvas issues
        img.src = '299f86e2-665c-452a-a625-9d0556cb6647.png?' + Date.now();
    });
}

function init() {
    hydrate();
    initPad();
    preloadLogo();
    renderSidebar();
    setTodayDates();
    document.querySelectorAll('#reportEditor input, #reportEditor textarea').forEach(el => {
        el.addEventListener('input', () => markUnsaved());
    });
    // Hide native share btn if not supported
    if (!navigator.share) {
        const nb = document.getElementById('shareNativeBtn');
        if (nb) nb.style.display = 'none';
    }
}

function setTodayDates() {
    document.getElementById('fVisitDate').value = today();
    document.getElementById('fCompDate').value  = today();
}

/* ================================================================
   SIGNATURE PAD
================================================================ */
function initPad() {
    const canvas = document.getElementById('signatureCanvas');
    canvas.width  = canvas.parentElement.offsetWidth || 680;
    canvas.height = 140;
    S.pad = new SignaturePad(canvas, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: '#1e293b',
        minWidth: 1.5,
        maxWidth: 3,
    });
    window.addEventListener('resize', () => {
        if (!S.pad) return;
        const data = S.pad.toDataURL();
        canvas.width = canvas.parentElement.offsetWidth || 680;
        canvas.height = 140;
        S.pad.clear();
        if (data && !data.endsWith(',')) S.pad.fromDataURL(data);
    });
}
function clearSignature() { S.pad && S.pad.clear(); markUnsaved(); }

/* ================================================================
   NEW REPORT MODAL
================================================================ */
function showNewReportModal() {
    document.getElementById('newReportName').value = '';
    // populate template options
    const list = document.getElementById('newReportTplList');
    const tplIds = Object.keys(S.templates);
    if (!tplIds.length) {
        list.innerHTML = '<div style="font-size:12px;color:var(--slate-400);padding:6px 0;">אין תבניות שמורות</div>';
    } else {
        list.innerHTML = tplIds.map(id => {
            const t = S.templates[id];
            return `<div class="tpl-opt" data-tpl="${id}" onclick="selectNewReportTpl(this,'${id}')">
                        <span>📋</span><span>${esc(t.name)}</span>
                        <span style="font-size:11px;color:var(--slate-400);margin-right:auto;">${t.tasks.length} משימות</span>
                    </div>`;
        }).join('');
    }
    showModal('newReportModal');
    setTimeout(() => document.getElementById('newReportName').focus(), 80);
}

function selectNewReportTpl(el, id) {
    document.querySelectorAll('#newReportTplList .tpl-opt').forEach(e => e.classList.remove('selected'));
    if (el.dataset.chosen === '1') {
        el.dataset.chosen = '';
    } else {
        el.classList.add('selected');
        el.dataset.chosen = '1';
    }
}

function confirmNewReport() {
    const name = document.getElementById('newReportName').value.trim();
    if (!name) { toast('אנא הכנס שם לדוח', 'error'); return; }

    const chosenTplEl = document.querySelector('#newReportTplList .tpl-opt[data-chosen="1"]');
    const tplId = chosenTplEl ? chosenTplEl.dataset.tpl : null;

    const id = uid();
    const t  = today();
    const tpl = tplId ? S.templates[tplId] : null;

    S.reports[id] = {
        id,
        title:       name,
        customer:    '',
        site:        '',
        visitDate:   t,
        number:      '',
        permComments: tpl ? (tpl.permComments || '') : '',
        tasks: tpl ? tpl.tasks.map(tk => ({
            id: 'tk_' + (++S.taskCounter),
            description: tk.description,
            status:   'pending',
            comments: tk.comments || '',
        })) : [],
        images: [],
        tech: { name: '', compDate: t, sig: '' },
        folder:    null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    persist();
    hideModal('newReportModal');
    openReport(id);
    renderSidebar();
    toast('דוח חדש נוצר' + (tpl ? ` מתבנית "${tpl.name}"` : ''), 'success');
}

/* ================================================================
   REPORTS – CRUD
================================================================ */
function openReport(id) {
    if (!confirmUnsaved()) return;
    closeMobileSidebar();
    S.currentId   = id;
    S.currentMode = 'report';
    S.unsaved     = false;
    const r = S.reports[id];
    if (!r) return;

    setReportMode('report');

    document.getElementById('fTitle').value        = r.title        || '';
    document.getElementById('fCustomer').value     = r.customer     || '';
    document.getElementById('fSite').value         = r.site         || '';
    document.getElementById('fVisitDate').value    = r.visitDate    || '';
    document.getElementById('fNumber').value       = r.number       || '';
    document.getElementById('fPermComments').value = r.permComments || '';
    document.getElementById('fTechName').value     = r.tech?.name   || '';
    document.getElementById('fCompDate').value     = r.tech?.compDate || '';

    renderTasks(r.tasks || []);
    renderImages(r.images || []);
    renderReportAppendices(r.appendices || []);

    if (S.pad) {
        S.pad.clear();
        if (r.tech?.sig) S.pad.fromDataURL(r.tech.sig);
    }

    updateToolbar();
    renderSidebar();
    document.getElementById('reportArea').scrollTop = 0;
}

function setReportMode(mode) {
    // mode = 'report' | 'template-editing'
    const isReport = mode === 'report';
    document.getElementById('emptyState').style.display   = 'none';
    document.getElementById('reportEditor').style.display = 'block';
    document.getElementById('cardImages').style.display   = isReport ? '' : 'none';
    document.getElementById('cardTech').style.display     = isReport ? '' : 'none';
    document.getElementById('cardDetails').querySelector('#fCustomer').closest('.fg').style.display   = isReport ? '' : 'none';
    document.getElementById('cardDetails').querySelector('#fVisitDate').closest('.fg').style.display  = isReport ? '' : 'none';
    document.getElementById('cardDetails').querySelector('#fNumber').closest('.fg').style.display     = isReport ? '' : 'none';
    // status buttons on tasks
    document.querySelectorAll('.status-btns').forEach(el => el.style.display = isReport ? '' : 'none');
}

function saveReport() {
    if (!S.currentId || S.currentMode !== 'report') return;
    const r = S.reports[S.currentId];
    if (!r) return;

    r.title        = document.getElementById('fTitle').value.trim() || 'דוח ללא שם';
    r.customer     = document.getElementById('fCustomer').value;
    r.site         = document.getElementById('fSite').value;
    r.visitDate    = document.getElementById('fVisitDate').value;
    r.number       = document.getElementById('fNumber').value;
    r.permComments = document.getElementById('fPermComments').value;
    r.tasks        = collectTasks();
    r.appendices   = collectReportAppendices();
    r.tech = {
        name:     document.getElementById('fTechName').value,
        compDate: document.getElementById('fCompDate').value,
        sig:      S.pad && !S.pad.isEmpty() ? S.pad.toDataURL() : (r.tech?.sig || ''),
    };
    r.updatedAt = new Date().toISOString();

    persist();
    S.unsaved = false;
    updateToolbar();
    renderSidebar();
    toast('הדוח נשמר ✓', 'success');
}

function clearReport() {
    if (!S.currentId) return;
    if (!confirm('לנקות את כל הנתונים? (הדוח לא יימחק)')) return;
    const t = today();
    ['fTitle','fCustomer','fSite','fNumber','fPermComments','fTechName'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('fVisitDate').value = t;
    document.getElementById('fCompDate').value  = t;
    S.reports[S.currentId].tasks  = [];
    S.reports[S.currentId].images = [];
    renderTasks([]);
    renderImages([]);
    if (S.pad) S.pad.clear();
    markUnsaved();
    toast('הטופס נוקה', 'success');
}

function deleteReportPrompt() {
    if (!S.currentId) return;
    showModal('deleteModal');
}

function confirmDelete() {
    if (!S.currentId) return;
    const id = S.currentId;
    for (const fn in S.folders) {
        S.folders[fn] = S.folders[fn].filter(x => x !== id);
    }
    delete S.reports[id];
    S.currentId = null;
    S.unsaved   = false;
    document.getElementById('emptyState').style.display   = 'flex';
    document.getElementById('reportEditor').style.display = 'none';
    persist();
    renderSidebar();
    hideModal('deleteModal');
    updateToolbar();
    toast('הדוח נמחק', 'error');
}

function markUnsaved() { S.unsaved = true; updateToolbar(); }

function confirmUnsaved() {
    if (S.unsaved && S.currentId) {
        return confirm('יש שינויים שלא נשמרו. לנטוש?');
    }
    return true;
}

/* ================================================================
   TASKS
================================================================ */
function renderTasks(tasks) {
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

function addTask() {
    const id = 'tk_' + (++S.taskCounter);
    appendTask({ id, type: 'task', description: '', status: 'pending', comments: '' }, taskCount() + 1);
    markUnsaved();
    updateTaskCount();
    setTimeout(() => {
        const last = document.querySelector('#tasksList .task-item:last-child .task-desc');
        if (last) last.focus();
    }, 40);
}

function addSectionTitle() {
    const id = 'sec_' + (++S.taskCounter);
    appendSectionTitle({ id, type: 'section', title: '' });
    markUnsaved();
    setTimeout(() => {
        const last = document.querySelector('#tasksList .section-title-item:last-of-type .section-title-input');
        if (last) last.focus();
    }, 40);
}

function taskCount() { return document.querySelectorAll('#tasksList .task-item').length; }
function updateTaskCount() {
    const n = taskCount();
    document.getElementById('taskCountBadge').textContent = n + ' משימות';
}

function appendSectionTitle(t) {
    const list = document.getElementById('tasksList');
    const div  = document.createElement('div');
    div.className  = 'section-title-item';
    div.dataset.id = t.id;
    div.dataset.type = 'section';
    div.innerHTML = `
        <input type="text" class="section-title-input" value="${esc(t.title||'')}"
               placeholder="שם האזור / קטגוריה..." oninput="markUnsaved()">
        <button class="section-del-btn" onclick="this.closest('.section-title-item').remove();markUnsaved()">✕</button>
    `;
    list.appendChild(div);
}

function appendTask(t, num) {
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
            <span class="task-num">${num}</span>
            <input type="text" class="task-desc" value="${esc(t.description)}" placeholder="תיאור המשימה..." oninput="markUnsaved()">
            <div class="status-btns" style="${isReport ? '' : 'display:none'}">
                <button class="sbtn sbtn-yes ${t.status==='performed'?'active':''}" onclick="setStatus(this,'performed')">✓ בוצע</button>
                <button class="sbtn sbtn-no  ${t.status==='not_performed'?'active':''}" onclick="setStatus(this,'not_performed')">✗ לא בוצע</button>
            </div>
            <button class="task-del-btn" onclick="removeTask(this)">✕</button>
        </div>
        <textarea class="task-comment" placeholder="הערות למשימה זו..." oninput="markUnsaved()">${esc(t.comments)}</textarea>
    `;
    list.appendChild(div);
}

function setStatus(btn, status) {
    const item = btn.closest('.task-item');
    item.dataset.status = status;
    item.querySelectorAll('.sbtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    item.classList.remove('performed','not-performed');
    if (status === 'performed')     item.classList.add('performed');
    if (status === 'not_performed') item.classList.add('not-performed');
    markUnsaved();
}

function removeTask(btn) {
    btn.closest('.task-item').remove();
    // re-number only task items (not section titles)
    let num = 0;
    document.querySelectorAll('#tasksList .task-item').forEach(el => {
        el.querySelector('.task-num').textContent = ++num;
    });
    markUnsaved();
    updateTaskCount();
}

function collectTasks() {
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
function handleImages(e) {
    const r = S.reports[S.currentId];
    if (!r) return;
    const files = Array.from(e.target.files);
    let done = 0;
    files.forEach(file => {
        const fr = new FileReader();
        fr.onload = ev => {
            r.images.push(ev.target.result);
            if (++done === files.length) { renderImages(r.images); markUnsaved(); }
        };
        fr.readAsDataURL(file);
    });
    e.target.value = '';
}

function renderImages(images) {
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

/* ── Report appendix view ─────────────────────────────── */
function renderReportAppendices(appendices) {
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

function openAppendixFile(btn) {
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

function collectReportAppendices() {
    return Array.from(document.querySelectorAll('#reportAppendicesList .report-appendix-block')).map(block => ({
        id:       block.dataset.appId,
        title:    block.querySelector('.report-appendix-name').textContent,
        fileName: block.querySelector('.report-appendix-name').textContent,
        fileSize: block.querySelector('.report-appendix-meta').textContent,
        fileType: block.dataset.fileType,
        fileData: block.dataset.fileData,
    }));
}

function removeImage(idx) {
    const r = S.reports[S.currentId];
    if (!r) return;
    r.images.splice(idx, 1);
    renderImages(r.images);
    markUnsaved();
}

function openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.remove('hidden');
}
function closeLightbox() { document.getElementById('lightbox').classList.add('hidden'); }

/* ================================================================
   TEMPLATES
================================================================ */
function showTemplateEditor(id) {
    const tpl = id ? S.templates[id] : null;
    document.getElementById('tplEditorId').value         = id || '';
    document.getElementById('tplEditorTitle').textContent = tpl ? `✏️ עריכת תבנית` : `📋 תבנית חדשה`;
    document.getElementById('tplName').value             = tpl ? (tpl.name || '') : '';
    document.getElementById('tplPermComments').value     = tpl ? (tpl.permComments || '') : '';
    renderTplTasks(tpl ? tpl.tasks : []);
    renderTplAppendices(tpl ? (tpl.appendices || []) : []);
    showModal('tplEditorModal');
    setTimeout(() => document.getElementById('tplName').focus(), 80);
}

function renderTplTasks(tasks) {
    const list = document.getElementById('tplTaskList');
    list.innerHTML = '';
    let num = 0;
    tasks.forEach(t => {
        if (t.type === 'section') appendTplSection(t);
        else appendTplTask(t, ++num);
    });
}

function appendTplTask(t, num) {
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

function appendTplSection(t) {
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

function addTplTask() {
    appendTplTask({ description: '' }, tplTaskCount() + 1);
    setTimeout(() => {
        const list = document.getElementById('tplTaskList');
        const last = list.querySelector('.tpl-task-row:last-child .tpl-task-input');
        if (last) last.focus();
    }, 40);
}

function addTplSection() {
    appendTplSection({ type: 'section', title: '' });
    setTimeout(() => {
        const list = document.getElementById('tplTaskList');
        const last = list.querySelector('.section-title-item:last-of-type .section-title-input');
        if (last) last.focus();
    }, 40);
}

/* ── Template appendix editor ─────────────────────────── */
function renderTplAppendices(appendices) {
    const list = document.getElementById('tplAppendicesList');
    list.innerHTML = '';
    (appendices || []).forEach(app => appendTplAppendixBlock(app));
}

function appendTplAppendixBlock(app) {
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

function handleTplAppendixFile(event) {
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

function collectTplAppendices() {
    return Array.from(document.querySelectorAll('#tplAppendicesList .appendix-editor-block')).map(block => ({
        id:       block.dataset.appId,
        title:    block.querySelector('.appendix-file-name').textContent,
        fileName: block.querySelector('.appendix-file-name').textContent,
        fileSize: block.querySelector('.appendix-file-size').textContent,
        fileType: block.dataset.fileType,
        fileData: block.dataset.fileData,
    })).filter(a => a.fileData);
}

function fileIcon(type) {
    if (!type) return '📎';
    if (type.includes('pdf'))   return '📄';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('sheet') || type.includes('excel'))   return '📊';
    if (type.includes('image')) return '🖼️';
    return '📎';
}

function formatFileSize(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function tplTaskCount() {
    return document.querySelectorAll('#tplTaskList .tpl-task-row').length;
}

function renumberTplTasks() {
    let num = 0;
    document.querySelectorAll('#tplTaskList .tpl-task-row').forEach(row => {
        row.querySelector('span').textContent = ++num;
    });
}

function saveTplEditor() {
    const name = document.getElementById('tplName').value.trim();
    if (!name) { toast('אנא הכנס שם לתבנית', 'error'); return; }

    const items = document.querySelectorAll('#tplTaskList .tpl-task-row, #tplTaskList .section-title-item');
    const tasks = Array.from(items).map(el => {
        if (el.dataset.type === 'section') {
            return { type: 'section', title: el.querySelector('.section-title-input').value.trim() };
        }
        return { type: 'task', description: el.querySelector('.tpl-task-input').value.trim(), comments: '' };
    }).filter(t => t.type === 'section' ? t.title : t.description);

    const existingId = document.getElementById('tplEditorId').value;
    const id = existingId || uid();

    S.templates[id] = {
        id,
        name,
        permComments: document.getElementById('tplPermComments').value,
        tasks,
        appendices: collectTplAppendices(),
        updatedAt: new Date().toISOString(),
    };
    if (!existingId) S.templates[id].createdAt = S.templates[id].updatedAt;

    persist();
    renderSidebar();
    hideModal('tplEditorModal');
    toast(`תבנית "${name}" נשמרה ✓`, 'success');
}

function deleteTemplatePrompt(id) {
    if (confirm(`למחוק את התבנית "${S.templates[id]?.name}"?`)) {
        delete S.templates[id];
        persist();
        renderSidebar();
        toast('התבנית נמחקה', 'error');
    }
}

function createReportFromTemplate(tplId) {
    const tpl = S.templates[tplId];
    if (!tpl) return;
    const name = prompt(`שם הדוח שייווצר מתבנית "${tpl.name}":`, tpl.name + ' – ' + fmtDate(today()));
    if (!name) return;

    const id = uid();
    const t  = today();
    S.reports[id] = {
        id,
        title:        name,
        customer:     '',
        site:         '',
        visitDate:    t,
        number:       '',
        permComments: tpl.permComments || '',
        tasks: tpl.tasks.map(tk => tk.type === 'section'
            ? { id: 'sec_' + (++S.taskCounter), type: 'section', title: tk.title }
            : { id: 'tk_'  + (++S.taskCounter), type: 'task', description: tk.description, status: 'pending', comments: '' }
        ),
        appendices: (tpl.appendices || []).map(app => ({
            id:       app.id,
            title:    app.title,
            fileName: app.fileName,
            fileSize: app.fileSize,
            fileType: app.fileType,
            fileData: app.fileData,
        })),
        images: [],
        tech: { name: '', compDate: t, sig: '' },
        folder:    null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    persist();
    openReport(id);
    renderSidebar();
    toast(`דוח נוצר מתבנית "${tpl.name}"`, 'success');
}

// "Save as template" from current report
function showSaveAsTemplate() {
    if (!S.currentId) return;
    const r = S.reports[S.currentId];
    document.getElementById('saveTplName').value = r.title || '';
    showModal('saveTplModal');
    setTimeout(() => document.getElementById('saveTplName').focus(), 80);
}

function confirmSaveAsTemplate() {
    const name = document.getElementById('saveTplName').value.trim();
    if (!name) { toast('אנא הכנס שם', 'error'); return; }

    // collect current tasks
    saveReport();
    const r = S.reports[S.currentId];
    const id = uid();
    S.templates[id] = {
        id,
        name,
        permComments: r.permComments || '',
        tasks: (r.tasks || []).map(t => ({ description: t.description, comments: '' })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    persist();
    renderSidebar();
    hideModal('saveTplModal');
    toast(`תבנית "${name}" נשמרה ✓`, 'success');
}

/* ================================================================
   FOLDERS
================================================================ */
function createFolder() {
    const name = document.getElementById('newFolderName').value.trim();
    if (!name) { toast('אנא הכנס שם', 'error'); return; }
    if (S.folders[name]) { toast('תיקייה עם שם זה קיימת', 'error'); return; }
    S.folders[name] = [];
    persist();
    renderSidebar();
    hideModal('createFolderModal');
    document.getElementById('newFolderName').value = '';
    toast(`תיקייה "${name}" נוצרה`, 'success');
}

function showMoveFolderModal() {
    if (!S.currentId) return;
    const names = Object.keys(S.folders);
    if (!names.length) { toast('אין תיקיות. צור תיקייה קודם.', 'error'); return; }

    let cur = null;
    for (const fn in S.folders) {
        if (S.folders[fn].includes(S.currentId)) { cur = fn; break; }
    }

    const list = document.getElementById('folderOptList');
    list.innerHTML = names.map(name => `
        <div class="folder-opt ${name === cur ? 'selected' : ''}" onclick="moveToFolder('${esc(name)}')">
            📁 ${esc(name)}
        </div>`).join('');
    showModal('moveFolderModal');
}

function moveToFolder(name) {
    if (!S.currentId) return;
    for (const fn in S.folders) {
        S.folders[fn] = S.folders[fn].filter(x => x !== S.currentId);
    }
    if (!S.folders[name]) S.folders[name] = [];
    S.folders[name].push(S.currentId);
    if (S.reports[S.currentId]) S.reports[S.currentId].folder = name;
    persist();
    renderSidebar();
    hideModal('moveFolderModal');
    toast(`הדוח הועבר לתיקייה "${name}"`, 'success');
}

function renameFolderPrompt(name) {
    S.pendingRenameFolder = name;
    document.getElementById('renameFolderInput').value = name;
    showModal('renameFolderModal');
    setTimeout(() => document.getElementById('renameFolderInput').focus(), 80);
}

function confirmRenameFolder() {
    const old = S.pendingRenameFolder;
    const nw  = document.getElementById('renameFolderInput').value.trim();
    if (!nw || nw === old) { hideModal('renameFolderModal'); return; }
    if (S.folders[nw]) { toast('שם קיים', 'error'); return; }
    S.folders[nw] = S.folders[old] || [];
    delete S.folders[old];
    S.folders[nw].forEach(id => { if (S.reports[id]) S.reports[id].folder = nw; });
    persist();
    renderSidebar();
    hideModal('renameFolderModal');
    toast(`תיקייה שונתה ל"${nw}"`, 'success');
}

function deleteFolderPrompt(name) {
    S.pendingDeleteFolder = name;
    document.getElementById('deleteFolderMsg').textContent =
        `למחוק את התיקייה "${name}"? הדוחות שבתוכה לא יימחקו.`;
    showModal('deleteFolderModal');
}

function confirmDeleteFolder() {
    const name = S.pendingDeleteFolder;
    if (!name) return;
    (S.folders[name] || []).forEach(id => { if (S.reports[id]) S.reports[id].folder = null; });
    delete S.folders[name];
    persist();
    renderSidebar();
    hideModal('deleteFolderModal');
    toast(`תיקייה "${name}" נמחקה`, 'error');
}

/* ================================================================
   IMPORT – JSON / EXCEL / WORD
================================================================ */
function importFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const ext = file.name.split('.').pop().toLowerCase();
    const name = file.name.replace(/\.[^.]+$/, '');

    if (ext === 'json') {
        const fr = new FileReader();
        fr.onload = ev => importJSON(ev.target.result, name);
        fr.readAsText(file);
    } else if (['xlsx','xls'].includes(ext)) {
        const fr = new FileReader();
        fr.onload = ev => importExcel(ev.target.result, name);
        fr.readAsArrayBuffer(file);
    } else if (['docx','doc'].includes(ext)) {
        const fr = new FileReader();
        fr.onload = ev => importWord(ev.target.result, name);
        fr.readAsArrayBuffer(file);
    } else {
        toast('סוג קובץ לא נתמך', 'error');
    }
}

function importJSON(text, filename) {
    try {
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : [data];
        let count = 0, lastId = null;
        list.forEach(r => {
            if (r && (r.title || r.tasks)) {
                const id = uid();
                r.id = id; r.tasks = r.tasks || []; r.images = r.images || [];
                r.tech = r.tech || {}; r.folder = null;
                r.updatedAt = new Date().toISOString();
                if (!r.createdAt) r.createdAt = r.updatedAt;
                S.reports[id] = r;
                lastId = id;
                count++;
            }
        });
        if (!count) { toast('קובץ JSON לא תקין', 'error'); return; }
        persist();
        if (lastId) openReport(lastId);
        renderSidebar();
        toast(`יובאו ${count} דוחות ✓`, 'success');
    } catch { toast('שגיאה בקריאת JSON', 'error'); }
}

function importExcel(buffer, filename) {
    try {
        const wb = XLSX.read(buffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // detect header row: if first cell looks like header text, skip it
        let startRow = 0;
        if (rows.length && typeof rows[0][0] === 'string') {
            const first = (rows[0][0] || '').toString().trim().toLowerCase();
            if (['משימה','task','תיאור','description','שם','name','פעולה'].some(h => first.includes(h))) {
                startRow = 1;
            }
        }

        const tasks = [];
        for (let i = startRow; i < rows.length; i++) {
            const row = rows[i];
            const desc = (row[0] || '').toString().trim();
            const comm = (row[1] || '').toString().trim();
            if (desc) tasks.push({ description: desc, comments: comm });
        }

        if (!tasks.length) { toast('לא נמצאו משימות בקובץ', 'error'); return; }
        showImportPreview(filename, tasks, 'Excel');
    } catch (err) { toast('שגיאה בקריאת Excel: ' + err.message, 'error'); }
}

function importWord(buffer, filename) {
    mammoth.extractRawText({ arrayBuffer: buffer }).then(result => {
        const lines = result.value.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 1 && l.length < 300);

        if (!lines.length) { toast('לא נמצא תוכן בקובץ', 'error'); return; }

        const tasks = lines.map(l => ({ description: l, comments: '' }));
        showImportPreview(filename, tasks, 'Word');
    }).catch(err => toast('שגיאה בקריאת Word: ' + err.message, 'error'));
}

function showImportPreview(name, tasks, type) {
    S.importParsed = { name, tasks };
    document.getElementById('importPreviewInfo').textContent =
        `יובאו ${tasks.length} משימות מקובץ ${type}`;
    document.getElementById('importPreviewName').value = name;
    document.getElementById('importPreviewList').innerHTML = tasks.map((t, i) =>
        `<div class="preview-item">
            <span class="preview-item-num">${i+1}</span>
            <span>${esc(t.description)}</span>
            ${t.comments ? `<span style="color:var(--slate-400);font-size:11px;margin-right:auto;">${esc(t.comments)}</span>` : ''}
        </div>`
    ).join('');
    document.querySelector('input[name="importAs"][value="report"]').checked = true;
    showModal('importPreviewModal');
}

function confirmImport() {
    if (!S.importParsed) return;
    const name = document.getElementById('importPreviewName').value.trim() || S.importParsed.name;
    const asWhat = document.querySelector('input[name="importAs"]:checked').value;
    const tasks  = S.importParsed.tasks;

    if (asWhat === 'template') {
        const id = uid();
        S.templates[id] = {
            id, name,
            permComments: '',
            tasks: tasks.map(t => ({ description: t.description, comments: t.comments || '' })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        persist();
        renderSidebar();
        hideModal('importPreviewModal');
        toast(`תבנית "${name}" נשמרה ✓`, 'success');
    } else {
        const id  = uid();
        const t   = today();
        S.reports[id] = {
            id, title: name, customer: '', site: '',
            visitDate: t, number: '', permComments: '',
            tasks: tasks.map(tk => ({
                id: 'tk_' + (++S.taskCounter),
                description: tk.description,
                status: 'pending',
                comments: tk.comments || '',
            })),
            images: [], tech: { name: '', compDate: t, sig: '' },
            folder: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        persist();
        openReport(id);
        renderSidebar();
        hideModal('importPreviewModal');
        toast(`דוח "${name}" יובא ✓`, 'success');
    }
    S.importParsed = null;
}

/* ================================================================
   EXPORT JSON
================================================================ */
function exportJSON() {
    if (!S.currentId) return;
    saveReport();
    const r    = S.reports[S.currentId];
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `${r.title||'דוח'}.json` });
    a.click();
    URL.revokeObjectURL(url);
    toast('יוצא ✓', 'success');
}

/* ================================================================
   PDF
================================================================ */
async function downloadPDF(returnBlob = false) {
    if (!S.currentId) return null;
    saveReport();
    const r = S.reports[S.currentId];
    document.getElementById('loadingOverlay').classList.remove('hidden');
    try {
        const el = await buildPrintEl(r);
        document.body.appendChild(el);
        await new Promise(res => setTimeout(res, 600));
        const fullH = el.scrollHeight;
        const cnv = await html2canvas(el, {
            scale: 2, useCORS: true, allowTaint: true,
            backgroundColor: '#ffffff', logging: false,
            width: 794, height: fullH,
            windowWidth: 794, windowHeight: fullH,
            scrollX: 0, scrollY: 0,
            x: 0, y: 0,
        });
        document.body.removeChild(el);

        const { jsPDF } = window.jspdf;
        // Use a single custom-height page so nothing gets cut off
        const pw = 210; // A4 width in mm
        const iw = pw;
        const ih = (cnv.height * pw) / cnv.width; // proportional height
        const img = cnv.toDataURL('image/jpeg', 0.95);

        const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [pw, ih] });
        pdf.addImage(img, 'JPEG', 0, 0, iw, ih);

        document.getElementById('loadingOverlay').classList.add('hidden');

        if (returnBlob) return pdf.output('blob');

        pdf.save(`${r.title||'דוח'}_${r.customer||''}.pdf`);
        toast('PDF הורד ✓', 'success');
        return null;
    } catch (err) {
        document.getElementById('loadingOverlay').classList.add('hidden');
        toast('שגיאה ביצירת PDF', 'error');
        console.error(err);
        return null;
    }
}

async function getPdfLogoHtml() {
    if (LOGO_DATA_URL) {
        return `<img src="${LOGO_DATA_URL}" style="height:36px;width:auto;object-fit:contain;">`;
    }
    // If preload failed, try one more time synchronously via canvas
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            try {
                LOGO_DATA_URL = c.toDataURL('image/png');
                resolve(`<img src="${LOGO_DATA_URL}" style="height:36px;width:auto;object-fit:contain;">`);
            } catch {
                resolve(fallbackLogoSvg());
            }
        };
        img.onerror = () => resolve(fallbackLogoSvg());
        img.src = '299f86e2-665c-452a-a625-9d0556cb6647.png?' + Date.now();
    });
}

function fallbackLogoSvg() {
    return `<svg viewBox="0 0 230 46" xmlns="http://www.w3.org/2000/svg" style="height:32px;width:auto;">
        <defs><clipPath id="lh"><rect x="-24" y="-24" width="20" height="48"/></clipPath></defs>
        <g transform="translate(23,23)">
            <circle cx="0" cy="0" r="22" fill="#7dcbe8"/>
            <circle cx="0" cy="0" r="17" fill="white"/>
            <circle cx="0" cy="0" r="17" fill="#a3a3a3"/>
            <circle cx="0" cy="0" r="12" fill="white"/>
            <circle cx="0" cy="0" r="12" fill="#1a1a1a" clip-path="url(#lh)"/>
            <circle cx="0" cy="0" r="7.5" fill="white"/>
        </g>
        <text x="50" y="31" font-family="Arial Black,Arial,sans-serif" font-size="23" font-weight="900" fill="#1a1a1a" letter-spacing="0.5">FICIENCY</text>
    </svg>`;
}

async function buildPrintEl(r) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;background:white;padding:38px 44px;font-family:Arial,sans-serif;direction:rtl;color:#1e293b;box-sizing:border-box;font-size:13px;';

    const tasks = r.tasks || [];
    const realTasks = tasks.filter(t => t.type !== 'section');
    const perf  = realTasks.filter(t => t.status==='performed').length;
    const notP  = realTasks.filter(t => t.status==='not_performed').length;
    const pend  = realTasks.filter(t => t.status==='pending').length;

    let taskNum = 0;
    const tasksHtml = tasks.length ? tasks.map(t => {
        if (t.type === 'section') {
            return `<div style="display:flex;align-items:center;gap:10px;margin:14px 0 8px;">
                <div style="flex:1;height:2px;background:linear-gradient(to right,#e2e8f0,transparent);border-radius:2px;"></div>
                <span style="background:#fffbeb;border:2px solid #fde68a;border-radius:20px;padding:3px 14px;font-size:11px;font-weight:800;color:#92400e;white-space:nowrap;">${esc(t.title||'אזור')}</span>
                <div style="flex:1;height:2px;background:linear-gradient(to left,#e2e8f0,transparent);border-radius:2px;"></div>
            </div>`;
        }
        const n  = ++taskNum;
        const sc = t.status==='performed'?'#22c55e':t.status==='not_performed'?'#ef4444':'#94a3b8';
        const sb = t.status==='performed'?'#f0fdf4':t.status==='not_performed'?'#fff5f5':'#f8fafc';
        const st = t.status==='performed'?'✓ בוצע':t.status==='not_performed'?'✗ לא בוצע':'⏳ ממתין';
        return `<div style="background:${sb};border:1.5px solid ${sc}44;border-radius:7px;padding:10px 12px;margin-bottom:7px;">
            <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:${t.comments?'7px':'0'};">
                <span style="background:#e2e8f0;color:#475569;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:800;white-space:nowrap;">${n}</span>
                <span style="flex:1;line-height:1.5;">${esc(t.description||'ללא תיאור')}</span>
                <span style="background:${sc};color:white;border-radius:5px;padding:2px 9px;font-size:10px;font-weight:800;white-space:nowrap;">${st}</span>
            </div>
            ${t.comments?`<div style="margin-right:26px;padding:5px 8px;background:white;border-radius:5px;border:1px solid #e2e8f0;font-size:11px;color:#475569;line-height:1.5;">${esc(t.comments)}</div>`:''}
        </div>`;
    }).join('') : '<p style="color:#94a3b8;font-size:12px;">אין משימות</p>';

    const imagesHtml = r.images?.length ? `
        <div style="margin-top:20px;padding-top:16px;border-top:2px solid #e2e8f0;">
            <h3 style="font-size:13px;font-weight:800;margin-bottom:11px;">🖼️ תמונות מהשטח</h3>
            <div style="display:flex;flex-wrap:wrap;gap:10px;">
                ${r.images.map(src=>`<img src="${src}" style="width:185px;height:138px;object-fit:cover;border-radius:7px;border:1px solid #e2e8f0;">`).join('')}
            </div>
        </div>` : '';

    const sigHtml = r.tech?.sig
        ? `<img src="${r.tech.sig}" style="max-width:200px;height:68px;object-fit:contain;border:1px solid #e2e8f0;border-radius:5px;background:white;">`
        : `<div style="width:200px;height:68px;border:1.5px dashed #cbd5e1;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;">לא חתום</div>`;

    // Appendix HTML for PDF
    const appendixHtml = (r.appendices || []).filter(a => a.fileData).length ? `
        <div style="margin-top:20px;border-top:2px solid #fde68a;padding-top:16px;">
            <h3 style="font-size:13px;font-weight:800;color:#92400e;margin-bottom:10px;">📎 נספחים משלימים</h3>
            ${(r.appendices||[]).filter(a=>a.fileData).map(app => `
                <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;">
                    <span style="font-size:20px;">${(app.fileType||'').includes('pdf')?'📄':(app.fileType||'').includes('image')?'🖼️':(app.fileType||'').includes('word')||((app.fileType||'').includes('document'))?'📝':(app.fileType||'').includes('sheet')||((app.fileType||'').includes('excel'))?'📊':'📎'}</span>
                    <span style="flex:1;font-size:13px;font-weight:700;color:#92400e;">${esc(app.fileName||app.title||'נספח')}</span>
                    <span style="font-size:11px;color:#a3a3a3;">${esc(app.fileSize||'')}</span>
                </div>
            `).join('')}
        </div>
    ` : '';

    // Try to get logo as data URL for PDF
    const pdfLogoHtml = await getPdfLogoHtml();

    el.innerHTML = `
        <!-- Company logo bar -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid #e2e8f0;">
            ${pdfLogoHtml}
            <div style="text-align:left;">
                <div style="font-size:9px;color:#94a3b8;">תאריך הפקה</div>
                <div style="font-size:11px;font-weight:700;color:#374151;">${new Date().toLocaleDateString('he-IL')}</div>
            </div>
        </div>
        <!-- Report title block -->
        <div style="margin-bottom:18px;padding-bottom:12px;border-bottom:3px solid #2563eb;">
            <h1 style="font-size:20px;font-weight:800;color:#1e293b;margin:0 0 4px;">${esc(r.title||'דוח שירות')}</h1>
            ${r.number?`<span style="font-size:11px;color:#64748b;">מספר דוח: ${esc(r.number)}</span>`:''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
            ${r.customer?`<div style="background:#f8fafc;padding:9px 11px;border-radius:7px;border:1px solid #e2e8f0;"><div style="font-size:9px;color:#94a3b8;margin-bottom:2px;">לקוח</div><div style="font-size:12px;font-weight:700;">${esc(r.customer)}</div></div>`:''}
            ${r.site?`<div style="background:#f8fafc;padding:9px 11px;border-radius:7px;border:1px solid #e2e8f0;"><div style="font-size:9px;color:#94a3b8;margin-bottom:2px;">אתר</div><div style="font-size:12px;font-weight:700;">${esc(r.site)}</div></div>`:''}
            ${r.visitDate?`<div style="background:#f8fafc;padding:9px 11px;border-radius:7px;border:1px solid #e2e8f0;"><div style="font-size:9px;color:#94a3b8;margin-bottom:2px;">תאריך ביקור</div><div style="font-size:12px;font-weight:700;">${fmtDate(r.visitDate)}</div></div>`:''}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px;">
            <div style="flex:1;background:#f0fdf4;padding:9px;border-radius:7px;border:1px solid #86efac;text-align:center;"><div style="font-size:20px;font-weight:800;color:#22c55e;">${perf}</div><div style="font-size:10px;color:#16a34a;">בוצע</div></div>
            <div style="flex:1;background:#fff5f5;padding:9px;border-radius:7px;border:1px solid #fca5a5;text-align:center;"><div style="font-size:20px;font-weight:800;color:#ef4444;">${notP}</div><div style="font-size:10px;color:#dc2626;">לא בוצע</div></div>
            <div style="flex:1;background:#f8fafc;padding:9px;border-radius:7px;border:1px solid #e2e8f0;text-align:center;"><div style="font-size:20px;font-weight:800;color:#94a3b8;">${pend}</div><div style="font-size:10px;color:#64748b;">ממתין</div></div>
            <div style="flex:1;background:#eff6ff;padding:9px;border-radius:7px;border:1px solid #93c5fd;text-align:center;"><div style="font-size:20px;font-weight:800;color:#2563eb;">${realTasks.length}</div><div style="font-size:10px;color:#1d4ed8;">סה"כ</div></div>
        </div>
        ${r.permComments?`<div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:7px;padding:10px 13px;margin-bottom:16px;"><div style="font-size:10px;font-weight:800;color:#92400e;margin-bottom:5px;">📌 הערות קבועות</div><div style="font-size:12px;color:#78350f;white-space:pre-wrap;line-height:1.6;">${esc(r.permComments)}</div></div>`:''}
        <h3 style="font-size:13px;font-weight:800;margin-bottom:10px;padding-bottom:7px;border-bottom:2px solid #f1f5f9;">✅ רשימת משימות</h3>
        ${tasksHtml}
        ${imagesHtml}
        ${appendixHtml}
        <div style="margin-top:20px;padding-top:16px;border-top:2px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-end;">
            <div>
                <h3 style="font-size:12px;font-weight:800;margin-bottom:9px;">👷 פרטי הטכנאי</h3>
                <div style="font-size:11px;color:#475569;margin-bottom:3px;">שם: <strong style="color:#1e293b;">${esc(r.tech?.name||'לא צוין')}</strong></div>
                <div style="font-size:11px;color:#475569;">תאריך סיום: <strong style="color:#1e293b;">${fmtDate(r.tech?.compDate||'')}</strong></div>
            </div>
            <div style="text-align:center;">
                <div style="font-size:10px;color:#94a3b8;margin-bottom:5px;">חתימה</div>
                ${sigHtml}
            </div>
        </div>
        <div style="margin-top:18px;text-align:center;font-size:10px;color:#cbd5e1;padding-top:10px;border-top:1px solid #f1f5f9;">
            דוח זה הופק באמצעות מערכת דוחות טכנאי שטח
        </div>`;
    return el;
}

/* ================================================================
   SHARE
================================================================ */
function showShareModal() {
    if (!S.currentId) return;
    showModal('shareModal');
}

async function shareTo(platform) {
    if (!S.currentId) return;
    hideModal('shareModal');
    const r = S.reports[S.currentId];

    if (platform === 'copy') {
        // Copy text summary to clipboard (no PDF needed)
        const tasks = r.tasks || [];
        const perf  = tasks.filter(t => t.status==='performed').length;
        const notP  = tasks.filter(t => t.status==='not_performed').length;
        const lines = [
            `📋 דוח שירות: ${r.title||''}`,
            r.customer ? `👤 לקוח: ${r.customer}` : '',
            r.site     ? `📍 אתר: ${r.site}` : '',
            r.visitDate? `📅 תאריך: ${fmtDate(r.visitDate)}` : '',
            '',
            `✅ בוצע: ${perf}  ✗ לא בוצע: ${notP}  סה"כ: ${tasks.length}`,
            '',
            ...tasks.map((t,i) => {
                const st = t.status==='performed'?'✓':t.status==='not_performed'?'✗':'⏳';
                return `${i+1}. ${st} ${t.description}${t.comments?' — '+t.comments:''}`;
            }),
            '',
            r.tech?.name ? `👷 טכנאי: ${r.tech.name}` : '',
        ].filter(l => l !== null && l !== undefined).join('\n');

        try {
            await navigator.clipboard.writeText(lines);
            toast('הסיכום הועתק ✓', 'success');
        } catch {
            toast('העתקה נכשלה', 'error');
        }
        return;
    }

    if (platform === 'native') {
        // Web Share API
        const blob = await downloadPDF(true);
        if (!blob) return;
        const file = new File([blob], `${r.title||'דוח'}.pdf`, { type: 'application/pdf' });
        try {
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: r.title || 'דוח שירות' });
            } else if (navigator.share) {
                await navigator.share({ title: r.title || 'דוח שירות', text: `דוח שירות – ${r.title}` });
            }
        } catch (err) { if (err.name !== 'AbortError') toast('שיתוף נכשל', 'error'); }
        return;
    }

    // For platforms that can't receive files: download PDF first, then open platform
    await downloadPDF(false);
    const title = encodeURIComponent(`דוח שירות – ${r.title||''} – ${r.customer||''}`);
    const msg   = encodeURIComponent(`שלום,\nמצורף דוח שירות: ${r.title||''}\nלקוח: ${r.customer||''}\nתאריך: ${fmtDate(r.visitDate)}`);

    if (platform === 'whatsapp') {
        window.open(`https://wa.me/?text=${msg}`, '_blank');
        toast('WhatsApp נפתח — צרף את ה-PDF שהורד', 'success');
    } else if (platform === 'gmail') {
        window.open(`mailto:?subject=${title}&body=${msg}`, '_blank');
    } else if (platform === 'telegram') {
        window.open(`https://t.me/share/url?url=&text=${msg}`, '_blank');
        toast('Telegram נפתח — צרף את ה-PDF שהורד', 'success');
    }
}

/* ================================================================
   SIDEBAR
================================================================ */
function renderSidebar() {
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
                <span class="folder-name">${esc(name)}</span>
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
        lbl.textContent = 'לא מסווג';
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
            d.onclick = () => openReport(id);
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
        lbl.className = 'sb-label';
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
            d.onclick = () => createReportFromTemplate(id);
            c.appendChild(d);
        });
    }

    // Empty state
    if (!Object.keys(S.folders).length && !unfiled.length && !tplIds.length) {
        c.innerHTML = '<div style="padding:18px 10px;font-size:12px;color:#3d506b;text-align:center;line-height:1.7;">עדיין אין דוחות.<br>לחץ <strong style="color:#60a5fa;">"+ דוח חדש"</strong> להתחלה.</div>';
    }
}

function toggleFolder(hdr) { hdr.parentElement.classList.toggle('open'); }

function deleteReportById(id) {
    for (const fn in S.folders) {
        S.folders[fn] = S.folders[fn].filter(x => x !== id);
    }
    delete S.reports[id];
    if (S.currentId === id) {
        S.currentId = null; S.unsaved = false;
        document.getElementById('emptyState').style.display   = 'flex';
        document.getElementById('reportEditor').style.display = 'none';
        updateToolbar();
    }
    persist();
    renderSidebar();
    toast('הדוח נמחק', 'error');
}

/* ================================================================
   TOOLBAR
================================================================ */
function updateToolbar() {
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
        <button class="tbtn tbtn-save"     onclick="saveReport()">💾 שמור</button>
        <button class="tbtn tbtn-pdf"      onclick="downloadPDF()">📄 PDF</button>
        <button class="tbtn tbtn-share"    onclick="showShareModal()">📤 שתף</button>
        <button class="tbtn tbtn-template" onclick="showSaveAsTemplate()" title="שמור כתבנית">📋 שמור כתבנית</button>
        <button class="tbtn tbtn-folder"   onclick="showMoveFolderModal()">📁 תיקייה</button>
        <button class="tbtn tbtn-export"   onclick="exportJSON()" title="ייצא JSON">⬇ JSON</button>
        <button class="tbtn tbtn-clear"    onclick="clearReport()">🗑️ נקה</button>
        <button class="tbtn tbtn-delete"   onclick="deleteReportPrompt()">✕ מחק</button>
    `;
}

/* ================================================================
   MODALS & TOASTS
================================================================ */
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

document.querySelectorAll('.overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.add('hidden'); });
});

document.getElementById('newFolderName').addEventListener('keydown', e => { if (e.key==='Enter') createFolder(); });
document.getElementById('newReportName').addEventListener('keydown', e => { if (e.key==='Enter') confirmNewReport(); });

function toast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' '+type : '');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ================================================================
   KEYBOARD
================================================================ */
document.addEventListener('keydown', e => {
    if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); saveReport(); }
    if (e.key==='Escape') {
        document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.classList.add('hidden'));
        document.getElementById('lightbox').classList.add('hidden');
    }
});

/* ================================================================
   MOBILE SIDEBAR
================================================================ */
function toggleMobileSidebar() {
    const sb  = document.querySelector('.sidebar');
    const ov  = document.getElementById('mobileSidebarOverlay');
    const open = sb.classList.toggle('mobile-open');
    ov.classList.toggle('active', open);
}
function closeMobileSidebar() {
    document.querySelector('.sidebar').classList.remove('mobile-open');
    document.getElementById('mobileSidebarOverlay').classList.remove('active');
}

/* ================================================================
   IOS KEYBOARD / VIEWPORT FIX
   When the software keyboard dismisses on iOS Safari the window can
   remain scrolled to a non-zero position, pushing the toolbar off-
   screen. We detect this via visualViewport resize events and via
   focusout, then snap back to 0,0.
================================================================ */
(function iosKeyboardFix() {
    function snapBack() {
        // Tiny delay lets iOS finish its internal scroll animation first
        setTimeout(function() {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        }, 80);
    }

    // Fires when the visual viewport resizes (keyboard open/close)
    if (window.visualViewport) {
        var lastH = window.visualViewport.height;
        window.visualViewport.addEventListener('resize', function() {
            var newH = window.visualViewport.height;
            // Keyboard just closed (height grew back)
            if (newH > lastH) { snapBack(); }
            lastH = newH;
        });
    }

    // Fallback: also snap on every input/textarea blur
    document.addEventListener('focusout', function(e) {
        var tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            snapBack();
        }
    }, true);
})();

/* ================================================================
   BOOT
================================================================ */
init();

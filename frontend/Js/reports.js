import { S, persist, uid, today, esc, fmtDate, apiSaveReport, apiUploadDocument, apiDeleteReport, fetchStorageDataUrl } from './api.js';
import {
    showModal, hideModal, toast,
    setReportMode, renderTasks, renderImages, renderReportAppendices,
    renderTplTasks, renderTplAppendices, collectTplAppendices,
    updateToolbar, renderSidebar, showDashboard, showFolderContent,
    closeMobileSidebar, markUnsaved, confirmUnsaved,
    collectTasks, collectReportAppendices,
} from './ui.js';

/* ================================================================
   LOGO (no longer needed for PDF — kept as no-op for compatibility)
================================================================ */
export function preloadLogo() {
    return Promise.resolve();
}

/* ================================================================
   AUTH HELPERS
================================================================ */
function _techName() {
    const u = S.currentUser;
    if (!u) return '';
    return u.displayName || u.email?.split('@')[0] || '';
}

/* ================================================================
   NEW REPORT MODAL
================================================================ */
export function showNewReportModal() {
    document.getElementById('newReportName').value = '';
    const list = document.getElementById('newReportTplList');

    // When inside a folder, show only that folder's templates
    const allTpls = Object.values(S.templates);
    const tpls = S.currentFolder
        ? allTpls.filter(t => t.folder === S.currentFolder)
        : allTpls;

    if (!tpls.length) {
        const msg = S.currentFolder ? 'אין תבניות זמינות לאתר זה' : 'אין תבניות שמורות';
        list.innerHTML = `<div style="font-size:12px;color:#5d7a94;padding:10px 0;text-align:center;">${msg}</div>`;
    } else {
        list.innerHTML = tpls.map(t => {
            return `<div class="tpl-opt" data-tpl="${t.id}" onclick="selectNewReportTpl(this,'${t.id}')">
                        <span>${esc(t.name)}</span>
                        <span style="font-size:11px;color:var(--slate-400);margin-right:auto;">${(t.tasks||[]).length} משימות</span>
                    </div>`;
        }).join('');
    }
    showModal('newReportModal');
    setTimeout(() => document.getElementById('newReportName').focus(), 80);
}

export function selectNewReportTpl(el, id) {
    document.querySelectorAll('#newReportTplList .tpl-opt').forEach(e => e.classList.remove('selected'));
    if (el.dataset.chosen === '1') {
        el.dataset.chosen = '';
    } else {
        el.classList.add('selected');
        el.dataset.chosen = '1';
    }
}

export async function confirmNewReport() {
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
        serviceType: tpl ? (tpl.serviceType || '') : '',
        permComments:  tpl ? (tpl.permComments || '') : '',
        finalComments: '',
        tasks: tpl ? tpl.tasks.map(tk => ({
            id: 'tk_' + (++S.taskCounter),
            description: tk.description,
            status:   'pending',
            comments: tk.comments || '',
        })) : [],
        images: [],
        tech: { name: _techName(), compDate: t, sig: '' },
        customerSig: '',
        folder:    S.currentFolder || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    if (S.currentFolder) {
        if (!S.folders[S.currentFolder]) S.folders[S.currentFolder] = [];
        S.folders[S.currentFolder].push(id);
    }

    persist();   // saves taskCounter
    hideModal('newReportModal');
    openReport(id);
    renderSidebar();
    toast('דוח חדש נוצר' + (tpl ? ` מתבנית "${tpl.name}"` : ''), 'success');

    try {
        const saved = await apiSaveReport(S.reports[id]);
        S.reports[id]._backendId = saved.id;
    } catch (e) {
        toast('הדוח נוצר אך לא נשמר בשרת – נסה לשמור שוב', 'error');
    }
}

/* ================================================================
   REPORTS – CRUD
================================================================ */
export function openReport(id) {
    if (!confirmUnsaved()) return;
    closeMobileSidebar();
    // On desktop, ensure the reports tab is active so the report editor is visible
    if (window.innerWidth > 768 && window.switchTab) window.switchTab('reports');
    S.currentId   = id;
    S.currentMode = 'report';
    S.unsaved     = false;
    const r = S.reports[id];
    if (!r) {
        // Report not in memory — server may need restart after migration
        setReportMode('report');
        updateToolbar();
        renderSidebar();
        toast('הדוח לא נטען – אנא הפעל מחדש את השרת ורענן', 'error');
        return;
    }

    setReportMode('report');

    document.getElementById('fTitle').value        = r.title        || '';
    document.getElementById('fCustomer').value     = r.customer     || '';
    document.getElementById('fSite').value         = r.site         || '';
    document.getElementById('fVisitDate').value    = r.visitDate    || '';
    document.getElementById('fNumber').value       = r.number       || '';
    document.getElementById('fPermComments').value  = r.permComments  || '';
    document.getElementById('fFinalComments').value = r.finalComments || '';
    const _stVal = r.serviceType || '';
    document.getElementById('fServiceType').value = _stVal;
    document.querySelectorAll('#serviceTypePicker .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === _stVal);
    });
    const techField = document.getElementById('fTechName');
    techField.value = r.tech?.name || _techName();
    document.getElementById('fCompDate').value     = r.tech?.compDate || '';

    renderTasks(r.tasks || []);
    renderImages(r.images || []);
    renderReportAppendices(r.appendices || []);

    if (S.pad) {
        S.pad.clear();
        _loadSigToPad(S.pad, r.tech?.sig);
    }
    if (S.customerPad) {
        S.customerPad.clear();
        _loadSigToPad(S.customerPad, r.customerSig);
    }

    updateToolbar();
    renderSidebar();
    document.getElementById('reportArea').scrollTop = 0;
}

export async function saveReport() {
    // Capture before any async gap — onSnapshot may clear S.currentId during uploads
    const savedId = S.currentId;
    if (!savedId || S.currentMode !== 'report') return;
    const r = S.reports[savedId];
    if (!r) { toast('הדוח לא נמצא בזיכרון – רענן את הדף', 'error'); return; }

    const overlay    = document.getElementById('loadingOverlay');
    const overlayMsg = document.getElementById('loadingMsg');
    if (overlayMsg) overlayMsg.textContent = 'שומר דוח...';
    overlay?.classList.remove('hidden');

    let saveOk = false;
    try {
        // DOM collection is inside try so any null-element error is caught cleanly
        r.title         = document.getElementById('fTitle')?.value.trim()        || r.title        || 'דוח ללא שם';
        r.customer      = document.getElementById('fCustomer')?.value             ?? r.customer;
        r.site          = document.getElementById('fSite')?.value                 ?? r.site;
        r.visitDate     = document.getElementById('fVisitDate')?.value            ?? r.visitDate;
        r.number        = document.getElementById('fNumber')?.value               ?? r.number;
        r.serviceType   = document.getElementById('fServiceType')?.value          || r.serviceType  || '';
        r.permComments  = document.getElementById('fPermComments')?.value         ?? r.permComments;
        r.finalComments = document.getElementById('fFinalComments')?.value        ?? r.finalComments;
        r.tasks         = collectTasks();
        r.appendices    = collectReportAppendices();
        r.tech = {
            name:     document.getElementById('fTechName')?.value  ?? r.tech?.name     ?? '',
            compDate: document.getElementById('fCompDate')?.value  ?? r.tech?.compDate ?? '',
            sig:      S.pad && !S.pad.isEmpty() ? S.pad.toDataURL() : (r.tech?.sig || ''),
        };
        r.customerSig = S.customerPad && !S.customerPad.isEmpty()
            ? S.customerPad.toDataURL()
            : (r.customerSig || '');
        r.updatedAt = new Date().toISOString();

        const saved = await apiSaveReport(r);
        r._backendId = saved.id;
        saveOk = true;
    } catch (e) {
        console.error('[SAVE] failed:', e);
        toast('שגיאה בשמירה לשרת – בדוק שהשרת פועל', 'error');
    } finally {
        overlay?.classList.add('hidden');
        // Always restore UI state — even on error or onSnapshot-driven S.currentId clear
        S.currentId   = savedId;
        S.currentMode = 'report';
        S.unsaved     = !saveOk;
        updateToolbar();
    }

    if (saveOk) {
        renderSidebar();
        toast('הדוח נשמר ✓', 'success');
    }
}

export function clearReport() {
    if (!S.currentId) return;
    if (!confirm('לאפס את סטטוסי המשימות וההערות?\n(המשימות עצמן נשמרות)')) return;

    // Reset every task's status and comments in the DOM
    document.querySelectorAll('#tasksList .task-item').forEach(item => {
        item.dataset.status = 'pending';
        item.classList.remove('performed', 'not-performed');
        item.querySelectorAll('.sbtn').forEach(b => b.classList.remove('active'));
        const comment = item.querySelector('.task-comment');
        if (comment) comment.value = '';
    });

    // Clear the final comments field
    document.getElementById('fFinalComments').value = '';

    markUnsaved();
    toast('המשימות אופסו ✓', 'success');
}

export function deleteReportPrompt() {
    if (!S.currentId) return;
    showModal('deleteModal');
}

export function confirmDelete() {
    if (!S.currentId) return;
    const id = S.currentId;
    _markDeleted(id);
    for (const fn in S.folders) {
        S.folders[fn] = S.folders[fn].filter(x => x !== id);
    }
    delete S.reports[id];
    S.currentId = null;
    S.unsaved   = false;
    showDashboard();
    persist();
    hideModal('deleteModal');
    toast('הדוח נמחק', 'error');
    console.log('[DELETE] Sending delete request for ID:', id);
    apiDeleteReport(id).catch(e => console.error('[DELETE] server delete failed:', e));
}

export function deleteReportById(id) {
    _markDeleted(id);
    for (const fn in S.folders) {
        S.folders[fn] = S.folders[fn].filter(x => x !== id);
    }
    delete S.reports[id];
    persist();
    renderSidebar();
    toast('הדוח נמחק', 'error');
    console.log('[DELETE] Sending delete request for ID:', id);
    apiDeleteReport(id).catch(e => console.error('[DELETE] server delete failed:', e));
    if (S.currentId === id || !S.currentId) {
        S.currentFolder ? showFolderContent(S.currentFolder) : showDashboard();
    }
}

/* ================================================================
   TEMPLATES
================================================================ */
export function showTemplateEditor(id, folderName = null) {
    const tpl = id ? S.templates[id] : null;
    document.getElementById('tplEditorId').value          = id || '';
    document.getElementById('tplEditorFolder').value      = tpl ? (tpl.folder || '') : (folderName || '');
    document.getElementById('tplEditorTitle').textContent = tpl ? `עריכת תבנית` : `תבנית חדשה`;
    document.getElementById('tplName').value              = tpl ? (tpl.name || '') : '';
    document.getElementById('tplPermComments').value      = tpl ? (tpl.permComments || '') : '';
    const _tplStVal = tpl ? (tpl.serviceType || '') : '';
    document.getElementById('tplServiceType').value = _tplStVal;
    document.querySelectorAll('#tplServiceTypePicker .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === _tplStVal);
    });
    renderTplTasks(tpl ? tpl.tasks : []);
    renderTplAppendices(tpl ? (tpl.appendices || []) : []);
    showModal('tplEditorModal');
    setTimeout(() => document.getElementById('tplName').focus(), 80);
}

export function saveTplEditor() {
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
    const folderVal = document.getElementById('tplEditorFolder').value || null;

    S.templates[id] = {
        id,
        name,
        folder: folderVal,
        serviceType: document.getElementById('tplServiceType')?.value || null,
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

export function deleteTemplatePrompt(id) {
    if (confirm(`למחוק את התבנית "${S.templates[id]?.name}"?`)) {
        delete S.templates[id];
        persist();
        renderSidebar();
        toast('התבנית נמחקה', 'error');
        if (S.currentFolder) showFolderContent(S.currentFolder);
    }
}

export async function createReportFromTemplate(tplId, folderName = null) {
    const tpl = S.templates[tplId];
    if (!tpl) return;

    const id = uid();
    const t  = today();
    const targetFolder = folderName || null;
    S.reports[id] = {
        id,
        title:        tpl.name,
        customer:     '',
        site:         '',
        visitDate:    t,
        number:       '',
        serviceType:  tpl.serviceType || '',
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
        tech: { name: _techName(), compDate: t, sig: '' },
        folder:    targetFolder,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    if (targetFolder) {
        if (!S.folders[targetFolder]) S.folders[targetFolder] = [];
        S.folders[targetFolder].push(id);
    }
    persist();   // saves taskCounter
    openReport(id);
    renderSidebar();
    toast(`דוח נוצר מתבנית "${tpl.name}"`, 'success');

    try {
        const saved = await apiSaveReport(S.reports[id]);
        S.reports[id]._backendId = saved.id;
    } catch (e) {
        toast('הדוח נוצר אך לא נשמר בשרת – נסה לשמור שוב', 'error');
    }
}

export function showSaveAsTemplate() {
    if (!S.currentId) return;
    const r = S.reports[S.currentId];
    document.getElementById('saveTplName').value = r.title || '';
    showModal('saveTplModal');
    setTimeout(() => document.getElementById('saveTplName').focus(), 80);
}

export async function confirmSaveAsTemplate() {
    const name = document.getElementById('saveTplName').value.trim();
    if (!name) { toast('אנא הכנס שם', 'error'); return; }

    // collect current tasks
    await saveReport();
    if (!S.currentId) { toast('שגיאה בשמירת הדוח', 'error'); return; }
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
   HELPERS
================================================================ */
/** Record a frontend uid so hydrate() skips it on next load. */
function _markDeleted(frontendId) {
    const del = JSON.parse(localStorage.getItem('trs_deleted') || '[]');
    if (!del.includes(frontendId)) {
        del.push(frontendId);
        localStorage.setItem('trs_deleted', JSON.stringify(del));
    }
}

/* ================================================================
   FOLDERS
================================================================ */
export function createFolder() {
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

export function showMoveFolderModal() {
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
            ${esc(name)}
        </div>`).join('');
    showModal('moveFolderModal');
}

export function moveToFolder(name) {
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

export function renameFolderPrompt(name) {
    S.pendingRenameFolder = name;
    document.getElementById('renameFolderInput').value = name;
    showModal('renameFolderModal');
    setTimeout(() => document.getElementById('renameFolderInput').focus(), 80);
}

export function confirmRenameFolder() {
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

export function deleteFolderPrompt(name) {
    const hasReports   = (S.folders[name] || []).some(id => S.reports[id]);
    const hasTemplates = Object.values(S.templates).some(t => t.folder === name);
    const hasProcs     = ((S.procedures || {})[name] || []).length > 0;

    if (hasReports || hasTemplates || hasProcs) {
        toast('לא ניתן למחוק תיקייה שמכילה דוחות, תבניות או נהלים. יש לרוקן אותה תחילה.', 'error');
        return;
    }

    S.pendingDeleteFolder = name;
    document.getElementById('deleteFolderMsg').textContent =
        `האם אתה בטוח שברצונך למחוק את התיקייה "${name}"?`;
    showModal('deleteFolderModal');
}

export function confirmDeleteFolder() {
    const name = S.pendingDeleteFolder;
    if (!name) return;
    (S.folders[name] || []).forEach(id => { if (S.reports[id]) S.reports[id].folder = null; });
    delete S.folders[name];
    S.pendingDeleteFolder = null;
    persist();
    renderSidebar();
    showDashboard();
    hideModal('deleteFolderModal');
    toast(`תיקייה "${name}" נמחקה`, 'error');
}

/* ================================================================
   IMPORT – DOCUMENT UPLOAD (PDF / IMAGE)
================================================================ */

/** Step 1 – user picked a file; update modal UI and enable Upload button. */
export function onDocumentFilePicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('docFilePreview').textContent = file.name;
    document.getElementById('docUploadBtn').disabled = false;
}

/** Step 2 – user confirmed; upload file to the current folder. */
export async function confirmDocumentUpload() {
    const fileInput  = document.getElementById('documentInput');
    const file       = fileInput.files[0];
    if (!file) return;

    const folderName = S.currentFolder || '';

    hideModal('importAssociationModal');
    fileInput.value = '';

    toast('מעלה מסמך...', '');
    try {
        const attachment = await apiUploadDocument(file, folderName);
        const key = attachment.folder_id || '';
        if (!S.attachments[key]) S.attachments[key] = [];
        S.attachments[key].unshift(attachment);
        toast(`"${file.name}" הועלה בהצלחה ✓`, 'success');
        if (S.currentFolder) window.showFolderContent(S.currentFolder);
    } catch (err) {
        console.error('[UPLOAD] Failed:', err);
        toast('שגיאה בהעלאת המסמך', 'error');
    }
}

/* ================================================================
   IMPORT – JSON / EXCEL / WORD
================================================================ */
export function importFile(e) {
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

export async function importJSON(text, _filename) {
    try {
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : [data];
        const toSave = [];
        let lastId = null;
        list.forEach(r => {
            if (r && (r.title || r.tasks)) {
                const id = uid();
                r.id = id; r.tasks = r.tasks || []; r.images = r.images || [];
                r.tech = r.tech || {}; r.folder = null;
                r.updatedAt = new Date().toISOString();
                if (!r.createdAt) r.createdAt = r.updatedAt;
                S.reports[id] = r;
                toSave.push(r);
                lastId = id;
            }
        });
        if (!toSave.length) { toast('קובץ JSON לא תקין', 'error'); return; }
        persist();
        if (lastId) openReport(lastId);
        renderSidebar();
        toast(`יובאו ${toSave.length} דוחות ✓`, 'success');
        // save to backend in the background
        for (const r of toSave) {
            try { const saved = await apiSaveReport(r); r._backendId = saved.id; } catch {}
        }
    } catch { toast('שגיאה בקריאת JSON', 'error'); }
}

export function importExcel(buffer, filename) {
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

export function importWord(buffer, filename) {
    mammoth.extractRawText({ arrayBuffer: buffer }).then(result => {
        const lines = result.value.split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 1 && l.length < 300);

        if (!lines.length) { toast('לא נמצא תוכן בקובץ', 'error'); return; }

        const tasks = lines.map(l => ({ description: l, comments: '' }));
        showImportPreview(filename, tasks, 'Word');
    }).catch(err => toast('שגיאה בקריאת Word: ' + err.message, 'error'));
}

export function showImportPreview(name, tasks, type) {
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

export async function confirmImport() {
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
            images: [], tech: { name: _techName(), compDate: t, sig: '' },
            folder: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        persist();   // saves taskCounter
        openReport(id);
        renderSidebar();
        hideModal('importPreviewModal');
        toast(`דוח "${name}" יובא ✓`, 'success');
        try {
            const saved = await apiSaveReport(S.reports[id]);
            S.reports[id]._backendId = saved.id;
        } catch (e) {
            toast('הדוח יובא אך לא נשמר בשרת – נסה לשמור שוב', 'error');
        }
    }
    S.importParsed = null;
}

/* ================================================================
   EXPORT JSON
================================================================ */
export async function exportJSON() {
    if (!S.currentId) return;
    await saveReport();
    const r    = S.reports[S.currentId];
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `${r.title||'דוח'}.json` });
    a.click();
    URL.revokeObjectURL(url);
    toast('יוצא ✓', 'success');
}

/* ================================================================
   SIGNATURE LOADER
   After the Firebase migration, sigs in S.reports can be either:
     • a data: URL (just drawn, or freshly loaded from a Storage URL)
     • an https URL pointing to Firebase Storage (after hydrate / first save)
   SignaturePad.fromDataURL only accepts data: URLs, so we fetch + convert
   transparently. Called fire-and-forget — the sig appears a tick later for
   hydrated reports.
================================================================ */
async function _loadSigToPad(pad, value) {
    if (!pad || !value) return;
    let dataUrl = value;
    if (!value.startsWith('data:')) {
        dataUrl = await fetchStorageDataUrl(value);
        if (!dataUrl) { console.warn('[sig] could not load sig from Storage:', value.slice(0, 80)); return; }
    }
    try { pad.fromDataURL(dataUrl); } catch (e) { console.warn('[sig] pad load failed:', e); }
}

/* ================================================================
   PDF – client-side generation (jsPDF + html2canvas)
   The old FastAPI /api/reports/{id}/pdf endpoint is gone after the Firebase
   migration. We render the live #reportEditor DOM to canvas, then slice the
   canvas across A4 pages. RTL/Hebrew renders correctly because we're
   capturing the already-rendered DOM, not laying out text from scratch.
================================================================ */
export async function downloadPDF(returnBlob = false) {
    if (!S.currentId) { toast('אין דוח פתוח', 'error'); return null; }
    const r = S.reports[S.currentId];
    if (!r) { toast('הדוח לא נמצא – רענן את הדף', 'error'); return null; }

    await saveReport();

    const overlay    = document.getElementById('loadingOverlay');
    const overlayMsg = document.getElementById('loadingMsg');
    if (overlayMsg) overlayMsg.textContent = 'מייצר PDF...';
    overlay?.classList.remove('hidden');

    console.log('[PDF] report fields — tech.sig:', r.tech?.sig?.slice(0,60),
        '| customerSig:', r.customerSig?.slice(0,60),
        '| images:', (r.images || []).length);

    try {
        // Pre-convert Firebase Storage https:// URLs → data: URLs so
        // html2canvas can draw them without cross-origin restrictions.
        const [sigTech, sigCust, ...imgSrcs] = await Promise.all([
            _fetchDataUrl(r.tech?.sig),
            _fetchDataUrl(r.customerSig),
            ...(r.images || []).filter(Boolean).map(_fetchDataUrl),
        ]);
        console.log('[PDF] resolved — sigTech len:', sigTech?.length,
            '| sigCust len:', sigCust?.length,
            '| imgSrcs:', imgSrcs.map(s => s?.length));

        // Mount a hidden, fixed-width print container
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;' +
                             'font-family:Heebo,Arial,sans-serif;background:#fff;';
        wrap.innerHTML = _buildPrintLayout(r, sigTech, sigCust, imgSrcs);
        document.body.appendChild(wrap);

        // Wait for every <img> to fully decode before html2canvas captures the DOM.
        await Promise.all(
            Array.from(wrap.querySelectorAll('img[src]')).map(img => {
                const p = img.decode
                    ? img.decode().catch(() => {})
                    : new Promise(resolve => {
                        if (img.complete && img.naturalHeight > 0) { resolve(); return; }
                        img.onload = img.onerror = resolve;
                    });
                return Promise.race([p, new Promise(r => setTimeout(r, 8000))]);
            })
        );
        await document.fonts.ready;

        const canvas = await html2canvas(wrap, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#ffffff',
            windowWidth: 794,
            logging: false,
        });
        document.body.removeChild(wrap);

        // Build a multi-page PDF; scan for white rows near each page boundary
        // so we never bisect a table row, image, or signature block.
        const { jsPDF } = window.jspdf;
        const pdf     = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const pdfW    = pdf.internal.pageSize.getWidth();
        const pdfH    = pdf.internal.pageSize.getHeight();
        const pageHpx = Math.round((pdfH / pdfW) * canvas.width);

        let yOff = 0, pg = 0;
        while (yOff < canvas.height && pg < 60) {  // 60-page hard cap — safety valve
            if (pg++ > 0) pdf.addPage();
            const remaining = canvas.height - yOff;
            const ideal     = Math.min(pageHpx, remaining);
            const cutH      = remaining > pageHpx ? _bestPageCut(canvas, yOff, ideal) : ideal;
            if (cutH <= 0) break;   // guard: never allow zero-height slice

            const slice = document.createElement('canvas');
            slice.width  = canvas.width;
            slice.height = cutH;
            const ctx = slice.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, cutH);
            ctx.drawImage(canvas, 0, yOff, canvas.width, cutH, 0, 0, canvas.width, cutH);

            pdf.addImage(
                slice.toDataURL('image/jpeg', 0.93), 'JPEG',
                0, 0, pdfW, (cutH / canvas.width) * pdfW
            );
            yOff += cutH;
        }

        const filename = `${r.title || 'דוח'}.pdf`;
        if (returnBlob) return pdf.output('blob');
        pdf.save(filename);
        toast('PDF הורד ✓', 'success');
        return null;
    } catch (err) {
        console.error('[PDF]', err);
        toast('שגיאה ביצירת PDF', 'error');
        return null;
    } finally {
        overlay?.classList.add('hidden');
    }
}

/** Convert a remote URL to a data: URL for canvas embedding.
 *  Uses the Firebase Storage SDK (auth-aware, CORS-immune) for Storage URLs;
 *  falls back to fetch for anything else. */
async function _fetchDataUrl(url) {
    return fetchStorageDataUrl(url);
}

/** Scan backward from (startY + pageH) for the nearest near-white pixel row
 *  so page breaks land in whitespace rather than through content.
 *  Hard limit: 150 px — prevents freezing when no pure-white rows exist
 *  (e.g. reports with continuous grey/blue backgrounds). Falls back to
 *  exact A4 boundary rather than spinning indefinitely. */
function _bestPageCut(canvas, startY, pageH) {
    const SCAN_LIMIT = 150;           // absolute max rows to check (never > 150)
    const THRESHOLD  = 248;           // "near-white": catches #f9fafb (249,250,251) etc.
    const limit = Math.min(SCAN_LIMIT, Math.floor(pageH * 0.08));
    try {
        const ctx = canvas.getContext('2d');
        for (let dy = 0; dy < limit; dy++) {
            const scanY = startY + pageH - dy;
            if (scanY < 0 || scanY >= canvas.height) break;   // stay in bounds
            const data = ctx.getImageData(0, scanY, canvas.width, 1).data;
            let white = true;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] < THRESHOLD || data[i + 1] < THRESHOLD || data[i + 2] < THRESHOLD) {
                    white = false;
                    break;
                }
            }
            if (white) return pageH - dy;
        }
    } catch {
        // Canvas tainted or getImageData unavailable — fall through to hard cut
    }
    return pageH;   // hard fallback: exact A4 mathematical boundary
}

/** Build a self-contained A4 HTML string that html2canvas will render.
 *  All text is dir=rtl; Heebo font; no external stylesheet dependencies. */
function _buildPrintLayout(r, sigTech, sigCust, imgSrcs) {
    const tasks     = r.tasks || [];
    const realTasks = tasks.filter(t => t.type !== 'section');
    const nPerf  = realTasks.filter(t => t.status === 'performed').length;
    const nNot   = realTasks.filter(t => t.status === 'not_performed').length;
    const nPend  = realTasks.filter(t => t.status === 'pending').length;
    const docNum = r.number ? esc(r.number) : ('#' + r.id.slice(-8).toUpperCase());

    const STATUS_MAP = {
        performed:     { label: 'תקין',     bg: '#dcfce7', fg: '#166534' },
        not_performed: { label: 'לא תקין',  bg: '#fee2e2', fg: '#991b1b' },
        pending:       { label: 'ממתין',     bg: '#f1f5f9', fg: '#64748b' },
    };

    let rowN = 0;
    const taskRows = tasks.map(t => {
        if (t.type === 'section') {
            return `<tr><td colspan="4" style="padding:8px 12px;background:#f1f5f9;
                border:1px solid #e2e8f0;border-right:4px solid #f59e0b;
                font-weight:700;font-size:12px;color:#334155;">
                ${esc(t.label || t.title || t.description || '')}</td></tr>`;
        }
        rowN++;
        const s      = STATUS_MAP[t.status] || STATUS_MAP.pending;
        const rowBg  = rowN % 2 === 0 ? '#f9fafb' : '#ffffff';
        return `<tr style="background:${rowBg};">
          <td style="border:1px solid #e2e8f0;padding:7px 8px;text-align:center;
            font-size:11px;color:#94a3b8;">${rowN}</td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:12px;">
            ${esc(t.description || '')}</td>
          <td style="border:1px solid #e2e8f0;padding:7px 8px;text-align:center;">
            <span style="background:${s.bg};color:${s.fg};padding:2px 9px;
              border-radius:99px;font-size:10px;font-weight:700;white-space:nowrap;">
              ${s.label}</span></td>
          <td style="border:1px solid #e2e8f0;padding:7px 10px;font-size:11px;
            color:#475569;">${esc(t.comments || '')}</td>
        </tr>`;
    }).join('');

    const metaItems = [
        ['לקוח',        r.customer],
        ['אתר',         r.site],
        ['טכנאי',       r.tech?.name],
        ['תאריך ביקור', fmtDate(r.visitDate)],
    ].filter(([, v]) => v);

    const imagesHtml = imgSrcs.filter(Boolean).length ? `
      <div style="margin-top:28px;">
        <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;
          text-transform:uppercase;border-bottom:2px solid #1a2640;
          padding-bottom:5px;margin-bottom:12px;">תמונות</div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          ${imgSrcs.filter(Boolean).map(src =>
            `<img src="${src}" style="width:calc(50% - 6px);aspect-ratio:4/3;object-fit:cover;
              border-radius:6px;border:1px solid #e2e8f0;display:block;">`
          ).join('')}
        </div>
      </div>` : '';

    const sigBox = (sig, label, name, date) => `
      <div style="flex:1;text-align:center;">
        <div style="font-size:10px;font-weight:700;color:#64748b;margin-bottom:8px;">${label}</div>
        <div style="height:72px;border:1px solid #cbd5e1;border-radius:6px;
          display:flex;align-items:center;justify-content:center;background:#f8fafc;">
          ${sig ? `<img src="${sig}" style="max-height:62px;max-width:180px;object-fit:contain;">` : ''}
        </div>
        <div style="margin-top:6px;font-size:12px;font-weight:600;color:#1a2640;">${esc(name || '')}</div>
        ${date ? `<div style="font-size:10px;color:#94a3b8;">${date}</div>` : ''}
      </div>`;

    return `
    <div style="width:794px;direction:rtl;font-family:Heebo,Arial,sans-serif;
      color:#1a1a2e;background:#fff;box-sizing:border-box;">

      <!-- HEADER -->
      <div style="background:#1a2640;color:#fff;padding:22px 36px;
        display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:26px;font-weight:800;letter-spacing:-.5px;">Oficiency</div>
          <div style="font-size:10px;opacity:.6;margin-top:2px;">מערכת דוחות שירות</div>
        </div>
        <div style="text-align:left;">
          <div style="font-size:9px;opacity:.6;margin-bottom:2px;">מספר דוח</div>
          <div style="font-size:16px;font-weight:700;">${docNum}</div>
        </div>
      </div>

      <!-- META STRIP -->
      <div style="background:#eef2f9;padding:10px 36px;display:flex;gap:28px;
        flex-direction:row-reverse;justify-content:flex-end;
        border-bottom:1px solid #d1dae8;flex-wrap:wrap;">
        ${metaItems.map(([k, v]) => `
          <div>
            <div style="font-size:9px;color:#64748b;font-weight:600;">${k}</div>
            <div style="font-size:12px;font-weight:700;color:#1a2640;">${esc(v)}</div>
          </div>`).join('')}
      </div>

      <!-- STATUS BADGES -->
      <div style="background:#f8fafc;padding:7px 36px;display:flex;gap:10px;
        flex-direction:row-reverse;justify-content:flex-end;
        border-bottom:1px solid #e2e8f0;flex-wrap:wrap;">
        <span style="background:#dcfce7;color:#166534;padding:3px 11px;
          border-radius:99px;font-size:10px;font-weight:700;">✓ תקין: ${nPerf}</span>
        <span style="background:#fee2e2;color:#991b1b;padding:3px 11px;
          border-radius:99px;font-size:10px;font-weight:700;">✗ לא תקין: ${nNot}</span>
        <span style="background:#f1f5f9;color:#475569;padding:3px 11px;
          border-radius:99px;font-size:10px;font-weight:700;">⏳ ממתין: ${nPend}</span>
        <span style="background:#e0e7ff;color:#3730a3;padding:3px 11px;
          border-radius:99px;font-size:10px;font-weight:700;">סה״כ: ${realTasks.length}</span>
      </div>

      <!-- MAIN CONTENT -->
      <div style="padding:24px 36px;">

        <div style="font-size:17px;font-weight:800;color:#1a2640;margin-bottom:16px;
          padding-bottom:10px;border-bottom:2px solid #1a2640;">
          ${esc(r.title || '')}
        </div>

        ${r.permComments ? `
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;
          padding:10px 14px;margin-bottom:16px;">
          <div style="font-size:10px;font-weight:700;color:#92400e;margin-bottom:3px;">
            הערות כלליות</div>
          <div style="font-size:11px;color:#78350f;">
            ${esc(r.permComments).replace(/\n/g, '<br>')}</div>
        </div>` : ''}

        ${tasks.length ? `
        <div style="margin-bottom:20px;">
          <div style="font-size:10px;font-weight:700;color:#64748b;letter-spacing:.5px;
            text-transform:uppercase;border-bottom:2px solid #1a2640;
            padding-bottom:5px;margin-bottom:8px;">משימות</div>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#1a2640;color:#fff;">
                <th style="border:1px solid #334155;padding:8px;text-align:center;
                  width:32px;font-size:10px;">#</th>
                <th style="border:1px solid #334155;padding:8px 10px;text-align:right;
                  font-size:10px;">תיאור</th>
                <th style="border:1px solid #334155;padding:8px;text-align:center;
                  width:80px;font-size:10px;">סטטוס</th>
                <th style="border:1px solid #334155;padding:8px 10px;text-align:right;
                  width:175px;font-size:10px;">הערות</th>
              </tr>
            </thead>
            <tbody>${taskRows}</tbody>
          </table>
        </div>` : ''}

        ${r.finalComments ? `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;
          padding:10px 14px;margin-bottom:16px;">
          <div style="font-size:10px;font-weight:700;color:#334155;margin-bottom:4px;">
            הערות סיום</div>
          <div style="font-size:11px;">
            ${esc(r.finalComments).replace(/\n/g, '<br>')}</div>
        </div>` : ''}

        ${imagesHtml}

        <!-- SIGNATURES -->
        <div style="display:flex;gap:20px;margin-top:28px;padding-top:20px;
          border-top:2px solid #e2e8f0;">
          ${sigBox(sigTech, 'חתימת טכנאי',  r.tech?.name,  fmtDate(r.tech?.compDate))}
          ${sigBox(sigCust, 'חתימת לקוח',   r.customer,    '')}
        </div>

      </div>

      <!-- FOOTER -->
      <div style="background:#f1f5f9;border-top:1px solid #e2e8f0;padding:8px 36px;
        display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;">
        <span>Oficiency © ${new Date().getFullYear()}</span>
        <span>הופק: ${new Date().toLocaleDateString('he-IL')}</span>
      </div>

    </div>`;
}

/* ================================================================
   SHARE
================================================================ */
export function showShareModal() {
    if (!S.currentId) return;
    showModal('shareModal');
}

export async function shareTo(platform) {
    if (!S.currentId) return;
    hideModal('shareModal');
    const r = S.reports[S.currentId];

    const tasks   = (r.tasks || []).filter(t => t.type !== 'section');
    const perf    = tasks.filter(t => t.status === 'performed').length;
    const notPerf = tasks.filter(t => t.status === 'not_performed').length;

    const subject = encodeURIComponent(`דוח שירות – ${r.title || ''}${r.customer ? ' – ' + r.customer : ''}`);
    const bodyLines = [
        'שלום,',
        'מצורף דוח שירות:',
        '',
        `שם הדוח: ${r.title || ''}`,
        r.customer  ? `לקוח: ${r.customer}`           : '',
        r.site      ? `אתר: ${r.site}`                : '',
        r.visitDate ? `תאריך: ${fmtDate(r.visitDate)}` : '',
        '',
        `סיכום משימות: ${perf} בוצעו, ${notPerf} לא בוצעו, סה"כ ${tasks.length}`,
        '',
        ...tasks.map((t, i) => {
            const st = t.status === 'performed' ? 'בוצע' : t.status === 'not_performed' ? 'לא בוצע' : 'ממתין';
            return `${i + 1}. ${t.description} — ${st}${t.comments ? ' (' + t.comments + ')' : ''}`;
        }),
        '',
        r.tech?.name ? `טכנאי: ${r.tech.name}` : '',
    ].filter(Boolean).join('\n');
    const body = encodeURIComponent(bodyLines);

    await downloadPDF(false);

    if (platform === 'gmail') {
        window.open(`https://mail.google.com/mail/?view=cm&su=${subject}&body=${body}`, '_blank');
        toast('Gmail נפתח — צרף את ה-PDF שהורד', 'success');
    } else if (platform === 'outlook') {
        window.open(`https://outlook.live.com/mail/0/deeplink/compose?subject=${subject}&body=${body}`, '_blank');
        toast('Outlook נפתח — צרף את ה-PDF שהורד', 'success');
    }
}

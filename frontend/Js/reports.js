import { S, persist, uid, today, esc, fmtDate, apiSaveReport, apiUploadDocument, apiDeleteReport, fetchStorageDataUrl, isAdmin, canEditReport, canEditTemplates, apiSaveDraftFields, apiClearDraftFields, apiAssignReportNumber, apiPeekReportNumber, apiSetSiteCode, REPORT_TYPE_LABELS } from './api.js';
import {
    showModal, hideModal, toast,
    setReportMode, renderTasks, renderImages, renderReportAppendices,
    renderTplTasks, renderTplAppendices, collectTplAppendices,
    updateToolbar, renderSidebar, showDashboard, showFolderContent,
    closeMobileSidebar, markUnsaved, confirmUnsaved,
    collectTasks, collectReportAppendices,
} from './ui.js';
import { preloadLogo, downloadPDF } from './utils/pdfGenerator.js';

// Re-export so app.js imports continue to resolve from this module
export { preloadLogo, downloadPDF };

/* ================================================================
   MODULE STATE
================================================================ */
let _importDefaultAs    = 'report';
let _pendingAssetAction = null;

/* ================================================================
   AUTH HELPERS
================================================================ */
function _techName() {
    const u = S.currentUser;
    if (!u) return '';
    return u.displayName || u.email?.split('@')[0] || '';
}

function _applyReadOnlyMode(r) {
    const editable = canEditReport(r);
    const area     = document.getElementById('reportArea');
    if (!area) return;

    area.querySelector('.readonly-banner')?.remove();

    if (editable) {
        area.querySelectorAll('input, textarea, select').forEach(el => { el.disabled = false; });
        area.querySelectorAll('.sbtn, .task-del-btn, .section-del-btn, .image-del-btn, .seg-btn, .btn-add-task, .add-image-btn').forEach(el => {
            el.disabled = false; el.style.pointerEvents = ''; el.style.opacity = '';
        });
        if (S.pad)         { try { S.pad.on(); }         catch(e) {} }
        if (S.customerPad) { try { S.customerPad.on(); } catch(e) {} }
    } else {
        const banner = document.createElement('div');
        banner.className = 'readonly-banner';
        banner.style.cssText = [
            'background:rgba(245,158,11,0.10)',
            'border:1px solid rgba(245,158,11,0.35)',
            'border-radius:8px',
            'padding:9px 14px',
            'margin-bottom:14px',
            'font-size:12px',
            'color:#f59e0b',
            'font-weight:600',
            'text-align:center',
            'letter-spacing:0.2px',
        ].join(';');
        banner.textContent = '📋 מצב צפייה בלבד — הדוח שייך לטכנאי אחר ואינו ניתן לעריכה';
        area.insertBefore(banner, area.firstChild);
        area.querySelectorAll('input, textarea, select').forEach(el => { el.disabled = true; });
        area.querySelectorAll('.sbtn, .task-del-btn, .section-del-btn, .image-del-btn, .seg-btn, .btn-add-task, .add-image-btn').forEach(el => {
            el.disabled = true; el.style.pointerEvents = 'none'; el.style.opacity = '0.4';
        });
        if (S.pad)         { try { S.pad.off(); }         catch(e) {} }
        if (S.customerPad) { try { S.customerPad.off(); } catch(e) {} }
    }
}

/* ================================================================
   NEW REPORT MODAL
================================================================ */
/* ================================================================
   NEW REPORT WIZARD (3-step: service type → location → template)
================================================================ */
const _NR = { serviceType: '', folder: null, tplId: null, title: '' };
const _NR_LABELS = REPORT_TYPE_LABELS;

/* ================================================================
   DAILY WORK LOG — helpers
================================================================ */
function _emptyDailyLog() {
    return { dayOfWeek: '', weather: '', projectDesc: '', activities: [], dailyWorkers: [], subWorkers: [], equipment: [], generalNotes: '', supervisorNotes: '' };
}

/* ================================================================
   WELD INSPECTION — helpers
   Field set mirrors OFCY-GALIL-VT-002 (Daily Welding & Visual
   Inspection Report): each joint connects two components, so the
   material fields (form/spec/heat) are captured per side (A/B).
   Company/Location/Date reuse the report's generic customer/site/
   visitDate fields rather than duplicating them — every report type
   already shows those, and folder/PDF listings key off them.
================================================================ */
function _emptyWeldInspection() {
    return {
        project: '', installationLine: '', contractor: '',
        rev: '', docNo: '', wps: '', weldingProcess: '', acceptanceCriteria: '',
        rows: [],
        note: '',
        inspectedByName: '', inspectedByDate: '',
        witnessedByName: '', witnessedByDate: '',
        reviewByName: '', reviewByDate: '',
    };
}

function _weldRowHtml(data, num) {
    const inp = (val, ph) => '<input type="text" class="wi-inp" value="' + esc(val || '') + '" placeholder="' + ph + '" oninput="markUnsaved()">';
    const dateInp = (val) => '<input type="date" class="wi-inp" value="' + esc(val || '') + '" oninput="markUnsaved()">';
    const resBg = { ACC: '#dcfce7', REJ: '#fee2e2' };
    const resFg = { ACC: '#166534', REJ: '#991b1b' };
    const resSel = (val) => {
        const style = resBg[val] ? ' style="background:' + resBg[val] + ';color:' + resFg[val] + ';"' : '';
        return '<select class="wi-select"' + style + ' onchange="weldSelChange(this)">'
            + '<option value="">—</option>'
            + ['ACC', 'REJ'].map(o => '<option value="' + o + '"' + (val === o ? ' selected' : '') + '>' + o + '</option>').join('')
            + '</select>';
    };
    const typeSel = (val) => '<select class="wi-select" onchange="markUnsaved()">'
        + '<option value="">—</option>'
        + ['BW', 'FW'].map(o => '<option value="' + o + '"' + (val === o ? ' selected' : '') + '>' + o + '</option>').join('')
        + '</select>';
    const del = '<button class="dl-del-btn" onclick="weldDelRow(this)">✕</button>';
    return '<tr>'
        + '<td class="dl-num wi-num">' + num + '</td>'
        + '<td>' + inp(data.drawingNo, 'מס׳ שרטוט') + '</td>'
        + '<td>' + inp(data.jointNo, 'מפרק') + '</td>'
        + '<td>' + typeSel(data.weldType) + '</td>'
        + '<td>' + inp(data.formA, 'צד א') + '</td>'
        + '<td>' + inp(data.formB, 'צד ב') + '</td>'
        + '<td>' + inp(data.specA, 'תקן א') + '</td>'
        + '<td>' + inp(data.specB, 'תקן ב') + '</td>'
        + '<td>' + inp(data.heatA, 'התכה א') + '</td>'
        + '<td>' + inp(data.heatB, 'התכה ב') + '</td>'
        + '<td>' + inp(data.npsSch, 'קוטר/עובי') + '</td>'
        + '<td>' + inp(data.electrodeRoot, 'שורש') + '</td>'
        + '<td>' + inp(data.electrodeFillCap, 'מילוי/כיסוי') + '</td>'
        + '<td>' + dateInp(data.fitUpDate) + '</td>'
        + '<td>' + resSel(data.fitUpResult) + '</td>'
        + '<td>' + dateInp(data.weldingDate) + '</td>'
        + '<td>' + inp(data.welderStamp, 'חותמת') + '</td>'
        + '<td>' + dateInp(data.visualDate) + '</td>'
        + '<td>' + resSel(data.visualResult) + '</td>'
        + '<td>' + inp(data.ndtType, 'סוג') + '</td>'
        + '<td>' + del + '</td>'
        + '</tr>';
}

export function renderWeldInspection(wi = {}) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('wiProject',            wi.project);
    set('wiInstallationLine',   wi.installationLine);
    set('wiContractor',         wi.contractor);
    set('wiRev',                wi.rev);
    set('wiDocNo',              wi.docNo);
    set('wiWps',                wi.wps);
    set('wiWeldingProcess',     wi.weldingProcess);
    set('wiAcceptanceCriteria', wi.acceptanceCriteria);
    set('wiNote',               wi.note);
    set('wiInspectedByName',    wi.inspectedByName);
    set('wiInspectedByDate',    wi.inspectedByDate);
    set('wiWitnessedByName',    wi.witnessedByName);
    set('wiWitnessedByDate',    wi.witnessedByDate);
    set('wiReviewByName',       wi.reviewByName);
    set('wiReviewByDate',       wi.reviewByDate);
    const tbody = document.getElementById('wiRowsTbody');
    if (tbody) tbody.innerHTML = (wi.rows || []).map((row, i) => _weldRowHtml(row, i + 1)).join('');
}

export function weldAddRow() {
    const tbody = document.getElementById('wiRowsTbody');
    if (!tbody) return;
    tbody.insertAdjacentHTML('beforeend', _weldRowHtml({}, tbody.rows.length + 1));
    markUnsaved();
}

export function weldDelRow(btn) {
    const tbody = btn.closest('tr').parentElement;
    btn.closest('tr').remove();
    Array.from(tbody.rows).forEach((row, i) => { const c = row.querySelector('.wi-num'); if (c) c.textContent = i + 1; });
    markUnsaved();
}

export function weldSelChange(sel) {
    const bg = { ACC: '#dcfce7', REJ: '#fee2e2' };
    const fg = { ACC: '#166534', REJ: '#991b1b' };
    sel.style.background = bg[sel.value] || '';
    sel.style.color      = fg[sel.value] || '';
    markUnsaved();
}

export function collectWeldInspection() {
    const get = id => document.getElementById(id)?.value || '';
    const rows = Array.from(document.getElementById('wiRowsTbody')?.rows || []).map(row => {
        const texts = row.querySelectorAll('input[type="text"]');
        const dates = row.querySelectorAll('input[type="date"]');
        const sels  = row.querySelectorAll('select');
        return {
            drawingNo:        texts[0]?.value.trim() || '',
            jointNo:          texts[1]?.value.trim() || '',
            weldType:         sels[0]?.value || '',
            formA:            texts[2]?.value.trim() || '',
            formB:            texts[3]?.value.trim() || '',
            specA:            texts[4]?.value.trim() || '',
            specB:            texts[5]?.value.trim() || '',
            heatA:            texts[6]?.value.trim() || '',
            heatB:            texts[7]?.value.trim() || '',
            npsSch:           texts[8]?.value.trim() || '',
            electrodeRoot:    texts[9]?.value.trim() || '',
            electrodeFillCap: texts[10]?.value.trim() || '',
            fitUpDate:        dates[0]?.value || '',
            fitUpResult:      sels[1]?.value || '',
            weldingDate:      dates[1]?.value || '',
            welderStamp:      texts[11]?.value.trim() || '',
            visualDate:       dates[2]?.value || '',
            visualResult:     sels[2]?.value || '',
            ndtType:          texts[12]?.value.trim() || '',
        };
    });
    return {
        project:            get('wiProject'),
        installationLine:   get('wiInstallationLine'),
        contractor:         get('wiContractor'),
        rev:                get('wiRev'),
        docNo:              get('wiDocNo'),
        wps:                get('wiWps'),
        weldingProcess:     get('wiWeldingProcess'),
        acceptanceCriteria: get('wiAcceptanceCriteria'),
        rows,
        note:               get('wiNote'),
        inspectedByName:    get('wiInspectedByName'),
        inspectedByDate:    get('wiInspectedByDate'),
        witnessedByName:    get('wiWitnessedByName'),
        witnessedByDate:    get('wiWitnessedByDate'),
        reviewByName:       get('wiReviewByName'),
        reviewByDate:       get('wiReviewByDate'),
    };
}

function _dlRowHtml(type, data, num) {
    const inp = (val, ph) => '<input type="text" class="dl-input" value="' + esc(val || '') + '" placeholder="' + ph + '" oninput="markUnsaved()">';
    const numInp = (val, ph) => '<input type="number" class="dl-input" value="' + esc(String(val || '')) + '" placeholder="' + ph + '" oninput="markUnsaved()" style="max-width:80px">';
    const del = '<button class="dl-del-btn" onclick="dlDelRow(this)">✕</button>';
    const chk = function(checked) { return '<input type="checkbox" class="dl-chk"' + (checked ? ' checked' : '') + ' oninput="markUnsaved()" aria-label="חתימה">'; };
    if (type === 'activities')   return '<tr><td class="dl-num">' + num + '</td><td>' + inp(data.contractTask, 'פעילות / משימה...') + '</td><td>' + inp(data.notes, 'הערות...') + '</td><td style="text-align:center;">' + chk(data.signed) + '</td><td>' + del + '</td></tr>';
    if (type === 'dailyWorkers') return '<tr><td class="dl-num">' + num + '</td><td>' + inp(data.name, 'שם + משפחה...') + '</td><td>' + inp(data.profession, 'מקצוע...') + '</td><td>' + inp(data.notes, 'הערות...') + '</td><td>' + del + '</td></tr>';
    if (type === 'subWorkers')   return '<tr><td class="dl-num">' + num + '</td><td>' + inp(data.contractor, 'קבלן משנה...') + '</td><td>' + inp(data.profession, 'מקצוע...') + '</td><td>' + inp(data.notes, 'הערות...') + '</td><td>' + del + '</td></tr>';
    if (type === 'equipment')    return '<tr><td class="dl-num">' + num + '</td><td>' + inp(data.name, 'שם / סוג ציוד...') + '</td><td>' + numInp(data.quantity, 'כמות...') + '</td><td>' + inp(data.notes, 'הערות...') + '</td><td>' + del + '</td></tr>';
    return '';
}

export function renderDailyLog(dl = {}) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('fDayOfWeek',      dl.dayOfWeek);
    set('fWeather',        dl.weather);
    set('fProjectDesc',    dl.projectDesc);
    set('fGeneralNotes',   dl.generalNotes);
    set('fSupervisorNotes',dl.supervisorNotes);
    const tbMap = { activities: 'dlActivitiesTbody', dailyWorkers: 'dlDailyWorkersTbody', subWorkers: 'dlSubWorkersTbody', equipment: 'dlEquipmentTbody' };
    for (const [key, tbId] of Object.entries(tbMap)) {
        const tbody = document.getElementById(tbId);
        if (tbody) tbody.innerHTML = (dl[key] || []).map((row, i) => _dlRowHtml(key, row, i + 1)).join('');
    }
}

export function dlAddRow(type) {
    const tbMap = { activities: 'dlActivitiesTbody', dailyWorkers: 'dlDailyWorkersTbody', subWorkers: 'dlSubWorkersTbody', equipment: 'dlEquipmentTbody' };
    const tbody = document.getElementById(tbMap[type]);
    if (!tbody) return;
    tbody.insertAdjacentHTML('beforeend', _dlRowHtml(type, {}, tbody.rows.length + 1));
    markUnsaved();
}

export function dlDelRow(btn) {
    const tbody = btn.closest('tr').parentElement;
    btn.closest('tr').remove();
    Array.from(tbody.rows).forEach((row, i) => { const c = row.querySelector('.dl-num'); if (c) c.textContent = i + 1; });
    markUnsaved();
}

export function collectDailyLog() {
    const get = id => document.getElementById(id)?.value || '';
    const collectTbl = (tbId, cols) => {
        const tbody = document.getElementById(tbId);
        if (!tbody) return [];
        return Array.from(tbody.rows).map(row => {
            const inputs = row.querySelectorAll('input');
            const obj = {};
            cols.forEach((col, i) => { obj[col] = inputs[i]?.value.trim() || ''; });
            return obj;
        });
    };
    return {
        dayOfWeek:      get('fDayOfWeek'),
        weather:        get('fWeather'),
        projectDesc:    get('fProjectDesc'),
        activities: Array.from(document.getElementById('dlActivitiesTbody')?.rows || []).map(row => {
            const texts = row.querySelectorAll('input[type="text"]');
            return {
                contractTask: texts[0]?.value.trim() || '',
                notes:        texts[1]?.value.trim() || '',
                signed:       row.querySelector('input[type="checkbox"]')?.checked || false,
            };
        }),
        dailyWorkers:   collectTbl('dlDailyWorkersTbody', ['name', 'profession', 'notes']),
        subWorkers:     collectTbl('dlSubWorkersTbody',   ['contractor', 'profession', 'notes']),
        equipment:      collectTbl('dlEquipmentTbody',    ['name', 'quantity', 'notes']),
        generalNotes:   get('fGeneralNotes'),
        supervisorNotes: get('fSupervisorNotes'),
    };
}

function _nrShowStep(n) {
    ['1b', 1, 2, 3].forEach(i => {
        const el = document.getElementById('nrStep' + i);
        if (el) el.style.display = (i === n) ? '' : 'none';
    });
}

export function showNewReportModal() {
    _NR.serviceType = '';
    _NR.folder      = S.currentFolder !== undefined ? S.currentFolder : null;
    _NR.tplId       = null;
    _NR.title       = '';
    const nameInput = document.getElementById('nrReportName');
    if (nameInput) nameInput.value = '';
    document.querySelectorAll('#nrStep1 .nr-type-btn').forEach(b => b.classList.remove('selected'));
    const nextBtn = document.getElementById('nrStep1Next');
    if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.onclick = nrGoStep1b;
    }
    _nrShowStep(1);
    showModal('newReportModal');
}

export function nrSelectType(el, val) {
    _NR.serviceType = val;
    document.querySelectorAll('#nrStep1 .nr-type-btn').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected');
    const btn = document.getElementById('nrStep1Next');
    if (btn) btn.disabled = false;
}

export function nrGoStep1() { _nrShowStep(1); }

export function nrGoStep1b() {
    _nrShowStep('1b');
    setTimeout(() => document.getElementById('nrReportName')?.focus(), 80);
}

export function nrGoStep2() {
    _NR.title = document.getElementById('nrReportName')?.value.trim() || '';
    const folders = Object.keys(S.folders);
    const list    = document.getElementById('nrFolderList');
    list.innerHTML = [
        `<div class="folder-opt${_NR.folder === null ? ' selected' : ''}" onclick="nrSelectFolder(this, null)">
            <span style="font-size:15px;">🌐</span> ללא אתר ספציפי
         </div>`,
        ...folders.map(name =>
            `<div class="folder-opt${_NR.folder === name ? ' selected' : ''}" onclick="nrSelectFolder(this,'${esc(name)}')">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                ${esc(name)}
             </div>`)
    ].join('');
    const btn = document.getElementById('nrStep2NextBtn');
    if (btn) btn.textContent = _NR.serviceType === 'routine' ? 'המשך ←' : 'צור דוח ✓';
    _nrShowStep(2);
}

export function nrSelectFolder(el, name) {
    _NR.folder = name;
    document.querySelectorAll('#nrFolderList .folder-opt').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
}

export function nrGoStep3() {
    if (_NR.serviceType !== 'routine') { nrConfirm(); return; }
    const tpls = Object.values(S.templates)
        .filter(t => !_NR.folder || t.folder === _NR.folder);
    const list = document.getElementById('nrTplList');
    list.innerHTML = [
        `<div class="tpl-opt${_NR.tplId === null ? ' selected' : ''}" onclick="nrSelectTpl(this, null)">
            <span>📄</span>
            <span>דוח ריק (ללא תבנית)</span>
         </div>`,
        ...tpls.map(t =>
            `<div class="tpl-opt${_NR.tplId === t.id ? ' selected' : ''}" onclick="nrSelectTpl(this,'${t.id}')">
                <span>📋</span>
                <span>${esc(t.name)}</span>
                <span style="font-size:11px;color:var(--slate-400);margin-right:auto;">${(t.tasks||[]).length} משימות</span>
             </div>`)
    ].join('');
    _nrShowStep(3);
}

export function nrSelectTpl(el, id) {
    _NR.tplId = id;
    document.querySelectorAll('#nrTplList .tpl-opt').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
}

/** Saves a newly-created report to Firestore for the first time. The
 *  report's document number is deliberately NOT assigned here — only a
 *  live, non-binding preview is shown (see openReport) — so a report
 *  that's created and discarded without ever being genuinely saved never
 *  burns a real number. The real number is reserved on first real save,
 *  see saveReport(). Never blocks report creation if the save fails. */
async function _finalizeNewReport(id, failToastMsg) {
    try {
        const saved = await apiSaveReport(S.reports[id]);
        S.reports[id]._backendId = saved.id;
    } catch (e) {
        toast(failToastMsg, 'error');
    }
}

export async function nrConfirm() {
    if (!_NR.serviceType) { toast('אנא בחר סוג טיפול', 'error'); return; }
    const tpl    = _NR.tplId ? S.templates[_NR.tplId] : null;
    const id     = uid();
    const t      = today();
    const folder = _NR.folder;

    S.reports[id] = {
        id,
        title:            _NR.title || _NR_LABELS[_NR.serviceType] || 'דוח חדש',
        customer:         '',
        site:             folder || '',
        visitDate:        t,
        number:           '',
        startTime:        '',
        endTime:          '',
        totalHours:       '',
        serviceType:      _NR.serviceType,
        periodicInterval: tpl ? (tpl.periodicInterval || '') : '',
        permComments:     tpl ? (tpl.permComments     || '') : '',
        finalComments:    '',
        tasks: (tpl ? tpl.tasks : []).map(tk => {
            if (tk.type === 'section') return { id: 'sec_' + (++S.taskCounter), type: 'section', title: tk.title };
            if (tk.type === 'range')   return { id: 'tk_' + (++S.taskCounter), type: 'range', description: tk.description, minValue: tk.minValue ?? null, maxValue: tk.maxValue ?? null, unit: tk.unit || '', reading: null, status: 'pending', comments: '' };
            return { id: 'tk_' + (++S.taskCounter), type: 'task', description: tk.description, status: 'pending', comments: tk.comments || '' };
        }),
        images:       [],
        appendices:   [],
        tech:         { name: _techName(), compDate: t, sig: '' },
        customerSig:  '',
        folder,
        createdBy:    S.currentUser?.email || '',
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
    };

    if (_NR.serviceType === 'daily_log')      S.reports[id].dailyLog       = _emptyDailyLog();
    if (_NR.serviceType === 'weld_inspection') S.reports[id].weldInspection = _emptyWeldInspection();

    if (folder) {
        if (!S.folders[folder]) S.folders[folder] = [];
        if (!S.folders[folder].includes(id)) S.folders[folder].push(id);
    }
    S.currentFolder = folder;

    persist();
    hideModal('newReportModal');
    openReport(id);
    renderSidebar();
    toast('דוח חדש נוצר' + (tpl ? ` מתבנית "${tpl.name}"` : ''), 'success');

    await _finalizeNewReport(id, 'הדוח נוצר אך לא נשמר בשרת – נסה לשמור שוב');
}

/* ================================================================
   AUTO-SAVE DRAFT
   – localStorage write is immediate (survives browser refresh / screen-lock reload)
   – Firestore write is debounced 2.5 s (cross-device / localStorage-clear backup)
================================================================ */
let _draftTimer = null;

function _collectDraftSnapshot() {
    const id = S.currentId;
    if (!id) return null;
    return {
        id,
        savedAt:          new Date().toISOString(),
        title:            document.getElementById('fTitle')?.value            ?? '',
        customer:         document.getElementById('fCustomer')?.value         ?? '',
        site:             document.getElementById('fSite')?.value             ?? '',
        visitDate:        document.getElementById('fVisitDate')?.value        ?? '',
        number:           document.getElementById('fNumber')?.value           ?? '',
        startTime:        document.getElementById('fStartTime')?.value        ?? '',
        endTime:          document.getElementById('fEndTime')?.value          ?? '',
        totalHours:       document.getElementById('fTotalHours')?.value       ?? '',
        serviceType:      document.getElementById('fServiceType')?.value      ?? '',
        periodicInterval: document.getElementById('fPeriodicInterval')?.value ?? '',
        permComments:     document.getElementById('fPermComments')?.value     ?? '',
        finalComments:    document.getElementById('fFinalComments')?.value    ?? '',
        techName:         document.getElementById('fTechName')?.value         ?? '',
        compDate:         document.getElementById('fCompDate')?.value         ?? '',
        tasks: collectTasks().map(t => ({
            id:       t.id,
            type:     t.type,
            status:   t.status,
            comments: t.comments,
            reading:  t.type === 'range' ? (t.reading ?? null) : undefined,
        })),
        ...(S.reports[id]?.serviceType === 'daily_log'      ? { dailyLog:       collectDailyLog()       } : {}),
        ...(S.reports[id]?.serviceType === 'weld_inspection' ? { weldInspection: collectWeldInspection() } : {}),
    };
}

export function saveDraft() {
    const id = S.currentId;
    if (!id) return;
    const snap = _collectDraftSnapshot();
    if (!snap) return;
    try { localStorage.setItem('trs_draft_' + id, JSON.stringify(snap)); } catch (e) {
        console.warn('[DRAFT] localStorage write failed:', e.message);
    }
    if (_draftTimer) clearTimeout(_draftTimer);
    _draftTimer = setTimeout(() => {
        _draftTimer = null;
        apiSaveDraftFields(id, snap).catch(() => {});
    }, 2500);
}

export function recoverDraft(id) {
    const raw = localStorage.getItem('trs_draft_' + id);
    if (!raw) return;
    let draft;
    try { draft = JSON.parse(raw); } catch { return; }

    const r = S.reports[id];
    if (r?.updatedAt && draft.savedAt && draft.savedAt <= r.updatedAt) {
        localStorage.removeItem('trs_draft_' + id);
        return;
    }

    const _setVal = (elId, val) => {
        if (val == null) return;
        const el = document.getElementById(elId);
        if (el) el.value = val;
    };

    _setVal('fTitle',            draft.title);
    _setVal('fCustomer',         draft.customer);
    _setVal('fSite',             draft.site);
    _setVal('fVisitDate',        draft.visitDate);
    _setVal('fNumber',           draft.number);
    _setVal('fStartTime',        draft.startTime);
    _setVal('fEndTime',          draft.endTime);
    _setVal('fTotalHours',       draft.totalHours);
    _setVal('fPeriodicInterval', draft.periodicInterval);
    _setVal('fFinalComments',    draft.finalComments);
    _setVal('fTechName',         draft.techName);
    _setVal('fCompDate',         draft.compDate);

    if (draft.permComments != null) {
        _setVal('fPermComments', draft.permComments);
        const el = document.getElementById('fPermComments');
        if (el && window.autoExpand) setTimeout(() => window.autoExpand(el), 0);
    }

    if (draft.serviceType != null) {
        _setVal('fServiceType', draft.serviceType);
        const badge = document.getElementById('serviceTypeDisplay');
        if (badge) badge.textContent = _NR_LABELS[draft.serviceType] || draft.serviceType || '—';
        const row = document.getElementById('periodicIntervalRow');
        if (row) row.style.display = draft.serviceType === 'routine' ? '' : 'none';
    }

    // Restore task states (status, comments, range readings)
    for (const dt of (draft.tasks || [])) {
        if (dt.type === 'section') continue;
        const taskEl = document.querySelector(`#tasksList [data-id="${dt.id}"]`);
        if (!taskEl) continue;

        const commentEl = taskEl.querySelector('.task-comment');
        if (commentEl && dt.comments != null) commentEl.value = dt.comments;

        if (dt.type === 'range') {
            const inp = taskEl.querySelector('.task-reading-input');
            if (inp && dt.reading != null) {
                inp.value = dt.reading;
                if (window.setRangeReading) window.setRangeReading(inp);
            }
        } else {
            const status = dt.status || 'pending';
            taskEl.dataset.status = status;
            taskEl.classList.remove('performed', 'not-performed');
            taskEl.querySelectorAll('.sbtn').forEach(b => b.classList.remove('active'));
            if (status === 'performed') {
                taskEl.classList.add('performed');
                taskEl.querySelector('.sbtn-yes')?.classList.add('active');
            } else if (status === 'not_performed') {
                taskEl.classList.add('not-performed');
                taskEl.querySelector('.sbtn-no')?.classList.add('active');
            }
        }
    }

    if (r.serviceType === 'daily_log' && draft.dailyLog) {
        renderDailyLog(draft.dailyLog);
    }
    if (r.serviceType === 'weld_inspection' && draft.weldInspection) {
        renderWeldInspection(draft.weldInspection);
    }

    markUnsaved();
    toast('הדוח שוחזר אוטומטית', 'success');
}

export function clearDraft(id) {
    if (!id) return;
    localStorage.removeItem('trs_draft_' + id);
    if (_draftTimer) { clearTimeout(_draftTimer); _draftTimer = null; }
    apiClearDraftFields(id).catch(() => {});
}

/* ================================================================
   REPORTS – CRUD
================================================================ */
/** Shows a live, non-binding preview of the next document number as the
 *  field's placeholder (grey hint text, not a real value) — only while the
 *  report has no real number yet. Purely cosmetic; can go stale if someone
 *  else's report gets saved first, which is fine since it's never read
 *  back as the actual value (see saveReport()). */
async function _refreshNumberPreview(id, r) {
    const numEl = document.getElementById('fNumber');
    if (!numEl) return;
    if (r.number || !r.folder) { numEl.placeholder = 'אופציונלי'; return; }
    numEl.placeholder = 'טוען הערכה...';
    const preview = await apiPeekReportNumber(r.folder);
    if (S.currentId !== id) return; // navigated away before this resolved
    numEl.placeholder = preview ? `${preview} (משוער)` : 'אופציונלי';
}

export function openReport(id) {
    if (!confirmUnsaved()) return;
    closeMobileSidebar();
    if (window.switchTab) window.switchTab('reports');
    S.currentId   = id;
    S.currentMode = 'report';
    S.unsaved     = false;
    const r = S.reports[id];
    if (!r) {
        setReportMode('report');
        updateToolbar();
        renderSidebar();
        toast('הדוח לא נטען – אנא הפעל מחדש את השרת ורענן', 'error');
        return;
    }

    setReportMode('report');

    document.getElementById('fTitle').value         = r.title        || '';
    document.getElementById('fCustomer').value      = r.customer     || '';
    document.getElementById('fSite').value          = r.site         || '';
    document.getElementById('fVisitDate').value     = r.visitDate    || '';
    document.getElementById('fNumber').value        = r.number       || '';
    _refreshNumberPreview(id, r);
    document.getElementById('fStartTime').value     = r.startTime    || '';
    document.getElementById('fEndTime').value       = r.endTime      || '';
    document.getElementById('fTotalHours').value    = r.totalHours   || '';
    document.getElementById('fPermComments').value  = r.permComments  || '';
    if (window.autoExpand) setTimeout(() => window.autoExpand(document.getElementById('fPermComments')), 0);
    document.getElementById('fFinalComments').value = r.finalComments || '';
    const _stVal = r.serviceType || '';
    document.getElementById('fServiceType').value = _stVal;
    document.querySelectorAll('#serviceTypePicker .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === _stVal);
    });
    const _stDisplay = document.getElementById('serviceTypeDisplay');
    if (_stDisplay) _stDisplay.textContent = _NR_LABELS[_stVal] || _stVal || '—';
    const _intervalEl  = document.getElementById('fPeriodicInterval');
    const _intervalRow = document.getElementById('periodicIntervalRow');
    if (_intervalEl)  _intervalEl.value = r.periodicInterval || '';
    if (_intervalRow) _intervalRow.style.display = _stVal === 'routine' ? '' : 'none';
    document.getElementById('fTechName').value = r.tech?.name || _techName();
    document.getElementById('fCompDate').value = r.tech?.compDate || '';

    renderTasks(r.tasks || []);

    // Show/hide sections based on service type
    const _isDL = r.serviceType === 'daily_log';
    const _isWI = r.serviceType === 'weld_inspection';
    const _el   = id => document.getElementById(id);
    if (_el('cardDailyLog'))       _el('cardDailyLog').style.display       = _isDL ? '' : 'none';
    if (_el('cardWeldInspection')) _el('cardWeldInspection').style.display  = _isWI ? '' : 'none';
    if (_el('cardTasks'))          _el('cardTasks').style.display            = (_isDL || _isWI) ? 'none' : '';
    if (_el('cardPermComments'))   _el('cardPermComments').style.display     = (_isDL || _isWI) ? 'none' : '';
    if (_el('cardFinalComments'))  _el('cardFinalComments').style.display    = (_isDL || _isWI) ? 'none' : '';
    if (_el('cardTechTitle'))      _el('cardTechTitle').textContent          = _isDL ? 'חתימת מנהל עבודה' : _isWI ? 'Prepared By' : 'פרטי הטכנאי';
    if (_el('lblTechSig'))         _el('lblTechSig').textContent             = _isDL ? 'חתימת מנהל עבודה' : _isWI ? 'חתימת Prepared By' : 'חתימת הטכנאי';
    if (_el('cardCustomerSigTitle')) _el('cardCustomerSigTitle').textContent = _isDL ? 'חתימת מפקח' : _isWI ? 'Review By' : 'חתימת לקוח';
    if (_isDL) renderDailyLog(r.dailyLog || {});
    if (_isWI) renderWeldInspection(r.weldInspection || {});

    renderImages(r.images || []);
    renderReportAppendices(r.appendices || []);

    if (S.pad)         { S.pad.clear();         _loadSigToPad(S.pad,         r.tech?.sig);  }
    if (S.customerPad) { S.customerPad.clear(); _loadSigToPad(S.customerPad, r.customerSig); }

    updateToolbar();
    renderSidebar();
    document.getElementById('reportArea').scrollTop = 0;
    _applyReadOnlyMode(r);
    recoverDraft(id);
}

export async function saveReport() {
    const savedId = S.currentId;
    if (!savedId || S.currentMode !== 'report') return;
    const r = S.reports[savedId];
    if (!r) { toast('הדוח לא נמצא בזיכרון – רענן את הדף', 'error'); return; }

    if (!canEditReport(r)) { toast('אין הרשאה — הדוח שייך לטכנאי אחר', 'error'); return; }

    const overlay    = document.getElementById('loadingOverlay');
    const overlayMsg = document.getElementById('loadingMsg');
    if (overlayMsg) overlayMsg.textContent = 'שומר דוח...';
    overlay?.classList.remove('hidden');

    let saveOk = false;
    try {
        r.title         = document.getElementById('fTitle')?.value.trim()        || r.title        || 'דוח ללא שם';
        r.customer      = document.getElementById('fCustomer')?.value             ?? r.customer;
        r.site          = document.getElementById('fSite')?.value                 ?? r.site;
        r.visitDate     = document.getElementById('fVisitDate')?.value            ?? r.visitDate;
        const _typedNumber = document.getElementById('fNumber')?.value ?? '';
        if (!_typedNumber && !r.number && r.folder) {
            // First real save with no manual override — reserve a real number now
            // (never at creation, so an abandoned/deleted report never burns one).
            const assignedNumber = await apiAssignReportNumber(r);
            if (assignedNumber) {
                r.number = assignedNumber;
                document.getElementById('fNumber').value = assignedNumber;
            }
        } else {
            r.number = _typedNumber || r.number;
        }
        r.startTime     = document.getElementById('fStartTime')?.value            ?? r.startTime    ?? '';
        r.endTime       = document.getElementById('fEndTime')?.value              ?? r.endTime      ?? '';
        r.totalHours    = document.getElementById('fTotalHours')?.value           ?? r.totalHours   ?? '';
        r.serviceType      = document.getElementById('fServiceType')?.value         || r.serviceType  || '';
        r.periodicInterval = document.getElementById('fPeriodicInterval')?.value   || '';
        r.permComments  = document.getElementById('fPermComments')?.value         ?? r.permComments;
        r.finalComments = document.getElementById('fFinalComments')?.value        ?? r.finalComments;
        r.tasks         = collectTasks();
        if (r.serviceType === 'daily_log')      r.dailyLog       = collectDailyLog();
        if (r.serviceType === 'weld_inspection') r.weldInspection = collectWeldInspection();
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
        clearDraft(savedId);
    } catch (e) {
        console.error('[SAVE] failed:', e);
        toast('שמירת הדו"ח נכשלה', 'error');
    } finally {
        overlay?.classList.add('hidden');
        S.currentId   = savedId;
        S.currentMode = 'report';
        S.unsaved     = !saveOk;
        updateToolbar();
    }

    if (saveOk) { renderSidebar(); toast('הדו"ח נשמר בהצלחה', 'success'); }
}

export function clearReport() {
    if (!S.currentId) return;
    if (!confirm('לאפס את סטטוסי המשימות וההערות?\n(המשימות עצמן נשמרות)')) return;
    clearDraft(S.currentId);

    document.querySelectorAll('#tasksList .task-item').forEach(item => {
        item.dataset.status = 'pending';
        if (item.dataset.type === 'range') {
            const inp = item.querySelector('.task-reading-input');
            if (inp) { inp.value = ''; inp.classList.remove('in-range', 'out-of-range'); }
        } else {
            item.classList.remove('performed', 'not-performed');
            item.querySelectorAll('.sbtn').forEach(b => b.classList.remove('active'));
        }
        const comment = item.querySelector('.task-comment');
        if (comment) comment.value = '';
    });

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
    clearDraft(id);
    _markDeleted(id);
    for (const fn in S.folders) S.folders[fn] = S.folders[fn].filter(x => x !== id);
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
    clearDraft(id);
    _markDeleted(id);
    for (const fn in S.folders) S.folders[fn] = S.folders[fn].filter(x => x !== id);
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
    if (!canEditTemplates()) { toast('אין הרשאה לערוך תבניות', 'error'); return; }
    const tpl = id ? S.templates[id] : null;
    document.getElementById('tplEditorId').value          = id || '';
    document.getElementById('tplEditorFolder').value      = tpl ? (tpl.folder || '') : (folderName || '');
    document.getElementById('tplEditorTitle').textContent = tpl ? 'עריכת תבנית' : 'תבנית חדשה';
    document.getElementById('tplName').value              = tpl ? (tpl.name || '') : '';
    document.getElementById('tplPermComments').value      = tpl ? (tpl.permComments || '') : '';
    const _tplStVal = tpl ? (tpl.serviceType || '') : '';
    document.getElementById('tplServiceType').value = _tplStVal;
    document.querySelectorAll('#tplServiceTypePicker .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === _tplStVal);
    });
    renderTplTasks(tpl ? tpl.tasks : []);
    renderTplAppendices(tpl ? (tpl.appendices || []) : []);
    closeMobileSidebar();

    if (window.innerWidth > 768) {
        document.querySelectorAll('.dtab-btn').forEach(b =>
            b.classList.toggle('dtab-active', b.dataset.dtab === 'reports'));
        const dHome  = document.getElementById('desktopHomePanel');
        const dEquip = document.getElementById('desktopEquipmentPanel');
        if (dHome)  dHome.style.display  = 'none';
        if (dEquip) dEquip.style.display = 'none';
        const rArea = document.getElementById('reportArea');
        if (rArea) rArea.style.display = '';
    }

    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('emptyState').style.display    = 'none';
    document.getElementById('reportEditor').style.display  = 'none';
    document.getElementById('tplEditorPage').style.display = 'block';
    document.getElementById('tplEditorPage').scrollTop     = 0;
    setTimeout(() => document.getElementById('tplName').focus(), 80);
}

export function saveTplEditor() {
    if (!canEditTemplates()) { toast('אין הרשאה לערוך תבניות', 'error'); return; }
    const name = document.getElementById('tplName').value.trim();
    if (!name) { toast('אנא הכנס שם לתבנית', 'error'); return; }

    const items = document.querySelectorAll('#tplTaskList .tpl-task-row, #tplTaskList .section-title-item');
    const tasks = Array.from(items).map(el => {
        if (el.dataset.type === 'section') {
            return { type: 'section', title: el.querySelector('.section-title-input').value.trim() };
        }
        if (el.dataset.type === 'range') {
            const minRaw = el.querySelector('.tpl-range-min')?.value;
            const maxRaw = el.querySelector('.tpl-range-max')?.value;
            return {
                type:        'range',
                description: el.querySelector('.tpl-range-desc')?.value.trim() || '',
                minValue:    minRaw !== '' && minRaw != null ? Number(minRaw) : null,
                maxValue:    maxRaw !== '' && maxRaw != null ? Number(maxRaw) : null,
                unit:        el.querySelector('.tpl-range-unit')?.value.trim() || '',
            };
        }
        return { type: 'task', description: el.querySelector('.tpl-task-input').value.trim(), comments: '' };
    }).filter(t => t.type === 'section' ? t.title : t.description);

    const existingId = document.getElementById('tplEditorId').value;
    const id         = existingId || uid();
    const folderVal  = document.getElementById('tplEditorFolder').value || null;

    S.templates[id] = {
        id, name, folder: folderVal,
        serviceType:  document.getElementById('tplServiceType')?.value || null,
        permComments: document.getElementById('tplPermComments').value,
        tasks,
        appendices: collectTplAppendices(),
        updatedAt: new Date().toISOString(),
    };
    if (!existingId) S.templates[id].createdAt = S.templates[id].updatedAt;

    persist();
    renderSidebar();
    document.getElementById('tplEditorPage').style.display = 'none';
    if (S.currentFolder) showFolderContent(S.currentFolder);
    else showDashboard();
    toast(`תבנית "${name}" נשמרה ✓`, 'success');
}

export function deleteTemplatePrompt(id) {
    if (!canEditTemplates()) { toast('אין הרשאה למחוק תבניות', 'error'); return; }
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

    const id           = uid();
    const t            = today();
    const targetFolder = folderName || null;
    S.reports[id] = {
        id, title: tpl.name, customer: '', site: '',
        visitDate: t, number: '', startTime: '', endTime: '', totalHours: '',
        serviceType:      tpl.serviceType || '',
        periodicInterval: '',
        permComments:     tpl.permComments || '',
        tasks: tpl.tasks.map(tk => {
            if (tk.type === 'section') return { id: 'sec_' + (++S.taskCounter), type: 'section', title: tk.title };
            if (tk.type === 'range')   return { id: 'tk_' + (++S.taskCounter), type: 'range', description: tk.description, minValue: tk.minValue ?? null, maxValue: tk.maxValue ?? null, unit: tk.unit || '', reading: null, status: 'pending', comments: '' };
            return { id: 'tk_' + (++S.taskCounter), type: 'task', description: tk.description, status: 'pending', comments: '' };
        }),
        appendices: (tpl.appendices || []).map(app => ({
            id: app.id, title: app.title, fileName: app.fileName,
            fileSize: app.fileSize, fileType: app.fileType, fileData: app.fileData,
        })),
        images: [],
        tech: { name: _techName(), compDate: t, sig: '' },
        folder:    targetFolder,
        createdBy: S.currentUser?.email || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    if (targetFolder) {
        if (!S.folders[targetFolder]) S.folders[targetFolder] = [];
        S.folders[targetFolder].push(id);
    }
    persist();
    openReport(id);
    renderSidebar();
    toast(`דוח נוצר מתבנית "${tpl.name}"`, 'success');

    await _finalizeNewReport(id, 'הדוח נוצר אך לא נשמר בשרת – נסה לשמור שוב');
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
    if (!canEditTemplates()) { toast('אין הרשאה לשמור תבניות', 'error'); return; }

    await saveReport();
    if (!S.currentId) { toast('שגיאה בשמירת הדוח', 'error'); return; }
    const r = S.reports[S.currentId];
    if (!r) { toast('שגיאה: הדוח לא נמצא', 'error'); return; }

    const id = uid();
    S.templates[id] = {
        id, name,
        folder:       r.folder       || null,
        serviceType:  r.serviceType  || '',
        permComments: r.permComments || '',
        tasks: (r.tasks || []).map(t => {
            if (t.type === 'section') return { type: 'section', title: t.title || '' };
            if (t.type === 'range')   return {
                type:        'range',
                description: t.description || '',
                minValue:    t.minValue  ?? null,
                maxValue:    t.maxValue  ?? null,
                unit:        t.unit      || '',
            };
            return { type: 'task', description: t.description || '', comments: '' };
        }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    try {
        persist();
        renderSidebar();
        hideModal('saveTplModal');
        toast('הדוח נשמר כתבנית בהצלחה!', 'success');
    } catch (e) {
        console.error('[SAVE_TPL]', e);
        toast('שגיאה בשמירת התבנית – נסה שוב', 'error');
    }
}

/* ================================================================
   HELPERS
================================================================ */
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
    if (!isAdmin()) { toast('רק מנהל מערכת יכול ליצור תיקיות', 'error'); return; }
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

    document.getElementById('folderOptList').innerHTML = names.map(name =>
        `<div class="folder-opt ${name === cur ? 'selected' : ''}" onclick="moveToFolder('${esc(name)}')">${esc(name)}</div>`
    ).join('');
    showModal('moveFolderModal');
}

export function moveToFolder(name) {
    if (!S.currentId) return;
    for (const fn in S.folders) S.folders[fn] = S.folders[fn].filter(x => x !== S.currentId);
    if (!S.folders[name]) S.folders[name] = [];
    S.folders[name].push(S.currentId);
    if (S.reports[S.currentId]) S.reports[S.currentId].folder = name;
    persist();
    renderSidebar();
    hideModal('moveFolderModal');
    toast(`הדוח הועבר לתיקייה "${name}"`, 'success');
}

export function renameFolderPrompt(name) {
    if (!isAdmin()) { toast('רק מנהל מערכת יכול לשנות שם תיקייה', 'error'); return; }
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

export function siteCodePrompt(folderName) {
    if (!isAdmin()) { toast('רק מנהל מערכת יכול לקבוע קוד אתר', 'error'); return; }
    S.pendingSiteCodeFolder = folderName;
    document.getElementById('siteCodeInput').value = S.siteCodes?.[folderName] || '';
    showModal('siteCodeModal');
    setTimeout(() => document.getElementById('siteCodeInput').focus(), 80);
}

export async function confirmSiteCode() {
    const folderName = S.pendingSiteCodeFolder;
    const code = document.getElementById('siteCodeInput').value.trim();
    if (!folderName) return;
    try {
        await apiSetSiteCode(folderName, code);
        hideModal('siteCodeModal');
        toast(code ? `קוד אתר נקבע: ${code.toUpperCase()}` : 'מספור אוטומטי בוטל לתיקייה זו', 'success');
    } catch (e) {
        toast('שמירת קוד האתר נכשלה', 'error');
    }
}

export function deleteFolderPrompt(name) {
    if (!isAdmin()) { toast('רק מנהל מערכת יכול למחוק תיקיות', 'error'); return; }
    const hasReports   = (S.folders[name] || []).some(id => S.reports[id]);
    const hasTemplates = Object.values(S.templates).some(t => t.folder === name);
    const hasProcs     = ((S.procedures || {})[name] || []).length > 0;

    if (hasReports || hasTemplates || hasProcs) {
        toast('לא ניתן למחוק תיקייה שמכילה דוחות, תבניות או נהלים. יש לרוקן אותה תחילה.', 'error');
        return;
    }

    S.pendingDeleteFolder = name;
    document.getElementById('deleteFolderMsg').textContent = `האם אתה בטוח שברצונך למחוק את התיקייה "${name}"?`;
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
   IMPORT – DOCUMENT UPLOAD
================================================================ */
export function onDocumentFilePicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('docFilePreview').textContent = file.name;
    document.getElementById('docUploadBtn').disabled      = false;
}

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
    const ext  = file.name.split('.').pop().toLowerCase();
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
        const data  = JSON.parse(text);
        const list  = Array.isArray(data) ? data : [data];
        const toSave = [];
        let lastId   = null;
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
        for (const r of toSave) {
            try { const saved = await apiSaveReport(r); r._backendId = saved.id; } catch {}
        }
    } catch { toast('שגיאה בקריאת JSON', 'error'); }
}

export function importExcel(buffer, filename) {
    try {
        const wb   = XLSX.read(buffer, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        let startRow = 0;
        if (rows.length && typeof rows[0][0] === 'string') {
            const first = (rows[0][0] || '').toString().trim().toLowerCase();
            if (['משימה','task','תיאור','description','שם','name','פעולה'].some(h => first.includes(h))) startRow = 1;
        }
        const tasks = [];
        for (let i = startRow; i < rows.length; i++) {
            const row  = rows[i];
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
        showImportPreview(filename, lines.map(l => ({ description: l, comments: '' })), 'Word');
    }).catch(err => toast('שגיאה בקריאת Word: ' + err.message, 'error'));
}

export function showImportPreview(name, tasks, type) {
    S.importParsed = { name, tasks };
    document.getElementById('importPreviewInfo').textContent = `יובאו ${tasks.length} משימות מקובץ ${type}`;
    document.getElementById('importPreviewName').value       = name;
    document.getElementById('importPreviewList').innerHTML   = tasks.map((t, i) =>
        `<div class="preview-item">
            <span class="preview-item-num">${i+1}</span>
            <span>${esc(t.description)}</span>
            ${t.comments ? `<span style="color:var(--slate-400);font-size:11px;margin-right:auto;">${esc(t.comments)}</span>` : ''}
        </div>`
    ).join('');
    const asWhat = _importDefaultAs;
    _importDefaultAs = 'report';
    document.querySelector(`input[name="importAs"][value="${asWhat}"]`).checked = true;
    showModal('importPreviewModal');
}

export async function confirmImport() {
    if (!S.importParsed) return;
    const name   = document.getElementById('importPreviewName').value.trim() || S.importParsed.name;
    const asWhat = document.querySelector('input[name="importAs"]:checked').value;
    const tasks  = S.importParsed.tasks;

    if (asWhat === 'template') {
        if (!canEditTemplates()) { toast('אין הרשאה לערוך תבניות', 'error'); return; }
        const id = uid();
        S.templates[id] = {
            id, name, folder: S.currentFolder || null, permComments: '',
            tasks: tasks.map(t => ({ description: t.description, comments: t.comments || '' })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        persist();
        renderSidebar();
        hideModal('importPreviewModal');
        toast(`תבנית "${name}" נשמרה ✓`, 'success');
        if (S.currentFolder) showFolderContent(S.currentFolder);
    } else {
        const id = uid();
        const t  = today();
        S.reports[id] = {
            id, title: name, customer: '', site: '',
            visitDate: t, number: '', permComments: '',
            tasks: tasks.map(tk => ({
                id: 'tk_' + (++S.taskCounter),
                description: tk.description, status: 'pending', comments: tk.comments || '',
            })),
            images: [], tech: { name: _techName(), compDate: t, sig: '' },
            folder: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        persist();
        openReport(id);
        renderSidebar();
        hideModal('importPreviewModal');
        toast(`דוח "${name}" יובא ✓`, 'success');
        await _finalizeNewReport(id, 'הדוח יובא אך לא נשמר בשרת – נסה לשמור שוב');
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
   ASSET MOVE / COPY
================================================================ */
export function showAssetMoveModal(type, id, action) {
    const names = Object.keys(S.folders);
    if (!names.length) { toast('אין תיקיות. צור תיקייה קודם.', 'error'); return; }
    _pendingAssetAction = { type, id, action };
    const titleEl = document.getElementById('assetMoveTitle');
    if (titleEl) titleEl.textContent = action === 'move' ? '📁 העבר לתיקייה' : '📁 העתק לתיקייה';
    let currentFolder = null;
    if (type === 'report') {
        for (const fn in S.folders) { if ((S.folders[fn] || []).includes(id)) { currentFolder = fn; break; } }
    } else if (type === 'template') {
        currentFolder = S.templates[id]?.folder || null;
    }
    const list = document.getElementById('assetMoveList');
    if (list) {
        list.innerHTML = names.map(name =>
            `<div class="folder-opt ${name === currentFolder ? 'selected' : ''}" onclick="executeAssetAction('${esc(name)}')">${esc(name)}</div>`
        ).join('');
    }
    showModal('assetMoveModal');
}

export function executeAssetAction(toFolder) {
    const pending = _pendingAssetAction;
    if (!pending) return;
    _pendingAssetAction = null;
    hideModal('assetMoveModal');
    if (pending.action === 'move') _moveAsset(pending.type, pending.id, toFolder);
    else                           _copyAsset(pending.type, pending.id, toFolder);
}

function _moveAsset(type, id, toFolder) {
    if (type === 'report') {
        for (const fn in S.folders) S.folders[fn] = S.folders[fn].filter(x => x !== id);
        if (!S.folders[toFolder]) S.folders[toFolder] = [];
        S.folders[toFolder].push(id);
        if (S.reports[id]) S.reports[id].folder = toFolder;
        persist();
        renderSidebar();
        if (S.currentFolder) showFolderContent(S.currentFolder); else showDashboard();
        toast(`הדוח הועבר לתיקייה "${toFolder}"`, 'success');
    } else if (type === 'template') {
        if (!canEditTemplates()) { toast('אין הרשאה לערוך תבניות', 'error'); return; }
        if (!S.templates[id]) return;
        S.templates[id].folder = toFolder;
        persist();
        renderSidebar();
        if (S.currentFolder) showFolderContent(S.currentFolder); else showDashboard();
        toast(`התבנית הועברה לתיקייה "${toFolder}"`, 'success');
    }
}

async function _copyAsset(type, id, toFolder) {
    if (type === 'report') {
        const orig = S.reports[id];
        if (!orig) return;
        const newId = uid();
        const now   = new Date().toISOString();
        S.reports[newId] = { ...orig, id: newId, folder: toFolder, createdAt: now, updatedAt: now };
        delete S.reports[newId]._backendId;
        if (!S.folders[toFolder]) S.folders[toFolder] = [];
        S.folders[toFolder].push(newId);
        persist();
        renderSidebar();
        if (S.currentFolder) showFolderContent(S.currentFolder); else showDashboard();
        toast(`הדוח הועתק לתיקייה "${toFolder}"`, 'success');
        try {
            const saved = await apiSaveReport(S.reports[newId]);
            S.reports[newId]._backendId = saved.id;
        } catch (e) {
            toast('הדוח הועתק אך לא נשמר בשרת – נסה לשמור שוב', 'error');
        }
    } else if (type === 'template') {
        if (!canEditTemplates()) { toast('אין הרשאה לערוך תבניות', 'error'); return; }
        const orig = S.templates[id];
        if (!orig) return;
        const newId = uid();
        const now   = new Date().toISOString();
        S.templates[newId] = { ...orig, id: newId, folder: toFolder, createdAt: now, updatedAt: now };
        persist();
        renderSidebar();
        if (S.currentFolder) showFolderContent(S.currentFolder); else showDashboard();
        toast(`התבנית הועתקה לתיקייה "${toFolder}"`, 'success');
    }
}

/* ================================================================
   IMPORT AS TEMPLATE
================================================================ */
export function importAsTemplate(folderName) {
    if (!canEditTemplates()) { toast('אין הרשאה לערוך תבניות', 'error'); return; }
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.xlsx,.xls,.docx,.doc';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = (e) => {
        try { document.body.removeChild(input); } catch {}
        const file = e.target.files[0];
        if (!file) return;
        _importDefaultAs = 'template';
        const ext  = file.name.split('.').pop().toLowerCase();
        const name = file.name.replace(/\.[^.]+$/, '');
        if (['xlsx', 'xls'].includes(ext)) {
            const fr = new FileReader(); fr.onload = ev => importExcel(ev.target.result, name); fr.readAsArrayBuffer(file);
        } else if (['docx', 'doc'].includes(ext)) {
            const fr = new FileReader(); fr.onload = ev => importWord(ev.target.result, name); fr.readAsArrayBuffer(file);
        } else {
            _importDefaultAs = 'report';
            toast('סוג קובץ לא נתמך', 'error');
        }
    };
    input.oncancel = () => { try { document.body.removeChild(input); } catch {} };
    input.click();
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

    const subject   = encodeURIComponent(`דוח שירות – ${r.title || ''}${r.customer ? ' – ' + r.customer : ''}`);
    const bodyLines = [
        'שלום,', 'מצורף דוח שירות:', '',
        `שם הדוח: ${r.title || ''}`,
        r.customer  ? `לקוח: ${r.customer}`            : '',
        r.site      ? `אתר: ${r.site}`                 : '',
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

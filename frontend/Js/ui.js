import { S, esc, escHtml, fmtDate, fileIcon, formatFileSize, today, apiDeleteAttachment, apiUploadProcedure, apiDeleteProcedure, isAdmin, canEditReport, canEditTemplates, computeReportStatus, SERVICE_TYPES, countByServiceType, apiSubscribeSiteCode, apiSetSiteCode, REPORT_TYPE_LABELS } from './api.js';
import { renumberTplTasks } from './components/taskComponent.js';
import { buildLogBoard }     from './components/folderBoard.js';

/* Re-export all task & template functions so existing imports from this
   module continue to resolve without changes in reports.js or app.js. */
export {
    appendTask, appendSectionTitle,
    addTask, addRangeTask, addSectionTitle,
    taskCount, updateTaskCount,
    removeTask, setStatus,
    duplicateTask, updateTaskBulkBar, clearTaskSelection, duplicateSelectedTasks,
    collectTasks, renderTasks,
    renderTplTasks,
    appendTplTask, appendTplSection,
    addTplTask, addTplSection,
    appendTplRangeTask, addTplRangeTask,
    tplTaskCount, renumberTplTasks,
    duplicateTplTask, updateTplTaskBulkBar, clearTplTaskSelection, duplicateSelectedTplTasks,
} from './components/taskComponent.js';

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
    _initOnePad('signatureCanvas',   'pad',         140);
    _initOnePad('customerSigCanvas', 'customerPad', 160);
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
/** Ring-chart color per report type — daily_log/weld_inspection aren't part
 *  of the 4-way SERVICE_TYPES breakdown (they fall into the ring chart's
 *  "other" bucket there), but still get a real badge color on cards. */
const _TYPE_COLOR = { routine: 'blue', fault: 'red', extra: 'amber', other: 'slate', daily_log: 'slate', weld_inspection: 'slate' };

function _buildReportCards(reports, showActions = false) {
    const statusLabel = { pending: 'ממתין', in_progress: 'בתהליך', completed: 'הושלם' };
    const statusClass = { pending: 'dash-status-pending', in_progress: 'dash-status-progress', completed: 'dash-status-done' };
    return reports.map(r => {
        const status = computeReportStatus(r);
        const tasks  = (r.tasks || []).filter(t => t.type !== 'section');
        const done   = tasks.filter(t => t.status && t.status !== 'pending').length;
        const safeId    = esc(r.id);
        const safeTitle = esc(r.title || 'ללא שם');
        const typeColor = _RING_HEX[_TYPE_COLOR[r.serviceType] || 'slate'];
        const typeLabel = REPORT_TYPE_LABELS[r.serviceType] || '';
        const actionsHtml = showActions ? `
            <div class="card-actions-desktop" style="display:flex;gap:6px;margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);">
                <button class="dash-card-action-btn" onclick="event.stopPropagation();showAssetMoveModal('report','${safeId}','move')">העבר</button>
                <button class="dash-card-action-btn" onclick="event.stopPropagation();showAssetMoveModal('report','${safeId}','copy')">העתק</button>
            </div>
            <div class="mobile-dots-wrap" onclick="event.stopPropagation()">
                <select class="mobile-dots-select" onchange="handleReportSelect(this,'${safeId}')">
                    <option value="">⋮</option>
                    <option value="open">פתח דוח</option>
                    <option value="move">העבר</option>
                    <option value="copy">העתק</option>
                    <option value="delete">מחק</option>
                </select>
            </div>` : '';
        return `
            <div class="dash-card" onclick="openReport('${safeId}')">
                <button class="dash-card-delete card-actions-desktop" title="מחק דוח" onclick="event.stopPropagation();if(confirm('למחוק את הדוח &quot;${safeTitle}&quot;?')){deleteReportById('${safeId}')}">✕</button>
                ${typeLabel ? `<div class="dash-card-type" style="color:${typeColor};background:${typeColor}1f;">${typeLabel}</div>` : ''}
                <div class="dash-card-title">${esc(r.title || 'ללא שם')}</div>
                ${r.customer  ? `<div class="dash-card-meta">👤 ${esc(r.customer)}</div>`      : ''}
                ${r.site      ? `<div class="dash-card-meta">📍 ${esc(r.site)}</div>`          : ''}
                ${r.visitDate ? `<div class="dash-card-meta">📅 ${fmtDate(r.visitDate)}</div>` : ''}
                <div class="dash-card-footer">
                    <span class="dash-card-tasks">${tasks.length} משימות · ${done} בוצעו</span>
                    <span class="dash-status ${statusClass[status]}">${statusLabel[status]}</span>
                </div>
                ${actionsHtml}
            </div>`;
    }).join('');
}

/** Groups report cards by visit-month, current month first, then each
 *  earlier month in descending order — a month-name header sits above its
 *  group. Reports missing a visitDate fall into a trailing "ללא תאריך"
 *  group. Used everywhere report cards are listed (home dashboard, folder
 *  history) so the two can't drift apart. */
function _buildReportCardsByMonth(reports, showActions = false) {
    const NO_DATE = '0000-00'; // sorts after any real "YYYY-MM" key
    const groups = new Map();
    reports.forEach(r => {
        const key = r.visitDate ? r.visitDate.slice(0, 7) : NO_DATE;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    });

    const currentKey = today().slice(0, 7);
    const keys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
    if (keys.includes(currentKey)) {
        keys.splice(keys.indexOf(currentKey), 1);
        keys.unshift(currentKey);
    }

    return keys.map(key => {
        const monthLabel = key === NO_DATE
            ? 'ללא תאריך'
            : new Date(key + '-01').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
        const groupReports = groups.get(key).slice().sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''));
        return `
            <div class="dash-month-label">${monthLabel}</div>
            <div class="dash-grid">${_buildReportCards(groupReports, showActions)}</div>`;
    }).join('');
}

function _buildDocCards(docs) {
    return docs.map(a => {
        const icon = fileIcon(a.file_type);
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
    const tplPage = document.getElementById('tplEditorPage');
    if (tplPage) tplPage.style.display = 'none';
    updateToolbar();
    renderSidebar();
    const fab = document.getElementById('mobileFab');
    if (fab && window.innerWidth <= 768) {
        // Show FAB on home and reports tabs; hide only on equipment tab
        const activeTab = document.querySelector('.bnav-item.active')?.dataset?.tab;
        fab.classList.toggle('fab-visible', activeTab !== 'equipment');
    }
}

function _buildFolderCards(folderNames) {
    return folderNames.map(name => {
        const count = (S.folders[name] || []).filter(id => S.reports[id]).length;
        return `
            <div class="dash-folder-card" onclick="showFolderContent('${esc(name)}')">
                <div class="dash-folder-icon">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                </div>
                <div class="dash-folder-name">${esc(name)}</div>
                <div class="dash-folder-count">${count} דוחות</div>
            </div>`;
    }).join('');
}

/** Solid hex per SERVICE_TYPES color key, for the ring chart's flat
 *  segment strokes (no gradient — see buildServiceTypeChart). */
const _RING_HEX = { blue: '#3b82f6', red: '#ef4444', amber: '#f59e0b', slate: '#94a3b8' };
/** Same colors as RGB triples, for the rgba() tints used in the
 *  card's ambient glow/shadow and the chip backgrounds. */
const _RING_RGB = { blue: '59,130,246', red: '239,68,68', amber: '245,158,11', slate: '100,116,139' };

/** Service-type breakdown as a segmented ring chart, mobile-app
 *  styled (soft color-matched glow and card shadow, chip-grid legend
 *  — no gradient on the data itself). Used for a folder's full report
 *  history (all of it, no time window) and for the home dashboard's
 *  monthly breakdown — same chart, different report lists passed in,
 *  so the two can never drift apart. */
export function buildServiceTypeChart(reports, centerLabel = 'סה"כ דוחות') {
    const typeCounts = countByServiceType(reports);
    const total = reports.length;
    const active = total > 0 ? SERVICE_TYPES.filter(t => typeCounts[t.val] > 0) : [];

    const dominant = active.slice().sort((a, b) => typeCounts[b.val] - typeCounts[a.val])[0];
    const glowRgb  = _RING_RGB[dominant?.color || 'blue'];

    const r = 72, sw = 15;
    const C = 2 * Math.PI * r;
    const gap = active.length > 1 ? 6 : 0;

    let cumulative = 0;
    const segments = active.map(t => {
        const full    = (typeCounts[t.val] / total) * C;
        const visible = Math.max(0, full - gap);
        const offset  = -cumulative;
        cumulative += full;
        return `<circle cx="88" cy="88" r="${r}" fill="none" stroke="${_RING_HEX[t.color]}"
                stroke-width="${sw}" stroke-linecap="round"
                stroke-dasharray="${visible.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>`;
    }).join('');

    const chips = SERVICE_TYPES.map(t => {
        const rgb = _RING_RGB[t.color];
        return `
            <div class="ring-chip" style="background:rgba(${rgb},0.12)">
                <div class="ring-chip-icon" style="background:rgba(${rgb},0.2)"><span class="ring-chip-dot" style="background:${_RING_HEX[t.color]}"></span></div>
                <div class="ring-chip-text">
                    <div class="ring-chip-num">${typeCounts[t.val]}</div>
                    <div class="ring-chip-lbl">${t.label}</div>
                </div>
            </div>`;
    }).join('');

    return `
        <div class="ring-card" style="margin-bottom:20px; box-shadow: 0 20px 40px -18px rgba(${glowRgb},0.35), 0 6px 16px -6px rgba(0,0,0,0.4);">
            <div class="ring-chart-stage">
                <div class="ring-glow" style="background: radial-gradient(circle, rgba(${glowRgb},0.22) 0%, rgba(${glowRgb},0) 70%);"></div>
                <svg width="176" height="176" viewBox="0 0 176 176" role="img" aria-label="פילוח ${total} דוחות לפי סוג טיפול">
                    <title>פילוח דוחות לפי סוג טיפול</title>
                    <g transform="rotate(-90 88 88)">
                        <circle cx="88" cy="88" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="${sw}"/>
                        ${segments}
                    </g>
                </svg>
                <div class="ring-center-stat">
                    <div class="ring-center-num">${total}</div>
                    <div class="ring-center-pill" style="background:rgba(${glowRgb},0.16); color:${_RING_HEX[dominant?.color || 'blue']};">${centerLabel}</div>
                </div>
            </div>
            <div class="ring-chips">${chips}</div>
        </div>`;
}

let _dashVisibleCount = 30;
let _siteCodeUnsub = null;

export function showDashboard() {
    _dashVisibleCount = 30;
    _renderDashboard();
}

export function loadMoreDashboardReports() {
    _dashVisibleCount += 30;
    _renderDashboard();
}

function _renderDashboard() {
    S.currentFolder = null;
    _showContentView();
    const container  = document.getElementById('dashboardView');
    const folderNames = Object.keys(S.folders);
    const reports = Object.values(S.reports)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    let html = `
        <div class="dash-header">
            <h2 class="dash-title">תיקיות</h2>
            ${isAdmin() ? `<button class="dash-new-folder-btn" onclick="showModal('createFolderModal')">תיקייה חדשה</button>` : ''}
        </div>`;

    if (folderNames.length) {
        html += `<div class="dash-folder-grid">${_buildFolderCards(folderNames)}</div>`;
    } else {
        html += `<p class="dash-folders-empty">אין תיקיות עדיין.</p>`;
    }

    if (reports.length) {
        const shown     = Math.min(_dashVisibleCount, reports.length);
        const remaining = reports.length - shown;
        html += `
            <div class="dash-header" style="margin-top:28px;">
                <h2 class="dash-title">דוחות אחרונים</h2>
                <span class="dash-count">${remaining > 0 ? `מוצגים ${shown} מתוך ${reports.length}` : `${reports.length} סה"כ`}</span>
            </div>
            ${_buildReportCardsByMonth(reports.slice(0, _dashVisibleCount))}
            ${remaining > 0 ? `
            <div style="display:flex;justify-content:center;margin-top:16px;">
                <button class="dash-new-folder-btn" onclick="loadMoreDashboardReports()">טען עוד (${remaining} נותרו)</button>
            </div>` : ''}`;
    } else {
        html += `
            <div class="dash-empty">
                <h2>אין דוחות עדיין</h2>
                <p>לחץ <strong>"דוח חדש"</strong> כדי להתחיל</p>
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

/** Derives this folder's currently-open faults from its own report
 *  history — no separate data model, no AI, just the existing task
 *  statuses. A recurring check item (matched by its description text
 *  — reports created from the same template reuse the exact same
 *  wording) is "open" as long as its MOST RECENT dated occurrence in
 *  this folder is still not_performed/out_of_range/under_review; the
 *  moment a later report shows that same description marked OK, it
 *  drops off this list automatically. Only scans r.tasks — daily_log
 *  and weld_inspection reports use their own separate structures and
 *  aren't covered here. */
function _computeOpenFaults(reports) {
    const bySignature = new Map();
    reports.forEach(r => {
        const reportDate = r.visitDate || r.createdAt || '';
        (r.tasks || []).forEach(t => {
            if (t.type === 'section' || !t.description) return;
            const sig = t.description.trim().replace(/\s+/g, ' ');
            if (!sig) return;
            const existing = bySignature.get(sig);
            if (!existing || reportDate > existing.reportDate) {
                bySignature.set(sig, {
                    description: sig,
                    status:      t.status || 'pending',
                    comments:    t.comments || '',
                    reportId:    r.id,
                    reportTitle: r.title || 'דוח',
                    reportDate,
                    techName:    r.tech?.name || '',
                });
            }
        });
    });

    const OPEN_STATUSES = new Set(['not_performed', 'out_of_range', 'under_review']);
    return Array.from(bySignature.values())
        .filter(f => OPEN_STATUSES.has(f.status))
        .sort((a, b) => {
            const rank = s => s === 'under_review' ? 1 : 0;
            if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
            return (b.reportDate || '').localeCompare(a.reportDate || '');
        });
}

const _FAULT_STATUS_META = {
    not_performed: { label: 'לא תקין', cls: 'not-performed' },
    out_of_range:  { label: 'חריג',    cls: 'not-performed' },
    under_review:  { label: 'בבדיקה',  cls: 'under-review'  },
};

function _buildFaultsPanel(openFaults) {
    if (!openFaults.length) {
        return `<div class="dash-empty"><div class="dash-empty-icon">✅</div><p>אין תקלות פתוחות בתיקייה זו כרגע.</p></div>`;
    }
    return `<div class="fault-list">` + openFaults.map(f => {
        const meta = _FAULT_STATUS_META[f.status] || { label: f.status, cls: '' };
        return `
            <div class="fault-card ${meta.cls}" onclick="openReport('${esc(f.reportId)}')">
                <div class="fault-card-top">
                    <span class="fault-status-badge ${meta.cls}">${meta.label}</span>
                    <span class="fault-date">${fmtDate(f.reportDate)}</span>
                </div>
                <div class="fault-desc">${esc(f.description)}</div>
                ${f.comments ? `<div class="fault-comment">${esc(f.comments)}</div>` : ''}
                <div class="fault-meta">
                    <span>${esc(f.reportTitle)}</span>
                    ${f.techName ? `<span> · ${esc(f.techName)}</span>` : ''}
                </div>
            </div>`;
    }).join('') + `</div>`;
}

export async function showFolderContent(folderName) {
    S.currentFolder = folderName;
    _showContentView();
    const container = document.getElementById('dashboardView');

    if (_siteCodeUnsub) { _siteCodeUnsub(); _siteCodeUnsub = null; }

    container.innerHTML = `
        <div class="site-topbar">
            <button class="site-back-btn" onclick="showDashboard()">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleX(-1)"><polyline points="9 18 15 12 9 6"/></svg>
                חזור לתיקיות
            </button>
            <h2 class="site-title">${esc(folderName)}</h2>
        </div>
        <div class="dash-empty" style="opacity:.5"><p>טוען...</p></div>`;

    const ids     = (S.folders[folderName] || []).filter(id => S.reports[id]);
    const reports = ids.map(id => S.reports[id])
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const docs    = S.attachments[folderName] || [];
    const totalReports = reports.length + docs.length;

    // ── Faults tab content ─────────────────────────────────────────
    const openFaults = _computeOpenFaults(reports);
    const faultsHtml = _buildFaultsPanel(openFaults);

    // ── History tab content ───────────────────────────────────────
    let historyHtml = '';
    if (!reports.length && !docs.length) {
        historyHtml = `
            <div class="dash-empty">
                <div class="dash-empty-icon">📂</div>
                <p>תיקייה זו ריקה. צור דוח חדש או הזז דוח קיים לכאן.</p>
            </div>`;
    } else {
        if (reports.length) {
            historyHtml += buildServiceTypeChart(reports);
            historyHtml += _buildReportCardsByMonth(reports, true);
        }
        if (docs.length)    historyHtml += `
            <div class="dash-section-label" style="margin-top:${reports.length ? '28px' : '0'}">מסמכים</div>
            <div class="dash-grid">${_buildDocCards(docs)}</div>`;
    }

    // ── Templates tab content ─────────────────────────────────────
    const safeFolderName = esc(folderName);
    const folderTpls = Object.values(S.templates).filter(t => t.folder === folderName);

    const canEditTpl = canEditTemplates();

    function _tplCard(t) {
        const safeId = esc(t.id);
        return `
            <div class="site-tpl-card">
                <div class="site-tpl-icon">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="12" y2="15"/></svg>
                </div>
                <div class="site-tpl-info">
                    <div class="site-tpl-name">${esc(t.name)}</div>
                    <div class="site-tpl-meta">${t.tasks?.length || 0} משימות</div>
                </div>
                <div class="card-actions-desktop" style="display:flex;gap:6px;flex-shrink:0;align-items:center">
                    <button class="site-tpl-btn" onclick="createReportFromTemplate('${safeId}','${safeFolderName}')">דוח</button>
                    ${canEditTpl ? `
                    <button class="site-tpl-btn" onclick="showTemplateEditor('${safeId}','${safeFolderName}')">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="site-tpl-btn" title="העבר תבנית" onclick="showAssetMoveModal('template','${safeId}','move')">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                    </button>
                    <button class="site-tpl-btn" title="העתק תבנית" onclick="showAssetMoveModal('template','${safeId}','copy')">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    </button>
                    <button class="site-tpl-btn site-tpl-btn-del" onclick="deleteTemplatePrompt('${safeId}')" title="מחק תבנית">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>` : ''}
                </div>
                <div class="mobile-dots-wrap">
                    <select class="mobile-dots-select" onchange="handleTplSelect(this,'${safeId}','${safeFolderName}')">
                        <option value="">⋮</option>
                        <option value="newReport">דוח</option>
                        ${canEditTpl ? `
                        <option value="edit">עריכה</option>
                        <option value="move">העבר</option>
                        <option value="copy">העתק</option>
                        <option value="delete">מחק</option>` : ''}
                    </select>
                </div>
            </div>`;
    }

    const newTplBtn = canEditTpl ? `
        <div style="display:flex;gap:8px;margin-bottom:16px;">
            <button class="dash-new-folder-btn" style="flex:1" onclick="showTemplateEditor(null,'${safeFolderName}')">תבנית חדשה</button>
            <button class="dash-new-folder-btn" style="white-space:nowrap;padding:7px 16px;" onclick="importAsTemplate('${safeFolderName}')">ייבוא</button>
        </div>` : '';

    let templatesHtml = newTplBtn;
    if (!folderTpls.length) {
        templatesHtml += canEditTpl
            ? `<div class="dash-empty"><p>אין תבניות עדיין. לחץ "תבנית חדשה" ליצירה.</p></div>`
            : `<div class="dash-empty"><p>אין תבניות בתיקייה זו.</p></div>`;
    } else {
        templatesHtml += `<div class="site-tpl-list">${folderTpls.map(_tplCard).join('')}</div>`;
    }

    // ── Procedures tab content ────────────────────────────────────
    const proceduresHtml = _buildProceduresPanel(folderName);

    // ── Log board tab content (folderBoard module) ────────────────
    const logBoardHtml = buildLogBoard(folderName);

    // ── Assemble full view ────────────────────────────────────────
    const safeFN = esc(folderName);
    container.innerHTML = `
        <div class="site-topbar">
            <button class="site-back-btn" onclick="showDashboard()">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform:scaleX(-1)"><polyline points="9 18 15 12 9 6"/></svg>
                חזור לתיקיות
            </button>
            <h2 class="site-title">${esc(folderName)}</h2>
            <span class="site-code-badge hidden" id="siteCodeBadge"></span>
            ${totalReports ? `<span class="dash-count">${totalReports}</span>` : ''}
            ${isAdmin() ? `
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
            </div>` : ''}
        </div>

        <div class="site-tabs" role="tablist">
            <button class="site-tab active" role="tab" data-tab="history"    onclick="switchFolderTab('history')">היסטוריית דו״חות</button>
            <button class="site-tab"        role="tab" data-tab="faults"     onclick="switchFolderTab('faults')">תקלות${openFaults.length ? `<span class="site-tab-badge">${openFaults.length}</span>` : ''}</button>
            <button class="site-tab"        role="tab" data-tab="templates"  onclick="switchFolderTab('templates')">תבניות</button>
            <button class="site-tab"        role="tab" data-tab="procedures" onclick="switchFolderTab('procedures')">נהלים</button>
            <button class="site-tab"        role="tab" data-tab="logboard"   onclick="switchFolderTab('logboard')">לוח טיפולים</button>
        </div>

        <div class="site-panel" data-panel="history">${historyHtml}</div>
        <div class="site-panel hidden" data-panel="faults">${faultsHtml}</div>
        <div class="site-panel hidden" data-panel="templates">${templatesHtml}</div>
        <div class="site-panel hidden" data-panel="procedures">${proceduresHtml}</div>
        <div class="site-panel hidden" data-panel="logboard">${logBoardHtml}</div>`;

    _siteCodeUnsub = apiSubscribeSiteCode(folderName, (code) => {
        S.siteCodes[folderName] = code;
        const badge = document.getElementById('siteCodeBadge');
        if (!badge) return;
        const admin = isAdmin();
        if (!code && !admin) { badge.classList.add('hidden'); return; }
        badge.classList.remove('hidden');
        badge.textContent = code ? `קוד אתר: ${code}` : 'הגדר קוד אתר למספור אוטומטי';
        if (admin) {
            badge.classList.add('site-code-badge-editable');
            badge.onclick = () => window.siteCodePrompt(folderName);
        }
    });
}

/* ================================================================
   PROCEDURES
================================================================ */
function _buildProceduresPanel(folderName) {
    const _seen = new Set();
    const procs = (S.procedures[folderName] || [])
        .filter(p => { if (!p.id || _seen.has(p.id)) return false; _seen.add(p.id); return true; })
        .sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''));
    const safeName = esc(folderName);

    let html = `
        <button class="dash-new-folder-btn" style="margin-bottom:16px" onclick="uploadProcedure('${safeName}')">
            הוסף נוהל
        </button>`;

    if (!procs.length) {
        html += `<div class="dash-empty" style="min-height:160px"><p>אין נהלים מצורפים לאתר זה עדיין.</p></div>`;
    } else {
        html += `<div class="site-tpl-list">` +
            procs.map(p => {
                const icon   = fileIcon(p.file_type);
                const safeId = esc(p.id || '');
                const rawUrl = p.file_path || '';
                const ext    = (p.filename || '').split('.').pop().toLowerCase();
                const viewUrl = ['xlsx', 'xls', 'docx', 'doc'].includes(ext)
                    ? 'https://docs.google.com/viewer?url=' + encodeURIComponent(rawUrl) + '&embedded=true'
                    : rawUrl;
                return `
                    <a href="${esc(viewUrl)}" target="_blank" rel="noopener noreferrer" class="site-tpl-card proc-card">
                        <div class="proc-file-icon">${icon}</div>
                        <div class="site-tpl-info proc-info">
                            <div class="site-tpl-name">${esc(p.filename)}</div>
                            <div class="site-tpl-meta">${formatFileSize(p.file_size || 0)} · ${fmtDate(p.uploaded_at)}</div>
                        </div>
                        <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
                            <button class="site-tpl-btn site-tpl-btn-del"
                                onclick="event.preventDefault();event.stopPropagation();deleteProcedure('${safeId}','${safeName}')" title="מחק">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </button>
                        </div>
                    </a>`;
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

            const panel = document.querySelector('[data-panel="procedures"]');
            if (panel) {
                panel.innerHTML = `
                    <div class="proc-uploading">
                        <div class="proc-spinner"></div>
                        <span>מעלה מסמך...</span>
                    </div>`;
            }

            try {
                await apiUploadProcedure(file, folderName);
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
    const isReport = mode === 'report';
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('emptyState').style.display   = 'none';
    document.getElementById('reportEditor').style.display = 'block';
    document.getElementById('cardImages').style.display        = isReport ? '' : 'none';
    document.getElementById('cardTech').style.display          = isReport ? '' : 'none';
    document.getElementById('cardFinalComments').style.display = isReport ? '' : 'none';
    document.getElementById('cardCustomerSig').style.display   = isReport ? '' : 'none';
    document.getElementById('cardDetails').querySelector('#fCustomer').closest('.fg').style.display   = isReport ? '' : 'none';
    document.getElementById('cardDetails').querySelector('#fVisitDate').closest('.fg').style.display  = isReport ? '' : 'none';
    document.getElementById('cardDetails').querySelector('#fNumber').closest('.fg').style.display     = isReport ? '' : 'none';
    document.querySelectorAll('.status-btns').forEach(el => el.style.display = isReport ? '' : 'none');
    document.querySelectorAll('.task-reading-wrap').forEach(el => el.style.display = isReport ? '' : 'none');
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

    for (const file of files) {
        try {
            const dataUrl = await _processImageFile(file);
            r.images.push(dataUrl);
            renderImages(r.images);
            markUnsaved();
        } catch (err) {
            console.error('[IMG] error for', file.name, err);
            const isHeic = /\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type);
            toast(isHeic ? 'פורמט HEIC אינו נתמך במכשיר זה – שתף את התמונה תחילה ל-JPEG' : 'שגיאה בעיבוד התמונה', 'error');
        }
    }
}

async function _processImageFile(file) {
    // Always compress & convert to JPEG — ensures format conversion from HEIC/WebP/etc.
    const opts = { maxWidthOrHeight: 1920, useWebWorker: true, initialQuality: 0.82, fileType: 'image/jpeg' };
    try {
        const blob = await imageCompression(file, opts);
        const dataUrl = await imageCompression.getDataUrlFromFile(blob);
        console.log('[IMG] compressed:', file.name, `→ ${(blob.size/1024/1024).toFixed(1)}MB`);
        return dataUrl;
    } catch (libErr) {
        console.warn('[IMG] library compression failed, trying canvas fallback:', libErr.message);
    }
    // Canvas fallback via createImageBitmap — supports JPEG/PNG/WebP/GIF on all modern browsers
    const bitmap = await createImageBitmap(file);
    let w = bitmap.width, h = bitmap.height;
    const MAX = 1920;
    if (w > MAX || h > MAX) {
        const scale = MAX / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    console.log('[IMG] canvas fallback OK:', file.name, `${w}×${h}`);
    return canvas.toDataURL('image/jpeg', 0.82);
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
    if (!appendices || appendices.length === 0) { card.style.display = 'none'; return; }
    card.style.display = '';
    appendices.forEach(app => {
        const block = document.createElement('div');
        block.className       = 'report-appendix-block';
        block.dataset.appId   = app.id;
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

    if (fileType.includes('image') || fileType.includes('pdf')) {
        const win = window.open();
        if (fileType.includes('image')) {
            win.document.write(`<html><body style="margin:0;background:#000"><img src="${fileData}" style="max-width:100%;display:block;margin:auto"></body></html>`);
        } else {
            win.document.write(`<html><body style="margin:0"><embed src="${fileData}" type="application/pdf" width="100%" height="100%"></body></html>`);
        }
        return;
    }

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
    div.className      = 'appendix-editor-block';
    div.dataset.appId  = app.id;
    div.dataset.fileData = app.fileData || '';
    div.dataset.fileType = app.fileType || '';
    div.innerHTML = `
        <span class="appendix-file-icon">${fileIcon(app.fileType || '')}</span>
        <div class="appendix-file-info">
            <div class="appendix-file-name">${escHtml(app.fileName || app.title || '')}</div>
            <div class="appendix-file-size">${app.fileSize || ''}</div>
        </div>
        <button class="appendix-item-del" onclick="this.closest('.appendix-editor-block').remove()" title="הסר">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
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

    Object.keys(S.folders).forEach(name => {
        const ids = (S.folders[name] || []).filter(id => S.reports[id]);
        const fi  = document.createElement('div');
        fi.className = 'folder-item';

        const reportsHtml = ids.map(id => {
            const r   = S.reports[id];
            const act = id === S.currentId;
            return `<div class="row-item ${act?'active':''}" onclick="openReport('${id}')">
                        <span class="row-name">${esc(r.title||'ללא שם')}</span>
                        <div class="rbtns" onclick="event.stopPropagation()">
                            <button class="rbn" title="מחק" onclick="if(confirm('למחוק דוח זה?')){deleteReportById('${id}')}">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                            </button>
                        </div>
                    </div>`;
        }).join('');

        fi.innerHTML = `
            <div class="folder-hdr" onclick="toggleFolder(this)">
                <span class="folder-name" onclick="event.stopPropagation();navToFolder('${esc(name)}')">${esc(name)}</span>
                <span class="folder-badge">${ids.length}</span>
                <div class="folder-btns" onclick="event.stopPropagation()">
                    ${isAdmin() ? `
                    <button class="fbn" title="שנה שם" onclick="renameFolderPrompt('${esc(name)}')">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="fbn" title="מחק" onclick="deleteFolderPrompt('${esc(name)}')">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>` : ''}
                </div>
                <span class="folder-chevron">▶</span>
            </div>
            <div class="folder-reports">
                ${reportsHtml || '<div style="padding:5px 7px;font-size:11px;color:#3d506b;">אין דוחות</div>'}
            </div>`;
        c.appendChild(fi);
    });

    const unfiled = Object.keys(S.reports).filter(id => {
        const r = S.reports[id];
        return !r.folder || !S.folders[r.folder] || !S.folders[r.folder].includes(id);
    });
    if (unfiled.length) {
        const lbl = document.createElement('div');
        lbl.className   = 'sb-label';
        lbl.textContent = 'דו"חות אחרונים';
        c.appendChild(lbl);
        unfiled.forEach(id => {
            const r   = S.reports[id];
            const act = id === S.currentId;
            const d   = document.createElement('div');
            d.className = `row-item ${act?'active':''}`;
            d.innerHTML = `<span class="row-name">${esc(r.title||'ללא שם')}</span>
                           <div class="rbtns" onclick="event.stopPropagation()">
                               <button class="rbn" title="מחק" onclick="if(confirm('למחוק?')){deleteReportById('${id}')}">
                                   <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                               </button>
                           </div>`;
            d.onclick = () => window.openReport(id);
            c.appendChild(d);
        });
    }

    if (!Object.keys(S.folders).length && !unfiled.length) {
        c.innerHTML = '<div style="padding:18px 10px;font-size:12px;color:#3d506b;text-align:center;line-height:1.7;">עדיין אין דוחות.<br>לחץ <strong style="color:#60a5fa;">"דוח חדש"</strong> להתחלה.</div>';
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
        title.innerHTML   = 'מערכת ניהול ותחזוקה';
        mode.innerHTML    = '';
        actions.innerHTML = '';
        return;
    }

    const fab = document.getElementById('mobileFab');
    if (fab && window.innerWidth <= 768) fab.classList.remove('fab-visible');

    const r       = S.reports[S.currentId];
    const dot     = S.unsaved ? '<span class="unsaved-dot"></span>' : '';
    const editable = canEditReport(r);
    title.innerHTML = dot + esc(r?.title || 'דוח');
    mode.innerHTML  = '';

    if (editable) {
        const canTpl = canEditTemplates();
        actions.innerHTML = `
            <div class="card-actions-desktop" style="display:flex;gap:5px;align-items:center;">
                <button class="tbtn tbtn-save"     onclick="saveReport()">שמור</button>
                <button class="tbtn tbtn-pdf"      onclick="downloadPDF()">PDF</button>
                <button class="tbtn tbtn-share"    onclick="showShareModal()">שתף</button>
                ${canTpl ? `<button class="tbtn tbtn-template" onclick="showSaveAsTemplate()">שמור כתבנית</button>` : ''}
                <button class="tbtn tbtn-folder"   onclick="showMoveFolderModal()">תיקייה</button>
                <button class="tbtn tbtn-clear"    onclick="clearReport()">נקה</button>
                <button class="tbtn tbtn-delete"   onclick="deleteReportPrompt()">✕ מחק</button>
            </div>
            <div class="mobile-dots-wrap" style="flex-shrink:0;">
                <select class="mobile-dots-select" onchange="handleToolbarSelect(this)">
                    <option value="">⋮</option>
                    <option value="save">שמור</option>
                    <option value="pdf">PDF</option>
                    <option value="share">שתף</option>
                    ${canTpl ? `<option value="template">שמור כתבנית</option>` : ''}
                    <option value="folder">תיקייה</option>
                    <option value="clear">נקה</option>
                    <option value="delete">✕ מחק</option>
                </select>
            </div>`;
    } else {
        actions.innerHTML = `
            <div class="card-actions-desktop" style="display:flex;gap:5px;align-items:center;">
                <span style="font-size:11px;color:var(--amber);font-weight:700;padding:0 6px;white-space:nowrap;">📋 צפייה בלבד</span>
                <button class="tbtn tbtn-pdf"   onclick="downloadPDF()">PDF</button>
                <button class="tbtn tbtn-share" onclick="showShareModal()">שתף</button>
            </div>
            <div class="mobile-dots-wrap" style="flex-shrink:0;">
                <select class="mobile-dots-select" onchange="handleToolbarSelect(this)">
                    <option value="">⋮</option>
                    <option value="pdf">PDF</option>
                    <option value="share">שתף</option>
                </select>
            </div>`;
    }
}

/* ================================================================
   MODALS & TOASTS
================================================================ */
export function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
export function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

export function openImportAssociationModal() {
    document.getElementById('docFilePreview').textContent = 'לא נבחר קובץ';
    document.getElementById('docUploadBtn').disabled      = true;
    document.getElementById('documentInput').value        = '';
    document.getElementById('docTargetFolder').textContent = S.currentFolder || '(ללא תיקייה)';
    showModal('importAssociationModal');
}

export function toast(msg, type = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className   = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ================================================================
   MOBILE SIDEBAR
================================================================ */
export function toggleMobileSidebar() {
    const sb   = document.querySelector('.sidebar');
    const ov   = document.getElementById('mobileSidebarOverlay');
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
    if (typeof Sortable === 'undefined') return;

    const list = document.getElementById('tasksList');
    if (list) {
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
                let num = 0;
                list.querySelectorAll('.task-item').forEach(el => {
                    el.querySelector('.task-num').textContent = ++num;
                });
                markUnsaved();
            },
        });
    }

    const tplList = document.getElementById('tplTaskList');
    if (tplList) {
        if (tplList._sortable) { tplList._sortable.destroy(); tplList._sortable = null; }
        tplList._sortable = Sortable.create(tplList, {
            animation: 150,
            handle: '.drag-handle',
            delay: 150,
            delayOnTouchOnly: true,
            ghostClass:  'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass:   'sortable-drag',
            onEnd() { renumberTplTasks(); },
        });
    }
}

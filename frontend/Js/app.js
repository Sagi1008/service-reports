import { S, hydrate, subscribeToChanges, auth, signInWithEmailAndPassword, signOut, onAuthStateChanged, apiSubmitRegistrationRequest, apiSubscribePendingRegistrations, apiApproveRegistration, apiRejectRegistration, apiAddEquipment, apiUpdateEquipment, apiDeleteEquipment, apiLogEquipmentHandover } from './api.js';
import {
    initPad, setTodayDates, markUnsaved,
    showModal, hideModal, toast,
    setStatus, removeTask, openLightbox, closeLightbox,
    removeImage, openAppendixFile,
    addTask, addSectionTitle,
    addTplTask, addTplSection, renumberTplTasks,
    handleImages, handleTplAppendixFile,
    clearSignature, clearCustomerSignature, toggleMobileSidebar, closeMobileSidebar,
    toggleFolder, updateToolbar, showDashboard, showFolderContent, switchFolderTab,
    toggleFolderMenu, closeFolderMenu,
    openImportAssociationModal, deleteAttachment,
    uploadProcedure, deleteProcedure,
    renderHomeDashboard,
    initSortable, renderSidebar,
    renderEquipmentTab, EQUIP_STATUS_CONFIG,
} from './ui.js';
import {
    preloadLogo,
    showNewReportModal, selectNewReportTpl, confirmNewReport,
    openReport, saveReport, clearReport, deleteReportPrompt, confirmDelete, deleteReportById,
    showTemplateEditor, saveTplEditor, deleteTemplatePrompt,
    createReportFromTemplate, showSaveAsTemplate, confirmSaveAsTemplate,
    createFolder, showMoveFolderModal, moveToFolder,
    renameFolderPrompt, confirmRenameFolder,
    deleteFolderPrompt, confirmDeleteFolder,
    importFile, confirmImport, onDocumentFilePicked, confirmDocumentUpload,
    exportJSON, downloadPDF, showShareModal, shareTo,
} from './reports.js';

/* ================================================================
   ADMIN PANEL STATE
================================================================ */
const ADMIN_EMAIL    = 'sagi.tisson@oficiency.com';
let   _adminUnsub    = null;
let   _pendingRequests = [];

function _esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _updateAdminBadge() {
    const badge = document.getElementById('adminBadge');
    if (!badge) return;
    if (_pendingRequests.length > 0) {
        badge.textContent = _pendingRequests.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function _renderRegistrationRequests() {
    const list = document.getElementById('adminRequestsList');
    if (!list) return;
    if (_pendingRequests.length === 0) {
        list.innerHTML = '<div class="reg-requests-empty">אין בקשות הרשמה ממתינות</div>';
        return;
    }
    list.innerHTML = _pendingRequests.map(req => `
        <div class="reg-request-card" id="req-${req.id}">
            <div class="reg-request-info">
                <div class="reg-request-name">${_esc(req.name)}</div>
                <div class="reg-request-email">${_esc(req.email)}</div>
            </div>
            <div class="reg-request-actions">
                <button class="btn-approve" onclick="approveRegistration('${req.id}')">אשר טכנאי</button>
                <button class="btn-reject"  onclick="rejectRegistration('${req.id}')">דחה</button>
            </div>
        </div>`).join('');
}

window.showAdminPanel = function() {
    _renderRegistrationRequests();
    showModal('adminPanelModal');
};

window.approveRegistration = async function(docId) {
    const req = _pendingRequests.find(r => r.id === docId);
    if (!req) { toast('הבקשה כבר טופלה', 'error'); return; }
    const card = document.getElementById(`req-${docId}`);
    if (card) card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
        await apiApproveRegistration(docId, req.name, req.email, req.password);
        toast(`הטכנאי ${_esc(req.name)} אושר בהצלחה`, 'success');
    } catch (e) {
        console.error('[APPROVE]', e);
        toast('שגיאה באישור הטכנאי: ' + (e.message || ''), 'error');
        if (card) card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
};

window.rejectRegistration = async function(docId) {
    const card = document.getElementById(`req-${docId}`);
    if (card) card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
        await apiRejectRegistration(docId);
        toast('הבקשה נדחתה', 'success');
    } catch (e) {
        console.error('[REJECT]', e);
        toast('שגיאה בדחיית הבקשה', 'error');
        if (card) card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    }
};

/* ================================================================
   EXPOSE ALL FUNCTIONS GLOBALLY
   (Required for onclick="..." handlers in static and dynamic HTML)
================================================================ */
window.showModal              = showModal;
window.hideModal              = hideModal;
window.toast                  = toast;
window.markUnsaved            = markUnsaved;

// Report actions
window.openReport             = openReport;
window.saveReport             = saveReport;
window.clearReport            = clearReport;
window.deleteReportPrompt     = deleteReportPrompt;
window.confirmDelete          = confirmDelete;
window.deleteReportById       = deleteReportById;

// New report modal
window.showNewReportModal     = showNewReportModal;
window.selectNewReportTpl     = selectNewReportTpl;
window.confirmNewReport       = confirmNewReport;

// Template actions
window.showTemplateEditor     = showTemplateEditor;
window.saveTplEditor          = saveTplEditor;
window.deleteTemplatePrompt   = deleteTemplatePrompt;
window.createReportFromTemplate = createReportFromTemplate;
window.showSaveAsTemplate     = showSaveAsTemplate;
window.confirmSaveAsTemplate  = confirmSaveAsTemplate;
window.addTplTask             = addTplTask;
window.addTplSection          = addTplSection;
window.renumberTplTasks       = renumberTplTasks;
window.handleTplAppendixFile  = handleTplAppendixFile;

// Folder actions
window.createFolder           = createFolder;
window.showMoveFolderModal    = showMoveFolderModal;
window.moveToFolder           = moveToFolder;
window.renameFolderPrompt     = renameFolderPrompt;
window.confirmRenameFolder    = confirmRenameFolder;
window.deleteFolderPrompt     = deleteFolderPrompt;
window.confirmDeleteFolder    = confirmDeleteFolder;
window.toggleFolder           = toggleFolder;

// Import / Export / PDF / Share
window.importFile             = importFile;
window.confirmImport          = confirmImport;
window.onDocumentFilePicked   = onDocumentFilePicked;
window.confirmDocumentUpload  = confirmDocumentUpload;
window.exportJSON             = exportJSON;
window.downloadPDF            = downloadPDF;
window.showShareModal         = showShareModal;
window.shareTo                = shareTo;

// Task UI
window.addTask                = addTask;
window.addSectionTitle        = addSectionTitle;
window.setStatus              = setStatus;
window.removeTask             = removeTask;

// Image / Appendix UI
window.handleImages           = handleImages;
window.openLightbox           = openLightbox;
window.closeLightbox          = closeLightbox;
window.removeImage            = removeImage;
window.openAppendixFile       = openAppendixFile;

// Signature
window.clearSignature         = clearSignature;
window.clearCustomerSignature = clearCustomerSignature;

// Mobile sidebar
window.toggleMobileSidebar    = toggleMobileSidebar;
window.closeMobileSidebar     = closeMobileSidebar;

// Dashboard / folder views
window.showDashboard              = showDashboard;
window.showFolderContent          = showFolderContent;
window.switchFolderTab            = switchFolderTab;
window.toggleFolderMenu           = toggleFolderMenu;
window.closeFolderMenu            = closeFolderMenu;
window.uploadProcedure            = uploadProcedure;
window.deleteProcedure            = deleteProcedure;

window.goBackToDashboard = function() {
    if (S.unsaved && S.currentId) {
        if (!confirm('יש שינויים שלא נשמרו. לנטוש?')) return;
    }
    if (S.currentFolder) showFolderContent(S.currentFolder);
    else showDashboard();
};
window.openImportAssociationModal = openImportAssociationModal;
window.deleteAttachment           = deleteAttachment;

window.setServiceType = function(val) {
    document.getElementById('fServiceType').value = val;
    document.querySelectorAll('#serviceTypePicker .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === val);
    });
    markUnsaved();
};

window.setTplServiceType = function(val) {
    document.getElementById('tplServiceType').value = val;
    document.querySelectorAll('#tplServiceTypePicker .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === val);
    });
};

/* ================================================================
   EQUIPMENT MANAGEMENT
================================================================ */
function _equipToggleHolder() {
    const status = document.getElementById('equipStatus').value;
    document.getElementById('equipHolderFg').style.display = status === 'active' ? '' : 'none';
}

window.onEquipStatusChange = _equipToggleHolder;

window.filterEquipment = function(query) {
    const q = (query || '').trim().toLowerCase();
    document.querySelectorAll('.eq-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
    document.querySelectorAll('.eq-category-section').forEach(section => {
        const anyVisible = Array.from(section.querySelectorAll('.eq-card'))
            .some(c => c.style.display !== 'none');
        section.style.display = anyVisible ? '' : 'none';
    });
};

window.showAddEquipmentModal = function() {
    document.getElementById('equipFormTitle').textContent = 'הוסף ציוד חדש';
    document.getElementById('equipFormId').value     = '';
    document.getElementById('equipName').value       = '';
    document.getElementById('equipModel').value      = '';
    document.getElementById('equipSerial').value     = '';
    document.getElementById('equipCategory').value   = 'כלי עבודה ידניים';
    document.getElementById('equipStatus').value     = 'storage';
    document.getElementById('equipHolder').value     = '';
    document.getElementById('equipNotes').value      = '';
    document.getElementById('equipDeleteBtn').style.display = 'none';
    _equipToggleHolder();
    showModal('equipFormModal');
};

window.showEquipmentDetail = function(id) {
    const item = S.equipment[id];
    if (!item) return;
    document.getElementById('equipFormTitle').textContent = 'ערוך כלי';
    document.getElementById('equipFormId').value     = id;
    document.getElementById('equipName').value       = item.name       || '';
    document.getElementById('equipModel').value      = item.model      || '';
    document.getElementById('equipSerial').value     = item.serialNumber || '';
    document.getElementById('equipCategory').value   = item.category   || 'כלי עבודה ידניים';
    document.getElementById('equipStatus').value     = item.status     || 'storage';
    document.getElementById('equipHolder').value     = item.currentHolder || '';
    document.getElementById('equipNotes').value      = item.notes      || '';
    document.getElementById('equipDeleteBtn').style.display = '';
    _equipToggleHolder();
    showModal('equipFormModal');
};

window.saveEquipment = async function() {
    const id     = document.getElementById('equipFormId').value;
    const name   = document.getElementById('equipName').value.trim();
    if (!name) { toast('יש להזין שם לפריט', 'error'); return; }

    const status = document.getElementById('equipStatus').value;
    const data = {
        name,
        model:         document.getElementById('equipModel').value.trim(),
        serialNumber:  document.getElementById('equipSerial').value.trim(),
        category:      document.getElementById('equipCategory').value,
        status,
        currentHolder: status === 'active' ? document.getElementById('equipHolder').value.trim() : '',
        notes:         document.getElementById('equipNotes').value.trim(),
    };

    try {
        if (id) {
            await apiUpdateEquipment(id, data);
            S.equipment[id] = { ...S.equipment[id], ...data };
            toast('הציוד עודכן ✓', 'success');
        } else {
            const item = await apiAddEquipment(data);
            S.equipment[item.id] = item;
            toast('הציוד נוסף ✓', 'success');
        }
        hideModal('equipFormModal');
        renderEquipmentTab();
    } catch (e) {
        console.error('[EQUIP] save error:', e);
        toast('שגיאה בשמירה', 'error');
    }
};

window.deleteEquipmentPrompt = function() {
    const id   = document.getElementById('equipFormId').value;
    const name = document.getElementById('equipName').value || 'פריט זה';
    if (!confirm(`למחוק את "${name}" מהמלאי?`)) return;
    _deleteEquipment(id);
};

async function _deleteEquipment(id) {
    try {
        await apiDeleteEquipment(id);
        delete S.equipment[id];
        hideModal('equipFormModal');
        toast('הפריט נמחק', 'error');
        renderEquipmentTab();
    } catch (e) {
        console.error('[EQUIP] delete error:', e);
        toast('שגיאה במחיקה', 'error');
    }
}

window.showHandoverModal = function() {
    const items = Object.values(S.equipment)
        .slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'));
    document.getElementById('handoverHolder').value         = '';
    document.getElementById('handoverRecipientEmail').value = '';

    const list = document.getElementById('handoverItemList');
    if (!items.length) {
        list.innerHTML = '<div class="handover-empty">אין פריטים במלאי</div>';
    } else {
        list.innerHTML = items.map(item => {
            const sc = EQUIP_STATUS_CONFIG[item.status] || EQUIP_STATUS_CONFIG.storage;
            return `
                <label class="handover-row">
                    <input type="checkbox" class="handover-check" data-id="${esc(item.id)}">
                    <div class="handover-item-info">
                        <span class="handover-item-name">${esc(item.name || 'ללא שם')}</span>
                        ${item.serialNumber ? `<span class="handover-item-serial">S/N: ${esc(item.serialNumber)}</span>` : ''}
                    </div>
                    <span class="eq-badge ${sc.cls}">${sc.label}</span>
                </label>`;
        }).join('');
    }
    showModal('handoverModal');
};

function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const MANAGER_EMAIL = 'maor.menachem@oficiency.com';

window.confirmHandover = async function() {
    const holder         = document.getElementById('handoverHolder').value.trim();
    const recipientEmail = document.getElementById('handoverRecipientEmail').value.trim();
    if (!holder) { toast('יש להזין שם טכנאי', 'error'); return; }
    const checked = Array.from(document.querySelectorAll('.handover-check:checked'));
    if (!checked.length) { toast('יש לבחור לפחות פריט אחד', 'error'); return; }

    // Snapshot tool details before modifying state
    const tools = checked.map(cb => {
        const item = S.equipment[cb.dataset.id] || {};
        return { id: cb.dataset.id, name: item.name || 'ציוד', serialNumber: item.serialNumber || '' };
    });

    try {
        // 1. Batch-update equipment status
        await Promise.all(checked.map(cb => {
            const id     = cb.dataset.id;
            const update = { status: 'active', currentHolder: holder };
            S.equipment[id] = { ...S.equipment[id], ...update };
            return apiUpdateEquipment(id, update);
        }));

        // 2. Write log to equipment_logs
        const senderName = S.currentUser?.displayName || S.currentUser?.email || 'מנהל המערכת';
        await apiLogEquipmentHandover({ senderName, recipientName: holder, recipientEmail, tools });

        // 3. Build pre-filled mailto: link
        const now = new Date().toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
        const toolLines = tools.map(t =>
            `• ${t.name}${t.serialNumber ? ' - S/N: ' + t.serialNumber : ''}`
        ).join('\n');
        const bodyText = [
            'שלום,',
            '',
            'להלן פרטי תנועת ציוד שבוצעה במערכת Oficiency:',
            '',
            `מוסר: ${senderName}`,
            `מקבל: ${holder}`,
            `תאריך ושעה: ${now}`,
            '',
            'ציוד שהועבר:',
            toolLines,
            '',
            '---',
            'Oficiency | מערכת ניהול ותחזוקה',
        ].join('\n');

        const toField = [recipientEmail, MANAGER_EMAIL].filter(Boolean).join(',');
        const mailUrl = `mailto:${toField}?subject=${encodeURIComponent('עדכון תנועת ציוד במערכת - Oficiency')}&body=${encodeURIComponent(bodyText)}`;
        window.open(mailUrl, '_blank');

        // 4. Close + notify
        hideModal('handoverModal');
        toast(`${tools.length} פריטים הועברו ל-${holder} — הלוג נשמר ✓`, 'success');
        renderEquipmentTab();
    } catch (e) {
        console.error('[HANDOVER] error:', e);
        toast('שגיאה בהעברה — נסה שוב', 'error');
    }
};

/* ================================================================
   BOTTOM NAV — MOBILE TAB SWITCHING
================================================================ */
function _isMobile() { return window.innerWidth <= 768; }

function switchTab(tab) {
    if (!_isMobile()) return;

    // Update active indicator on nav buttons
    document.querySelectorAll('.bnav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Toggle tab overlay panels
    const homePanel  = document.getElementById('tabHome');
    const equipPanel = document.getElementById('tabEquipment');
    const fab        = document.getElementById('mobileFab');

    if (homePanel)  homePanel.classList.toggle('hidden', tab !== 'home');
    if (equipPanel) equipPanel.classList.toggle('hidden', tab !== 'equipment');

    // FAB is only visible on the reports tab
    if (fab) fab.classList.toggle('fab-visible', tab === 'reports');

    // When switching to reports, ensure dashboard/folder content is rendered
    if (tab === 'home')      renderHomeDashboard();
    if (tab === 'equipment') renderEquipmentTab();
    if (tab === 'reports' && !S.currentId) {
        if (S.currentFolder) showFolderContent(S.currentFolder);
        else                  showDashboard();
    }
}

window.switchTab = switchTab;

/* ================================================================
   EVENT LISTENERS
================================================================ */
document.querySelectorAll('.overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.add('hidden'); });
});

/* Enter-to-submit is now handled natively by the <form> elements. */
document.getElementById('newFolderName').addEventListener('keydown', e => { if (e.key==='Enter') createFolder(); });
document.getElementById('newReportName').addEventListener('keydown', e => { if (e.key==='Enter') confirmNewReport(); });

document.addEventListener('keydown', e => {
    if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); saveReport(); }
    if (e.key==='Escape') {
        document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.classList.add('hidden'));
        document.getElementById('lightbox').classList.add('hidden');
    }
});

/* ================================================================
   IOS KEYBOARD / VIEWPORT FIX
================================================================ */
(function iosKeyboardFix() {
    function snapBack() {
        setTimeout(function() {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        }, 80);
    }

    if (window.visualViewport) {
        var lastH = window.visualViewport.height;
        window.visualViewport.addEventListener('resize', function() {
            var newH = window.visualViewport.height;
            if (newH > lastH) { snapBack(); }
            lastH = newH;
        });
    }

    document.addEventListener('focusout', function(e) {
        var tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            snapBack();
        }
    }, true);
})();

/* ================================================================
   AUTH – sign-in / sign-out handlers (called from onclick in HTML)
================================================================ */
window.doSignIn = async function() {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl    = document.getElementById('loginError');
    const btn      = document.getElementById('loginBtn');

    if (!email || !password) { errEl.textContent = 'אנא מלא כתובת דוא״ל וסיסמה'; return; }

    btn.disabled    = true;
    btn.textContent = 'מתחבר...';
    errEl.textContent = '';
    try {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged handles the rest
    } catch (e) {
        console.error('[AUTH ERROR]', e);
        const MAP = {
            'auth/invalid-credential':    'אימייל או סיסמה שגויים',
            'auth/user-not-found':        'משתמש לא נמצא',
            'auth/wrong-password':        'סיסמה שגויה',
            'auth/invalid-email':         'כתובת דוא״ל לא תקינה',
            'auth/too-many-requests':     'יותר מדי ניסיונות – נסה שוב מאוחר יותר',
            'auth/network-request-failed':'בעיית רשת – בדוק את החיבור',
            'auth/operation-not-allowed': 'כניסה באימייל/סיסמה לא מופעלת – בדוק הגדרות Firebase',
        };
        errEl.textContent = MAP[e.code] || `שגיאה בהתחברות (${e.code})`;
        btn.disabled      = false;
        btn.textContent   = 'כניסה';
    }
};

window.doSignOut = async function() {
    await signOut(auth);
    // onAuthStateChanged → location.reload() for clean state
};

window.doTogglePassword = function(inputId, btn) {
    const inp = document.getElementById(inputId);
    const showing = inp.type === 'text';
    inp.type       = showing ? 'password' : 'text';
    btn.textContent = showing ? 'הצג' : 'הסתר';
};

window.doShowRegister = function() {
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('registerView').classList.remove('hidden');
    document.getElementById('loginError').textContent = '';
    setTimeout(() => document.getElementById('regName').focus(), 60);
};

window.doHideRegister = function() {
    document.getElementById('registerView').classList.add('hidden');
    document.getElementById('loginView').classList.remove('hidden');
};

window.doSubmitRegistration = async function() {
    const name     = document.getElementById('regName').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const errEl    = document.getElementById('registerError');
    const btn      = document.getElementById('registerBtn');

    errEl.style.color = '';
    if (!name || !email || !password) {
        errEl.textContent = 'אנא מלא את כל השדות';
        return;
    }
    if (password.length < 6) {
        errEl.textContent = 'הסיסמה חייבת להכיל לפחות 6 תווים';
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'שולח...';
    errEl.textContent = '';

    try {
        await apiSubmitRegistrationRequest(name, email, password);
        // Show success inline, then return to login after a beat
        errEl.style.color = '#059669';
        errEl.textContent = 'בקשת ההרשמה נשלחה בהצלחה וממתינה לאישור מנהל';
        setTimeout(() => {
            document.getElementById('regName').value     = '';
            document.getElementById('regEmail').value    = '';
            document.getElementById('regPassword').value = '';
            errEl.textContent = '';
            errEl.style.color = '';
            btn.disabled      = false;
            btn.textContent   = 'שלח בקשה';
            doHideRegister();
        }, 3000);
    } catch (e) {
        console.error('[REGISTER ERROR]', e);
        errEl.textContent = 'שגיאה בשליחת הבקשה – נסה שוב';
        btn.disabled      = false;
        btn.textContent   = 'שלח בקשה';
    }
};

/* ================================================================
   BOOT – gated behind Firebase Auth
================================================================ */
async function init() {
    await hydrate().catch(() => toast('השרת לא זמין – עובד במצב לא מקוון', 'error'));
    try { initPad(); } catch (e) { console.warn('Signature pad unavailable:', e.message); }
    preloadLogo();
    setTodayDates();
    initSortable();
    showDashboard();
    document.querySelectorAll('#reportEditor input, #reportEditor textarea').forEach(el => {
        el.addEventListener('input', () => markUnsaved());
    });
    if (!navigator.share) {
        const nb = document.getElementById('shareNativeBtn');
        if (nb) nb.style.display = 'none';
    }
    renderHomeDashboard();
    subscribeToChanges(() => {
        renderSidebar();
        renderHomeDashboard();
        const equipEl = document.getElementById('tabEquipment');
        if (equipEl && !equipEl.classList.contains('hidden')) renderEquipmentTab();
        if (!S.currentId) {
            if (S.currentFolder) showFolderContent(S.currentFolder);
            else                 showDashboard();
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            renderSidebar();
            if (!S.currentId) {
                if (S.currentFolder) showFolderContent(S.currentFolder);
                else                 showDashboard();
            }
        }
    });
    // Mobile: open on the Home tab by default
    if (_isMobile()) switchTab('home');
}

let _appBooted    = false;
let _freshChecked = false;   // ensures the fresh-session guard runs exactly once

onAuthStateChanged(auth, async (user) => {
    // First fire only: if this is a brand-new browser session, evict any stale
    // credentials that may have been persisted from a previous LOCAL-persistence run.
    if (!_freshChecked) {
        _freshChecked = true;
        if (!sessionStorage.getItem('fresh_session')) {
            sessionStorage.setItem('fresh_session', '1');
            if (user) {
                await signOut(auth);   // triggers a second onAuthStateChanged(null)
                return;
            }
        }
    }

    if (user) {
        S.currentUser = user;
        document.getElementById('userEmail').textContent = user.email;
        const mua = document.getElementById('mobileUserAvatar');
        if (mua) mua.textContent = (user.email?.[0] || '?').toUpperCase();
        document.getElementById('loginScreen').classList.add('hidden');
        if (user.email === ADMIN_EMAIL) {
            const adminBtn = document.getElementById('adminPanelBtn');
            if (adminBtn) adminBtn.classList.remove('hidden');
            if (!_adminUnsub) {
                _adminUnsub = apiSubscribePendingRegistrations((requests) => {
                    _pendingRequests = requests;
                    _updateAdminBadge();
                    const modal = document.getElementById('adminPanelModal');
                    if (modal && !modal.classList.contains('hidden')) {
                        _renderRegistrationRequests();
                    }
                });
            }
        }
        if (!_appBooted) { _appBooted = true; init(); }
    } else {
        if (_adminUnsub) { _adminUnsub(); _adminUnsub = null; }
        if (_appBooted) {
            location.reload();
        } else {
            // Reveal the login screen only after the splash has finished fading out.
            // If auth resolves before the 2.5 s timer, set a flag the timer will honour.
            if (window._splashDone) {
                document.getElementById('loginScreen').classList.remove('hidden');
            } else {
                window._showLoginWhenSplashDone = true;
            }
        }
    }
});

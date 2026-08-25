import { S, hydrate, subscribeToChanges, auth, signInWithEmailAndPassword, signOut, onAuthStateChanged, apiSubmitRegistrationRequest, apiCheckUserApproval, apiSubscribeUserStatus, apiSubscribeTemplatePermission } from './api.js';
import {
    initPad, setTodayDates, markUnsaved,
    showModal, hideModal, toast,
    setStatus, removeTask, openLightbox, closeLightbox,
    removeImage, openAppendixFile,
    addTask, addRangeTask, addSectionTitle,
    duplicateTask, updateTaskBulkBar, clearTaskSelection, duplicateSelectedTasks,
    addTplTask, addTplSection, addTplRangeTask, renumberTplTasks,
    duplicateTplTask, updateTplTaskBulkBar, clearTplTaskSelection, duplicateSelectedTplTasks,
    handleImages, handleTplAppendixFile,
    clearSignature, clearCustomerSignature, toggleMobileSidebar, closeMobileSidebar,
    toggleFolder, updateToolbar, showDashboard, loadMoreDashboardReports, showFolderContent, switchFolderTab,
    toggleFolderMenu, closeFolderMenu,
    openImportAssociationModal, deleteAttachment,
    uploadProcedure, deleteProcedure,
    initSortable, renderSidebar,
} from './ui.js';
import {
    preloadLogo,
    showNewReportModal,
    nrSelectType, nrGoStep1, nrGoStep1b, nrGoStep2, nrGoStep3, nrSelectFolder, nrSelectTpl, nrConfirm,
    saveDraft, clearDraft,
    openReport, saveReport, clearReport, deleteReportPrompt, confirmDelete, deleteReportById,
    showTemplateEditor, saveTplEditor, deleteTemplatePrompt,
    createReportFromTemplate, showSaveAsTemplate, confirmSaveAsTemplate,
    createFolder, showMoveFolderModal, moveToFolder,
    renameFolderPrompt, confirmRenameFolder,
    deleteFolderPrompt, confirmDeleteFolder,
    importFile, confirmImport, onDocumentFilePicked, confirmDocumentUpload,
    exportJSON, downloadPDF, showShareModal, shareTo,
    showAssetMoveModal, executeAssetAction, importAsTemplate,
    dlAddRow, dlDelRow,
    weldAddRow, weldDelRow, weldSelChange,
} from './reports.js';
import { renderHomeDashboard } from './components/HomeTab.js';
import { renderEquipmentTab } from './components/EquipmentTab.js';
import { setupManagerPanel, cleanupManagerPanel } from './components/ManagerPanel.js';
import { ADMIN_EMAIL, setupAdminPanel, cleanupAdminPanel } from './components/AdminPanel.js';

const MANAGER_EMAIL  = 'sagi.tisson@oficiency.com';

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

// Auto-save draft
window.saveDraft              = saveDraft;
window.clearDraft             = clearDraft;

// New report modal / wizard
window.showNewReportModal     = showNewReportModal;
window.nrSelectType           = nrSelectType;
window.nrGoStep1              = nrGoStep1;
window.nrGoStep1b             = nrGoStep1b;
window.nrGoStep2              = nrGoStep2;
window.nrGoStep3              = nrGoStep3;
window.nrSelectFolder         = nrSelectFolder;
window.nrSelectTpl            = nrSelectTpl;
window.nrConfirm              = nrConfirm;

// Template actions
window.showTemplateEditor     = showTemplateEditor;
window.saveTplEditor          = saveTplEditor;
window.deleteTemplatePrompt   = deleteTemplatePrompt;
window.createReportFromTemplate = createReportFromTemplate;
window.showSaveAsTemplate     = showSaveAsTemplate;
window.confirmSaveAsTemplate  = confirmSaveAsTemplate;
window.addTplTask             = addTplTask;
window.addTplSection          = addTplSection;
window.addTplRangeTask        = addTplRangeTask;
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
window.addRangeTask           = addRangeTask;
window.addSectionTitle        = addSectionTitle;
window.handleAddTaskType = function(sel) {
    const type = sel.value;
    sel.selectedIndex = 0;
    if (type === 'task')  addTask();
    if (type === 'range') addRangeTask();
};
window.handleAddTplTaskType = function(sel) {
    const type = sel.value;
    sel.selectedIndex = 0;
    if (type === 'task')  addTplTask();
    if (type === 'range') addTplRangeTask();
};
window.setStatus = function(btn, status) {
    setStatus(btn, status);
    if (S.currentId) saveDraft();
};
window.removeTask             = removeTask;
window.duplicateTask          = duplicateTask;
window.updateTaskBulkBar      = updateTaskBulkBar;
window.clearTaskSelection     = clearTaskSelection;
window.duplicateSelectedTasks = duplicateSelectedTasks;
window.duplicateTplTask              = duplicateTplTask;
window.updateTplTaskBulkBar          = updateTplTaskBulkBar;
window.clearTplTaskSelection         = clearTplTaskSelection;
window.duplicateSelectedTplTasks     = duplicateSelectedTplTasks;

// Daily Work Log
window.dlAddRow               = dlAddRow;
window.dlDelRow               = dlDelRow;

// Weld Inspection
window.weldAddRow             = weldAddRow;
window.weldDelRow             = weldDelRow;
window.weldSelChange          = weldSelChange;

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
window.loadMoreDashboardReports   = loadMoreDashboardReports;
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
    S.currentId = null;
    S.unsaved = false;
    if (!_isMobile()) switchTab('reports');
    else {
        if (S.currentFolder) showFolderContent(S.currentFolder);
        else showDashboard();
    }
};

// Desktop sidebar navigation — auto-switches to reports tab before showing content
window.navToFolder = function(name) {
    if (!_isMobile()) switchTab('reports');
    showFolderContent(name);
};
window.navToDashboard = function() {
    if (!_isMobile()) switchTab('reports');
    else showDashboard();
};
window.autoExpand = function(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
};

window.closeTplEditor = function() {
    const page = document.getElementById('tplEditorPage');
    if (page) page.style.display = 'none';
    if (S.currentFolder) showFolderContent(S.currentFolder);
    else showDashboard();
};

window.openImportAssociationModal = openImportAssociationModal;
window.deleteAttachment           = deleteAttachment;

// Asset move / copy
window.showAssetMoveModal = showAssetMoveModal;
window.executeAssetAction = executeAssetAction;
window.importAsTemplate   = importAsTemplate;

// Native <select> handlers for mobile three-dots menus.
// Using OS-native pickers bypasses all iOS Safari touch/overflow/z-index issues.
window.handleReportSelect = function(sel, reportId) {
    const action = sel.value;
    sel.selectedIndex = 0;
    if (!action) return;
    if (action === 'open')   openReport(reportId);
    if (action === 'move')   showAssetMoveModal('report', reportId, 'move');
    if (action === 'copy')   showAssetMoveModal('report', reportId, 'copy');
    if (action === 'delete') {
        const title = (S.reports[reportId] || {}).title || 'דוח זה';
        if (confirm('למחוק את הדוח "' + title + '"?')) deleteReportById(reportId);
    }
};

window.handleTplSelect = function(sel, tplId, folderName) {
    const action = sel.value;
    sel.selectedIndex = 0;
    if (!action) return;
    if (action === 'newReport') createReportFromTemplate(tplId, folderName);
    if (action === 'edit')      showTemplateEditor(tplId, folderName);
    if (action === 'move')      showAssetMoveModal('template', tplId, 'move');
    if (action === 'copy')      showAssetMoveModal('template', tplId, 'copy');
    if (action === 'delete')    deleteTemplatePrompt(tplId);
};

window.handleToolbarSelect = function(sel) {
    const action = sel.value;
    sel.selectedIndex = 0;
    if (!action) return;
    if (action === 'save')     saveReport();
    if (action === 'pdf')      downloadPDF();
    if (action === 'share')    showShareModal();
    if (action === 'template') showSaveAsTemplate();
    if (action === 'folder')   showMoveFolderModal();
    if (action === 'clear')    clearReport();
    if (action === 'delete')   deleteReportPrompt();
};

window.setRangeReading = function(input) {
    const item   = input.closest('.task-item');
    if (!item) return;
    const val    = parseFloat(input.value);
    const minInp = item.querySelector('.task-range-min');
    const maxInp = item.querySelector('.task-range-max');
    const minV   = minInp?.value !== '' ? parseFloat(minInp.value) : null;
    const maxV   = maxInp?.value !== '' ? parseFloat(maxInp.value) : null;

    input.classList.remove('in-range', 'out-of-range');

    if (input.value === '' || isNaN(val)) {
        item.dataset.status = 'pending';
    } else if ((minV === null || val >= minV) && (maxV === null || val <= maxV)) {
        input.classList.add('in-range');
        item.dataset.status = 'in_range';
    } else {
        input.classList.add('out-of-range');
        item.dataset.status = 'out_of_range';
    }
    markUnsaved();
};

window.calcTotalHours = function() {
    const start   = document.getElementById('fStartTime')?.value;
    const end     = document.getElementById('fEndTime')?.value;
    const totalEl = document.getElementById('fTotalHours');
    if (!totalEl) return;
    if (!start || !end) { totalEl.value = ''; return; }
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let diffMin = (eh * 60 + em) - (sh * 60 + sm);
    if (diffMin < 0) diffMin += 24 * 60; // overnight
    const hours = Math.floor(diffMin / 60);
    const mins  = diffMin % 60;
    totalEl.value = mins > 0
        ? `${hours}:${String(mins).padStart(2, '0')} שעות`
        : `${hours} שעות`;
    markUnsaved();
    if (S.currentId) saveDraft();
};

window.setServiceType = function(val) {
    document.getElementById('fServiceType').value = val;
    document.querySelectorAll('#serviceTypePicker .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === val);
    });
    const row = document.getElementById('periodicIntervalRow');
    if (row) row.style.display = val === 'routine' ? '' : 'none';
    markUnsaved();
};

window.setTplServiceType = function(val) {
    document.getElementById('tplServiceType').value = val;
    document.querySelectorAll('#tplServiceTypePicker .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === val);
    });
};

/* ================================================================
   BOTTOM NAV — MOBILE TAB SWITCHING
================================================================ */
function _isMobile() {
    return window.innerWidth <= 768 ||
           (window.innerHeight <= 500 && window.matchMedia('(orientation: landscape)').matches);
}

function switchTab(tab) {
    if (_isMobile()) {
        document.querySelectorAll('.bnav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        const homePanel  = document.getElementById('tabHome');
        const equipPanel = document.getElementById('tabEquipment');
        const fab        = document.getElementById('mobileFab');

        if (homePanel)  homePanel.classList.toggle('hidden', tab !== 'home');
        if (equipPanel) equipPanel.classList.toggle('hidden', tab !== 'equipment');
        if (fab) fab.classList.toggle('fab-visible', tab === 'reports' || tab === 'home');

        if (tab === 'home')      renderHomeDashboard();
        if (tab === 'equipment') renderEquipmentTab();
        if (tab === 'reports' && !S.currentId) {
            if (S.currentFolder) showFolderContent(S.currentFolder);
            else                 showDashboard();
        }
    } else {
        document.querySelectorAll('.dtab-btn').forEach(btn => {
            btn.classList.toggle('dtab-active', btn.dataset.dtab === tab);
        });

        const dHomePanel  = document.getElementById('desktopHomePanel');
        const dEquipPanel = document.getElementById('desktopEquipmentPanel');
        const reportArea  = document.getElementById('reportArea');

        // Use inline style so !important on .hidden cannot interfere
        if (dHomePanel)  dHomePanel.style.display  = tab === 'home'      ? 'flex' : 'none';
        if (dEquipPanel) dEquipPanel.style.display = tab === 'equipment' ? 'flex' : 'none';
        if (reportArea)  reportArea.style.display  = tab === 'reports'   ? ''     : 'none';

        if (tab === 'home')      renderHomeDashboard();
        if (tab === 'equipment') renderEquipmentTab();
        if (tab === 'reports' && !S.currentId) {
            if (S.currentFolder) showFolderContent(S.currentFolder);
            else                 showDashboard();
        }
    }
}

window.switchTab = switchTab;

/* ================================================================
   EVENT LISTENERS
================================================================ */
document.querySelectorAll('.overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.add('hidden'); });
});

document.getElementById('newFolderName').addEventListener('keydown', e => { if (e.key==='Enter') createFolder(); });

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
   ORIENTATION CHANGE — keep mobile layout on phone landscape
   Re-runs switchTab so panels reflect the correct viewport class
   (_isMobile now fires for landscape phones with height ≤ 500px).
================================================================ */
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        const activeTab =
            document.querySelector('.bnav-item.active')?.dataset?.tab ||
            document.querySelector('.dtab-btn.dtab-active')?.dataset?.dtab ||
            'home';
        switchTab(activeTab);
    }, 150);
});

/* ================================================================
   AUTH – sign-in / sign-out handlers
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
    if (_userStatusUnsub) { _userStatusUnsub(); _userStatusUnsub = null; }
    await signOut(auth);
};

window.doTogglePassword = function(inputId, btn) {
    const inp = document.getElementById(inputId);
    const showing = inp.type === 'text';
    inp.type        = showing ? 'password' : 'text';
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
    // Single delegated listener covers all inputs including dynamically-added task fields.
    // Both markUnsaved() and saveDraft() fire on every keystroke/change inside the editor.
    document.getElementById('reportEditor').addEventListener('input', () => {
        markUnsaved();
        if (S.currentId) saveDraft();
    });
    const _permTA = document.getElementById('fPermComments');
    if (_permTA) _permTA.addEventListener('input', () => window.autoExpand(_permTA));
    if (!navigator.share) {
        const nb = document.getElementById('shareNativeBtn');
        if (nb) nb.style.display = 'none';
    }
    renderHomeDashboard();
    subscribeToChanges(() => {
        renderSidebar();
        renderHomeDashboard();
        const mobileEquip  = document.getElementById('tabEquipment');
        const desktopEquip = document.getElementById('desktopEquipmentPanel');
        const equipVisible = (mobileEquip  && !mobileEquip.classList.contains('hidden'))
                          || (desktopEquip && desktopEquip.style.display === 'flex');
        if (equipVisible) renderEquipmentTab();
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
    switchTab('home');
}

let _appBooted       = false;
let _freshChecked    = false;
let _userStatusUnsub = null;
let _tplPermUnsub    = null;

onAuthStateChanged(auth, async (user) => {
    if (!_freshChecked) {
        _freshChecked = true;
        if (!sessionStorage.getItem('fresh_session')) {
            sessionStorage.setItem('fresh_session', '1');
            if (user) {
                await signOut(auth);
                return;
            }
        }
    }

    if (user) {
        S.currentUser = user;
        if (_tplPermUnsub) _tplPermUnsub();
        _tplPermUnsub = apiSubscribeTemplatePermission(user.email, (allowed) => {
            if (S.canEditTemplates === allowed) return;
            S.canEditTemplates = allowed;
            renderSidebar();
            if (S.currentFolder) showFolderContent(S.currentFolder);
            updateToolbar();
        });
        document.getElementById('userEmail').textContent = user.email;
        const mua = document.getElementById('mobileUserAvatar');
        if (mua) mua.textContent = (user.email?.[0] || '?').toUpperCase();
        document.getElementById('loginScreen').classList.add('hidden');
        const _normalEmail = user.email?.toLowerCase().trim();
        console.log('[AUTH] signed in:', _normalEmail);
        setupAdminPanel(user.email);
        const _rawEmail = user.email;
        const _isManager = _normalEmail === MANAGER_EMAIL
            || _rawEmail === 'sagi.tisson@oficiency.com'
            || _rawEmail === 'Sagi.tisson@oficiency.com';
        if (_isManager) {
            console.log('Master Admin Connected:', _rawEmail, '- Forcing Admin Panel Visibility.');
            setupManagerPanel();
        } else {
            // Security guard: verify the user has an approved record in Firestore.
            // Managers bypass this check (no registration_request doc for them).
            try {
                const approved = await apiCheckUserApproval(user.email);
                if (!approved) {
                    console.warn('[AUTH-GUARD] No approved record for:', user.email, '— signing out.');
                    await signOut(auth);
                    return;
                }
            } catch (e) {
                // Allow access on network failure to avoid locking out offline users.
                console.warn('[AUTH-GUARD] Approval check failed (offline?):', e.message);
            }
            // Real-time listener: kick the user immediately if their access is revoked
            // mid-session (admin changes status to rejected/deleted while they're active).
            if (_userStatusUnsub) _userStatusUnsub();
            _userStatusUnsub = apiSubscribeUserStatus(user.email, (status) => {
                if (status !== 'approved') {
                    console.warn('[AUTH-GUARD] Access revoked mid-session for:', user.email);
                    if (_userStatusUnsub) { _userStatusUnsub(); _userStatusUnsub = null; }
                    signOut(auth);
                }
            });
        }
        if (!_appBooted) { _appBooted = true; init(); }
    } else {
        if (_userStatusUnsub) { _userStatusUnsub(); _userStatusUnsub = null; }
        if (_tplPermUnsub)    { _tplPermUnsub();    _tplPermUnsub    = null; }
        S.canEditTemplates = false;
        cleanupAdminPanel();
        cleanupManagerPanel();
        if (_appBooted) {
            location.reload();
        } else {
            if (window._splashDone) {
                document.getElementById('loginScreen').classList.remove('hidden');
            } else {
                window._showLoginWhenSplashDone = true;
            }
        }
    }
});

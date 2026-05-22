import { S, hydrate, subscribeToChanges, auth, signInWithEmailAndPassword, signOut, onAuthStateChanged, apiSubmitRegistrationRequest } from './api.js';
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
    initSortable, renderSidebar,
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
import { renderHomeDashboard } from './components/HomeTab.js';
import { renderEquipmentTab } from './components/EquipmentTab.js';
import { setupManagerPanel, cleanupManagerPanel } from './components/ManagerPanel.js';
import { ADMIN_EMAIL, setupAdminPanel, cleanupAdminPanel } from './components/AdminPanel.js';

const MANAGER_EMAIL = 'sagi.tisson@oficiency.com';

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
   BOTTOM NAV — MOBILE TAB SWITCHING
================================================================ */
function _isMobile() { return window.innerWidth <= 768; }

function switchTab(tab) {
    if (!_isMobile()) return;

    document.querySelectorAll('.bnav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    const homePanel  = document.getElementById('tabHome');
    const equipPanel = document.getElementById('tabEquipment');
    const fab        = document.getElementById('mobileFab');

    if (homePanel)  homePanel.classList.toggle('hidden', tab !== 'home');
    if (equipPanel) equipPanel.classList.toggle('hidden', tab !== 'equipment');

    if (fab) fab.classList.toggle('fab-visible', tab === 'reports');

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
    document.querySelectorAll('#reportEditor input, #reportEditor textarea').forEach(el => {
        el.addEventListener('input', () => markUnsaved());
    });
    if (!navigator.share) {
        const nb = document.getElementById('shareNativeBtn');
        if (nb) nb.style.display = 'none';
    }
    renderHomeDashboard();
    if (S.currentUser?.email === MANAGER_EMAIL) {
        setupManagerPanel();
    }
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
    if (_isMobile()) switchTab('home');
}

let _appBooted    = false;
let _freshChecked = false;

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
        document.getElementById('userEmail').textContent = user.email;
        const mua = document.getElementById('mobileUserAvatar');
        if (mua) mua.textContent = (user.email?.[0] || '?').toUpperCase();
        document.getElementById('loginScreen').classList.add('hidden');
        setupAdminPanel(user.email);
        if (!_appBooted) { _appBooted = true; init(); }
    } else {
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

/* ================================================================
   FIREBASE CONFIG & INITIALIZATION
================================================================ */
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    initializeFirestore, persistentLocalCache, getFirestore,
    connectFirestoreEmulator,
    doc, setDoc, getDoc, collection, addDoc, getDocs, deleteDoc,
    onSnapshot, serverTimestamp, query, where, updateDoc, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    getStorage, ref, uploadBytes, getDownloadURL, deleteObject, getBlob,
    connectStorageEmulator
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import {
    initializeAuth, browserSessionPersistence, inMemoryPersistence,
    signInWithEmailAndPassword, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, updateProfile,
    connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    getFunctions, httpsCallable, connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

// Detect local dev — true when served by the Firebase Hosting emulator or any localhost server
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

const firebaseConfig = {
  apiKey: "AIzaSyCcqnXeV1VXdMODF0E0wiqGNjkdCVFBHbU",
  authDomain: "oficiency-1bbf9.firebaseapp.com",
  projectId: "oficiency-1bbf9",
  storageBucket: "oficiency-1bbf9.firebasestorage.app",
  messagingSenderId: "38007578536",
  appId: "1:38007578536:web:24a10e19eb109864b9c79d",
  measurementId: "G-9Z5QVVb3CM"
};

/*
const firebaseConfig = {
  apiKey: "AIzaSyBKdMzNYuD_SODQkZYaYbf_cOVK7i35bro",
  authDomain: "reports-test-504cd.firebaseapp.com",
  projectId: "reports-test-504cd",
  storageBucket: "reports-test-504cd.firebasestorage.app",
  messagingSenderId: "492681235098",
  appId: "1:492681235098:web:200c24bfcb63796f53ed23",
  measurementId: "G-24L6HY2MKT"
};
*/

// אתחול Firebase ושירותי הענן
console.log('[FIREBASE] apiKey prefix:', firebaseConfig.apiKey.slice(0, 5));
const app = initializeApp(firebaseConfig);
let db;
try {
    // Skip offline persistence in emulator mode — emulator restarts wipe data so the cache
    // would serve stale data on the next cold start, which is confusing during development.
    db = IS_LOCAL
        ? initializeFirestore(app, {})
        : initializeFirestore(app, { localCache: persistentLocalCache() });
} catch (e) {
    console.warn('[FIREBASE] Offline persistence unavailable, falling back:', e.message);
    db = getFirestore(app);
}
const storage = getStorage(app);
const functions = getFunctions(app, 'us-central1');
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export { signInWithEmailAndPassword, signOut, onAuthStateChanged };

// Point all SDK calls at the local emulators when running on localhost.
// connectXxxEmulator must be called immediately after init and before any read/write.
if (IS_LOCAL) {
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectStorageEmulator(storage, 'localhost', 9199);
    connectFunctionsEmulator(functions, 'localhost', 5001);
    console.log('%c[FIREBASE] LOCAL EMULATORS active — Firestore :8080  Auth :9099  Storage :9199  Functions :5001  UI → http://localhost:4000', 'color:#34d399;font-weight:bold');
}

/* ================================================================
   STATE
================================================================ */
export const S = {
    reports:   {},
    folders:   {},       // { folderName: [id, ...] }
    templates: {},       // { id: { id, name, permComments, tasks:[{desc,comments}] } }
    attachments: {},     // { folderName: [attachment, ...] } — folder-level documents
    procedures: {},      // { folderName: [procedure, ...] } — site procedures/guidelines
    equipment:   {},       // { id: { id, name, model, serialNumber, category, status, currentHolder, notes, updatedAt } }
    currentId:      null,
    currentFolder:  null,   // folder currently shown in the main view
    currentMode:    'report',   // 'report' | 'template'
    currentTplId:   null,
    currentUser: null,   // Firebase Auth user (set by onAuthStateChanged in app.js)
    canEditTemplates: false, // per-user grant, kept live by apiSubscribeTemplatePermission (admin is always true — see canEditTemplates())
    pad:         null,   // technician signature pad
    customerPad: null,   // customer signature pad
    taskCounter: 0,
    unsaved: false,
    pendingDeleteFolder: null,
    pendingRenameFolder: null,
    pendingSiteCodeFolder: null,
    siteCodes:   {},     // { folderName: code }, kept live per open folder by apiSubscribeSiteCode
    importParsed: null,   // { name, tasks }
};

/* ================================================================
   RBAC HELPERS
================================================================ */
export const ADMIN_EMAIL_SINGLE = 'sagi.tisson@oficiency.com';

/** Returns true if the currently logged-in user is the system administrator. */
export function isAdmin() {
    return (S.currentUser?.email || '').toLowerCase().trim() === ADMIN_EMAIL_SINGLE;
}

/** Returns true if the current user may create/edit/delete templates.
 *  Admins always can; everyone else needs an explicit grant (team_directory
 *  canEditTemplates field), set by the admin in ManagerPanel. This is
 *  unrelated to canEditReport() — editing tasks inside an already-open
 *  report is a separate permission from editing the shared templates. */
export function canEditTemplates() {
    return isAdmin() || S.canEditTemplates === true;
}

/** Returns true if the current user may edit report r.
 *  Admins can always edit. For regular technicians, they can only edit
 *  reports they created (matched by createdBy email). Legacy reports
 *  that have no createdBy field are treated as editable by anyone. */
export function canEditReport(r) {
    if (isAdmin()) return true;
    const email = S.currentUser?.email || '';
    if (!email) return false;
    if (!r?.createdBy) return true; // legacy report — no creator stored
    return email === r.createdBy;
}

/* ================================================================
   REPORT STATUS
   Single source of truth for the pending/in_progress/completed badge
   shown across the home dashboard, folder history cards, and saved to
   Firestore — previously three separate, drifted reimplementations of
   this same calculation lived in api.js/ui.js/HomeTab.js, disagreeing
   both on reports with no checklist and on which task outcomes count
   as "handled". Use this everywhere instead of recomputing locally.
================================================================ */
/** Returns 'pending' | 'in_progress' | 'completed' for a report.
 *  A task counts as "handled" the moment it has ANY recorded outcome —
 *  OK, not-OK, flagged for review, or a range reading — not just the
 *  positive ones; a report where every item was inspected and marked
 *  "not OK" is just as complete as one where everything passed.
 *  A report with no checklist at all (fault/other/daily-log style,
 *  free-text only) is always 'completed' — there's no per-item
 *  progress to track, and no separate "mark as done" control exists. */
export function computeReportStatus(report) {
    if (report.serviceType === 'weld_inspection') {
        const rows     = report.weldInspection?.rows || [];
        const answered = rows.filter(row => row.fitUpResult && row.visualResult).length;
        if (rows.length === 0)          return 'completed';
        if (answered === rows.length)   return 'completed';
        if (answered > 0)               return 'in_progress';
        return 'pending';
    }
    const tasks    = (report.tasks || []).filter(t => t.type !== 'section');
    const answered = tasks.filter(t => t.status && t.status !== 'pending').length;
    if (tasks.length === 0)          return 'completed';
    if (answered === tasks.length)   return 'completed';
    if (answered > 0)                return 'in_progress';
    return 'pending';
}

/** The 4 service-type categories shown in breakdown charts (home
 *  dashboard, folder history). Single source of truth for their
 *  labels/colors so the two chart renderers can't drift apart. */
export const SERVICE_TYPES = [
    { val: 'routine', label: 'ביקור תקופתי', color: 'blue'  },
    { val: 'fault',   label: 'תקלה',          color: 'red'   },
    { val: 'extra',   label: 'טיפול נוסף',    color: 'amber' },
    { val: 'other',   label: 'אחר',            color: 'slate' },
];

/** Display label for every report type, including the two (daily_log,
 *  weld_inspection) that aren't part of the 4-way SERVICE_TYPES chart
 *  breakdown. Single source of truth — used for the "מה סוג הטיפול?"
 *  picker, the open report's badge, and report-card badges. */
export const REPORT_TYPE_LABELS = {
    routine: 'ביקור תקופתי', fault: 'תקלה', extra: 'טיפול נוסף', other: 'אחר',
    daily_log: 'יומן עבודה יומי', weld_inspection: 'בדיקת ריתוך ויזואלי',
};

/** Tallies a list of reports by service type, defaulting anything
 *  unrecognised (or missing) to 'other'. Returns { routine, fault,
 *  extra, other } counts. */
export function countByServiceType(reports) {
    const knownVals = new Set(SERVICE_TYPES.map(t => t.val));
    const counts = {};
    SERVICE_TYPES.forEach(t => { counts[t.val] = 0; });
    reports.forEach(r => {
        const v = r.serviceType && knownVals.has(r.serviceType) ? r.serviceType : 'other';
        counts[v]++;
    });
    return counts;
}

/* ================================================================
   FIRESTORE HELPERS
================================================================ */
/** Firestore rejects `undefined`. Recursively drop undefined keys
 *  and undefined array elements. Leaves null/strings/numbers/bools alone. */
function _sanitize(obj) {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
        return obj.filter(v => v !== undefined).map(_sanitize);
    }
    if (typeof obj === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(obj)) {
            if (v !== undefined) out[k] = _sanitize(v);
        }
        return out;
    }
    return obj;
}

/** Convert a data: URL to a Blob without fetch() — reliable on mobile Safari/PWA. */
function _dataUrlToBlob(dataUrl) {
    const sep    = dataUrl.indexOf(',');
    const mime   = dataUrl.slice(5, dataUrl.indexOf(';'));
    const binary = atob(dataUrl.slice(sep + 1));
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

/** Upload a data: URL to the given Storage path and return its public download URL.
 *  If value is already an https:// URL (or empty/null) it is returned unchanged. */
async function _uploadIfDataUrl(value, storagePath) {
    if (!value || typeof value !== 'string' || !value.startsWith('data:')) return value || '';
    const blob    = _dataUrlToBlob(value);
    const fileRef = ref(storage, storagePath);
    await uploadBytes(fileRef, blob);
    return await getDownloadURL(fileRef);
}

/** Download a Firebase Storage https:// URL and return it as a data: URL.
 *  Tries three strategies in order:
 *  1. <img crossOrigin="anonymous"> → canvas.toDataURL()  (works when Storage returns CORS headers)
 *  2. Firebase Storage SDK getBlob()                       (auth-aware, bypasses browser CORS)
 *  3. plain fetch() with AbortController timeout           (last resort)
 *  Returns '' on total failure so callers gracefully skip missing assets. */
export async function fetchStorageDataUrl(url) {
    if (!url || url.startsWith('data:')) return url || '';
    console.log('[STORAGE] fetching:', url.slice(0, 100));

    // Strategy 1: Image element → canvas.toDataURL().
    // Firebase Storage download URLs include an auth token and return
    // Access-Control-Allow-Origin: * — crossOrigin fetch works if that header is present.
    try {
        const dataUrl = await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const timer = setTimeout(() => {
                img.src = '';
                reject(new Error('img-timeout'));
            }, 10000);
            img.onload = () => {
                clearTimeout(timer);
                try {
                    const c = document.createElement('canvas');
                    c.width  = img.naturalWidth  || 1;
                    c.height = img.naturalHeight || 1;
                    c.getContext('2d').drawImage(img, 0, 0);
                    resolve(c.toDataURL('image/png'));
                } catch (taintErr) {
                    reject(taintErr);
                }
            };
            img.onerror = () => { clearTimeout(timer); reject(new Error('img-error')); };
            img.src = url;
        });
        console.log('[STORAGE] strategy-1 (img→canvas) OK, len:', dataUrl.length);
        return dataUrl;
    } catch (imgErr) {
        console.warn('[STORAGE] strategy-1 failed:', imgErr.message);
    }

    // Strategy 2: Firebase Storage SDK getBlob() — carries Firebase auth, avoids CORS entirely.
    const pathMatch = url.match(/\/o\/([^?#]+)/);
    if (pathMatch) {
        try {
            const storagePath = decodeURIComponent(pathMatch[1]);
            const fileRef = ref(storage, storagePath);
            const timeout = new Promise((_, rej) =>
                setTimeout(() => rej(new Error('timeout')), 12000));
            const blob = await Promise.race([getBlob(fileRef), timeout]);
            const dataUrl = await _blobToDataUrl(blob);
            console.log('[STORAGE] strategy-2 (getBlob) OK, len:', dataUrl.length);
            return dataUrl;
        } catch (sdkErr) {
            console.warn('[STORAGE] strategy-2 (getBlob) failed:', sdkErr.message);
        }
    }

    // Strategy 3: plain fetch with AbortController timeout.
    try {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 10000);
        try {
            const resp = await fetch(url, { signal: ctrl.signal });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const dataUrl = await _blobToDataUrl(await resp.blob());
            console.log('[STORAGE] strategy-3 (fetch) OK, len:', dataUrl.length);
            return dataUrl;
        } finally {
            clearTimeout(tid);
        }
    } catch (fetchErr) {
        console.error('[STORAGE] all strategies failed for:', url.slice(0, 100), fetchErr.message);
        return '';
    }
}

function _blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onloadend = () => resolve(fr.result);
        fr.onerror   = reject;
        fr.readAsDataURL(blob);
    });
}

/* ================================================================
   APP STATE – folders / templates / taskCounter
   נשמר ישירות בתוך מסמך יחיד ב-Firestore תחת האוסף "config"
================================================================ */
export function persist() {
    const state = { folders: S.folders, templates: S.templates, taskCounter: S.taskCounter };
    // 1. שמירה מקומית מיידית לגיבוי אופליין
    localStorage.setItem('trs_v2', JSON.stringify(state));
    // 2. שמירה בענן (Fire-and-forget)
    apiSaveAppState(state).catch(e => console.warn('[PERSIST] backend sync failed:', e));
}

async function apiSaveAppState(state) {
    // שומר את מצב האפליקציה בתוך מסמך קבוע שנקרא appstate
    await setDoc(doc(db, "config", "appstate"), _sanitize(state));
}

/* ================================================================
   LIVE UPDATES – cross-device sync
   Consumers register a callback via subscribeToChanges(); we invoke it
   every time a Firestore snapshot delivers new data. This is how a folder
   created on the phone shows up on the desktop without a reload, and how
   writes that completed *after* the previous session closed become visible
   on next open.
================================================================ */
const _onChangeCallbacks = [];
let _unsubscribers = [];

export function subscribeToChanges(cb) {
    _onChangeCallbacks.push(cb);
    return () => {
        const i = _onChangeCallbacks.indexOf(cb);
        if (i >= 0) _onChangeCallbacks.splice(i, 1);
    };
}

function _notifyChanged() {
    for (const cb of _onChangeCallbacks) {
        try { cb(); } catch (e) { console.error('[onChange]', e); }
    }
}

/* ================================================================
   BOOT – attach live listeners and wait for first snapshot from each
================================================================ */
export async function hydrate() {
    // Tear down any prior listeners (e.g. on a re-hydrate after sign-out).
    _unsubscribers.forEach(u => { try { u(); } catch {} });
    _unsubscribers = [];

    const ready = { appstate: false, reports: false, attachments: false, procedures: false, equipment: false };
    let resolveReady;
    const readyPromise = new Promise(r => { resolveReady = r; });
    const checkReady = () => {
        if (ready.appstate && ready.reports && ready.attachments && ready.procedures && ready.equipment) resolveReady();
    };

    // 1. appstate doc (folders / templates / taskCounter)
    _unsubscribers.push(onSnapshot(
        doc(db, "config", "appstate"),
        (snap) => {
            if (snap.exists()) {
                const state = snap.data();
                S.folders     = state.folders     || {};
                S.templates   = state.templates   || {};
                S.taskCounter = state.taskCounter || 0;
                try { localStorage.setItem('trs_v2', JSON.stringify(state)); } catch {}
            }
            ready.appstate = true;
            checkReady();
            _notifyChanged();
        },
        (err) => {
            console.warn('[HYDRATE] appstate listener error:', err.message);
            if (!ready.appstate) {
                try {
                    const raw = localStorage.getItem('trs_v2');
                    if (raw) {
                        const d = JSON.parse(raw);
                        S.folders     = d.folders     || {};
                        S.templates   = d.templates   || {};
                        S.taskCounter = d.taskCounter || 0;
                    }
                } catch {}
            }
            ready.appstate = true;
            checkReady();
        }
    ));

    // 2. reports collection
    _unsubscribers.push(onSnapshot(
        collection(db, "reports"),
        (snap) => {
            const localDeleted  = new Set(JSON.parse(localStorage.getItem('trs_deleted') || '[]'));
            const remoteDeleted = new Set(); // IDs explicitly marked isDeleted:true in Firestore
            const latest = {};
            snap.forEach(docSnap => {
                const row = docSnap.data();
                // Hard-exclude any document the server has flagged as deleted.
                // This propagates to ALL connected clients the moment the admin
                // writes isDeleted:true — before the actual deleteDoc completes.
                if (row.isDeleted) { remoteDeleted.add(docSnap.id); return; }
                const r   = row.report_data;
                if (!r || !r.id) return;
                if (localDeleted.has(r.id)) return;
                // Don't overwrite the report the user is currently editing
                // with unsaved changes — but once saved, let Firestore win.
                if (r.id === S.currentId && S.unsaved && S.reports[r.id]) {
                    latest[r.id] = S.reports[r.id];
                } else {
                    latest[r.id] = { ...r, _backendId: docSnap.id };
                }
            });
            // If the currently-open report is missing from this snapshot
            // (transient gap between local write and server confirmation),
            // keep the in-memory copy — but NOT if Firestore flagged it deleted.
            if (S.currentId && !latest[S.currentId] && S.reports[S.currentId]
                    && !remoteDeleted.has(S.currentId)) {
                latest[S.currentId] = S.reports[S.currentId];
            }
            S.reports = latest;
            ready.reports = true;
            checkReady();
            _notifyChanged();
        },
        (err) => {
            console.error('[HYDRATE] reports listener error:', err);
            ready.reports = true;
            checkReady();
        }
    ));

    // 3. attachments collection
    _unsubscribers.push(onSnapshot(
        collection(db, "attachments"),
        (snap) => {
            S.attachments = {};
            snap.forEach(docSnap => {
                const a = { id: docSnap.id, ...docSnap.data() };
                const key = a.folder_id || '';
                if (!S.attachments[key]) S.attachments[key] = [];
                S.attachments[key].push(a);
            });
            ready.attachments = true;
            checkReady();
            _notifyChanged();
        },
        (err) => {
            console.warn('[HYDRATE] attachments listener error:', err.message);
            ready.attachments = true;
            checkReady();
        }
    ));

    // 4. procedures collection
    _unsubscribers.push(onSnapshot(
        collection(db, "procedures"),
        (snap) => {
            S.procedures = {};
            snap.forEach(docSnap => {
                const p = { id: docSnap.id, ...docSnap.data() };
                const key = p.folder_id || '';
                if (!S.procedures[key]) S.procedures[key] = [];
                S.procedures[key].push(p);
            });
            ready.procedures = true;
            checkReady();
            _notifyChanged();
        },
        (err) => {
            console.warn('[HYDRATE] procedures listener error:', err.message);
            ready.procedures = true;
            checkReady();
        }
    ));

    // 5. equipment collection
    _unsubscribers.push(onSnapshot(
        collection(db, "equipment"),
        (snap) => {
            S.equipment = {};
            snap.forEach(docSnap => {
                const item = { id: docSnap.id, ...docSnap.data() };
                S.equipment[item.id] = item;
            });
            ready.equipment = true;
            checkReady();
            _notifyChanged();
        },
        (err) => {
            console.warn('[HYDRATE] equipment listener error:', err.message);
            ready.equipment = true;
            checkReady();
        }
    ));

    // 5-second cap so the app boots even if Firestore is unreachable; the
    // listeners keep running in the background and will fill in data when
    // it eventually arrives.
    await Promise.race([
        readyPromise,
        new Promise(r => setTimeout(r, 5000)),
    ]);
}

/* ================================================================
   API – REPORTS (Firestore)
================================================================ */

/** שמירת דוח באוסף "reports" בענן.
 *  Large binary fields (images, signatures) are stripped out of the Firestore
 *  document and uploaded to Firebase Storage instead — Firestore docs are
 *  capped at 1 MB and a single phone photo would blow past that.
 *  The in-memory report is mutated so subsequent saves skip already-uploaded
 *  blobs (they're plain https URLs by then, not data: URLs). */
export async function apiSaveReport(report) {
    const id = report.id;

    // 1. Upload all binary fields in parallel — every data: URL goes to Storage
    //    so the Firestore document only ever contains short https:// strings
    //    (Firestore docs are capped at 1 MB; one phone photo exceeds that).
    const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

    const [resolvedImages, techSig, custSig] = await Promise.all([
        Promise.all(
            (report.images || []).map((src, i) => {
                if (!src || !src.startsWith('data:')) return Promise.resolve(src || '');
                const mime = src.slice(5, src.indexOf(';'));
                const ext  = extMap[mime] || 'jpg';
                return _uploadIfDataUrl(src, `reports/${id}/img_${i}_${Date.now()}.${ext}`);
            })
        ),
        _uploadIfDataUrl(report.tech?.sig       || '', `reports/${id}/sig_tech.png`),
        _uploadIfDataUrl(report.customerSig     || '', `reports/${id}/sig_cust.png`),
    ]);

    report.images = resolvedImages;
    if (report.tech) report.tech.sig = techSig;
    report.customerSig = custSig;

    // 2. Derive a denormalised status field for cheap dashboard queries.
    const reportPayload = _sanitize({
        technician_name:  report.tech?.name || '',
        customer_name:    report.customer   || '',
        work_description: report.title      || '',
        status: computeReportStatus(report),
        report_data: report,
        updatedAt: new Date().toISOString()
    });

    // 3. setDoc with the frontend uid so the same report id is reused on update.
    await setDoc(doc(db, "reports", report.id), reportPayload);

    return { id: report.id, ...reportPayload };
}

/** משיכת כל הדוחות מ-Firestore */
export async function apiGetReports() {
    const querySnapshot = await getDocs(collection(db, "reports"));
    const reports = [];
    querySnapshot.forEach((doc) => {
        reports.push({ id: doc.id, ...doc.data() });
    });
    return reports;
}

/** משיכת דוח בודד לפי ה-ID שלו */
export async function apiGetReportById(backendId) {
    const docSnap = await getDoc(doc(db, "reports", backendId));
    if (!docSnap.exists()) throw new Error("Report not found in Firebase");
    return { id: docSnap.id, ...docSnap.data() };
}

/** מחיקת דוח מ-Firestore לפי ה-ID.
 *  Writes isDeleted:true first so every connected client's onSnapshot fires
 *  and immediately removes the report from their S.reports — before the
 *  hard deleteDoc completes or in case it is temporarily delayed. */
export async function apiDeleteReport(frontendUid) {
    const docRef = doc(db, "reports", frontendUid);
    try { await updateDoc(docRef, { isDeleted: true }); } catch {}
    await deleteDoc(docRef);
}

/** שמירת בקשת הרשמה חדשה — ממתינה לאישור מנהל */
export async function apiSubmitRegistrationRequest(name, email, password) {
    await addDoc(collection(db, 'registration_requests'), _sanitize({
        name,
        email,
        password,
        status:      'pending',
        requestedAt: serverTimestamp(),
    }));
}

/** מנוי חי לבקשות הרשמה ממתינות — מחזיר פונקציית ביטול */
export function apiSubscribePendingRegistrations(cb) {
    const q = query(
        collection(db, 'registration_requests'),
        where('status', '==', 'pending')
    );
    return onSnapshot(q,
        (snap) => {
            const reqs = [];
            snap.forEach(d => reqs.push({ id: d.id, ...d.data() }));
            cb(reqs);
        },
        (err) => { console.error('[ADMIN] pending requests listener:', err); cb([]); }
    );
}

/** Signs into a secondary Firebase app as the target user and deletes their Auth account.
 *  Errors are caught and logged — they must not block the Firestore write that follows. */
async function _deleteAuthAccount(email, password) {
    const secondaryApp = initializeApp(firebaseConfig, `del-${Date.now()}`);
    try {
        const secondaryAuth = initializeAuth(secondaryApp, { persistence: inMemoryPersistence });
        const cred = await signInWithEmailAndPassword(secondaryAuth, email, password);
        await cred.user.delete();
        console.log('[AUTH DELETE] removed auth account for', email);
    } catch (e) {
        // Not fatal — account may already be gone, password may have changed, etc.
        console.warn('[AUTH DELETE] could not remove auth account for', email, ':', e.code, e.message);
    } finally {
        await deleteApp(secondaryApp);
    }
}

/** אישור בקשה: יצירת משתמש Firebase Auth דרך אפליקציה משנית, ועדכון סטטוס */
export async function apiApproveRegistration(docId, name, email, password) {
    const secondaryApp = initializeApp(firebaseConfig, `reg-${Date.now()}`);
    try {
        const secondaryAuth = initializeAuth(secondaryApp, { persistence: inMemoryPersistence });
        try {
            const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
            await updateProfile(cred.user, { displayName: name });
        } catch (authErr) {
            if (authErr.code === 'auth/email-already-in-use') {
                // Auth account already exists (previously approved or created externally).
                // Treat as success and proceed to mark approved in Firestore.
                console.log('[APPROVE] auth account already exists for', email, '— continuing to Firestore update');
            } else {
                throw authErr; // unexpected — propagate to caller
            }
        }
    } finally {
        await deleteApp(secondaryApp);
    }
    await updateDoc(doc(db, 'registration_requests', docId), {
        status:     'approved',
        approvedAt: serverTimestamp(),
    });
    await apiSyncTeamDirectory(name, email);
}

/** דחיית בקשה: מחיקה מ-Firebase Auth ועדכון סטטוס ב-Firestore */
export async function apiRejectRegistration(docId) {
    const reqSnap = await getDoc(doc(db, 'registration_requests', docId));
    if (reqSnap.exists()) {
        const { email, password } = reqSnap.data();
        if (email && password) await _deleteAuthAccount(email, password);
    }
    await updateDoc(doc(db, 'registration_requests', docId), {
        status:     'rejected',
        rejectedAt: serverTimestamp(),
    });
}

/* ================================================================
   API – ATTACHMENTS (Firebase Storage + Firestore)
================================================================ */

/** העלאת קובץ ל-Firebase Storage ושמירת המטא-דאטה שלו ב-Firestore */
export async function apiUploadDocument(file, folderName = '') {
    console.log('[UPLOAD TO FIREBASE] file:', file.name, 'folder:', folderName);
    
    // 1. העלאת הקובץ הפיזי לשרת הקבצים של גוגל בנתיב מוגדר
    const storageRef = ref(storage, `attachments/${folderName}/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    
    // 2. חילוץ קישור ישיר ומאובטח לקובץ
    const downloadUrl = await getDownloadURL(storageRef);

    const attachmentPayload = _sanitize({
        filename: file.name,
        file_type: file.type,
        file_size: file.size,
        folder_id: folderName,
        file_path: downloadUrl, // הלינק החי לאינטרנט
        storage_path: storageRef.fullPath, // נשמור את הנתיב בשביל מחיקות בעתיד
        created_at: new Date().toISOString(),
    });

    // 3. שמירת הרישום של הקובץ במסד הנתונים כדי שהאפליקציה תדע להציג אותו
    const docRef = await addDoc(collection(db, "attachments"), attachmentPayload);
    
    return { id: docRef.id, ...attachmentPayload };
}

/** משיכת רשימת כל הקבצים המצורפים מ-Firestore */
export async function apiGetAllAttachments() {
    const querySnapshot = await getDocs(collection(db, "attachments"));
    const attachments = [];
    querySnapshot.forEach((doc) => {
        attachments.push({ id: doc.id, ...doc.data() });
    });
    return attachments;
}

/** מחיקת קובץ גם מ-Storage וגם מ-Firestore */
export async function apiDeleteAttachment(id) {
    // 1. שליפת נתוני הקובץ כדי לדעת איפה הוא יושב ב-Storage
    const docRef = doc(db, "attachments", id);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.storage_path) {
            // 2. מחיקת הקובץ הפיזי משרת הקבצים
            const fileRef = ref(storage, data.storage_path);
            await deleteObject(fileRef).catch(e => console.warn("File in storage already deleted or missing:", e));
        }
    }
    // 3. מחיקת הרישום מתוך מסד הנתונים
    await deleteDoc(docRef);
}

/** העלאת נוהל/מסמך הנחיות לתיקייה ספציפית */
export async function apiUploadProcedure(file, folderName = '') {
    const storageRef = ref(storage, `procedures/${folderName}/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(storageRef);
    const payload = _sanitize({
        filename:     file.name,
        file_type:    file.type,
        file_size:    file.size,
        folder_id:    folderName,
        file_path:    downloadUrl,
        storage_path: storageRef.fullPath,
        uploaded_at:  new Date().toISOString(),
    });
    const docRef = await addDoc(collection(db, "procedures"), payload);
    return { id: docRef.id, ...payload };
}

/** מחיקת נוהל מ-Storage וגם מ-Firestore */
export async function apiDeleteProcedure(id) {
    const docRef  = doc(db, "procedures", id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.storage_path) {
            const fileRef = ref(storage, data.storage_path);
            await deleteObject(fileRef).catch(e => console.warn('[PROC] storage delete skipped:', e.message));
        }
    }
    await deleteDoc(docRef);
}

/** משיכת קבצים השייכים לתיקייה ספציפית */
export async function apiGetFolderUploads(folderName) {
    const querySnapshot = await getDocs(collection(db, "attachments"));
    const attachments = [];
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.folder_id === folderName) {
            attachments.push({ id: doc.id, ...data });
        }
    });
    return attachments;
}

/* ================================================================
   API – EQUIPMENT (Firestore)
================================================================ */
export async function apiAddEquipment(item) {
    const payload = _sanitize({ ...item, updatedAt: new Date().toISOString() });
    const docRef = await addDoc(collection(db, "equipment"), payload);
    return { id: docRef.id, ...payload };
}

export async function apiUpdateEquipment(id, updates) {
    const payload = _sanitize({ ...updates, updatedAt: new Date().toISOString() });
    await updateDoc(doc(db, "equipment", id), payload);
    return payload;
}

export async function apiDeleteEquipment(id) {
    await deleteDoc(doc(db, "equipment", id));
}

/** Reads the password-free public team directory (name + email only).
 *  Any signed-in user may read this — see firestore.rules. It is kept in
 *  sync with approved registration_requests by apiSyncTeamDirectory() /
 *  apiBackfillTeamDirectory() below, since registration_requests itself
 *  also stores plaintext passwords and can no longer be broadly read. */
export async function apiGetApprovedUsers() {
    const snap = await getDocs(collection(db, 'team_directory'));
    const users = [];
    snap.forEach(d => {
        const data = d.data();
        if (data.name && data.email) users.push({ id: d.id, name: data.name, email: data.email, canEditTemplates: data.canEditTemplates === true });
    });
    return users.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** Upserts a {name, email} entry into the public team directory. Admin-only
 *  write per firestore.rules. Email is used as the document id. Merges
 *  rather than overwrites, so it never clobbers an already-granted
 *  canEditTemplates flag on a re-sync/backfill. */
async function apiSyncTeamDirectory(name, email) {
    await setDoc(doc(db, 'team_directory', email), _sanitize({ name, email, updatedAt: new Date().toISOString() }), { merge: true });
}

/** Grants or revokes template-editing permission for a technician.
 *  Admin-only write per firestore.rules. */
export async function apiSetTemplatePermission(email, allowed) {
    await setDoc(doc(db, 'team_directory', email), { canEditTemplates: !!allowed }, { merge: true });
}

/** Subscribes to the current user's own template-editing permission.
 *  Calls cb(true|false) on every change. Returns an unsubscribe function. */
export function apiSubscribeTemplatePermission(email, cb) {
    return onSnapshot(doc(db, 'team_directory', email),
        (snap) => cb(snap.exists() && snap.data().canEditTemplates === true),
        (err) => { console.warn('[TEMPLATE PERM] subscribe failed:', err.message); cb(false); }
    );
}

/* ================================================================
   DOCUMENT NUMBERING (site_codes → Cloud Function → OFIC-<code>-SER-<n>)
================================================================ */
const _assignReportNumberFn   = httpsCallable(functions, 'assignReportNumber');
const _peekNextReportNumberFn = httpsCallable(functions, 'peekNextReportNumber');

/** Read-only live estimate of the next document number for a folder —
 *  reserves nothing, purely a preview for display before the report is
 *  actually saved. Returns null (never throws) on any failure. */
export async function apiPeekReportNumber(folderName) {
    if (!folderName) return null;
    try {
        const { data } = await _peekNextReportNumberFn({ folderName });
        return data?.number || null;
    } catch (e) {
        console.warn('[DOC NUMBER] peek failed:', e.message);
        return null;
    }
}

/** Reserves the next sequential document number for a report, scoped
 *  to its folder's site code. Call this only on the report's first real
 *  save (never on creation) — this actually consumes a number, unlike
 *  apiPeekReportNumber. Returns null (never throws) if the folder
 *  has no site code configured yet, or if the Cloud Function call itself
 *  fails — callers must treat this as "leave the number field manual",
 *  never as a reason to block saving. */
export async function apiAssignReportNumber(report) {
    try {
        const { data } = await _assignReportNumberFn({
            folderName:       report.folder,
            customer:         report.customer,
            site:             report.site,
            visitDate:        report.visitDate,
            title:            report.title,
            serviceType:      report.serviceType,
            periodicInterval: report.periodicInterval,
        });
        return data?.number || null;
    } catch (e) {
        console.warn('[DOC NUMBER] assignment failed, leaving manual:', e.message);
        return null;
    }
}

/** Subscribes to a folder's site code (e.g. "נשר מלט" → "NES"). Calls
 *  cb(code|null) on every change. Returns an unsubscribe function. */
export function apiSubscribeSiteCode(folderName, cb) {
    return onSnapshot(doc(db, 'site_codes', folderName),
        (snap) => cb(snap.exists() ? snap.data().code : null),
        (err) => { console.warn('[SITE CODE] subscribe failed:', err.message); cb(null); }
    );
}

/** Sets/changes a folder's site code. Admin-only write per firestore.rules. */
export async function apiSetSiteCode(folderName, code) {
    await setDoc(doc(db, 'site_codes', folderName), { code: code.trim().toUpperCase() }, { merge: true });
}

/** Removes a user from the public team directory (called on access revoke). */
async function apiRemoveFromTeamDirectory(email) {
    try { await deleteDoc(doc(db, 'team_directory', email)); } catch (e) { console.warn('[TEAM DIR] remove failed:', e.message); }
}

/** One-time (idempotent) backfill: mirrors every already-approved
 *  registration_requests record into team_directory. Safe to call on every
 *  admin login — setDoc overwrites are cheap and harmless if already synced.
 *  Only the admin can call this successfully (registration_requests reads
 *  and team_directory writes are both admin-only per firestore.rules). */
export async function apiBackfillTeamDirectory() {
    const q = query(
        collection(db, 'registration_requests'),
        where('status', '==', 'approved')
    );
    const snap = await getDocs(q);
    const jobs = [];
    snap.forEach(d => {
        const data = d.data();
        if (data.name && data.email) jobs.push(apiSyncTeamDirectory(data.name, data.email));
    });
    await Promise.all(jobs);
}

/** ביטול גישה: מחיקת חשבון Firebase Auth ועדכון סטטוס ב-Firestore */
export async function apiRevokeUserAccess(docId) {
    const reqSnap = await getDoc(doc(db, 'registration_requests', docId));
    if (reqSnap.exists()) {
        const { email, password } = reqSnap.data();
        if (email && password) await _deleteAuthAccount(email, password);
        if (email) await apiRemoveFromTeamDirectory(email);
    }
    await updateDoc(doc(db, 'registration_requests', docId), {
        status:    'rejected',
        revokedAt: serverTimestamp(),
    });
}

export function apiSubscribeRecentHandoverLogs(n, cb) {
    const q = query(
        collection(db, 'equipment_logs'),
        orderBy('timestamp', 'desc'),
        limit(n)
    );
    return onSnapshot(q,
        (snap) => {
            const logs = [];
            snap.forEach(d => logs.push({ id: d.id, ...d.data() }));
            cb(logs);
        },
        (err) => { console.warn('[LOGS] handover logs listener:', err.message); cb([]); }
    );
}

export async function apiLogEquipmentHandover(logData) {
    const payload = _sanitize({
        senderName:    logData.senderName,
        recipientName: logData.recipientName,
        recipientEmail: logData.recipientEmail || '',
        tools:         logData.tools,   // [{ id, name, serialNumber }]
        timestamp:     new Date().toISOString(),
        createdAt:     serverTimestamp(),
    });
    const docRef = await addDoc(collection(db, "equipment_logs"), payload);
    return { id: docRef.id, ...payload };
}

/* ================================================================
   API – AUTH GUARD (approval check + real-time session revocation)
================================================================ */

/** Returns true if the given email has an approved registration record. */
export async function apiCheckUserApproval(email) {
    const q = query(
        collection(db, 'registration_requests'),
        where('email', '==', email),
        where('status', '==', 'approved')
    );
    const snap = await getDocs(q);
    return !snap.empty;
}

/** Subscribes to the user's registration status.
 *  Calls cb('approved') or cb('not_approved') on every change.
 *  Returns an unsubscribe function. */
export function apiSubscribeUserStatus(email, cb) {
    const q = query(
        collection(db, 'registration_requests'),
        where('email', '==', email)
    );
    return onSnapshot(q,
        (snap) => {
            let approved = false;
            snap.forEach(d => { if (d.data().status === 'approved') approved = true; });
            cb(approved ? 'approved' : 'not_approved');
        },
        (err) => { console.warn('[AUTH-GUARD] status listener error:', err.message); }
    );
}

/* ================================================================
   API – DRAFT AUTO-SAVE (text fields + task states, no images/sigs)
================================================================ */
export async function apiSaveDraftFields(reportId, snapshot) {
    try {
        await setDoc(doc(db, 'report_drafts', reportId), { ...snapshot, reportId });
    } catch (e) {
        console.warn('[DRAFT] Firestore backup failed:', e.message);
    }
}

export async function apiClearDraftFields(reportId) {
    try {
        await deleteDoc(doc(db, 'report_drafts', reportId));
    } catch {}
}

/* ================================================================
   UTILS
================================================================ */
export function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
export function today(){ return new Date().toISOString().split('T')[0]; }
export function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
export const escHtml = esc;
export function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('he-IL'); } catch { return d; }
}

export function fileIcon(type) {
    if (!type) return '📎';
    if (type.includes('pdf'))   return '📄';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('sheet') || type.includes('excel'))   return '📊';
    if (type.includes('image')) return '🖼️';
    return '📎';
}

export function formatFileSize(bytes) {
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
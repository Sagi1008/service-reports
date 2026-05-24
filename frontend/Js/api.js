/* ================================================================
   FIREBASE CONFIG & INITIALIZATION
================================================================ */
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    initializeFirestore, persistentLocalCache, getFirestore,
    doc, setDoc, getDoc, collection, addDoc, getDocs, deleteDoc,
    onSnapshot, serverTimestamp, query, where, updateDoc, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    getStorage, ref, uploadBytes, getDownloadURL, deleteObject, getBlob
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import {
    initializeAuth, browserSessionPersistence, inMemoryPersistence,
    signInWithEmailAndPassword, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// מפתחות החיבור שקיבלת מהקונסול של Firebase שלך
const firebaseConfig = {
  apiKey: "AIzaSyCcqnXeV1VXdMODF0E0wiqGNjkdCVFBHbU",
  authDomain: "oficiency-1bbf9.firebaseapp.com",
  projectId: "oficiency-1bbf9",
  storageBucket: "oficiency-1bbf9.firebasestorage.app",
  messagingSenderId: "38007578536",
  appId: "1:38007578536:web:24a10e19eb109864b9c79d",
  measurementId: "G-9Z5QVVb3CM"
};

// אתחול Firebase ושירותי הענן
console.log('[FIREBASE] apiKey prefix:', firebaseConfig.apiKey.slice(0, 5));
const app = initializeApp(firebaseConfig);
let db;
try {
    db = initializeFirestore(app, { localCache: persistentLocalCache() });
} catch (e) {
    console.warn('[FIREBASE] Offline persistence unavailable, falling back:', e.message);
    db = getFirestore(app);
}
const storage = getStorage(app);
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export { signInWithEmailAndPassword, signOut, onAuthStateChanged };

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
    pad:         null,   // technician signature pad
    customerPad: null,   // customer signature pad
    taskCounter: 0,
    unsaved: false,
    pendingDeleteFolder: null,
    pendingRenameFolder: null,
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
            const deleted = new Set(JSON.parse(localStorage.getItem('trs_deleted') || '[]'));
            const latest = {};
            snap.forEach(docSnap => {
                const row = docSnap.data();
                const r   = row.report_data;
                if (!r || !r.id) return;
                if (deleted.has(r.id)) return;
                // Don't overwrite the report the user is currently editing
                // with unsaved changes — but once saved, let Firestore win.
                if (r.id === S.currentId && S.unsaved && S.reports[r.id]) {
                    latest[r.id] = S.reports[r.id];
                } else {
                    latest[r.id] = { ...r, _backendId: docSnap.id };
                }
            });
            // If the currently-open report is missing from this snapshot
            // (e.g. transient gap between local write and server confirm),
            // keep the in-memory copy so the editor never loses its subject.
            if (S.currentId && !latest[S.currentId] && S.reports[S.currentId]) {
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

    // 2. Derive denormalised status fields for cheap dashboard queries.
    const tasks    = (report.tasks || []).filter(t => t.type !== 'section');
    const performed = tasks.filter(t => t.status === 'performed').length;
    const status   = tasks.length === 0     ? 'pending'
                   : performed === tasks.length ? 'completed'
                   : performed > 0              ? 'in_progress'
                   :                              'pending';

    const reportPayload = _sanitize({
        technician_name:  report.tech?.name || '',
        customer_name:    report.customer   || '',
        work_description: report.title      || '',
        status,
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

/** מחיקת דוח מ-Firestore לפי ה-ID */
export async function apiDeleteReport(frontendUid) {
    await deleteDoc(doc(db, "reports", frontendUid));
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

export async function apiGetApprovedUsers() {
    const q = query(
        collection(db, 'registration_requests'),
        where('status', '==', 'approved')
    );
    const snap = await getDocs(q);
    const users = [];
    snap.forEach(d => {
        const data = d.data();
        if (data.name && data.email) users.push({ id: d.id, name: data.name, email: data.email });
    });
    return users.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** ביטול גישה: מחיקת חשבון Firebase Auth ועדכון סטטוס ב-Firestore */
export async function apiRevokeUserAccess(docId) {
    const reqSnap = await getDoc(doc(db, 'registration_requests', docId));
    if (reqSnap.exists()) {
        const { email, password } = reqSnap.data();
        if (email && password) await _deleteAuthAccount(email, password);
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
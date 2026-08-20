'use strict';
/**
 * Automated validation of firestore.rules and storage.rules against the
 * Firebase emulators. Run with:
 *
 *   firebase emulators:exec --only firestore,storage --project oficiency-1bbf9 "node tests/rules.test.js"
 *
 * Exits with code 1 if any check fails.
 */
const fs = require('fs');
const path = require('path');
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, collection, addDoc } = require('firebase/firestore');
const { ref, uploadBytes, getBytes } = require('firebase/storage');

const PROJECT_ID = 'oficiency-1bbf9-rules-test';
const ADMIN_EMAIL = 'sagi.tisson@oficiency.com';
const TECH_A = 'techa@oficiency.com';
const TECH_B = 'techb@oficiency.com';

let pass = 0, fail = 0;
async function check(label, fn) {
    try {
        await fn();
        pass++;
        console.log(`  ✅  ${label}`);
    } catch (e) {
        fail++;
        console.log(`  ❌  ${label}`);
        console.log(`       ${e.message.split('\n')[0]}`);
    }
}

(async () => {
    const testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
            host: 'localhost',
            port: 8080,
        },
        storage: {
            rules: fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8'),
            host: 'localhost',
            port: 9199,
        },
    });

    const anon   = testEnv.unauthenticatedContext();
    const admin  = testEnv.authenticatedContext('admin-uid',  { email: ADMIN_EMAIL });
    const techA  = testEnv.authenticatedContext('techa-uid',  { email: TECH_A });
    const techB  = testEnv.authenticatedContext('techb-uid',  { email: TECH_B });

    // ── Seed data bypassing rules (as the real app's server-side state) ──
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'reports', 'r_owned_by_a'), {
            technician_name: 'A', customer_name: '', work_description: '', status: 'pending',
            report_data: { id: 'r_owned_by_a', createdBy: TECH_A, title: 'Report A' },
        });
        await setDoc(doc(db, 'reports', 'r_legacy_no_owner'), {
            technician_name: '', customer_name: '', work_description: '', status: 'pending',
            report_data: { id: 'r_legacy_no_owner', title: 'Legacy report' },
        });
        await setDoc(doc(db, 'registration_requests', 'req_a'), {
            name: 'Tech A', email: TECH_A, password: 'secret123', status: 'approved',
        });
    });

    console.log('\n== FIRESTORE: reports ==');
    const dbAnon  = anon.firestore();
    const dbA     = techA.firestore();
    const dbB     = techB.firestore();
    const dbAdmin = admin.firestore();

    await check('anon cannot read reports', () =>
        assertFails(getDoc(doc(dbAnon, 'reports', 'r_owned_by_a'))));

    await check('anon cannot create a report', () =>
        assertFails(setDoc(doc(dbAnon, 'reports', 'r_new'), { report_data: {} })));

    await check('signed-in tech can read any report', () =>
        assertSucceeds(getDoc(doc(dbB, 'reports', 'r_owned_by_a'))));

    await check('signed-in tech can create a report', () =>
        assertSucceeds(setDoc(doc(dbA, 'reports', 'r_new_a'), {
            report_data: { id: 'r_new_a', createdBy: TECH_A },
        })));

    await check('owner can update their own report', () =>
        assertSucceeds(updateDoc(doc(dbA, 'reports', 'r_owned_by_a'), { status: 'completed' })));

    await check('non-owner CANNOT update another tech\'s report', () =>
        assertFails(updateDoc(doc(dbB, 'reports', 'r_owned_by_a'), { status: 'completed' })));

    await check('admin can update any report', () =>
        assertSucceeds(updateDoc(doc(dbAdmin, 'reports', 'r_owned_by_a'), { status: 'completed' })));

    await check('any tech can update a legacy report with no createdBy', () =>
        assertSucceeds(updateDoc(doc(dbB, 'reports', 'r_legacy_no_owner'), { status: 'completed' })));

    await check('non-owner CANNOT delete another tech\'s report', () =>
        assertFails(require('firebase/firestore').deleteDoc(doc(dbB, 'reports', 'r_owned_by_a'))));

    console.log('\n== FIRESTORE: config/appstate ==');
    await check('anon cannot write appstate', () =>
        assertFails(setDoc(doc(dbAnon, 'config', 'appstate'), { folders: {} })));
    await check('signed-in tech can write appstate', () =>
        assertSucceeds(setDoc(doc(dbA, 'config', 'appstate'), { folders: {}, templates: {}, taskCounter: 0 })));

    console.log('\n== FIRESTORE: registration_requests (contains plaintext passwords) ==');
    await check('anon can submit a pending registration request', () =>
        assertSucceeds(addDoc(collection(dbAnon, 'registration_requests'), {
            name: 'New Guy', email: 'new@oficiency.com', password: 'abcdef', status: 'pending',
        })));

    await check('anon CANNOT self-approve at creation (status=approved rejected)', () =>
        assertFails(addDoc(collection(dbAnon, 'registration_requests'), {
            name: 'Sneaky', email: 'sneaky@oficiency.com', password: 'abcdef', status: 'approved',
        })));

    await check('non-admin tech CANNOT read another user\'s registration request', () =>
        assertFails(getDoc(doc(dbB, 'registration_requests', 'req_a'))));

    await check('a user CAN read their own registration request', () =>
        assertSucceeds(getDoc(doc(dbA, 'registration_requests', 'req_a'))));

    await check('admin CAN read any registration request', () =>
        assertSucceeds(getDoc(doc(dbAdmin, 'registration_requests', 'req_a'))));

    await check('non-admin CANNOT approve/change status', () =>
        assertFails(updateDoc(doc(dbA, 'registration_requests', 'req_a'), { status: 'approved' })));

    await check('admin CAN change status', () =>
        assertSucceeds(updateDoc(doc(dbAdmin, 'registration_requests', 'req_a'), { status: 'rejected' })));

    console.log('\n== FIRESTORE: equipment / equipment_logs ==');
    await check('anon cannot read equipment', () =>
        assertFails(getDoc(doc(dbAnon, 'equipment', 'e1'))));
    await check('signed-in tech can create equipment', () =>
        assertSucceeds(setDoc(doc(dbA, 'equipment', 'e1'), { name: 'Drill', status: 'storage' })));
    await check('signed-in tech can create a handover log', () =>
        assertSucceeds(addDoc(collection(dbA, 'equipment_logs'), { senderName: 'A', recipientName: 'B', tools: [] })));

    console.log('\n== FIRESTORE: default deny ==');
    await check('unknown collection is denied even for admin', () =>
        assertFails(setDoc(doc(dbAdmin, 'some_future_collection', 'x'), { a: 1 })));

    console.log('\n== STORAGE: reports/{id}/... ==');
    const stAnon  = anon.storage();
    const stA     = techA.storage();
    const stB     = techB.storage();
    const stAdmin = admin.storage();
    const tinyBytes = new Uint8Array([1, 2, 3]);

    await check('anon cannot upload a report image', () =>
        assertFails(uploadBytes(ref(stAnon, 'reports/r_owned_by_a/img_0.jpg'), tinyBytes)));

    await check('owner CAN upload to their own report folder', () =>
        assertSucceeds(uploadBytes(ref(stA, 'reports/r_owned_by_a/img_0.jpg'), tinyBytes)));

    // Storage does not cross-check Firestore report ownership (see
    // storage.rules for why) — any signed-in tech may upload here, same
    // as attachments/procedures. Real content-ownership enforcement is
    // at the Firestore layer, verified separately above.
    await check('any signed-in tech can upload to a report folder (no cross-service owner check)', () =>
        assertSucceeds(uploadBytes(ref(stB, 'reports/r_owned_by_a/img_1.jpg'), tinyBytes)));

    await check('admin CAN upload to any report folder', () =>
        assertSucceeds(uploadBytes(ref(stAdmin, 'reports/r_owned_by_a/img_2.jpg'), tinyBytes)));

    await check('signed-in tech CAN upload to a brand-new report id (no Firestore doc yet)', () =>
        assertSucceeds(uploadBytes(ref(stB, 'reports/r_not_in_firestore_yet/img_0.jpg'), tinyBytes)));

    console.log('\n== STORAGE: attachments / procedures ==');
    await check('anon cannot upload an attachment', () =>
        assertFails(uploadBytes(ref(stAnon, 'attachments/SiteX/doc.pdf'), tinyBytes)));
    await check('signed-in tech can upload an attachment', () =>
        assertSucceeds(uploadBytes(ref(stA, 'attachments/SiteX/doc.pdf'), tinyBytes)));
    await check('signed-in tech can upload a procedure', () =>
        assertSucceeds(uploadBytes(ref(stA, 'procedures/SiteX/manual.pdf'), tinyBytes)));

    await testEnv.cleanup();

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
});

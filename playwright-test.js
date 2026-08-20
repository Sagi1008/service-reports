const { chromium } = require('playwright');

const EMAIL = process.env.OFICIENCY_TEST_EMAIL;
const PASS  = process.env.OFICIENCY_TEST_PASSWORD;
const URL   = 'http://localhost:5000';

if (!EMAIL || !PASS) {
    console.error('Set OFICIENCY_TEST_EMAIL and OFICIENCY_TEST_PASSWORD env vars before running this script.');
    process.exit(1);
}
const TIMEOUT = 15000;

let consoleErrors = [];
let consoleWarnings = [];
let failedRequests = [];

function log(msg) { console.log(`[TEST] ${msg}`); }
function pass(msg) { console.log(`  ✅  ${msg}`); }
function fail(msg) { console.log(`  ❌  ${msg}`); }
function warn(msg) { console.log(`  ⚠️   ${msg}`); }
function section(msg) { console.log(`\n══ ${msg} ══`); }

async function waitForSelector(page, sel, opts = {}) {
    return page.waitForSelector(sel, { timeout: TIMEOUT, ...opts });
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Capture all console output
    page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        if (type === 'error') {
            consoleErrors.push(text);
            console.log(`  [console.error] ${text}`);
        } else if (type === 'warning') {
            consoleWarnings.push(text);
        }
    });
    page.on('pageerror', err => {
        consoleErrors.push(`[PAGE ERROR] ${err.message}`);
        console.log(`  [pageerror] ${err.message}`);
    });
    // Capture failed network requests
    page.on('requestfailed', req => {
        const url = req.url();
        // Skip extension/browser-internal URLs
        if (!url.startsWith('chrome-extension://') && !url.startsWith('devtools://')) {
            failedRequests.push({ url, failure: req.failure()?.errorText });
        }
    });
    page.on('response', resp => {
        const status = resp.status();
        const url = resp.url();
        if (status === 404 || status === 400 || status === 500) {
            // Skip known noisy Firebase/browser URLs
            const skip = ['favicon', 'google-analytics', 'firebaselogging', 'crashlytics', 'fcmregistrations', 'iid/v1'];
            if (!skip.some(s => url.includes(s))) {
                failedRequests.push({ url, status });
            }
        }
    });

    // ──────────────────────────────────────────────
    section('1. PAGE LOAD');
    // ──────────────────────────────────────────────
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    const title = await page.title();
    log(`Page title: ${title}`);
    if (title.includes('Oficiency')) pass('Page title contains "Oficiency"');
    else fail(`Unexpected title: ${title}`);

    // ──────────────────────────────────────────────
    section('2. LOGIN SCREEN');
    // ──────────────────────────────────────────────
    const loginScreen = await page.$('#loginScreen');
    if (loginScreen) pass('Login screen is present');
    else { fail('Login screen not found'); }

    // Fill credentials
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPassword', PASS);
    log(`Filled credentials: ${EMAIL}`);

    // Submit login
    await page.click('#loginBtn');
    log('Clicked login button, waiting for auth...');

    // ──────────────────────────────────────────────
    section('3. POST-LOGIN DASHBOARD');
    // ──────────────────────────────────────────────
    // Wait for login screen to disappear (hidden class or display:none)
    try {
        await page.waitForFunction(
            () => {
                const ls = document.getElementById('loginScreen');
                if (!ls) return true;
                const style = window.getComputedStyle(ls);
                return style.display === 'none' || style.visibility === 'hidden' || ls.classList.contains('hidden');
            },
            { timeout: 20000 }
        );
        pass('Login screen hidden — user is authenticated');
    } catch (e) {
        fail('Login screen still visible after 20s — login may have failed');
        // Try to get error text
        const errEl = await page.$('#loginError');
        if (errEl) {
            const errText = await errEl.innerText();
            if (errText) fail(`Login error message: ${errText}`);
        }
        await browser.close();
        process.exit(1);
    }

    // Wait for sidebar body to populate
    await page.waitForTimeout(3000); // allow Firestore to load
    const sidebarBody = await page.$('#sidebarBody');
    if (sidebarBody) pass('Sidebar body rendered');
    else fail('Sidebar body not found');

    // Check user email displayed
    const userEmailEl = await page.$('#userEmail');
    if (userEmailEl) {
        const emailText = await userEmailEl.innerText();
        log(`Displayed user email: ${emailText}`);
        if (emailText.toLowerCase().includes('sagi') || emailText.includes('@')) {
            pass(`User email displayed: ${emailText}`);
        } else {
            warn(`User email element empty or unexpected: "${emailText}"`);
        }
    } else {
        fail('User email element not found');
    }

    // Check sidebar has report list or folder items
    await page.waitForTimeout(2000);
    const sidebarContent = await page.$eval('#sidebarBody', el => el.innerHTML.trim());
    if (sidebarContent.length > 10) {
        pass(`Sidebar has content (${sidebarContent.length} chars)`);
    } else {
        warn('Sidebar body appears empty — no reports loaded yet?');
    }

    // ──────────────────────────────────────────────
    section('4. CONSOLE ERRORS (so far — dashboard load)');
    // ──────────────────────────────────────────────
    if (consoleErrors.length === 0) {
        pass('No console errors during page load + login + dashboard');
    } else {
        fail(`${consoleErrors.length} console error(s) detected:`);
        consoleErrors.forEach(e => console.log(`    • ${e}`));
    }

    // ──────────────────────────────────────────────
    section('5. NEW REPORT MODAL');
    // ──────────────────────────────────────────────
    // Click "דוח חדש" (new report button)
    const newReportBtn = await page.$('.btn-sb-primary');
    if (newReportBtn) {
        await newReportBtn.click();
        log('Clicked "+ דוח חדש" button');
        await page.waitForTimeout(800);

        // Check if new report modal / form opened
        const newReportModal = await page.$('#newReportModal');
        const reportModal2   = await page.$('.modal.active, .modal[style*="flex"], .modal[style*="block"]');
        if (newReportModal || reportModal2) {
            pass('New report modal opened');
            // Close it
            const closeBtn = await page.$('.modal.active .modal-close, .modal-overlay.active .close-btn, button[onclick*="hideModal"]');
            if (closeBtn) {
                await closeBtn.click();
                log('Closed new report modal');
            } else {
                await page.keyboard.press('Escape');
                log('Pressed Escape to close modal');
            }
        } else {
            // Maybe the modal is identified differently
            const anyModal = await page.$$eval('.modal', modals =>
                modals.map(m => ({ id: m.id, display: window.getComputedStyle(m).display }))
            );
            log('Visible modals: ' + JSON.stringify(anyModal.filter(m => m.display !== 'none')));
            warn('New report modal not clearly detected — check manually');
        }
    } else {
        fail('New report button (.btn-sb-primary) not found');
    }

    // ──────────────────────────────────────────────
    section('6. NAVIGATION — LOGO / DASHBOARD');
    // ──────────────────────────────────────────────
    const logo = await page.$('#sidebarLogo');
    if (logo) {
        await logo.click();
        await page.waitForTimeout(500);
        pass('Clicked sidebar logo to show dashboard');
    } else {
        warn('Sidebar logo (#sidebarLogo) not found');
    }

    // ──────────────────────────────────────────────
    section('7. REPORTS LIST — OPEN FIRST REPORT');
    // ──────────────────────────────────────────────
    // Sidebar uses .row-item, dashboard uses .dash-card
    const firstReport = await page.$('.row-item, .dash-card:not(.dash-card-doc)');
    if (firstReport) {
        const reportName = await firstReport.$eval('.row-name, .dash-card-title', el => el.innerText).catch(() => '(unknown)');
        log(`Found report: "${reportName}" — clicking`);
        await firstReport.click();
        await page.waitForTimeout(2000);
        pass(`Opened report: "${reportName}"`);

        // Check main content area — the report editor uses #reportEditor
        const reportEditor = await page.$('#reportEditor, #reportArea, .report-editor');
        if (reportEditor) {
            const editorVisible = await reportEditor.evaluate(el => {
                const s = window.getComputedStyle(el);
                return s.display !== 'none' && s.visibility !== 'hidden';
            });
            if (editorVisible) {
                pass('Report editor (#reportEditor) is visible');
            } else {
                warn('Report editor element found but may not be visible');
            }
        } else {
            warn('Report editor not found — checking for any main content');
        }
    } else {
        warn('No report items found in sidebar/dashboard (.row-item or .dash-card) — may be empty');
        // Log sidebar HTML snippet for debugging
        const sidebarHtml = await page.$eval('#sidebarBody', el => el.innerHTML.slice(0, 400)).catch(() => '');
        if (sidebarHtml) log(`Sidebar HTML snippet: ${sidebarHtml.replace(/\n/g,' ').slice(0,300)}`);
    }

    // ──────────────────────────────────────────────
    section('7b. CREATE NEW REPORT FLOW');
    // ──────────────────────────────────────────────
    // Open new report modal again
    const newBtn2 = await page.$('.btn-sb-primary');
    if (newBtn2) {
        await newBtn2.click();
        await page.waitForTimeout(800);

        // Check if modal or a direct form appeared
        const modalVisible = await page.$('.modal.active, #newReportModal');
        if (modalVisible) {
            log('New report modal is open');
            // Try to find a "blank" option or confirm button
            const blankBtn = await page.$('[onclick*="confirmNewReport"], .tpl-option, .btn-blank-report');
            if (blankBtn) {
                await blankBtn.click();
                await page.waitForTimeout(1500);
                pass('Selected blank report template');
            } else {
                // Try confirm button or first option
                const firstOption = await page.$('.tpl-card, .template-option, .new-report-option');
                if (firstOption) {
                    await firstOption.click();
                    await page.waitForTimeout(500);
                    const confirmBtn = await page.$('[onclick*="confirmNewReport"], .btn-confirm-new-report, .btn-confirm');
                    if (confirmBtn) {
                        await confirmBtn.click();
                        await page.waitForTimeout(1500);
                        pass('Confirmed new report creation');
                    }
                } else {
                    // Close the modal and skip
                    await page.keyboard.press('Escape');
                    warn('Could not find template options in new report modal');
                }
            }
        } else {
            warn('New report modal did not open on second click');
        }
    }

    // ──────────────────────────────────────────────
    section('8. FINAL CONSOLE ERROR CHECK');
    // ──────────────────────────────────────────────
    await page.waitForTimeout(2000);
    const errorsAfterNav = consoleErrors.filter(e =>
        !e.includes('ResizeObserver loop') &&
        !e.includes('Non-Error promise rejection')
    );
    if (errorsAfterNav.length === 0) {
        pass('No critical console errors after navigation');
    } else {
        fail(`${errorsAfterNav.length} console error(s) after navigation:`);
        errorsAfterNav.forEach(e => console.log(`    • ${e}`));
    }

    // ──────────────────────────────────────────────
    section('SUMMARY');
    // ──────────────────────────────────────────────
    log(`Total console errors: ${consoleErrors.length}`);
    log(`Total console warnings: ${consoleWarnings.length}`);
    log(`Total failed/bad-status requests: ${failedRequests.length}`);

    if (failedRequests.length > 0) {
        section('FAILED/BAD-STATUS REQUESTS DETAIL');
        failedRequests.forEach(r => {
            console.log(`  [${r.status || r.failure || '?'}] ${r.url}`);
        });
    }
    if (consoleWarnings.length > 0) {
        warn('Warnings:');
        consoleWarnings.forEach(w => console.log(`    • ${w}`));
    }

    await browser.close();
})();

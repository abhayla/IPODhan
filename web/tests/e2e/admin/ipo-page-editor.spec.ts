/**
 * The admin editor on the public IPO page, end to end (spec §9.2 items 1, 2, 3, 12, 13, 21, 24).
 *
 * Needs the TEST database (ipodhan_test, e.g. through the tunnel) and a running app; skipped when no
 * database is configured, so CI without a database skips it instead of failing. Run locally:
 *   PROD_BASE_URL=http://localhost:3100 EDITOR_E2E_BASE_URL=http://localhost:3100 \
 *     npx playwright test tests/e2e/admin/ipo-page-editor.spec.ts --project=chromium
 * (PROD_BASE_URL only stops playwright.config from booting its own server.)
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import {
  BSE_ISSUE_SIZE,
  DOC_ISSUE_SIZE,
  SESSION_COOKIE,
  fixtureDbConfig,
  readIssueSize,
  removeEditorFixture,
  seedEditorFixture,
  type EditorFixture,
} from './fixtures/ipo-editor-fixture';

const BASE = process.env.EDITOR_E2E_BASE_URL ?? 'http://localhost:3000';
const db = fixtureDbConfig();

test.describe('IPO page editor', () => {
  test.skip(!db || db.database !== 'ipodhan_test', 'needs the ipodhan_test database');
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let fx: EditorFixture;
  test.beforeAll(async () => {
    fx = await seedEditorFixture();
  });
  test.afterAll(async () => {
    await removeEditorFixture();
  });

  const asAdmin = async (context: BrowserContext) =>
    context.addCookies([{ name: SESSION_COOKIE, value: fx.sessionToken, url: BASE, httpOnly: true, sameSite: 'Lax' }]);

  test('a reader sees no Edit control and no source values', async ({ page, request }) => {
    const res = await request.get(`${BASE}/ipos/${fx.slug}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    // The page shows the current (BSE) figure; the document's witness value is admin-only (item 24).
    expect(html).toContain('₹700.00 Cr');
    expect(html).not.toContain(DOC_ISSUE_SIZE);
    expect(html).not.toContain('witnesses');
    expect(html).not.toContain('admin-edit-');
    expect(html).not.toContain('Edit this IPO');

    const api = await request.get(`${BASE}/api/admin/ipos/${fx.ipoId}/editor`);
    expect(api.status()).toBe(401);

    await page.goto(`${BASE}/ipos/${fx.slug}`);
    await expect(page.getByTestId('admin-edit-all')).toHaveCount(0);
  });

  test('an admin picks the offer document value, reloads and sees it with its reader line', async ({ page, context }) => {
    await asAdmin(context);
    await page.goto(`${BASE}/ipos/${fx.slug}?edit=ipos.issue_size`);
    const dialog = page.getByRole('dialog', { name: 'Edit IPO' });
    await expect(dialog).toBeVisible({ timeout: 120_000 });
    const doc = dialog.getByTestId('witness-DOC');
    await expect(doc).toContainText('₹1,000.00 Crores', { timeout: 120_000 });
    await expect(dialog.getByTestId('witness-CHITTORGARH')).toContainText('did not give a value');

    // A pick sends the source label only, never a value (§9.3, OD-109).
    const [req] = await Promise.all([
      page.waitForRequest((r) => r.url().includes('/api/admin/update-field') && r.method() === 'PATCH'),
      doc.getByRole('button', { name: 'Use this' }).click(),
    ]);
    const body = JSON.parse(req.postData() ?? '{}');
    expect(body.mode).toBe('pick');
    expect(body.sourceLabel).toBe('RHP');
    expect(body.value).toBeUndefined();
    await expect(dialog.getByRole('status')).toContainText('Saved', { timeout: 60_000 });

    const stored = await readIssueSize(fx.ipoId);
    expect(stored).toEqual({ issueSize: '10000000000.00', source: 'ADMIN' });

    await page.goto(`${BASE}/ipos/${fx.slug}`);
    await expect(page.getByText('₹1,000.00 Crores').first()).toBeVisible();
    await expect(page.getByText(BSE_ISSUE_SIZE)).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toMatch(/correction/i);
    expect(html).not.toContain('A3 Fixture Admin');
  });

  test('a typed amount previews in the reader unit and needs a source note', async ({ page, context }) => {
    await asAdmin(context);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/ipos/${fx.slug}?edit=ipos.issue_size`);
    const dialog = page.getByRole('dialog', { name: 'Edit IPO' });
    await expect(dialog.getByTestId('witness-DOC')).toBeVisible({ timeout: 120_000 });
    await dialog.locator('input[name="typed-value"]').fill('875');
    await expect(dialog.getByTestId('typed-preview')).toHaveText('stores Rs 8,75,00,00,000, shows ₹875.00 Crores');
    const save = dialog.getByRole('button', { name: 'Save typed value' });
    await expect(save).toBeDisabled();
    await dialog.locator('input[name="source-note"]').fill('RHP page 12, The Offer');
    await save.click();
    await expect(dialog.getByRole('status')).toContainText('Saved', { timeout: 60_000 });
    // Phone (item 21): the use-this button is a large tap target and the panel fills the width.
    const box = await dialog.getByRole('button', { name: 'Use this' }).first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    await page.goto(`${BASE}/ipos/${fx.slug}`);
    await expect(page.getByText('₹875.00 Crores').first()).toBeVisible();
    await expect(page.getByText(/Checked by the IPODhan team/).first()).toBeVisible();
  });
});

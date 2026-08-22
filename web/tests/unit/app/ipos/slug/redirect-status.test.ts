/**
 * Redirect status-code regression test (T-278F, checker finding #1).
 *
 * Next 15.5.4's `redirect()` throws RedirectStatusCode.TemporaryRedirect (307)
 * — a 307 keeps the retired polluted URL indexed and transfers no link equity.
 * The IPO detail page MUST use `permanentRedirect()` (308) for a retired slug
 * (see `web/app/ipos/[slug]/page.tsx`). This asserts the STATUS CODE CLASS
 * directly against the real `next/navigation` implementation rather than a
 * mock, so a regression back to `redirect()` fails this test.
 */
import { describe, it, expect } from 'vitest';
import { redirect, permanentRedirect } from 'next/navigation';

function digestStatusCode(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? '';
    // Digest shape: `NEXT_REDIRECT;<type>;<url>;<statusCode>;`
    return digest.split(';')[3] ?? '';
  }
  throw new Error('expected redirect function to throw');
}

describe('IPO detail page slug redirect — status code class', () => {
  it('permanentRedirect() throws a 308 (permanent) digest', () => {
    expect(digestStatusCode(() => permanentRedirect('/ipos/clean-slug'))).toBe('308');
  });

  it('redirect() throws a 307 (temporary) digest — the regression this guards against', () => {
    expect(digestStatusCode(() => redirect('/ipos/clean-slug'))).toBe('307');
  });

  it('page.tsx source calls permanentRedirect(), never the temporary redirect(), for a retired slug', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../../../app/ipos/[slug]/page.tsx'),
      'utf-8'
    );

    expect(source).toMatch(/permanentRedirect\(`\/ipos\/\$\{redirectSlug\}`\)/);
    // Guard against a bare `redirect(` call on the redirectSlug branch reappearing.
    expect(source).not.toMatch(/(?<!permanent)redirect\(`\/ipos\/\$\{redirectSlug\}`\)/);
  });
});

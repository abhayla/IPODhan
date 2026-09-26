import { NextResponse } from 'next/server';

/**
 * Deployed-SHA endpoint (T-242 M3, supersedes T-229).
 *
 * `NEXT_PUBLIC_BUILD_SHA` / `NEXT_PUBLIC_BUILT_AT` are set by
 * `scripts/deploy-linux.sh` BEFORE `next build` runs, so Next.js inlines
 * them as literal strings into the compiled route at build time (the same
 * mechanism that bakes every other `NEXT_PUBLIC_*` value — see
 * `.claude/rules/web-api-routes.md` / `.claude/rules/react-nextjs.md`).
 * The values are therefore fixed for the life of a release directory and
 * do not depend on what the running process's env happens to be — this is
 * what "baked at build time" means here, and it is what lets a deploy
 * verify `curl .../api/version` actually changed after a flip.
 *
 * `force-static` MUST stay (#568) — it is the whole mechanism above. But a
 * `force-static` route also gets Next's default `s-maxage=31536000` header,
 * and Cloudflare will happily cache THIS route at the edge for a year, so a
 * public read through the CDN can silently return a stale release's sha
 * (the deploy gate itself is unaffected — it reads `127.0.0.1`, which never
 * goes through Cloudflare). The edge cache is stopped in
 * `web/next.config.mjs`'s `headers()` for `/api/version`, not here: Next
 * overrides a `Cache-Control` set on the `NextResponse` itself for a
 * force-static route, so the header has to come from `next.config.mjs`,
 * which is applied after Next's own static-route header and wins.
 */
export const dynamic = 'force-static';

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      data: {
        sha: process.env.NEXT_PUBLIC_BUILD_SHA || 'unknown',
        builtAt: process.env.NEXT_PUBLIC_BUILT_AT || null,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

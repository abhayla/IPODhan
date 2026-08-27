/**
 * GET /api/calendar/materialized/[category] API Route
 *
 * RETIRED (T-330 P2-3): this route queried a `calendar_view` materialized view
 * that was authored in migration 0001_add_calendar_materialized_view.sql but
 * never landed in the journal, so it has never existed in any real database -
 * every request 500'd with "relation calendar_view does not exist". The
 * scraper-side refresh job (scraper/src/jobs/refresh-calendar.ts) that was
 * meant to keep it fresh was never wired into the scheduler either (T-241/
 * T-242 H3 already decided not to build the matview SQL out).
 *
 * This route has no frontend consumer (web/app/api/calendar/[category]/route.ts
 * is the live, JOIN-based calendar endpoint actually used). Rather than build
 * out unused matview + refresh-scheduling infrastructure for a route nothing
 * calls, this retires it honestly: 410 Gone with a pointer to the live route,
 * instead of a public 500 that can never succeed.
 *
 * @route GET /api/calendar/materialized/:category
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      error: {
        code: 'ENDPOINT_RETIRED',
        message:
          "This endpoint depended on a materialized view that was never created in the database and has no consumer. Use GET /api/calendar/[category] instead.",
      },
    },
    { status: 410 }
  );
}

/**
 * Per-IPO pipeline step grid (S-01, spec section 7).
 *
 * Rows = IPOs still generating work (anything not LISTED, plus LISTED within
 * the last 10 days); columns = the B1..J3 catalogue grouped by letter. One
 * cell per (IPO, step), coloured by status, titled with when it last ran,
 * which source satisfied it, and the last error. Clicking a cell with
 * evidence expands the raw JSON (a plain <details>, no client state).
 *
 * Server component: reads the repository directly, never an HTTP API
 * (CLAUDE.md — services and server components use repositories directly).
 */

import Link from 'next/link';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import {
  IpoPipelineStepsRepository,
  type PipelineStepRow,
} from '@ipodhan/shared/repositories/ipo-pipeline-steps-repository';
import { getPipelineStepsByGroup } from '@ipodhan/shared/pipeline/step-catalogue';

export const dynamic = 'force-dynamic';

const STAGES = [
  'UPCOMING',
  'OPEN',
  'CLOSED',
  'LISTED',
  'WITHDRAWN',
] as const;

/**
 * Cell colours per status (spec section 7). SKIPPED is striped rather than a
 * flat colour so "deliberately not run" never reads as a real outcome.
 */
const STATUS_STYLE: Record<string, string> = {
  NOT_DUE: 'bg-gray-600',
  DUE: 'bg-amber-500',
  RUNNING: 'bg-blue-500',
  DONE: 'bg-green-600',
  FAILED: 'bg-red-600',
  NOT_AVAILABLE_YET: 'bg-gray-400',
  BLOCKED: 'bg-red-900',
  SKIPPED:
    'bg-gray-500 [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.35)_0_4px,transparent_4px_8px)]',
};

/** No ledger row at all — the step has never been touched for this IPO. */
const MISSING_STYLE = 'bg-gray-800 border border-dashed border-gray-600';

function cellTitle(stepId: string, row: PipelineStepRow | undefined): string {
  if (!row) return `${stepId}: no ledger row`;
  const parts = [`${stepId}: ${row.status}`, `attempts ${row.attempts}`];
  if (row.lastRunAt) parts.push(`last run ${new Date(row.lastRunAt).toISOString()}`);
  if (row.source) parts.push(`source ${row.source}`);
  if (row.error) parts.push(`error: ${row.error}`);
  return parts.join(' | ');
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const { stage } = await searchParams;
  const validStage = STAGES.includes(stage as (typeof STAGES)[number]) ? stage : undefined;

  const repo = new IpoPipelineStepsRepository(db, getRedisClient());
  const grid = await repo.findGrid({ stage: validStage, limit: 50 });
  const groups = getPipelineStepsByGroup();

  const rowsWithEvidence = grid.ipos.flatMap((ipo) =>
    Object.values(grid.steps[ipo.ipoId] ?? {})
      .filter((row) => row.evidence != null)
      .map((row) => ({ ipo, row }))
  );

  return (
    <div className="min-h-screen bg-gray-900 p-6 text-gray-100">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Pipeline steps</h1>
        <p className="mt-1 text-sm text-gray-400">
          One row per in-flight IPO, one column per catalogue step (B1-J3). Hover a cell for
          timestamp, source and error.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-400">Stage:</span>
        <Link
          href="/admin/pipeline"
          className={`rounded px-3 py-1 ${!validStage ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
        >
          Active
        </Link>
        {STAGES.map((s) => (
          <Link
            key={s}
            href={`/admin/pipeline?stage=${s}`}
            className={`rounded px-3 py-1 ${validStage === s ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'}`}
          >
            {s}
          </Link>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-3 text-xs">
        {Object.entries(STATUS_STYLE).map(([status, cls]) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm ${cls}`} />
            {status}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm ${MISSING_STYLE}`} />
          no row
        </span>
      </div>

      {grid.ipos.length === 0 ? (
        <p className="rounded border border-gray-700 bg-gray-800 p-6 text-gray-400">
          No IPOs match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-700">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-gray-800">
                <th className="sticky left-0 z-10 bg-gray-800 px-3 py-2 text-left font-semibold">
                  IPO
                </th>
                {groups.map((group) => (
                  <th
                    key={group.group}
                    colSpan={group.steps.length}
                    className="border-l border-gray-700 px-2 py-2 text-center font-semibold"
                    title={group.label}
                  >
                    {group.group} — {group.label}
                  </th>
                ))}
              </tr>
              <tr className="bg-gray-800">
                <th className="sticky left-0 z-10 bg-gray-800 px-3 py-1" />
                {groups.flatMap((group) =>
                  group.steps.map((step, i) => (
                    <th
                      key={step.id}
                      className={`px-1 py-1 text-center font-mono font-normal text-gray-400 ${
                        i === 0 ? 'border-l border-gray-700' : ''
                      }`}
                      title={step.label}
                    >
                      {step.id}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {grid.ipos.map((ipo) => (
                <tr key={ipo.ipoId} className="border-t border-gray-700">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-gray-900 px-3 py-2">
                    <Link href={`/ipos/${ipo.slug}`} className="text-blue-400 hover:underline">
                      {ipo.companyName}
                    </Link>
                    <span className="ml-2 text-gray-500">
                      {ipo.symbol ?? '-'} · {ipo.status}
                    </span>
                  </td>
                  {groups.flatMap((group) =>
                    group.steps.map((step, i) => {
                      const row = grid.steps[ipo.ipoId]?.[step.id];
                      return (
                        <td
                          key={step.id}
                          className={`p-0.5 ${i === 0 ? 'border-l border-gray-700' : ''}`}
                        >
                          <span
                            className={`block h-5 w-5 rounded-sm ${
                              row ? (STATUS_STYLE[row.status] ?? MISSING_STYLE) : MISSING_STYLE
                            }`}
                            title={cellTitle(step.id, row)}
                          />
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rowsWithEvidence.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Evidence</h2>
          <div className="space-y-2">
            {rowsWithEvidence.map(({ ipo, row }) => (
              <details
                key={`${ipo.ipoId}-${row.stepId}`}
                className="rounded border border-gray-700 bg-gray-800"
              >
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  <span className="font-mono">{row.stepId}</span> · {ipo.companyName} ·{' '}
                  <span className="text-gray-400">{row.status}</span>
                  {row.source ? <span className="text-gray-500"> · {row.source}</span> : null}
                </summary>
                <pre className="overflow-x-auto border-t border-gray-700 px-3 py-2 text-xs text-gray-300">
                  {JSON.stringify(row.evidence, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Item 42 fix round 1 (#1468, MAJOR-1): how many LISTED IPOs the 22:00 closed-IPO job must give an
// answers-only round (OD-163(b)), and how long that takes at the job's 10-a-day cap.
// Read-only (openReadOnlyPool). Run: node docs/design/probes/item42-listed-round-backlog.mjs
import fs from 'node:fs';
import path from 'node:path';
import { HERE, openReadOnlyPool } from './_lib.mjs';

const pool = await openReadOnlyPool('ipodhan_staging');
try {
  const byOutcome = await pool.query(
    `SELECT coalesce(r.outcome::text, '(never walked)') AS outcome, count(*)::int AS n
       FROM ipos i LEFT JOIN closed_ipo_resourcing r ON r.ipo_id = i.id
      WHERE i.status = 'LISTED' GROUP BY 1 ORDER BY 1`
  );
  const totals = await pool.query(
    `SELECT count(*)::int AS listed,
            count(*) FILTER (WHERE i.hidden_at IS NULL AND i.close_date < CURRENT_DATE)::int AS selectable
       FROM ipos i WHERE i.status = 'LISTED'`
  );
  const hasColumn = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'ipos' AND column_name = 'answers_round_at'`
  );
  const out = {
    measuredAt: new Date().toISOString(),
    database: 'ipodhan_staging',
    listedByOutcome: byOutcome.rows,
    listedTotal: totals.rows[0].listed,
    listedSelectable: totals.rows[0].selectable,
    answersRoundAtColumnPresent: hasColumn.rows[0].n === 1,
    nightsToDrainAt10: Math.ceil(totals.rows[0].selectable / 10),
  };
  fs.writeFileSync(path.join(HERE, 'item42-listed-round-backlog.out.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 2));
} finally {
  await pool.end();
}

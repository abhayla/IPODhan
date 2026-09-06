// Guarded prod row repair: issue_size stored as a share count -> shares x cap (rupees).
// Dry-run by default; --apply writes. Refuses unless the CURRENT value equals the expected share count.
const { Client } = require(process.cwd() + '/node_modules/pg');
const APPLY = process.argv.includes('--apply');
const ROWS = [
  { slug: 'shanti-inorganics-ltd', id: '5d99eb96-70a5-473d-b36a-4d92dc742bf8', shares: 5691200, cap: 83 },
  { slug: 'ashutosh-fibre-ltd',    id: 'f65c491f-bc18-4c05-af21-5a28cb72f4ec', shares: 6124800, cap: 92 },
];
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, options: '-c timezone=UTC' });
  await c.connect();
  const db = (await c.query('select current_database() d')).rows[0].d;
  console.log('database:', db, APPLY ? '(APPLY)' : '(dry run)');
  for (const r of ROWS) {
    const cur = await c.query('select id, slug, issue_size, price_range_max from ipos where slug=$1', [r.slug]);
    if (cur.rowCount !== 1) { console.log(r.slug, 'REFUSED: rowCount', cur.rowCount); continue; }
    const row = cur.rows[0];
    const target = r.shares * r.cap;
    console.log(r.slug, 'current issue_size', row.issue_size, 'cap', row.price_range_max, 'target', target);
    if (row.id !== r.id) { console.log('REFUSED: id mismatch'); continue; }
    if (Number(row.issue_size) !== r.shares) { console.log('SKIP: current value is not the share count (already rewritten?)'); continue; }
    if (Number(row.price_range_max) !== r.cap) { console.log('REFUSED: cap mismatch'); continue; }
    if (!APPLY) continue;
    const upd = await c.query(
      'update ipos set issue_size=$1, updated_at=now() where id=$2 and slug=$3 and issue_size=$4 returning id, slug, issue_size',
      [target, r.id, r.slug, r.shares]);
    console.log('UPDATED', upd.rowCount, JSON.stringify(upd.rows));
  }
  await c.end();
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });

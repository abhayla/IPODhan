import fs from 'fs';
const txt = fs.readFileSync('../web/.env.local', 'utf8');
const m = txt.match(/^DATABASE_URL=(.+)$/m);
process.env.DATABASE_URL = m[1].trim();
const pg = await import('pg');
const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const r = await client.query(`SELECT id, company_name, slug, offering_type, segment, status FROM ipos WHERE slug = 'cube-highways-trust'`);
console.log(r.rows);
// check for any other IPO-typed trust/reit shaped rows
const r2 = await client.query(`SELECT id, company_name, slug, offering_type FROM ipos WHERE offering_type='IPO' AND (company_name ILIKE '%trust%' OR company_name ILIKE '%reit%' OR company_name ILIKE '%invit%')`);
console.log('other IPO-typed trust-shaped rows:', r2.rows);
await client.end();

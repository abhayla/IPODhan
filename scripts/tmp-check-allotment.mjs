import pg from 'pg';
const client = new pg.Client({
  host: '127.0.0.1', port: 15432, user: 'postgres',
  password: process.env.DBPW, database: 'ipodhan'
});
await client.connect();
const r = await client.query(`select company_name, slug, status, allotment_date from ipos where status in ('OPEN','UPCOMING') and allotment_date is not null order by allotment_date`);
console.log('OPEN/UPCOMING with allotment_date:', r.rows.length);
console.log(JSON.stringify(r.rows, null, 2));
const reg = await client.query(`select count(*)::int c from registrars`);
console.log('registrars:', reg.rows[0]);
await client.end();

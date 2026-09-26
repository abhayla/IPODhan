// #983 / OD-38 (spec 2.3.3.3): the nightly floor's view of every row the post-listing price job
// set DELISTED. A DELISTED row must carry exactly the three consecutive delisting reads that set
// it (delisting_strike_reads, ISO instants, oldest first) and delisted_at equal to the third one.
// Anything else is a delisting this rule did not make (a hand edit, another writer, a half write)
// and fails. Every DELISTED row is also DESCRIBED with its three read times, so a false delisting
// is visible to whoever reads the floor the next morning.

export const DELISTING_READS_REQUIRED = 3;

/** One line naming the row and its three reads. */
export function describeDelistedRow(r) {
  const reads = Array.isArray(r.reads) ? r.reads : [];
  return `${r.slug} delisted_at=${r.delistedAt ?? 'NULL'} reads=[${reads.map((x) => `${x?.exchange ?? '?'} ${x?.at ?? '?'}`).join(', ')}]`;
}

/**
 * Returns a violation string, or null for a DELISTED row that carries its evidence.
 * `delistedAt` is the column read as UTC text ("YYYY-MM-DD HH:MM:SS[.fff]").
 */
export function checkDelistedRow(r) {
  const reads = Array.isArray(r.reads) ? r.reads : null;
  if (!reads) return `${r.slug}: DELISTED with no delisting_strike_reads`;
  if (reads.length !== DELISTING_READS_REQUIRED) return `${r.slug}: DELISTED with ${reads.length} read(s), not ${DELISTING_READS_REQUIRED}`;
  const times = reads.map((x) => Date.parse(x?.at));
  if (times.some((t) => !Number.isFinite(t))) return `${r.slug}: a delisting read has no valid instant (${describeDelistedRow(r)})`;
  for (let i = 1; i < times.length; i++) {
    if (!(times[i] > times[i - 1])) return `${r.slug}: delisting reads are not in time order (${describeDelistedRow(r)})`;
  }
  if (Number(r.strikes) < DELISTING_READS_REQUIRED) return `${r.slug}: DELISTED with delisting_strikes=${r.strikes}`;
  if (!r.delistedAt) return `${r.slug}: DELISTED with delisted_at NULL`;
  const delistedAt = Date.parse(String(r.delistedAt).replace(' ', 'T') + 'Z');
  if (delistedAt !== times[times.length - 1]) {
    return `${r.slug}: delisted_at ${r.delistedAt} is not the third read (${reads[reads.length - 1].at})`;
  }
  return null;
}

// prospectus_promoters_peers_yield: the pure per-document judgement, shared by the nightly audit and its
// tests. A document with 0 promoter rows on its IPO passes only when THAT document's own stated absence
// (promoters_stated_none, matched on document_id in the SQL) excuses it; another document's statement on
// the same IPO does not.
export function judgePromotersPeersYield(r) {
  const out = [];
  const tag = `${r.company_name} (${r.doc_type} ${r.document_id.slice(0, 8)})`;
  if (r.promoter_rows === 0 && r.promoters_stated_none !== true) out.push(`${tag}: 0 promoters`);
  if (r.peer_rows === 0 && !/peer_comparison_issuer_states_no_listed_peers/.test(r.e6_evidence ?? '')) {
    const why = ((r.e6_evidence ?? '').match(/"peerReason":"([^"]+)"/) || [])[1] || 'no E6 reason';
    out.push(`${tag}: 0 peers (${why})`);
  }
  return out;
}

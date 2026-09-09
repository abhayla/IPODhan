#!/usr/bin/env node
// docs/design/probes/plan-limits.mjs — OD-45's denominator.
//
// WHY THIS EXISTS. A running-cost table is meaningless without the ceiling it is measured against.
// "The scraper uses 40 GB a month" is a number; "40 GB of the plan's 8,000 GB" is a decision. The
// plan's real limits are therefore fetched from the host, not remembered: the box was described in
// this project's own notes as having 96 GB of disk, and the API says 102,400 MB.
//
// HOW IT READS. The Hostinger API is behind an authenticated MCP tool that only an interactive
// session holds, so this probe does NOT call the API itself. The session calls
// `VPS_getVirtualMachinesV1`, saves the response verbatim as the fixture below, and this probe
// reads that fixture and prints the derived limits. The fixture carries the date it was taken.
// That keeps the standard of proof (OD-25): the claim is a saved payload, not a sentence.
//
//   node docs/design/probes/plan-limits.mjs
//
// EXIT CODES: 0 read and printed · 2 the fixture is missing or unreadable.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'hostinger-plan-2026-09-09.json');
const OUT = path.join(HERE, 'plan-limits.out.json');

try {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const vm = Array.isArray(raw.payload) ? raw.payload[0] : raw.payload;

  const out = {
    probe: 'plan-limits',
    generated_at: new Date().toISOString(),
    source: `Hostinger API VPS_getVirtualMachinesV1, saved verbatim at ${path.relative(HERE, FIXTURE).replace(/\\/g, '/')} on ${raw.fetched_at}`,
    host: vm.hostname,
    ipv4: (vm.ipv4 || []).map((a) => a.address),
    plan: vm.plan,
    template: vm.template && vm.template.name,
    limits: {
      vcpu: vm.cpus,
      memory_mb: vm.memory,
      memory_gb: +(vm.memory / 1024).toFixed(1),
      disk_mb: vm.disk,
      disk_gb: +(vm.disk / 1024).toFixed(1),
      bandwidth_mb_per_month: vm.bandwidth,
      bandwidth_gb_per_month: +(vm.bandwidth / 1024).toFixed(0),
      bandwidth_tb_per_month: +(vm.bandwidth / 1024 / 1024).toFixed(2),
    },
    // What the design is allowed to spend, and why the share is not 100%: this box also serves
    // IPODhan production and staging web, the notifier and firekaro-api. The scraper's budget is
    // stated as a share of the plan so a change to either side is visible.
    scraper_share_of_bandwidth: 0.25,
    scraper_bandwidth_budget_gb_per_month: +((vm.bandwidth / 1024) * 0.25).toFixed(0),
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`${out.plan}: ${out.limits.vcpu} vCPU, ${out.limits.memory_gb} GB RAM, ${out.limits.disk_gb} GB disk, ${out.limits.bandwidth_tb_per_month} TB/month bandwidth`);
  console.log(`scraper budget at ${out.scraper_share_of_bandwidth * 100}% of plan bandwidth: ${out.scraper_bandwidth_budget_gb_per_month} GB/month`);
  process.exit(0);
} catch (err) {
  console.error('plan-limits: the probe itself failed —', err.message);
  process.exit(2);
}

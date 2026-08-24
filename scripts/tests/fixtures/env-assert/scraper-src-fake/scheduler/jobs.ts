// Fixture: ENABLE_PRIMARY_SOURCE_DISCOVERY is mentioned ONLY inside
// scheduler/** (the retired SchedulerService path) -- this must be reported
// as a dead flag, matching the real issue #213 shape.
export function retiredJob() {
  if (process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY === 'true') {
    return 'retired-path-only';
  }
  return null;
}

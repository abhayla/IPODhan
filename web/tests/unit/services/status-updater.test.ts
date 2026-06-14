import { describe, it, expect } from 'vitest';
import { computeTargetStatus } from '@/lib/services/status-updater-service';

/**
 * State-machine coverage for IPO status transitions (GitHub #4/#6).
 * today is fixed so the cases are deterministic.
 */
describe('computeTargetStatus', () => {
  const today = '2026-06-14';

  it('UPCOMING when open date is in the future', () => {
    expect(computeTargetStatus({ openDate: '2026-06-20', closeDate: '2026-06-24', listingDate: null }, today)).toBe('UPCOMING');
  });

  it('OPEN when today is within the bidding window', () => {
    expect(computeTargetStatus({ openDate: '2026-06-12', closeDate: '2026-06-16', listingDate: null }, today)).toBe('OPEN');
  });

  it('CLOSED when the window has passed and not yet listed', () => {
    expect(computeTargetStatus({ openDate: '2026-06-01', closeDate: '2026-06-05', listingDate: null }, today)).toBe('CLOSED');
  });

  it('LISTED when the listing date has arrived', () => {
    expect(computeTargetStatus({ openDate: '2026-05-20', closeDate: '2026-05-24', listingDate: '2026-05-29' }, today)).toBe('LISTED');
  });

  // The bugs this fix targets:
  it('does NOT mark LISTED when the listing date is in the future (#6 premature-listed)', () => {
    const r = computeTargetStatus({ openDate: '2026-06-12', closeDate: '2026-06-16', listingDate: '2026-06-24' }, today);
    expect(r).not.toBe('LISTED');
    expect(r).toBe('OPEN'); // still within window
  });

  it('transitions an UPCOMING whose whole window has passed to CLOSED (#4 stuck-upcoming)', () => {
    expect(computeTargetStatus({ openDate: '2025-12-01', closeDate: '2025-12-05', listingDate: null }, today)).toBe('CLOSED');
  });

  it('transitions an UPCOMING with a reached listing date straight to LISTED', () => {
    expect(computeTargetStatus({ openDate: '2025-12-01', closeDate: '2025-12-05', listingDate: '2025-12-10' }, today)).toBe('LISTED');
  });

  it('returns null when there is not enough date info to decide', () => {
    expect(computeTargetStatus({ openDate: null, closeDate: null, listingDate: null }, today)).toBeNull();
  });

  it('treats close_date == today as still OPEN (boundary)', () => {
    expect(computeTargetStatus({ openDate: '2026-06-10', closeDate: today, listingDate: null }, today)).toBe('OPEN');
  });
});

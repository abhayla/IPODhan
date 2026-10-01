/**
 * #1347: React #418 (hydration mismatch) on /ipos/<slug>.
 *
 * The server (the VPS) renders in UTC; the reader's browser hydrates in IST (or any other zone). A
 * client component whose text depends on the running process's zone renders one string on the
 * server and another in the browser, and React throws #418. Reproduced in a dev build:
 *   IPOScoreSection  "Calculated: Oct 01, 2026 03:10" (server, UTC) vs "08:40" (browser, IST)
 *   TimelineBase     "06 Oct" (server, UTC) vs "05 Oct" (browser, America/Los_Angeles)
 *
 * Each test renders the component's markup under two host zones, as the server and the browser do,
 * and requires the same markup. It also pins the text to IST (.claude/rules/ist-timezone.md).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { IPOScoreSection } from '@/components/ipo/IPOScoreSection';
import { IPOTimelineWidget } from '@/components/ipo/IPOTimelineWidget';
import { DocumentList } from '@/components/ipo/DocumentList';
import { ListingPerformance } from '@/components/ipo/ListingPerformance';
import { AnchorInvestorsSection } from '@/components/ipo/AnchorInvestorsSection';
import { OverallSubscriptionChart } from '@/components/ipo/charts/SubscriptionDashboard/OverallSubscriptionChart';
import {
  transformToTimeSeriesData,
  transformToHeatmapData,
} from '@/components/ipo/charts/SubscriptionDashboard/utils';
import { transformGMPData } from '@/components/ipo/charts/GMPHistoryChart/utils';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

function renderIn(tz: string, el: () => ReactElement): string {
  process.env.TZ = tz;
  return renderToString(el());
}

/** The server zone (UTC on the VPS) against the browser zones readers actually have. */
function expectSameOnEveryHost(el: () => ReactElement): string {
  const server = renderIn('UTC', el);
  for (const browser of ['Asia/Kolkata', 'America/Los_Angeles', 'Asia/Tokyo']) {
    expect(renderIn(browser, el), `markup differs between a UTC server and a ${browser} browser`).toBe(server);
  }
  return server;
}

describe('#1347 the IPO page renders the same text on a UTC server and a non-UTC browser', () => {
  it('IPOScoreSection: "Calculated" time is IST on every host', () => {
    const html = expectSameOnEveryHost(() => (
      <IPOScoreSection
        score={{
          totalScore: 6.4,
          maxScore: 10,
          ratingLabel: 'Good',
          confidencePercent: 70,
          components: [],
          reasoning: null,
          // 03:10 UTC = 08:40 IST
          calculatedAt: new Date('2026-10-01T03:10:00Z'),
          algorithmVersion: 'realtime-v1.0',
          source: 'realtime',
        }}
      />
    ));
    expect(html).toContain('Oct 01, 2026 08:40');
  });

  it('IPOTimelineWidget: milestone dates are the IST calendar day on every host', () => {
    const html = expectSameOnEveryHost(() => (
      <IPOTimelineWidget
        ipo={{
          openDate: '2026-10-06',
          closeDate: '2026-10-08',
          allotmentDate: null,
          listingDate: null,
          status: 'UPCOMING',
        } as never}
      />
    ));
    expect(html).toContain('06 Oct');
    expect(html).toContain('08 Oct');
  });

  it('DocumentList: upload date is the IST calendar day on every host', () => {
    const html = expectSameOnEveryHost(() => (
      <DocumentList
        documents={[
          {
            id: '1',
            type: 'RHP',
            title: 'rhp.pdf',
            url: 'https://www.bseindia.com/downloads/ipo/rhp.pdf',
            fileSize: 1024,
            // 20:00 UTC on the 19th is the 20th in IST
            uploadedAt: new Date('2026-08-19T20:00:00Z'),
          } as never,
        ]}
      />
    ));
    expect(html).toContain('20 Aug 2026');
  });

  it('ListingPerformance: listing date is the IST calendar day on every host', () => {
    const html = expectSameOnEveryHost(() => (
      <ListingPerformance
        issuePrice={100}
        listingOpen={110}
        listingHigh={120}
        listingClose={115}
        listingDate={new Date('2026-09-30T20:00:00Z')}
        listingGainPercent={15}
      />
    ));
    expect(html).toContain('01 Oct 2026');
  });

  it('AnchorInvestorsSection: bid date is the IST calendar day on every host', () => {
    const html = expectSameOnEveryHost(() => (
      <AnchorInvestorsSection
        bidDate="2026-10-04T20:00:00Z"
        totalSharesOffered={1000}
        totalAmountRaised={10}
        anchorInvestorsCount={1}
        lockIn50PercentDate={null}
        lockInRemainingDate={null}
        investorList={null}
      />
    ));
    expect(html).toContain('05 Oct 2026');
  });

  it('OverallSubscriptionChart: "closes" date is the IST calendar day on every host', () => {
    const html = expectSameOnEveryHost(() => (
      <OverallSubscriptionChart
        data={[
          { dateLabel: 'Oct 02', totalSubscription: 3.2, qibSubscription: 1, niiSubscription: 1, retailSubscription: 1 } as never,
        ]}
        stats={{ total: 3.2 } as never}
        // 20:00 UTC on the 7th is the 8th in IST
        closeDate={new Date('2026-10-07T20:00:00Z')}
        status="OPEN"
      />
    ));
    expect(html).toContain('closes Oct 08');
  });

  it('SubscriptionDashboard utils: tick labels are IST on every host', () => {
    const rows = [
      // 18:30 UTC on the 1st = 00:00 IST on the 2nd
      { id: 'a', timestamp: '2026-10-01T18:30:00Z', totalSubscription: 1 },
      { id: 'b', timestamp: '2026-10-03T09:00:00Z', totalSubscription: 2 },
    ];
    const labels = (tz: string) => {
      process.env.TZ = tz;
      return JSON.stringify([
        transformToTimeSeriesData(rows as never).map((p) => p.dateLabel),
        transformToHeatmapData(rows as never).map((p) => p.dateLabel),
        // same-day series gets HH:mm ticks
        transformToTimeSeriesData([
          { id: 'c', timestamp: '2026-10-01T03:10:00Z', totalSubscription: 1 },
          { id: 'd', timestamp: '2026-10-01T05:40:00Z', totalSubscription: 2 },
        ] as never).map((p) => p.dateLabel),
      ]);
    };
    const server = labels('UTC');
    for (const browser of ['Asia/Kolkata', 'America/Los_Angeles', 'Asia/Tokyo']) {
      expect(labels(browser), `labels differ between UTC and ${browser}`).toBe(server);
    }
    expect(JSON.parse(server)).toEqual([
      ['Oct 02', 'Oct 03'],
      ['Oct 02', 'Oct 03'],
      ['08:40', '11:10'],
    ]);
  });

  it('GMPHistoryChart utils: point labels are IST on every host', () => {
    const records = [
      {
        id: '1', ipoId: 'x', gmp: 10, expectedListingPrice: null, subjectRate: null,
        kostakRate: null, saudaDetails: null, source: 's',
        // 20:00 UTC on the 19th is the 20th in IST
        timestamp: new Date('2026-08-19T20:00:00Z'),
      },
    ];
    const labels = (tz: string) => {
      process.env.TZ = tz;
      return transformGMPData(records as never).map((p) => p.date);
    };
    const server = labels('UTC');
    for (const browser of ['Asia/Kolkata', 'America/Los_Angeles', 'Asia/Tokyo']) {
      expect(labels(browser), `labels differ between UTC and ${browser}`).toEqual(server);
    }
    expect(server).toEqual(['20 Aug']);
  });
});

'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';

/** One numbered risk factor from the offer document (`ipo_risk_factors`). */
export interface RiskFactorItem {
  seq: number;
  heading: string;
  body: string | null;
}

interface CompanyOverviewProps {
  companyDescription: string;
  riskFactors?: string[];
  /**
   * Risk factors as extracted from the RHP: the heading is always shown, the
   * body (when the extractor captured one) on expand. Only the first
   * {@link RISK_FACTORS_COLLAPSED} are listed until the reader asks for all.
   */
  riskFactorItems?: RiskFactorItem[];
}

const RISK_FACTORS_COLLAPSED = 5;

/**
 * CompanyOverview component displays company business summary and risk factors
 * Description limited to 500 characters with "Read More" expansion
 * Risk factors displayed in collapsible accordion
 */
export function CompanyOverview({
  companyDescription,
  riskFactors = [],
  riskFactorItems = [],
}: CompanyOverviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAllRisks, setShowAllRisks] = useState(false);
  const visibleRiskItems = showAllRisks
    ? riskFactorItems
    : riskFactorItems.slice(0, RISK_FACTORS_COLLAPSED);
  const characterLimit = 500;
  const shouldTruncate = companyDescription.length > characterLimit;

  const displayText = shouldTruncate && !isExpanded
    ? `${companyDescription.slice(0, characterLimit)}...`
    : companyDescription;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company Overview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Business Summary: no description means nothing to show here (a
            company row can have risk factors extracted from the RHP with no
            price-band-ad description — the risk factors block below still
            renders, see W-103) */}
        {companyDescription && (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
              Business Model
            </h3>
            <div className="space-y-3">
              <p className="text-sm leading-relaxed sm:text-base">
                {displayText}
              </p>
              {shouldTruncate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="h-auto p-0 font-semibold text-primary hover:bg-transparent"
                >
                  {isExpanded ? 'Read Less' : 'Read More'}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Risk factors from the offer document. Headings are the substance
            here - the extractor often captures no body, so the accordion shows
            the heading itself rather than a numbered placeholder. */}
        {riskFactorItems.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
              Risk Factors ({riskFactorItems.length})
            </h3>
            <Accordion type="single" collapsible className="w-full">
              {visibleRiskItems.map((risk) => (
                <AccordionItem key={risk.seq} value={`risk-item-${risk.seq}`}>
                  <AccordionTrigger className="text-left text-sm hover:no-underline">
                    <span>
                      <span className="mr-2 text-muted-foreground">{risk.seq}.</span>
                      {risk.heading}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                    {risk.body ?? risk.heading}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
            {riskFactorItems.length > RISK_FACTORS_COLLAPSED && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllRisks(!showAllRisks)}
                className="mt-3 h-auto p-0 font-semibold text-primary hover:bg-transparent"
              >
                {showAllRisks
                  ? 'Show fewer risk factors'
                  : `Show all ${riskFactorItems.length} risk factors`}
              </Button>
            )}
          </div>
        )}

        {/* Risk Factors */}
        {riskFactors.length > 0 && (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
              Risk Factors
            </h3>
            <Accordion type="single" collapsible className="w-full">
              {riskFactors.map((risk, index) => (
                <AccordionItem key={index} value={`risk-${index}`}>
                  <AccordionTrigger className="text-left text-sm hover:no-underline">
                    Risk Factor {index + 1}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                    {risk}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        )}

        {/* No empty-state placeholder: a section that has nothing renders nothing
            (R17 #1 — reference products treat missing data as invisible). */}
      </CardContent>
    </Card>
  );
}

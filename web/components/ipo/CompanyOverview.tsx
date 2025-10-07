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

interface CompanyOverviewProps {
  companyDescription: string;
  riskFactors?: string[];
}

/**
 * CompanyOverview component displays company business summary and risk factors
 * Description limited to 500 characters with "Read More" expansion
 * Risk factors displayed in collapsible accordion
 */
export function CompanyOverview({
  companyDescription,
  riskFactors = [],
}: CompanyOverviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
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
        {/* Business Summary */}
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

        {/* Placeholder for when no risk factors */}
        {riskFactors.length === 0 && (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
              Risk Factors
            </h3>
            <p className="text-sm text-muted-foreground">
              Risk factors will be added after DRHP analysis
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

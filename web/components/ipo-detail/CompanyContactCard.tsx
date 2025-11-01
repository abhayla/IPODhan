/**
 * CompanyContactCard Component (Story 11.14)
 * Displays company contact information including address, phone, email, and compliance officer details
 */

'use client';

import React from 'react';
import { HiPhone, HiEnvelope, HiMapPin, HiArrowTopRightOnSquare } from 'react-icons/hi2';
import type { IpoDetails } from '@/lib/db/types';

export interface CompanyContactCardProps {
  /**
   * IPO details containing contact information
   */
  ipoDetails: IpoDetails;

  /**
   * Company name to display
   */
  companyName: string;

  /**
   * Optional website URL
   */
  website?: string | null;
}

/**
 * Company Contact Information Card
 * Displays registered office address, contact details, and compliance officer information
 * with clickable phone/email links and Google Maps integration
 */
export function CompanyContactCard({
  ipoDetails,
  companyName,
  website,
}: CompanyContactCardProps) {
  // Check if any contact information exists
  const hasContactInfo =
    ipoDetails.companyAddress ||
    ipoDetails.companyPhone ||
    ipoDetails.companyEmail ||
    ipoDetails.complianceOfficer;

  if (!hasContactInfo) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6">
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Company Contact Information
        </h3>
        <p className="text-sm text-muted-foreground italic">
          Contact information not available
        </p>
      </div>
    );
  }

  // Format full address
  const addressParts = [
    ipoDetails.companyAddress,
    ipoDetails.companyCity,
    ipoDetails.companyState,
    ipoDetails.companyPincode,
  ].filter(Boolean);

  const fullAddress = addressParts.join(', ');

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-foreground">
        Company Contact Information
      </h3>

      {/* Company Details Section */}
      <div className="space-y-4">
        {/* Company Name */}
        <div>
          <p className="text-sm font-medium text-muted-foreground">Company Name</p>
          <p className="text-base font-semibold text-foreground mt-1">{companyName}</p>
        </div>

        {/* Registered Office Address */}
        {ipoDetails.companyAddress && (
          <div>
            <div className="flex items-start gap-3">
              <HiMapPin className="mt-1 h-5 w-5 text-primary flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  Registered Office
                </p>
                <p className="text-sm text-foreground leading-relaxed">
                  {fullAddress}
                </p>
                {fullAddress && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(fullAddress)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    View on Google Maps
                    <HiArrowTopRightOnSquare className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* HiPhone */}
        {ipoDetails.companyPhone && (
          <div>
            <div className="flex items-start gap-3">
              <HiPhone className="mt-1 h-5 w-5 text-primary flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground mb-1">Phone</p>
                <a
                  href={`tel:${ipoDetails.companyPhone}`}
                  className="text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                >
                  {ipoDetails.companyPhone}
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Email */}
        {ipoDetails.companyEmail && (
          <div>
            <div className="flex items-start gap-3">
              <HiEnvelope className="mt-1 h-5 w-5 text-primary flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  Email (Investor Relations)
                </p>
                <a
                  href={`mailto:${ipoDetails.companyEmail}`}
                  className="text-sm text-primary hover:text-primary/80 transition-colors font-medium break-all"
                >
                  {ipoDetails.companyEmail}
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Website */}
        {website && (
          <div>
            <div className="flex items-start gap-3">
              <HiArrowTopRightOnSquare className="mt-1 h-5 w-5 text-primary flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground mb-1">Website</p>
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:text-primary/80 transition-colors font-medium break-all"
                >
                  {website}
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Compliance Officer */}
        {ipoDetails.complianceOfficer && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-3 text-sm font-semibold text-foreground">
              Compliance Officer
            </p>
            <div className="space-y-3 pl-2">
              <p className="text-sm font-medium text-foreground">
                {ipoDetails.complianceOfficer}
              </p>

              {ipoDetails.complianceOfficerPhone && (
                <div className="flex items-center gap-3">
                  <HiPhone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <a
                    href={`tel:${ipoDetails.complianceOfficerPhone}`}
                    className="text-sm text-primary hover:text-primary/80 transition-colors font-medium"
                  >
                    {ipoDetails.complianceOfficerPhone}
                  </a>
                </div>
              )}

              {ipoDetails.complianceOfficerEmail && (
                <div className="flex items-center gap-3">
                  <HiEnvelope className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <a
                    href={`mailto:${ipoDetails.complianceOfficerEmail}`}
                    className="text-sm text-primary hover:text-primary/80 transition-colors font-medium break-all"
                  >
                    {ipoDetails.complianceOfficerEmail}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

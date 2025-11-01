/**
 * Company Contact Section
 * Story 11.14: Company Contact Information Display
 *
 * Displays comprehensive company contact information including:
 * - Registered office address
 * - Contact phone and email (clickable)
 * - Compliance officer details
 *
 * @component
 * @param {Object} contactData - Company contact information from database
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HiBuildingOffice, HiPhone, HiEnvelope, HiMapPin, HiUser } from 'react-icons/hi2';

interface CompanyContactData {
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyCity: string | null;
  companyState: string | null;
  companyPincode: string | null;
  complianceOfficer: string | null;
  complianceOfficerPhone: string | null;
  complianceOfficerEmail: string | null;
}

interface CompanyContactSectionProps {
  contactData: CompanyContactData | null;
}

/**
 * Format complete address from individual components
 */
function formatAddress(data: CompanyContactData): string | null {
  const parts = [
    data.companyAddress,
    data.companyCity,
    data.companyState,
    data.companyPincode,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : null;
}

export function CompanyContactSection({ contactData }: CompanyContactSectionProps) {
  // Don't render if no contact data
  if (!contactData) {
    return null;
  }

  // Check if we have any contact information to display
  const hasContactInfo =
    contactData.companyAddress !== null ||
    contactData.companyPhone !== null ||
    contactData.companyEmail !== null ||
    contactData.companyCity !== null ||
    contactData.companyState !== null ||
    contactData.companyPincode !== null;

  const hasComplianceInfo =
    contactData.complianceOfficer !== null ||
    contactData.complianceOfficerPhone !== null ||
    contactData.complianceOfficerEmail !== null;

  // Don't render if no data available
  if (!hasContactInfo && !hasComplianceInfo) {
    return null;
  }

  const fullAddress = formatAddress(contactData);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <HiBuildingOffice className="h-5 w-5 text-primary" />
          <CardTitle>Company Contact Information</CardTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          Get in touch with the company
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Registered Office Address */}
          {hasContactInfo && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Registered Office</h3>
              <div className="space-y-3">
                {fullAddress && (
                  <div className="flex items-start gap-3">
                    <HiMapPin className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Address</p>
                      <p className="font-medium">{fullAddress}</p>
                    </div>
                  </div>
                )}

                {contactData.companyPhone && (
                  <div className="flex items-start gap-3">
                    <HiPhone className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Phone</p>
                      <a
                        href={`tel:${contactData.companyPhone}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {contactData.companyPhone}
                      </a>
                    </div>
                  </div>
                )}

                {contactData.companyEmail && (
                  <div className="flex items-start gap-3">
                    <HiEnvelope className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Email</p>
                      <a
                        href={`mailto:${contactData.companyEmail}`}
                        className="font-medium text-primary hover:underline break-all"
                      >
                        {contactData.companyEmail}
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Compliance Officer */}
          {hasComplianceInfo && (
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <HiUser className="h-5 w-5" />
                Compliance Officer
              </h3>
              <div className="space-y-3">
                {contactData.complianceOfficer && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Name</p>
                    <p className="font-medium">{contactData.complianceOfficer}</p>
                  </div>
                )}

                {contactData.complianceOfficerPhone && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Phone</p>
                    <a
                      href={`tel:${contactData.complianceOfficerPhone}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {contactData.complianceOfficerPhone}
                    </a>
                  </div>
                )}

                {contactData.complianceOfficerEmail && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Email</p>
                    <a
                      href={`mailto:${contactData.complianceOfficerEmail}`}
                      className="font-medium text-primary hover:underline break-all"
                    >
                      {contactData.complianceOfficerEmail}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Information Note */}
          <div className="text-xs text-muted-foreground border-t pt-4">
            <p>
              <strong>Note:</strong> Contact information is sourced from company regulatory filings.
              For investor queries, please contact the compliance officer or company directly.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

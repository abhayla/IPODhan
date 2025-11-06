/**
 * API Route: DRHP Financial Data Extraction
 * POST /api/ipos/[slug]/drhp-extract
 *
 * Triggers extraction of financial data from DRHP PDF
 * with confidence-based routing
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { drhpExtractorService } from '@/lib/services/drhp-extractor-service';
import { logger, logError } from '@/lib/logging/logger';
import path from 'path';
import fs from 'fs/promises';

// Request body schema
const extractionRequestSchema = z.object({
  pdfUrl: z.string().url().optional(),
  pdfPath: z.string().optional(),
  forceReextract: z.boolean().optional().default(false)
}).refine(data => data.pdfUrl || data.pdfPath, {
  message: 'Either pdfUrl or pdfPath must be provided'
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const startTime = Date.now();

  try {
    const { slug } = await params;

    // Validate slug exists
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const ipo = await ipoRepository.findBySlug(slug);

    if (!ipo) {
      return NextResponse.json(
        {
          error: 'IPO not found',
          slug
        },
        { status: 404 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validationResult = extractionRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request',
          details: validationResult.error.flatten()
        },
        { status: 400 }
      );
    }

    const { pdfUrl, pdfPath, forceReextract } = validationResult.data;

    // Check if extraction already exists
    if (!forceReextract) {
      const status = await drhpExtractorService.getExtractionStatus(slug);
      if (status.hasExtraction) {
        return NextResponse.json({
          success: false,
          message: 'Extraction already exists',
          existingExtraction: {
            confidence: status.confidence,
            action: status.action,
            extractedAt: status.extractedAt
          },
          hint: 'Use forceReextract: true to re-extract'
        }, { status: 409 });
      }
    }

    // Determine PDF source
    let finalPdfPath: string;

    if (pdfPath) {
      // Use provided path
      finalPdfPath = pdfPath;

      // Validate file exists
      try {
        await fs.access(finalPdfPath);
      } catch {
        return NextResponse.json(
          {
            error: 'PDF file not found',
            path: finalPdfPath
          },
          { status: 404 }
        );
      }
    } else if (pdfUrl) {
      // Download PDF from URL
      finalPdfPath = await downloadPdf(pdfUrl, slug);
    } else {
      // Check for existing DRHP in expected location
      const expectedPath = path.join(
        process.cwd(),
        '..',
        'pdf-parser-test',
        'drhps',
        `${slug}.pdf`
      );

      try {
        await fs.access(expectedPath);
        finalPdfPath = expectedPath;
      } catch {
        return NextResponse.json(
          {
            error: 'No PDF source provided and no existing DRHP found',
            expectedPath,
            hint: 'Provide either pdfUrl or pdfPath'
          },
          { status: 400 }
        );
      }
    }

    // Log extraction request
    logger.info('DRHP extraction requested', {
      slug,
      pdfSource: pdfUrl ? 'url' : pdfPath ? 'path' : 'existing',
      forceReextract
    });

    // Trigger extraction
    const result = await drhpExtractorService.extractDRHPData(finalPdfPath, slug);

    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Return extraction result
    if (result.success) {
      return NextResponse.json({
        success: true,
        confidence: result.confidence,
        confidenceLevel: result.confidenceLevel,
        action: result.action,
        data: result.data,
        metadata: {
          ...result.metadata,
          apiResponseTime: responseTime
        },
        message: getActionMessage(result.action)
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error || 'Extraction failed',
          confidence: 0,
          action: 'MANUAL_ENTRY'
        },
        { status: 500 }
      );
    }

  } catch (error) {
    const { slug } = await params;
    logError(error as Error, {
      endpoint: '/api/ipos/[slug]/drhp-extract',
      method: 'POST',
      slug
    });

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check extraction status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Check extraction status
    const status = await drhpExtractorService.getExtractionStatus(slug);

    if (status.hasExtraction) {
      return NextResponse.json({
        hasExtraction: true,
        confidence: status.confidence,
        action: status.action,
        extractedAt: status.extractedAt,
        message: getActionMessage(status.action as any)
      });
    } else {
      return NextResponse.json({
        hasExtraction: false,
        message: 'No extraction found for this IPO'
      });
    }

  } catch (error) {
    const { slug } = await params;
    logError(error as Error, {
      endpoint: '/api/ipos/[slug]/drhp-extract',
      method: 'GET',
      slug
    });

    return NextResponse.json(
      {
        error: 'Internal server error'
      },
      { status: 500 }
    );
  }
}

/**
 * Download PDF from URL
 */
async function downloadPdf(url: string, slug: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();

  // Save to drhps directory
  const outputPath = path.join(
    process.cwd(),
    '..',
    'pdf-parser-test',
    'drhps',
    `${slug}.pdf`
  );

  await fs.writeFile(outputPath, Buffer.from(buffer));

  return outputPath;
}

/**
 * Get user-friendly message based on action
 */
function getActionMessage(action: string): string {
  switch (action) {
    case 'AUTO_POPULATE':
      return 'High confidence extraction. Data has been auto-populated.';
    case 'REVIEW_REQUIRED':
      return 'Medium confidence extraction. Please review the extracted data.';
    case 'MANUAL_ENTRY':
      return 'Low confidence extraction. Manual data entry is required.';
    default:
      return 'Extraction status unknown.';
  }
}
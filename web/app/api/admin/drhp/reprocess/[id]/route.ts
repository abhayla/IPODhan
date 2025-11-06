/**
 * DRHP Reprocess API - Retry Failed Extractions
 *
 * POST /api/admin/drhp/reprocess/[id] - Reprocess a failed extraction
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { extractionLogs } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';

const execAsync = promisify(exec);

/**
 * Run Python DRHP extractor
 */
async function runPythonExtractor(
  pdfPath: string,
  version: 'v3' | 'original' = 'v3'
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const scriptPath = version === 'v3'
      ? join(process.cwd(), '..', 'pdf-parser-test', 'extract_drhp_pdfplumber_v3.py')
      : join(process.cwd(), '..', 'pdf-parser-test', 'extract_drhp_pdfplumber.py');

    // Ensure the PDF path is absolute
    const absolutePdfPath = pdfPath.startsWith('/') || pdfPath.includes(':')
      ? pdfPath
      : join(process.cwd(), pdfPath);

    const command = `python "${scriptPath}" "${absolutePdfPath}"`;

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 120000 // 2 minutes timeout
    });

    if (stderr && !stderr.includes('WARNING')) {
      console.warn('Python extractor stderr:', stderr);
    }

    // Parse the JSON output
    try {
      const result = JSON.parse(stdout);
      return { success: true, data: result };
    } catch (parseError) {
      console.error('Failed to parse Python output:', stdout);
      return { success: false, error: 'Invalid output from extractor' };
    }
  } catch (error) {
    console.error('Python extractor error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Extraction failed'
    };
  }
}

/**
 * Calculate confidence score based on extracted data
 */
function calculateConfidence(data: any): { score: number; level: 'HIGH' | 'MEDIUM' | 'LOW' } {
  if (!data || typeof data !== 'object') {
    return { score: 0, level: 'LOW' };
  }

  const fields = Object.keys(data);
  const fieldsWithValues = fields.filter(f => data[f] !== null && data[f] !== undefined);

  const score = Math.round((fieldsWithValues.length / 16) * 100);

  let level: 'HIGH' | 'MEDIUM' | 'LOW';
  if (score >= 80) level = 'HIGH';
  else if (score >= 50) level = 'MEDIUM';
  else level = 'LOW';

  return { score, level };
}

/**
 * POST - Reprocess a failed extraction
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify admin token
    const authError = await requireAdminAuth();
    if (authError) return authError;

    const { id: extractionId } = await params;

    // Get the extraction log
    const [extraction] = await db
      .select()
      .from(extractionLogs)
      .where(eq(extractionLogs.id, extractionId))
      .limit(1);

    if (!extraction) {
      return NextResponse.json(
        { success: false, error: 'Extraction log not found' },
        { status: 404 }
      );
    }

    if (!extraction.filePath) {
      return NextResponse.json(
        { success: false, error: 'No file path found for this extraction' },
        { status: 400 }
      );
    }

    // Update status to IN_PROGRESS
    await db.update(extractionLogs)
      .set({
        status: 'IN_PROGRESS',
        errorMessage: null,
        processedAt: new Date()
      })
      .where(eq(extractionLogs.id, extractionId));

    // Try different extraction methods
    const methods = [
      { version: 'v3' as const, name: 'pdfplumber_v3' },
      { version: 'original' as const, name: 'pdfplumber_original' }
    ];

    let bestResult: any = null;
    let bestScore = 0;
    let selectedMethod = '';

    for (const method of methods) {
      console.log(`[Reprocess] Trying ${method.name} for ${extraction.companyName}`);

      const result = await runPythonExtractor(extraction.filePath, method.version);

      if (result.success && result.data) {
        const { score } = calculateConfidence(result.data.financial_data);

        if (score > bestScore) {
          bestResult = result;
          bestScore = score;
          selectedMethod = method.name;
        }
      }
    }

    const duration = Date.now() - startTime;

    if (bestResult && bestResult.data) {
      const { score, level } = calculateConfidence(bestResult.data.financial_data);
      const fieldsExtracted = Object.keys(bestResult.data.financial_data || {})
        .filter(k => bestResult.data.financial_data[k] !== null).length;

      // Update extraction log with best results
      await db.update(extractionLogs)
        .set({
          status: fieldsExtracted > 10 ? 'SUCCESS' : 'PARTIAL',
          extractionMethod: selectedMethod,
          fieldsExtracted,
          extractedData: bestResult.data,
          confidenceScore: score,
          confidenceLevel: level,
          durationMs: duration,
          plPageNumber: bestResult.data.metadata?.pl_page,
          errorMessage: null,
          processedAt: new Date()
        })
        .where(eq(extractionLogs.id, extractionId));

      console.log(`[Reprocess] Success: ${extraction.companyName}, ${fieldsExtracted} fields extracted using ${selectedMethod}`);

      return NextResponse.json({
        success: true,
        message: 'Reprocessing completed successfully',
        fieldsExtracted,
        confidenceScore: score,
        method: selectedMethod
      });
    } else {
      // Update as failed
      await db.update(extractionLogs)
        .set({
          status: 'FAILED',
          errorMessage: 'All extraction methods failed',
          durationMs: duration,
          processedAt: new Date()
        })
        .where(eq(extractionLogs.id, extractionId));

      return NextResponse.json({
        success: false,
        error: 'All extraction methods failed'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[DRHP Reprocess] Error:', error);

    // Update extraction as failed
    const { id: extractionId } = await params;
    if (extractionId) {
      await db.update(extractionLogs)
        .set({
          status: 'FAILED',
          errorMessage: error instanceof Error ? error.message : 'Reprocessing failed',
          durationMs: Date.now() - startTime,
          processedAt: new Date()
        })
        .where(eq(extractionLogs.id, extractionId));
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reprocess extraction'
      },
      { status: 500 }
    );
  }
}
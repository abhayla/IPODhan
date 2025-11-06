/**
 * DRHP Extraction API - PDF Upload and Processing
 *
 * POST /api/admin/drhp/extract - Upload PDF and trigger extraction
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { extractionLogs, ipos } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

/**
 * Ensure upload directory exists
 */
async function ensureUploadDir(subDir: string): Promise<string> {
  const uploadDir = join(process.cwd(), 'web', 'uploads', subDir);
  await mkdir(uploadDir, { recursive: true });
  return uploadDir;
}

/**
 * Save uploaded file to disk
 */
async function saveFile(file: File, directory: string): Promise<string> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Generate unique filename
  const timestamp = Date.now();
  const uniqueId = uuidv4().substring(0, 8);
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const filename = `${timestamp}_${uniqueId}_${sanitizedName}`;
  const filepath = join(directory, filename);

  await writeFile(filepath, buffer);
  return filepath;
}

/**
 * Extract company name from filename or content
 */
function extractCompanyName(filename: string, formData?: FormData): string {
  // Try to get from form data first
  const providedName = formData?.get('companyName') as string;
  if (providedName) return providedName;

  // Extract from filename
  let name = filename
    .replace('.pdf', '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/DRHP/gi, '')
    .replace(/RHP/gi, '')
    .replace(/Prospectus/gi, '')
    .trim();

  // Capitalize properly
  name = name.replace(/\b\w/g, l => l.toUpperCase());

  return name || 'Unknown Company';
}

/**
 * Find or create IPO record for the company
 */
async function findOrCreateIPO(companyName: string): Promise<string> {
  // Try to find existing IPO
  const existingIPOs = await db
    .select()
    .from(ipos)
    .where(eq(ipos.companyName, companyName))
    .limit(1);

  if (existingIPOs.length > 0) {
    return existingIPOs[0].id;
  }

  // Create new IPO record
  const newIPO = await db.insert(ipos).values({
    companyName,
    slug: companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-'),
    status: 'UPCOMING',
    offeringType: 'IPO'
  }).returning();

  return newIPO[0].id;
}

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

    const command = `python "${scriptPath}" "${pdfPath}"`;

    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 120000 // 2 minutes timeout
    });

    if (stderr && !stderr.includes('WARNING')) {
      console.warn('Python extractor stderr:', stderr);
    }

    // Parse the JSON output
    // Extract JSON portion from stdout (Python outputs progress text before JSON)
    try {
      // Find the JSON object in stdout (from first '{' to last '}')
      const jsonStart = stdout.indexOf('{');
      const jsonEnd = stdout.lastIndexOf('}') + 1;

      if (jsonStart === -1 || jsonEnd <= jsonStart) {
        console.error('No JSON found in Python output:', stdout);
        return { success: false, error: 'No JSON found in extractor output' };
      }

      const jsonString = stdout.substring(jsonStart, jsonEnd);
      const result = JSON.parse(jsonString);

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

  const score = Math.round((fieldsWithValues.length / 16) * 100); // Assuming 16 target fields

  let level: 'HIGH' | 'MEDIUM' | 'LOW';
  if (score >= 80) level = 'HIGH';
  else if (score >= 50) level = 'MEDIUM';
  else level = 'LOW';

  return { score, level };
}

/**
 * POST - Upload PDF and extract data
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify admin token
    const authError = await requireAdminAuth();
    if (authError) return authError;

    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file uploaded' },
        { status: 400 }
      );
    }

    // Validate file type
    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { success: false, error: 'Only PDF files are allowed' },
        { status: 400 }
      );
    }

    // Save file
    const uploadDir = await ensureUploadDir('drhp');
    const filepath = await saveFile(file, uploadDir);
    const relativePath = filepath.replace(process.cwd(), '').replace(/\\/g, '/');

    // Extract company name
    const companyName = extractCompanyName(file.name, formData);

    // Find or create IPO
    const ipoId = await findOrCreateIPO(companyName);

    // Create initial extraction log
    const [extractionLog] = await db.insert(extractionLogs).values({
      ipoId,
      companyName,
      fileName: file.name,
      filePath: relativePath,
      fileSize: file.size,
      status: 'IN_PROGRESS',
      extractorVersion: 'v3',
      extractionMethod: 'pdfplumber',
      fieldsExtracted: 0,
      totalFields: 16
    }).returning();

    // Run Python extractor asynchronously
    runPythonExtractor(filepath, 'v3').then(async (result) => {
      const duration = Date.now() - startTime;

      if (result.success && result.data) {
        // Python outputs { data: { fields... }, metadata: { ... } }
        const extractedFields = result.data.data || result.data;
        const { score, level } = calculateConfidence(extractedFields);
        const fieldsExtracted = Object.keys(extractedFields || {})
          .filter(k => extractedFields[k] !== null).length;

        // Update extraction log with results
        await db.update(extractionLogs)
          .set({
            status: fieldsExtracted > 10 ? 'SUCCESS' : 'PARTIAL',
            fieldsExtracted,
            extractedData: result.data,
            confidenceScore: score,
            confidenceLevel: level,
            durationMs: duration,
            plPageNumber: result.data.metadata?.pl_page,
            processedAt: new Date()
          })
          .where(eq(extractionLogs.id, extractionLog.id));

        // Update IPO financial data if extraction was successful
        if (fieldsExtracted > 0 && extractedFields) {
          // Update IPO table with extracted data
          await db.update(ipos)
            .set({
              // Map extracted fields to IPO columns
              issueSize: extractedFields.fresh_issue,
              updatedAt: new Date()
            })
            .where(eq(ipos.id, ipoId));
        }

        console.log(`[DRHP Extraction] Success: ${companyName}, ${fieldsExtracted} fields extracted`);
      } else {
        // Update as failed
        await db.update(extractionLogs)
          .set({
            status: 'FAILED',
            errorMessage: result.error || 'Extraction failed',
            durationMs: duration,
            processedAt: new Date()
          })
          .where(eq(extractionLogs.id, extractionLog.id));

        console.error(`[DRHP Extraction] Failed: ${companyName}`, result.error);
      }
    }).catch(async (error) => {
      // Handle async errors
      console.error('[DRHP Extraction] Async error:', error);

      await db.update(extractionLogs)
        .set({
          status: 'FAILED',
          errorMessage: error.message || 'Unexpected error',
          durationMs: Date.now() - startTime,
          processedAt: new Date()
        })
        .where(eq(extractionLogs.id, extractionLog.id));
    });

    // Return immediate response (extraction continues in background)
    return NextResponse.json({
      success: true,
      message: 'Extraction started successfully',
      extractionId: extractionLog.id,
      status: 'IN_PROGRESS',
      estimatedTime: '30-60 seconds'
    });

  } catch (error) {
    console.error('[DRHP Extract] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process PDF'
      },
      { status: 500 }
    );
  }
}
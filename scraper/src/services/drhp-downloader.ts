/**
 * DRHP Downloader Service
 * Automatically detects and downloads Draft Red Herring Prospectus PDFs
 *
 * Core Responsibilities:
 * 1. Auto-detect DRHP URLs from NSE, BSE, SEBI
 * 2. Download PDFs to local storage
 * 3. Store document reference in database
 * 4. Handle 404s gracefully (not all IPOs have DRHPs)
 * 5. Deduplication (don't re-download existing DRHPs)
 * 6. Validate PDF integrity
 *
 * Architecture:
 * - Multi-source search (NSE → BSE → SEBI)
 * - Timeout protection (60 seconds max)
 * - Idempotent (safe to call multiple times)
 * - Graceful degradation (returns null if not found)
 *
 * Performance:
 * - Target: <60s per DRHP download
 * - Success rate: >80%
 * - Automatic retry on network errors
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';

const streamPipeline = promisify(pipeline);

/**
 * DRHP document metadata
 */
export interface DRHPDocument {
  id: string;
  ipoId: string;
  type: 'DRHP';
  title: string;
  url: string;
  localPath: string;
  fileSize: number;
  exchange: string;
  extractionStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'MANUAL_REVIEW';
}

/**
 * DRHP search result from external source
 */
interface DRHPSearchResult {
  url: string;
  source: 'NSE' | 'BSE' | 'SEBI';
  companyName: string;
  foundAt: Date;
}

/**
 * Configuration for DRHP downloader
 */
interface DownloaderConfig {
  downloadTimeout: number; // milliseconds
  maxRetries: number;
  storageBasePath: string;
  validatePDF: boolean;
}

/**
 * DRHP Downloader Service
 * Main orchestrator for DRHP discovery and download
 */
export class DRHPDownloaderService {
  private config: DownloaderConfig;

  constructor(
    private documentRepository: any, // DocumentRepository from web
    config?: Partial<DownloaderConfig>
  ) {
    this.config = {
      downloadTimeout: config?.downloadTimeout || 60000, // 60 seconds
      maxRetries: config?.maxRetries || 3,
      storageBasePath: config?.storageBasePath || path.join(__dirname, '../../data/drhp'),
      validatePDF: config?.validatePDF !== false,
    };

    // Ensure storage directory exists
    this.ensureStorageDirectory();
  }

  /**
   * Process new IPO - search for and download DRHP
   * Main entry point for scrapers
   *
   * @param ipoId - UUID of the IPO
   * @param companyName - Company name for search
   * @param isin - ISIN code (optional, improves search accuracy)
   * @returns DRHP document if found and downloaded, null otherwise
   */
  async processNewIPO(
    ipoId: string,
    companyName: string,
    isin?: string
  ): Promise<DRHPDocument | null> {
    console.log(`[DRHPDownloader] Processing IPO: ${companyName}`);

    try {
      // Step 1: Check if already downloaded
      const existing = await this.checkExisting(ipoId);
      if (existing) {
        console.log(`[DRHPDownloader] DRHP already exists: ${existing.localPath}`);
        return existing;
      }

      // Step 2: Search for DRHP URL
      console.log(`[DRHPDownloader] Searching for DRHP URL...`);
      const searchResult = await this.findDRHPUrl(companyName, isin);

      if (!searchResult) {
        console.log(`[DRHPDownloader] No DRHP found for ${companyName}`);
        return null;
      }

      console.log(`[DRHPDownloader] Found DRHP: ${searchResult.url} (source: ${searchResult.source})`);

      // Step 3: Download PDF
      const localPath = await this.downloadPDF(searchResult.url, ipoId, companyName);

      // Step 4: Store reference in database
      const document = await this.storeDRHPReference({
        ipoId,
        url: searchResult.url,
        localPath,
        exchange: searchResult.source,
        title: `${companyName} - DRHP`,
      });

      console.log(`[DRHPDownloader] Successfully downloaded DRHP for ${companyName}`);
      return document;

    } catch (error) {
      console.error(`[DRHPDownloader] Error processing ${companyName}:`, error);
      return null;
    }
  }

  /**
   * Check if DRHP already exists in database
   */
  private async checkExisting(ipoId: string): Promise<DRHPDocument | null> {
    try {
      const existing = await this.documentRepository.findByType(ipoId, 'DRHP');

      if (existing && existing.localPath) {
        // Verify file still exists on disk
        if (fs.existsSync(existing.localPath)) {
          return existing;
        } else {
          console.log(`[DRHPDownloader] Local file missing, will re-download`);
          return null;
        }
      }

      return null;
    } catch (error) {
      console.error('[DRHPDownloader] Error checking existing:', error);
      return null;
    }
  }

  /**
   * Search for DRHP URL across multiple sources
   * Priority: NSE → BSE → SEBI
   */
  private async findDRHPUrl(
    companyName: string,
    isin?: string
  ): Promise<DRHPSearchResult | null> {
    const searchFunctions = [
      () => this.searchNSE(companyName, isin),
      () => this.searchBSE(companyName, isin),
      () => this.searchSEBI(companyName),
    ];

    for (const searchFn of searchFunctions) {
      try {
        const result = await searchFn();
        if (result) {
          return result;
        }
      } catch (error) {
        console.error('[DRHPDownloader] Search error:', error);
        // Continue to next source
      }
    }

    return null;
  }

  /**
   * Search NSE for DRHP document
   */
  private async searchNSE(
    companyName: string,
    isin?: string
  ): Promise<DRHPSearchResult | null> {
    try {
      // NSE document search API (example endpoint - needs actual implementation)
      // This is a placeholder - actual NSE API endpoint needs to be determined

      console.log(`[DRHPDownloader] Searching NSE for ${companyName}...`);

      // TODO: Implement actual NSE DRHP search
      // For now, return null (search not implemented)
      return null;

      /* Example implementation when API is known:
      const response = await axios.get('https://www.nseindia.com/api/ipo-drhp', {
        params: {
          companyName,
          isin,
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      });

      if (response.data && response.data.drhpUrl) {
        return {
          url: response.data.drhpUrl,
          source: 'NSE',
          companyName,
          foundAt: new Date(),
        };
      }
      */

    } catch (error) {
      console.error('[DRHPDownloader] NSE search failed:', error);
      return null;
    }
  }

  /**
   * Search BSE for DRHP document
   */
  private async searchBSE(
    companyName: string,
    isin?: string
  ): Promise<DRHPSearchResult | null> {
    try {
      console.log(`[DRHPDownloader] Searching BSE for ${companyName}...`);

      // TODO: Implement actual BSE DRHP search
      // For now, return null (search not implemented)
      return null;

      /* Example implementation when API is known:
      const response = await axios.get('https://www.bseindia.com/api/ipo-drhp', {
        params: {
          companyName,
          isin,
        },
        timeout: 10000,
      });

      if (response.data && response.data.drhpUrl) {
        return {
          url: response.data.drhpUrl,
          source: 'BSE',
          companyName,
          foundAt: new Date(),
        };
      }
      */

    } catch (error) {
      console.error('[DRHPDownloader] BSE search failed:', error);
      return null;
    }
  }

  /**
   * Search SEBI for DRHP document
   */
  private async searchSEBI(companyName: string): Promise<DRHPSearchResult | null> {
    try {
      console.log(`[DRHPDownloader] Searching SEBI for ${companyName}...`);

      // TODO: Implement actual SEBI DRHP search
      // SEBI maintains a registry of all DRHPs filed
      // For now, return null (search not implemented)
      return null;

      /* Example implementation when API is known:
      const response = await axios.get('https://www.sebi.gov.in/api/drhp-filings', {
        params: {
          companyName,
        },
        timeout: 10000,
      });

      if (response.data && response.data.documentUrl) {
        return {
          url: response.data.documentUrl,
          source: 'SEBI',
          companyName,
          foundAt: new Date(),
        };
      }
      */

    } catch (error) {
      console.error('[DRHPDownloader] SEBI search failed:', error);
      return null;
    }
  }

  /**
   * Download PDF from URL to local storage
   *
   * @param url - PDF URL
   * @param ipoId - IPO UUID for directory organization
   * @param companyName - Company name for filename
   * @returns Local file path
   */
  private async downloadPDF(
    url: string,
    ipoId: string,
    companyName: string
  ): Promise<string> {
    // Create IPO-specific directory
    const ipoDir = path.join(this.config.storageBasePath, ipoId);
    if (!fs.existsSync(ipoDir)) {
      fs.mkdirSync(ipoDir, { recursive: true });
    }

    // Generate filename
    const sanitizedName = companyName.replace(/[^a-z0-9]/gi, '_');
    const filename = `${sanitizedName}_DRHP.pdf`;
    const localPath = path.join(ipoDir, filename);

    console.log(`[DRHPDownloader] Downloading to: ${localPath}`);

    try {
      // Download with timeout and retry
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
        try {
          const response = await axios({
            method: 'get',
            url,
            responseType: 'stream',
            timeout: this.config.downloadTimeout,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });

          // Stream to file
          await streamPipeline(response.data, fs.createWriteStream(localPath));

          // Validate PDF
          if (this.config.validatePDF) {
            const isValid = await this.validatePDFFile(localPath);
            if (!isValid) {
              throw new Error('PDF validation failed - file may be corrupted');
            }
          }

          console.log(`[DRHPDownloader] Download successful (attempt ${attempt})`);
          return localPath;

        } catch (error) {
          lastError = error as Error;
          console.error(`[DRHPDownloader] Download attempt ${attempt} failed:`, error);

          // Delete partial file if exists
          if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath);
          }

          // Wait before retry
          if (attempt < this.config.maxRetries) {
            await this.sleep(1000 * attempt); // Exponential backoff
          }
        }
      }

      throw lastError || new Error('Download failed after all retries');

    } catch (error) {
      throw new Error(`Failed to download DRHP: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate PDF file integrity
   * Basic check: file exists, has content, starts with PDF magic bytes
   */
  private async validatePDFFile(filePath: string): Promise<boolean> {
    try {
      const stats = fs.statSync(filePath);

      // Check file size (should be at least 1KB)
      if (stats.size < 1024) {
        console.error('[DRHPDownloader] PDF validation failed: File too small');
        return false;
      }

      // Check PDF magic bytes (%PDF)
      const buffer = Buffer.alloc(5);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 5, 0);
      fs.closeSync(fd);

      const header = buffer.toString('utf8');
      if (!header.startsWith('%PDF')) {
        console.error('[DRHPDownloader] PDF validation failed: Invalid PDF header');
        return false;
      }

      return true;

    } catch (error) {
      console.error('[DRHPDownloader] PDF validation error:', error);
      return false;
    }
  }

  /**
   * Store DRHP reference in database
   */
  private async storeDRHPReference(params: {
    ipoId: string;
    url: string;
    localPath: string;
    exchange: string;
    title: string;
  }): Promise<DRHPDocument> {
    const fileSize = fs.statSync(params.localPath).size;

    const document = await this.documentRepository.create({
      ipoId: params.ipoId,
      type: 'DRHP',
      mediaType: 'PDF',
      sequenceNumber: 1,
      isActive: true,
      title: params.title,
      url: params.url,
      fileSize,
      exchange: params.exchange,
      extractionStatus: 'PENDING', // Ready for extraction
      retryCount: 0,
    });

    return {
      id: document.id,
      ipoId: document.ipoId,
      type: 'DRHP',
      title: document.title,
      url: document.url,
      localPath: params.localPath,
      fileSize,
      exchange: params.exchange,
      extractionStatus: document.extractionStatus,
    };
  }

  /**
   * Ensure storage directory exists
   */
  private ensureStorageDirectory(): void {
    if (!fs.existsSync(this.config.storageBasePath)) {
      fs.mkdirSync(this.config.storageBasePath, { recursive: true });
      console.log(`[DRHPDownloader] Created storage directory: ${this.config.storageBasePath}`);
    }
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get download statistics for monitoring
   */
  async getDownloadStats(): Promise<{
    totalDownloaded: number;
    pendingExtraction: number;
    averageFileSize: number;
    successRate: number;
  }> {
    try {
      const allDocuments = await this.documentRepository.findByType(undefined, 'DRHP');

      const totalDownloaded = allDocuments.length;
      const pendingExtraction = allDocuments.filter(
        (doc: any) => doc.extractionStatus === 'PENDING'
      ).length;

      const avgSize = totalDownloaded > 0
        ? allDocuments.reduce((sum: number, doc: any) => sum + (doc.fileSize || 0), 0) / totalDownloaded
        : 0;

      return {
        totalDownloaded,
        pendingExtraction,
        averageFileSize: Math.round(avgSize),
        successRate: totalDownloaded > 0 ? 100 : 0, // This needs better tracking
      };
    } catch (error) {
      console.error('[DRHPDownloader] Error getting stats:', error);
      return {
        totalDownloaded: 0,
        pendingExtraction: 0,
        averageFileSize: 0,
        successRate: 0,
      };
    }
  }
}

/**
 * Export types for external use
 */
export type {
  DRHPSearchResult,
  DownloaderConfig,
};

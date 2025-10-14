/**
 * Mainboard Prospectus Service
 *
 * Service layer for fetching Mainboard IPO prospectus documents (DRHP and RHP).
 * Handles data fetching, filtering, pagination, and caching.
 *
 * Story 9.8a: Mainboard IPO Prospectus PDF Download Page
 */

import { db } from '@/lib/db';
import { ipos, documents } from '@/lib/db';
import { eq, and, ilike, sql } from 'drizzle-orm';

// ==================== TYPES ====================

export interface ProspectusFilters {
  companyName?: string;
  exchange?: 'All' | 'BSE' | 'NSE' | 'Both';
  page?: number;
  limit?: number;
}

export interface MainboardProspectusData {
  ipo: {
    id: string;
    companyName: string;
    slug: string;
    category: string;
    listingExchanges: ('NSE' | 'BSE')[] | null;
  };
  drhpDocument: {
    id: string;
    title: string;
    url: string;
    fileSize: number | null;
    uploadedAt: Date;
  } | null;
  rhpDocument: {
    id: string;
    title: string;
    url: string;
    fileSize: number | null;
    uploadedAt: Date;
  } | null;
}

export interface ProspectusResponse {
  data: MainboardProspectusData[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ==================== SERVICE FUNCTIONS ====================

/**
 * Fetch Mainboard IPO prospectus documents with filtering and pagination
 *
 * @param filters - Filter options (companyName, exchange, page, limit)
 * @returns Promise<ProspectusResponse> - Paginated prospectus data
 */
export async function getMainboardProspectusDocuments(
  filters?: ProspectusFilters
): Promise<ProspectusResponse> {
  try {
    // Parse filters with defaults
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;
    const companyName = filters?.companyName?.trim() || '';
    const exchange = filters?.exchange || 'All';

    // Build WHERE conditions
    const conditions = [eq(ipos.category, 'MAINBOARD')];

    // Add company name filter (case-insensitive partial match)
    if (companyName) {
      conditions.push(ilike(ipos.companyName, `%${companyName}%`));
    }

    // Add exchange filter
    if (exchange !== 'All') {
      if (exchange === 'Both') {
        // Both exchanges: listingExchanges contains both NSE and BSE
        conditions.push(
          sql`${ipos.listingExchanges}::jsonb @> '["NSE","BSE"]'::jsonb OR ${ipos.listingExchanges}::jsonb @> '["BSE","NSE"]'::jsonb`
        );
      } else {
        // Single exchange: listingExchanges contains specified exchange
        conditions.push(
          sql`${ipos.listingExchanges}::jsonb @> ${JSON.stringify([exchange])}::jsonb`
        );
      }
    }

    // Fetch IPOs with documents
    const iposWithDocuments = await db
      .select({
        ipo: {
          id: ipos.id,
          companyName: ipos.companyName,
          slug: ipos.slug,
          category: ipos.category,
          listingExchanges: ipos.listingExchanges,
        },
        document: {
          id: documents.id,
          type: documents.type,
          title: documents.title,
          url: documents.url,
          fileSize: documents.fileSize,
          uploadedAt: documents.uploadedAt,
        },
      })
      .from(ipos)
      .leftJoin(documents, eq(ipos.id, documents.ipoId))
      .where(and(...conditions))
      .orderBy(ipos.companyName)
      .limit(limit + 1) // Fetch one extra to determine hasMore
      .offset(skip);

    // Group documents by IPO
    const ipoMap = new Map<string, MainboardProspectusData>();

    for (const row of iposWithDocuments) {
      if (!ipoMap.has(row.ipo.id)) {
        ipoMap.set(row.ipo.id, {
          ipo: row.ipo,
          drhpDocument: null,
          rhpDocument: null,
        });
      }

      const prospectusData = ipoMap.get(row.ipo.id)!;

      // Assign DRHP or RHP document
      if (row.document) {
        if (row.document.type === 'DRHP') {
          prospectusData.drhpDocument = {
            id: row.document.id,
            title: row.document.title,
            url: row.document.url,
            fileSize: row.document.fileSize,
            uploadedAt: row.document.uploadedAt,
          };
        } else if (row.document.type === 'RHP') {
          prospectusData.rhpDocument = {
            id: row.document.id,
            title: row.document.title,
            url: row.document.url,
            fileSize: row.document.fileSize,
            uploadedAt: row.document.uploadedAt,
          };
        }
      }
    }

    // Convert map to array
    const prospectusArray = Array.from(ipoMap.values());

    // Determine if more pages exist
    const hasMore = prospectusArray.length > limit;
    const paginatedData = hasMore ? prospectusArray.slice(0, limit) : prospectusArray;

    // Get total count (approximate - can be improved with separate count query)
    const total = hasMore ? (page * limit) + 1 : (page - 1) * limit + prospectusArray.length;

    return {
      data: paginatedData,
      total,
      page,
      limit,
      hasMore,
    };
  } catch (error) {
    console.error('Error fetching mainboard prospectus documents:', error);
    // Graceful error handling - return empty response
    return {
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      hasMore: false,
    };
  }
}

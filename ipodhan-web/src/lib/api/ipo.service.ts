import { apiClient, scoreApiClient, handleApiError } from './client';
import type { IPO, IPOScore, GMPHistory, SubscriptionData } from '@/types/ipo';
import {
  GetIPOsParamsSchema,
  GetGMPHistoryParamsSchema,
  IPOIdSchema,
  validateData,
} from '@/lib/validation/schemas';

export interface GetIPOsParams {
  status?: 'LIVE' | 'UPCOMING' | 'CLOSED';
  category?: 'MAINBOARD' | 'SME';
  page?: number;
  limit?: number;
}

export interface GetIPOsResponse {
  data: IPO[];
  total: number;
  page: number;
  limit: number;
}

export interface GetGMPHistoryParams {
  days?: number;
}

/**
 * Fetch list of IPOs with optional filters
 * Validates input params before making API call (SEC-001 fix)
 */
export const getIPOs = async (params: GetIPOsParams = {}): Promise<GetIPOsResponse> => {
  try {
    // Validate input parameters
    const validation = validateData(GetIPOsParamsSchema, params);
    if (!validation.success) {
      throw new Error(`Invalid parameters: ${validation.errors.message}`);
    }

    const response = await apiClient.get<GetIPOsResponse>('/ipos', {
      params: validation.data,
    });
    return response.data;
  } catch (error: any) {
    throw handleApiError(error);
  }
};

/**
 * Fetch single IPO details by ID
 * Validates ID format before making API call (SEC-001 fix)
 */
export const getIPOById = async (id: string): Promise<IPO> => {
  try {
    // Validate IPO ID format
    const validation = validateData(IPOIdSchema, id);
    if (!validation.success) {
      throw new Error(`Invalid IPO ID: ${validation.errors.message}`);
    }

    const response = await apiClient.get<{ data: IPO }>(`/ipos/${validation.data}`);
    return response.data.data;
  } catch (error: any) {
    throw handleApiError(error);
  }
};

/**
 * Fetch IPO score by ID
 * Validates ID format before making API call (SEC-001 fix)
 */
export const getIPOScore = async (id: string): Promise<IPOScore> => {
  try {
    // Validate IPO ID
    const validation = validateData(IPOIdSchema, id);
    if (!validation.success) {
      throw new Error(`Invalid IPO ID: ${validation.errors.message}`);
    }

    const response = await scoreApiClient.get<IPOScore>(`/scores/${validation.data}`);
    return response.data;
  } catch (error: any) {
    throw handleApiError(error);
  }
};

/**
 * Fetch IPO score breakdown by ID
 */
export const getIPOScoreBreakdown = async (id: string): Promise<IPOScore> => {
  try {
    const response = await scoreApiClient.get<IPOScore>(`/scores/${id}/breakdown`);
    return response.data;
  } catch (error: any) {
    throw handleApiError(error);
  }
};

/**
 * Fetch GMP history for an IPO
 * Validates ID and params before making API call (SEC-001 fix)
 */
export const getGMPHistory = async (
  id: string,
  params: GetGMPHistoryParams = {}
): Promise<GMPHistory[]> => {
  try {
    // Validate IPO ID
    const idValidation = validateData(IPOIdSchema, id);
    if (!idValidation.success) {
      throw new Error(`Invalid IPO ID: ${idValidation.errors.message}`);
    }

    // Validate params
    const paramsValidation = validateData(GetGMPHistoryParamsSchema, params);
    if (!paramsValidation.success) {
      throw new Error(`Invalid parameters: ${paramsValidation.errors.message}`);
    }

    const response = await apiClient.get<{ data: GMPHistory[] }>(
      `/ipos/${idValidation.data}/gmp`,
      {
        params: paramsValidation.data,
      }
    );
    return response.data.data;
  } catch (error: any) {
    throw handleApiError(error);
  }
};

/**
 * Fetch subscription data for an IPO
 */
export const getSubscriptionData = async (id: string): Promise<SubscriptionData[]> => {
  try {
    const response = await apiClient.get<{ data: SubscriptionData[] }>(
      `/ipos/${id}/subscription`
    );
    return response.data.data;
  } catch (error: any) {
    throw handleApiError(error);
  }
};

/**
 * Fetch IPO score history
 */
export const getIPOScoreHistory = async (
  id: string,
  params: { days?: number } = {}
): Promise<IPOScore[]> => {
  try {
    const { days = 30 } = params;
    const response = await scoreApiClient.get<{ data: IPOScore[] }>(`/scores/${id}/history`, {
      params: { days },
    });
    return response.data.data;
  } catch (error: any) {
    throw handleApiError(error);
  }
};

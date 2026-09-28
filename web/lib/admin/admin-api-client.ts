/**
 * Admin API Client
 *
 * Centralized utility for making authenticated API calls from admin pages.
 * Sends the admin session cookie (httpOnly, set by /api/admin/auth/login) with every call.
 */

interface ApiOptions extends RequestInit {
  headers?: Record<string, string>;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  [key: string]: any;
}


/**
 * Make an authenticated API call to admin endpoints
 *
 * @param url - API endpoint URL (e.g., '/api/admin/protection/ipo/123')
 * @param options - Fetch options (method, body, headers, etc.)
 * @returns Parsed JSON response
 * @throws Error if token is missing or request fails
 */
export async function adminApiCall<T = any>(
  url: string,
  options: ApiOptions = {}
): Promise<ApiResponse<T>> {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      // Throw error with server message if available
      throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
    }

    return data;
  } catch (error) {
    // Re-throw with better error message
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Failed to make API request');
  }
}

/**
 * Convenience method for GET requests
 */
export async function adminGet<T = any>(url: string): Promise<ApiResponse<T>> {
  return adminApiCall<T>(url, { method: 'GET' });
}

/**
 * Convenience method for POST requests
 */
export async function adminPost<T = any>(
  url: string,
  body?: any
): Promise<ApiResponse<T>> {
  return adminApiCall<T>(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Convenience method for PATCH requests
 */
export async function adminPatch<T = any>(
  url: string,
  body?: any
): Promise<ApiResponse<T>> {
  return adminApiCall<T>(url, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Convenience method for DELETE requests
 */
export async function adminDelete<T = any>(url: string): Promise<ApiResponse<T>> {
  return adminApiCall<T>(url, { method: 'DELETE' });
}

/**
 * Make an authenticated fetch call (for non-JSON responses like file downloads)
 *
 * @param url - API endpoint URL
 * @param options - Fetch options
 * @returns Fetch Response object
 */
export async function adminFetch(url: string, options: ApiOptions = {}): Promise<Response> {
  const headers = {
    ...options.headers,
  };

  return fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers,
  });
}

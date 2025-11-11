import { Page, Locator } from '@playwright/test';

/**
 * E2E Test Helper Utilities
 *
 * This file provides reusable helper functions to eliminate code duplication
 * and improve test reliability across UX E2E tests.
 */

/**
 * Scrolls to an element to ensure it's in the viewport
 * @param page Playwright page object
 * @param selector Element selector
 * @param options Scrolling options
 */
export async function scrollToElement(
  page: Page,
  selector: string,
  options?: {
    timeout?: number;
    behavior?: 'auto' | 'smooth';
  }
): Promise<void> {
  const timeout = options?.timeout || 5000;
  const behavior = options?.behavior || 'smooth';

  try {
    await page.locator(selector).first().scrollIntoViewIfNeeded({ timeout });
  } catch (error) {
    // Fallback to JavaScript scroll if scrollIntoViewIfNeeded fails
    try {
      await page.evaluate(
        ({ sel, beh }) => {
          const element = document.querySelector(sel);
          if (element) {
            element.scrollIntoView({ behavior: beh, block: 'center' });
          }
        },
        { sel: selector, beh: behavior }
      );
      // Wait a bit for scroll to complete
      await page.waitForTimeout(500);
    } catch (fallbackError) {
      console.warn(`Failed to scroll to element: ${selector}`, fallbackError);
    }
  }
}

/**
 * Navigates to the first IPO card on the page with smart scrolling and retries
 * @param page Playwright page object
 * @param options Navigation options
 */
export async function navigateToFirstIPO(
  page: Page,
  options?: {
    timeout?: number;
    retries?: number;
  }
): Promise<void> {
  const timeout = options?.timeout || 30000;
  const retries = options?.retries || 3;

  const selector = '[data-testid="ipo-card"], .ipo-card, article';

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // First, try to scroll to "Current IPOs" section if it exists
      const currentIPOsHeading = page.locator('h2:has-text("Current IPOs"), h2:has-text("IPOs"), h3:has-text("Current IPOs")').first();
      if (await currentIPOsHeading.count() > 0) {
        await currentIPOsHeading.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500); // Give time for lazy loading
      }

      // Wait for at least one card to be present
      await page.waitForSelector(selector, { state: 'attached', timeout: 10000 });

      // Scroll to the first card
      await scrollToElement(page, selector, { timeout: 5000 });

      // Wait for it to be visible
      const firstCard = page.locator(selector).first();
      await firstCard.waitFor({ state: 'visible', timeout: 5000 });

      // Click the card
      await firstCard.click({ timeout: 5000 });

      // Wait for navigation to complete
      await page.waitForLoadState('networkidle', { timeout: 10000 });

      return; // Success
    } catch (error) {
      if (attempt === retries) {
        throw new Error(`Failed to navigate to first IPO after ${retries} attempts: ${error}`);
      }
      console.warn(`Attempt ${attempt} failed, retrying...`, error);
      await page.waitForTimeout(1000); // Wait before retry
    }
  }
}

/**
 * Navigates to the nth IPO card on the page
 * @param page Playwright page object
 * @param index Zero-based index of the IPO card
 * @param options Navigation options
 */
export async function navigateToIPOByIndex(
  page: Page,
  index: number,
  options?: {
    timeout?: number;
  }
): Promise<void> {
  const timeout = options?.timeout || 30000;
  const selector = '[data-testid="ipo-card"], .ipo-card, article';

  // Wait for cards to be present
  await page.waitForSelector(selector, { state: 'attached', timeout });

  // Get the specific card
  const card = page.locator(selector).nth(index);

  // Scroll to the card
  await card.scrollIntoViewIfNeeded({ timeout });

  // Wait for it to be visible
  await card.waitFor({ state: 'visible', timeout });

  // Click the card
  await card.click({ timeout });

  // Wait for navigation
  await page.waitForLoadState('networkidle', { timeout });
}

/**
 * Waits for an element with flexible options
 * @param page Playwright page object
 * @param selector Element selector
 * @param options Waiting options
 */
export async function waitForElement(
  page: Page,
  selector: string,
  options?: {
    state?: 'attached' | 'visible' | 'hidden' | 'detached';
    timeout?: number;
  }
): Promise<Locator> {
  const state = options?.state || 'visible';
  const timeout = options?.timeout || 30000;

  await page.waitForSelector(selector, { state, timeout });
  return page.locator(selector).first();
}

/**
 * Performs a swipe gesture on an element (for mobile tests)
 * @param page Playwright page object
 * @param element Element locator
 * @param direction Swipe direction
 * @param options Swipe options
 */
export async function performSwipeGesture(
  page: Page,
  element: Locator,
  direction: 'left' | 'right' | 'up' | 'down',
  options?: {
    distance?: number;
    duration?: number;
  }
): Promise<void> {
  const distance = options?.distance || 200;
  const duration = options?.duration || 500;

  const box = await element.boundingBox();
  if (!box) {
    throw new Error('Element has no bounding box');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  let endX = startX;
  let endY = startY;

  switch (direction) {
    case 'left':
      endX = startX - distance;
      break;
    case 'right':
      endX = startX + distance;
      break;
    case 'up':
      endY = startY - distance;
      break;
    case 'down':
      endY = startY + distance;
      break;
  }

  // Perform touch swipe
  await page.touchscreen.tap(startX, startY);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: Math.floor(duration / 10) });
  await page.mouse.up();
}

/**
 * Waits for content to change within an element
 * @param page Playwright page object
 * @param selector Element selector
 * @param initialValue Initial value to compare against (optional)
 * @param maxWait Maximum time to wait in milliseconds
 */
export async function waitForContentChange(
  page: Page,
  selector: string,
  initialValue?: string | null,
  maxWait: number = 60000
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 1000; // Check every 1 second

  // Get initial value if not provided
  if (initialValue === undefined) {
    try {
      const element = await page.locator(selector).first();
      initialValue = await element.textContent();
    } catch {
      initialValue = null;
    }
  }

  while (Date.now() - startTime < maxWait) {
    try {
      const element = await page.locator(selector).first();
      const currentValue = await element.textContent();

      if (currentValue !== initialValue) {
        return true; // Content changed
      }
    } catch {
      // Element might not exist yet
    }

    await page.waitForTimeout(pollInterval);
  }

  return false; // Timeout - no change detected
}

/**
 * Seeds localStorage with data safely
 * @param page Playwright page object
 * @param key localStorage key
 * @param data Data to store (will be JSON stringified)
 */
export async function seedLocalStorage(
  page: Page,
  key: string,
  data: any
): Promise<void> {
  await page.evaluate(
    ({ k, d }) => {
      try {
        const jsonData = typeof d === 'string' ? d : JSON.stringify(d);
        localStorage.setItem(k, jsonData);
      } catch (error) {
        console.error('Failed to seed localStorage:', error);
      }
    },
    { k: key, d: data }
  );
}

/**
 * Gets data from localStorage safely
 * @param page Playwright page object
 * @param key localStorage key
 * @returns Parsed data or null
 */
export async function getLocalStorage(
  page: Page,
  key: string
): Promise<any> {
  return await page.evaluate((k) => {
    try {
      const data = localStorage.getItem(k);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to get localStorage:', error);
      return null;
    }
  }, key);
}

/**
 * Clears localStorage
 * @param page Playwright page object
 */
export async function clearLocalStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.clear();
  });
}

/**
 * Checks if a route/page exists
 * @param page Playwright page object
 * @param path Path to check
 * @returns True if page exists (not 404)
 */
export async function pageExists(page: Page, path: string): Promise<boolean> {
  try {
    const response = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 5000 });
    return response ? response.status() !== 404 : false;
  } catch {
    return false;
  }
}

/**
 * Waits for network to be idle (no requests for a period)
 * @param page Playwright page object
 * @param options Waiting options
 */
export async function waitForNetworkIdle(
  page: Page,
  options?: {
    timeout?: number;
    idleTime?: number;
  }
): Promise<void> {
  const timeout = options?.timeout || 30000;
  const idleTime = options?.idleTime || 500;

  let lastRequestTime = Date.now();
  const startTime = Date.now();

  page.on('request', () => {
    lastRequestTime = Date.now();
  });

  while (Date.now() - startTime < timeout) {
    if (Date.now() - lastRequestTime >= idleTime) {
      return; // Network is idle
    }
    await page.waitForTimeout(100);
  }

  throw new Error(`Network did not become idle within ${timeout}ms`);
}

/**
 * Retries a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry options
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries || 3;
  const initialDelay = options?.initialDelay || 1000;
  const maxDelay = options?.maxDelay || 10000;
  const backoffFactor = options?.backoffFactor || 2;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxRetries) {
        break;
      }

      console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
}

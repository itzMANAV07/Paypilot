/**
 * lib/rate-limit.ts
 *
 * In-memory sliding window rate limiter for public abuse protection.
 * Tracks request counts per client IP within a configurable time window.
 */

interface RateLimitConfig {
  /** Window duration in milliseconds (e.g. 60_000 for 1 minute) */
  windowMs: number;
  /** Maximum number of allowed requests within the window */
  max: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

// Map key: `${endpoint}:${ip}` -> array of request timestamps in ms
const requestLog = new Map<string, number[]>();

/**
 * Extract client IP from standard proxy headers (e.g. Render, Cloudflare, Vercel)
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip) return ip;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

/**
 * Check and record a rate limit hit for a given IP and route.
 */
export function checkRateLimit(
  routeKey: string,
  ip: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const key = `${routeKey}:${ip}`;
  const windowStart = now - config.windowMs;

  let timestamps = requestLog.get(key) || [];
  // Filter out timestamps outside the active window
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= config.max) {
    const oldest = timestamps[0];
    const resetMs = Math.max(0, oldest + config.windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  timestamps.push(now);
  requestLog.set(key, timestamps);

  // Periodic memory cleanup: prune dead keys if map grows large
  if (requestLog.size > 2000) {
    for (const [k, ts] of requestLog.entries()) {
      if (ts.every((t) => t <= windowStart)) {
        requestLog.delete(k);
      }
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, config.max - timestamps.length),
    resetMs: config.windowMs,
  };
}

/** Preconfigured limits */
export const RATE_LIMITS = {
  chat: { windowMs: 60_000, max: 25 }, // 25 chat messages per minute
  createInvoice: { windowMs: 60_000, max: 10 }, // 10 invoice creates per minute
  remindInvoice: { windowMs: 60_000, max: 10 }, // 10 reminder sends per minute
  simulatePayment: { windowMs: 60_000, max: 15 }, // 15 payment simulations per minute
} as const;


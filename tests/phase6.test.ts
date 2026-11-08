/**
 * tests/phase6.test.ts
 *
 * Unit tests for Phase 6 production readiness:
 *  - GET /api/health
 *  - Rate limiter (sliding window, IP detection, exhaustion)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { GET as healthHandler } from "../app/api/health/route";
import { checkRateLimit, getClientIp } from "../lib/rate-limit";

describe("Phase 6 Production Readiness", () => {
  describe("GET /api/health", () => {
    it("returns 200 OK with status and demo mode", async () => {
      const res = await healthHandler();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.status).toBe("ok");
      expect(data.timestamp).toBeDefined();
      expect(typeof data.demoMode).toBe("boolean");
      expect(data.paypalEnv).toBe("sandbox");
    });
  });

  describe("lib/rate-limit.ts", () => {
    it("extracts client IP from x-forwarded-for header", () => {
      const req = new Request("http://localhost", {
        headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" },
      });
      expect(getClientIp(req)).toBe("203.0.113.195");
    });

    it("extracts client IP from x-real-ip if forwarded is missing", () => {
      const req = new Request("http://localhost", {
        headers: { "x-real-ip": "198.51.100.1" },
      });
      expect(getClientIp(req)).toBe("198.51.100.1");
    });

    it("falls back to 127.0.0.1 when no proxy headers exist", () => {
      const req = new Request("http://localhost");
      expect(getClientIp(req)).toBe("127.0.0.1");
    });

    it("allows requests up to max and then blocks until reset", () => {
      const ip = "test-rate-limit-ip";
      const config = { windowMs: 5000, max: 3 };

      // 1st request
      const r1 = checkRateLimit("testRoute", ip, config);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      // 2nd request
      const r2 = checkRateLimit("testRoute", ip, config);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      // 3rd request
      const r3 = checkRateLimit("testRoute", ip, config);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);

      // 4th request (exceeded!)
      const r4 = checkRateLimit("testRoute", ip, config);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.resetMs).toBeGreaterThan(0);
    });
  });
});


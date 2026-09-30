import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HaversineRoutingEngine } from "../src/routing/deterministic-routing";
import { ORSRoutingEngine } from "../src/routing/ors-routing";
import type { Location } from "../src/domain/types";
import { runSimulation } from "../src/simulation/simulate";

describe("Routing Abstraction", () => {
  const origin: Location = { latitude: 6.5158, longitude: 3.3896 };
  const destination: Location = { latitude: 6.525, longitude: 3.4 };

  describe("HaversineRoutingEngine", () => {
    it("distance calculation remains correct", async () => {
      const engine = new HaversineRoutingEngine();
      const estimate = await engine.estimateTravelTime(origin, destination, "driving");
      
      // Known Haversine distance between these coordinates
      expect(estimate.distanceKm).toBeCloseTo(1.54, 2);
    });

    it("travel time remains consistent", async () => {
      const engine = new HaversineRoutingEngine(20);
      const estimate = await engine.estimateTravelTime(origin, destination, "driving", { trafficMultiplier: 1.5 });
      
      const expectedTime = Math.max(1, (1.53 / 20) * 60 * 1.5);
      expect(estimate.durationMinutes).toBeCloseTo(expectedTime, 1);
    });
  });

  describe("ORSRoutingEngine", () => {
    let mockFetch: any;

    beforeEach(() => {
      // Set dummy API key
      process.env.ORS_API_KEY = "test_key";
      
      // Mock global fetch
      mockFetch = vi.fn().mockImplementation(async (url: string) => {
        // Mock the response structure from ORS
        return {
          ok: true,
          json: async () => ({
            features: [
              {
                properties: {
                  summary: {
                    distance: 1200, // 1.2 km
                    duration: 300,  // 5 mins
                  }
                }
              }
            ]
          })
        };
      });
      global.fetch = mockFetch;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      delete process.env.ORS_API_KEY;
    });

    it("ORS parsing converts correctly into distanceKm and durationMin", async () => {
      const engine = new ORSRoutingEngine();
      const estimate = await engine.estimateTravelTime(origin, destination, "driving");
      
      expect(estimate.distanceKm).toBe(1.2);
      expect(estimate.durationMinutes).toBe(5);
    });

    it("Cache works: first request is miss, second is hit", async () => {
      const engine = new ORSRoutingEngine();
      
      // Mock cache write to not hit actual disk in tests
      vi.spyOn(engine as any, "saveCache").mockResolvedValue(undefined);
      vi.spyOn(engine as any, "saveCacheSync").mockImplementation(() => {});

      await engine.estimateTravelTime(origin, destination, "driving");
      expect(engine.stats.cacheMisses).toBe(1);
      expect(engine.stats.cacheHits).toBe(0);
      expect(engine.stats.apiRequests).toBe(1);

      await engine.estimateTravelTime(origin, destination, "driving");
      expect(engine.stats.cacheMisses).toBe(1);
      expect(engine.stats.cacheHits).toBe(1);
      expect(engine.stats.apiRequests).toBe(1);
    });

    it("Walking and driving paths hit separate caches", async () => {
      const engine = new ORSRoutingEngine();
      vi.spyOn(engine as any, "saveCache").mockResolvedValue(undefined);
      vi.spyOn(engine as any, "saveCacheSync").mockImplementation(() => {});

      await engine.estimateTravelTime(origin, destination, "driving");
      expect(engine.stats.apiRequests).toBe(1);

      await engine.estimateTravelTime(origin, destination, "walking");
      // Walking should be a separate request since the cache is segregated by profile
      expect(engine.stats.apiRequests).toBe(2);
      expect(engine.stats.cacheMisses).toBe(2);
    });
  });

  describe("Dispatch Integration", () => {
    it("can operate against HaversineRoutingEngine", async () => {
      const metrics = await runSimulation({ orders: 2, seed: 42 }, new HaversineRoutingEngine());
      expect(metrics.assigned).toBeGreaterThan(0);
    });

    it("can operate against ORSRoutingEngine", async () => {
      const engine = new ORSRoutingEngine();
      
      // Mock out ORS to always return 1km / 5min so simulation doesn't fail
      vi.spyOn(engine as any, "fetchFromORS").mockResolvedValue({ distanceKm: 1, durationMinutes: 5 });
      vi.spyOn(engine as any, "saveCache").mockResolvedValue(undefined);
      vi.spyOn(engine as any, "saveCacheSync").mockImplementation(() => {});

      const metrics = await runSimulation({ orders: 2, seed: 42 }, engine);
      expect(metrics.assigned).toBeGreaterThan(0);
    });
  });
});

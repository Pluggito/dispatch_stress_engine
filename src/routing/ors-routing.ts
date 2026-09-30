import { promises as fs } from "node:fs";
import path from "node:path";
import type { Location } from "../domain/types";
import type { RoutingEngine, RoutingContext, TravelEstimate, TravelMode } from "./routing-engine";
import { HaversineRoutingEngine } from "./deterministic-routing";

type CacheStore = Record<string, TravelEstimate>;

export class ORSRoutingEngine implements RoutingEngine {
  private cacheDir = path.resolve(process.cwd(), "route-cache/ors");
  private walkingCachePath = path.join(this.cacheDir, "walking.json");
  private drivingCachePath = path.join(this.cacheDir, "driving.json");
  
  private walkingCache: CacheStore | null = null;
  private drivingCache: CacheStore | null = null;
  
  private cacheDirty = false;
  private haversineFallback = new HaversineRoutingEngine();
  
  public stats = {
    apiRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    walkingRoutes: 0,
    drivingRoutes: 0,
    routeFailures: 0,
    haversineFallbacks: 0,
  };

  private async loadCache() {
    if (this.walkingCache && this.drivingCache) return;
    
    this.walkingCache = {};
    this.drivingCache = {};
    
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    try {
      const walkingData = await fs.readFile(this.walkingCachePath, "utf-8");
      this.walkingCache = JSON.parse(walkingData);
    } catch {
      // Ignore if doesn't exist
    }
    
    try {
      const drivingData = await fs.readFile(this.drivingCachePath, "utf-8");
      this.drivingCache = JSON.parse(drivingData);
    } catch {
      // Ignore if doesn't exist
    }
    
    process.on("exit", () => {
      this.saveCacheSync();
    });
  }

  private saveCacheSync() {
    if (!this.cacheDirty) return;
    try {
      if (this.walkingCache) {
        import("node:fs").then(m => m.writeFileSync(this.walkingCachePath, JSON.stringify(this.walkingCache, null, 2)));
      }
      if (this.drivingCache) {
        import("node:fs").then(m => m.writeFileSync(this.drivingCachePath, JSON.stringify(this.drivingCache, null, 2)));
      }
      this.cacheDirty = false;
    } catch (e) {
      console.error("Failed to save ORS route cache:", e);
    }
  }

  private async saveCache() {
    if (!this.cacheDirty) return;
    try {
      if (this.walkingCache) {
        await fs.writeFile(this.walkingCachePath, JSON.stringify(this.walkingCache, null, 2));
      }
      if (this.drivingCache) {
        await fs.writeFile(this.drivingCachePath, JSON.stringify(this.drivingCache, null, 2));
      }
      this.cacheDirty = false;
    } catch (e) {
      console.error("Failed to save ORS route cache:", e);
    }
  }

  private getCacheKey(from: Location, to: Location): string {
    // Normalizing coordinates to 5 decimal places (approx 1.1m precision)
    const fromLat = from.latitude.toFixed(5);
    const fromLng = from.longitude.toFixed(5);
    const toLat = to.latitude.toFixed(5);
    const toLng = to.longitude.toFixed(5);
    return `${fromLat},${fromLng}:${toLat},${toLng}`;
  }

  private pendingRequests = new Map<string, Promise<TravelEstimate>>();
  private warnedErrors = new Set<string>();

  private async fetchFromORS(from: Location, to: Location, profile: string): Promise<TravelEstimate> {
    const apiKey = process.env.ORS_API_KEY;
    if (!apiKey) {
      throw new Error("ORS_API_KEY environment variable is not set");
    }

    this.stats.apiRequests++;
    
    const url = `https://api.openrouteservice.org/v2/directions/${profile}?api_key=${apiKey}&start=${from.longitude},${from.latitude}&end=${to.longitude},${to.latitude}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8",
      },
    });

    if (!response.ok) {
      throw new Error(`ORS API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.features || data.features.length === 0) {
      throw new Error("No route found in ORS response");
    }

    const properties = data.features[0].properties;
    const distanceKm = properties.summary.distance / 1000;
    const durationMinutes = properties.summary.duration / 60;

    return { distanceKm, durationMinutes };
  }

  async estimateTravelTime(from: Location, to: Location, mode: TravelMode, context: RoutingContext = {}): Promise<TravelEstimate> {
    await this.loadCache();
    
    const isWalking = mode === "walking";
    const cache = isWalking ? this.walkingCache! : this.drivingCache!;
    const profile = isWalking ? "foot-walking" : "driving-car";
    const cacheKey = this.getCacheKey(from, to);

    if (isWalking) this.stats.walkingRoutes++;
    else this.stats.drivingRoutes++;

    if (cache[cacheKey]) {
      this.stats.cacheHits++;
      return this.applyContext(cache[cacheKey], context);
    }

    // Deduplicate concurrent requests for the exact same route
    if (this.pendingRequests.has(cacheKey)) {
      this.stats.cacheHits++; // Treat concurrent deduped wait as a cache hit
      try {
        const result = await this.pendingRequests.get(cacheKey)!;
        return this.applyContext(result, context);
      } catch (e) {
        // Will fallback below
      }
    } else {
      this.stats.cacheMisses++;
    }

    const requestPromise = this.fetchFromORS(from, to, profile)
      .then(result => {
        cache[cacheKey] = result;
        this.cacheDirty = true;
        if (this.stats.cacheMisses % 100 === 0) {
          this.saveCache();
        }
        return result;
      })
      .finally(() => {
        this.pendingRequests.delete(cacheKey);
      });

    this.pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;
      return this.applyContext(result, context);
    } catch (e: any) {
      this.stats.routeFailures++;
      this.stats.haversineFallbacks++;
      
      const fallback = await this.haversineFallback.estimateTravelTime(from, to, mode, context);
      
      if (!this.warnedErrors.has(e.message)) {
        console.warn(`ORS API Warning: ${e.message}. Future identical errors will be silently handled with Haversine fallback.`);
        this.warnedErrors.add(e.message);
      }

      return fallback;
    }
  }

  private applyContext(estimate: TravelEstimate, context: RoutingContext): TravelEstimate {
    // The ORS gives us base driving/walking duration.
    // The original simulator adjusts time by traffic multiplier and noise.
    // We should preserve the traffic noise/multiplier logic for fair comparison, 
    // or just return the ORS duration unmodified if we want strict real-world.
    // The prompt says: "ORS should simply provide more realistic travel distance/duration. Do not redesign this formula."
    // And "Do NOT silently change: ... speed assumptions, traffic multiplier, noise model".
    // Wait, Haversine uses speedKph. ORS already accounts for speed.
    // But the prompt says "Preserve the existing behavior when the routing engine is set to Haversine."
    // For ORS, we should just use ORS's duration, but maybe apply noise/traffic?
    // Let's apply noise and traffic multiplier to ORS duration.
    const trafficMultiplier = context.trafficMultiplier ?? 1;
    const noiseMinutes = context.noiseMinutes ?? 0;
    const durationMinutes = Math.max(1, estimate.durationMinutes * trafficMultiplier + noiseMinutes);
    return {
      distanceKm: estimate.distanceKm,
      durationMinutes,
    };
  }
}

import type { Location } from "../domain/types";
import type { RoutingEngine, RoutingContext, TravelEstimate, TravelMode } from "./routing-engine";
import { HaversineRoutingEngine } from "./deterministic-routing";

export class ValhallaRoutingEngine implements RoutingEngine {
  private cache = new Map<string, TravelEstimate>();
  private pendingRequests = new Map<string, Promise<TravelEstimate>>();
  private warnedErrors = new Set<string>();
  private haversineFallback = new HaversineRoutingEngine();
  private endpoint = process.env.VALHALLA_URL || "http://localhost:8002/route";

  public stats = {
    apiRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    walkingRoutes: 0,
    drivingRoutes: 0,
    routeFailures: 0,
    haversineFallbacks: 0,
  };

  private getCacheKey(from: Location, to: Location, mode: TravelMode): string {
    const fromLat = from.latitude.toFixed(5);
    const fromLng = from.longitude.toFixed(5);
    const toLat = to.latitude.toFixed(5);
    const toLng = to.longitude.toFixed(5);
    return `${mode}:${fromLat},${fromLng}->${toLat},${toLng}`;
  }

  private async fetchFromValhalla(from: Location, to: Location, profile: string): Promise<TravelEstimate> {
    this.stats.apiRequests++;

    const payload = {
      locations: [
        { lat: from.latitude, lon: from.longitude },
        { lat: to.latitude, lon: to.longitude }
      ],
      costing: profile,
      units: "kilometers"
    };

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Valhalla API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.trip || !data.trip.summary) {
      throw new Error("No route summary found in Valhalla response");
    }

    const distanceKm = data.trip.summary.length;
    const durationMinutes = data.trip.summary.time / 60;

    return { distanceKm, durationMinutes };
  }

  async estimateTravelTime(from: Location, to: Location, mode: TravelMode, context: RoutingContext = {}): Promise<TravelEstimate> {
    const isWalking = mode === "walking";
    const profile = isWalking ? "pedestrian" : "motorcycle";
    const cacheKey = this.getCacheKey(from, to, mode);

    if (isWalking) this.stats.walkingRoutes++;
    else this.stats.drivingRoutes++;

    if (this.cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.applyContext(this.cache.get(cacheKey)!, context);
    }

    // Deduplicate concurrent requests
    if (this.pendingRequests.has(cacheKey)) {
      this.stats.cacheHits++; // Treat concurrent wait as hit
      try {
        const result = await this.pendingRequests.get(cacheKey)!;
        return this.applyContext(result, context);
      } catch (e) {
        // Fallback handles this below
      }
    } else {
      this.stats.cacheMisses++;
    }

    const requestPromise = this.fetchFromValhalla(from, to, profile)
      .then(result => {
        this.cache.set(cacheKey, result);
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
        console.warn(`Valhalla Routing Warning: ${e.message}. Falling back to Haversine.`);
        this.warnedErrors.add(e.message);
      }

      return fallback;
    }
  }

  private applyContext(estimate: TravelEstimate, context: RoutingContext): TravelEstimate {
    const trafficMultiplier = context.trafficMultiplier ?? 1;
    const noiseMinutes = context.noiseMinutes ?? 0;
    const durationMinutes = Math.max(1, estimate.durationMinutes * trafficMultiplier + noiseMinutes);
    return {
      distanceKm: estimate.distanceKm,
      durationMinutes,
    };
  }
}

import type { Location } from "../domain/types";
import type { RoutingEngine, RoutingContext, TravelEstimate, TravelMode } from "./routing-engine";
import { HaversineRoutingEngine } from "./deterministic-routing";

export type MatrixEstimate = {
  fromIndex: number;
  toIndex: number;
  distanceKm: number;
  durationMinutes: number;
};

export type IsochroneContour = {
  timeMinutes: number;
  color?: string;
};

export type IsochroneFeature = {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    contour: number;
    color?: string;
    opacity?: number;
  };
};

export type IsochroneResponse = {
  type: "FeatureCollection";
  features: IsochroneFeature[];
};

export class ValhallaRoutingEngine implements RoutingEngine {
  private cache = new Map<string, TravelEstimate>();
  private pendingRequests = new Map<string, Promise<TravelEstimate>>();
  private warnedErrors = new Set<string>();
  private haversineFallback = new HaversineRoutingEngine();
  
  private baseUrl: string;

  public stats = {
    apiRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    walkingRoutes: 0,
    drivingRoutes: 0,
    matrixRequests: 0,
    isochroneRequests: 0,
    routeFailures: 0,
    haversineFallbacks: 0,
  };

  constructor(customUrl?: string) {
    const raw = customUrl || process.env.VALHALLA_URL || "http://localhost:8002";
    // Strip trailing /route or / if user passed full endpoint
    this.baseUrl = raw.replace(/\/route\/?$/, "").replace(/\/+$/, "");
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  private getCacheKey(from: Location, to: Location, mode: TravelMode): string {
    const fromLat = from.latitude.toFixed(5);
    const fromLng = from.longitude.toFixed(5);
    const toLat = to.latitude.toFixed(5);
    const toLng = to.longitude.toFixed(5);
    return `${mode}:${fromLat},${fromLng}->${toLat},${toLng}`;
  }

  /**
   * /route: Single point-to-point trip calculation
   */
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

    const response = await fetch(`${this.baseUrl}/route`, {
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

  /**
   * RoutingEngine standard interface: Estimate travel time between two points
   */
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

    // Deduplicate concurrent requests for identical coordinates
    if (this.pendingRequests.has(cacheKey)) {
      this.stats.cacheHits++;
      try {
        const result = await this.pendingRequests.get(cacheKey)!;
        return this.applyContext(result, context);
      } catch (e) {
        // Handled by fallback below
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

  /**
   * /sources_to_targets: One-to-many or many-to-many distance/time matrix
   * Perfect for "errands near worker" or "riders nearest to pickup" in a single HTTP roundtrip
   */
  async sourcesToTargets(
    sources: Location[],
    targets: Location[],
    mode: TravelMode = "driving"
  ): Promise<MatrixEstimate[][]> {
    this.stats.matrixRequests++;
    const profile = mode === "walking" ? "pedestrian" : "motorcycle";

    const payload = {
      sources: sources.map(s => ({ lat: s.latitude, lon: s.longitude })),
      targets: targets.map(t => ({ lat: t.latitude, lon: t.longitude })),
      costing: profile,
      units: "kilometers"
    };

    const response = await fetch(`${this.baseUrl}/sources_to_targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Valhalla matrix error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.sources_to_targets) {
      throw new Error("No sources_to_targets returned by Valhalla matrix API");
    }

    return data.sources_to_targets.map((row: any[], srcIdx: number) =>
      row.map((item: any, tgtIdx: number) => ({
        fromIndex: srcIdx,
        toIndex: tgtIdx,
        distanceKm: item?.distance ?? 0,
        durationMinutes: (item?.time ?? 0) / 60,
      }))
    );
  }

  /**
   * /isochrone: Reachability polygon calculation
   * Perfect for "show jobs within 15 or 30 minutes"
   */
  async isochrone(
    center: Location,
    contours: number[] = [15, 30],
    mode: TravelMode = "driving"
  ): Promise<IsochroneResponse> {
    this.stats.isochroneRequests++;
    const profile = mode === "walking" ? "pedestrian" : "motorcycle";

    const payload = {
      locations: [{ lat: center.latitude, lon: center.longitude }],
      costing: profile,
      contours: contours.map(time => ({ time })),
      polygons: true,
      units: "kilometers",
    };

    const response = await fetch(`${this.baseUrl}/isochrone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Valhalla isochrone error: ${response.status} ${response.statusText}`);
    }

    return response.json();
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

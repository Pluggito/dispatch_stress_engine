import type { Location } from "../domain/types";

export type TravelMode = "walking" | "driving";

export type RoutingContext = {
  trafficMultiplier?: number;
  noiseMinutes?: number;
  averageSpeedKph?: number;
};

export type TravelEstimate = {
  distanceKm: number;
  durationMinutes: number;
};

export interface RoutingEngine {
  estimateTravelTime(
    from: Location,
    to: Location,
    mode: TravelMode,
    context?: RoutingContext
  ): Promise<TravelEstimate>;
}

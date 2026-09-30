import type { Location } from "../domain/types";
import type { RoutingEngine, RoutingContext, TravelEstimate, TravelMode } from "./routing-engine";

const EARTH_RADIUS_KM = 6371;

export function haversineDistanceKm(from: Location, to: Location): number {
  const latitudeDelta = ((to.latitude - from.latitude) * Math.PI) / 180;
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
  const latitudeOne = (from.latitude * Math.PI) / 180;
  const latitudeTwo = (to.latitude * Math.PI) / 180;
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.sin(longitudeDelta / 2) ** 2 * Math.cos(latitudeOne) * Math.cos(latitudeTwo);
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export class HaversineRoutingEngine implements RoutingEngine {
  constructor(private readonly defaultSpeedKph = 18) {}

  async estimateTravelTime(from: Location, to: Location, mode: TravelMode, context: RoutingContext = {}): Promise<TravelEstimate> {
    const distanceKm = haversineDistanceKm(from, to);
    const trafficMultiplier = context.trafficMultiplier ?? 1;
    const noiseMinutes = context.noiseMinutes ?? 0;
    const speedKph = context.averageSpeedKph ?? this.defaultSpeedKph;
    const durationMinutes = Math.max(1, distanceKm / speedKph * 60 * trafficMultiplier + noiseMinutes);
    return { distanceKm, durationMinutes };
  }
}

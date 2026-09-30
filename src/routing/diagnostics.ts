import { UNILAG_CAMPUS_PLACES } from "../simulation/campus";
import { createSeededRandom, randomBetween } from "../simulation/random";
import { HaversineRoutingEngine } from "./deterministic-routing";
import { percentile } from "../simulation/metrics";

export type RouteMode = "TREKKER" | "RIDER";

export type CampusRouteSample = {
  originName: string;
  destinationName: string;
  mode: RouteMode;
  distanceKm: number;
  travelTimeMinutes: number;
  assumedSpeedKph: number;
  effectiveSpeedKph: number;
  routeType: "HAVERSINE_STRAIGHT_LINE_SIMULATED_SPEED";
};

export type RouteSpeedSummary = {
  min: number;
  p50: number;
  p95: number;
  max: number;
};

export type CampusRouteDiagnostics = {
  samples: CampusRouteSample[];
  displayedSamples: CampusRouteSample[];
  speedByMode: Record<RouteMode, RouteSpeedSummary>;
};

function summarizeSpeeds(samples: CampusRouteSample[]): RouteSpeedSummary {
  const speeds = samples.map((sample) => sample.effectiveSpeedKph).sort((a, b) => a - b);
  return {
    min: speeds[0] ?? 0,
    p50: percentile(speeds, 0.5),
    p95: percentile(speeds, 0.95),
    max: speeds.at(-1) ?? 0,
  };
}

export async function sampleCampusRoutes(seed: number, sampleCount = 100, displayedSampleCount = 20): Promise<CampusRouteDiagnostics> {
  const random = createSeededRandom(seed ^ 0x6d2b79f5);
  const routing = new HaversineRoutingEngine();
  const samples: CampusRouteSample[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const origin = UNILAG_CAMPUS_PLACES[Math.floor(random() * UNILAG_CAMPUS_PLACES.length)];
    let destination = UNILAG_CAMPUS_PLACES[Math.floor(random() * UNILAG_CAMPUS_PLACES.length)];
    while (destination.name === origin.name) {
      destination = UNILAG_CAMPUS_PLACES[Math.floor(random() * UNILAG_CAMPUS_PLACES.length)];
    }
    const mode: RouteMode = random() < 0.75 ? "TREKKER" : "RIDER";
    const assumedSpeedKph = mode === "TREKKER" ? randomBetween(random, 4, 6) : randomBetween(random, 18, 28);
    const travelMode = mode === "TREKKER" ? "walking" : "driving";
    const estimate = await routing.estimateTravelTime(origin.location, destination.location, travelMode, { averageSpeedKph: assumedSpeedKph });
    const effectiveSpeedKph = estimate.durationMinutes > 0 ? estimate.distanceKm / (estimate.durationMinutes / 60) : 0;
    samples.push({
      originName: `${mode} / ${origin.name}`,
      destinationName: destination.name,
      mode,
      distanceKm: estimate.distanceKm,
      travelTimeMinutes: estimate.durationMinutes,
      assumedSpeedKph,
      effectiveSpeedKph,
      routeType: "HAVERSINE_STRAIGHT_LINE_SIMULATED_SPEED",
    });
  }

  return {
    samples,
    displayedSamples: samples.slice(0, displayedSampleCount),
    speedByMode: {
      TREKKER: summarizeSpeeds(samples.filter((sample) => sample.mode === "TREKKER")),
      RIDER: summarizeSpeeds(samples.filter((sample) => sample.mode === "RIDER")),
    },
  };
}

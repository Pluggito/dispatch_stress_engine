import type { SimulationMetrics } from "./metrics";

export type BottleneckLabel =
  | "UNDERUTILIZED_FLEET"
  | "BALANCED"
  | "RIDER_AVAILABILITY_LIMIT"
  | "PICKUP_ETA_LIMIT"
  | "FLEET_THROUGHPUT_LIMIT"
  | "MIXED_BOTTLENECK";

export type BottleneckThresholds = {
  underutilizedPercent: number;
  approachingUtilizationPercent: number;
  highUtilizationPercent: number;
  saturatedUtilizationPercent: number;
  queueWarningPercent: number;
  availabilityDominanceRatio: number;
};

export const DEFAULT_BOTTLENECK_THRESHOLDS: BottleneckThresholds = {
  underutilizedPercent: 65,
  approachingUtilizationPercent: 80,
  highUtilizationPercent: 90,
  saturatedUtilizationPercent: 95,
  queueWarningPercent: 5,
  availabilityDominanceRatio: 1.5,
};

export function classifyBottleneck(
  metrics: SimulationMetrics,
  thresholds: BottleneckThresholds = DEFAULT_BOTTLENECK_THRESHOLDS,
): BottleneckLabel {
  const queuePercent = metrics.orders ? metrics.queued / metrics.orders * 100 : 0;
  const pickupEtaQueue = metrics.queueReasons.PICKUP_ETA_EXCEEDED.count;
  const pickupEtaQueuePercent = metrics.orders ? pickupEtaQueue / metrics.orders * 100 : 0;
  const queueAvailability = metrics.pickupFeasibility.nearestAvailabilityMinutes.average;
  const queueTravel = metrics.pickupFeasibility.nearestTravelTimeMinutes.average;
  const availabilityDominates = queueTravel > 0 && queueAvailability >= queueTravel * thresholds.availabilityDominanceRatio;

  if (pickupEtaQueuePercent >= thresholds.queueWarningPercent && availabilityDominates) return "RIDER_AVAILABILITY_LIMIT";
  if (pickupEtaQueuePercent >= thresholds.queueWarningPercent) return "PICKUP_ETA_LIMIT";
  if (metrics.averageFleetUtilization >= thresholds.saturatedUtilizationPercent && queuePercent >= thresholds.queueWarningPercent) return "FLEET_THROUGHPUT_LIMIT";
  if (metrics.averageFleetUtilization < thresholds.underutilizedPercent) {
    return queuePercent >= thresholds.queueWarningPercent ? "MIXED_BOTTLENECK" : "UNDERUTILIZED_FLEET";
  }
  if (metrics.averageFleetUtilization >= thresholds.highUtilizationPercent && queuePercent >= thresholds.queueWarningPercent) return "FLEET_THROUGHPUT_LIMIT";
  if (metrics.averageFleetUtilization >= thresholds.approachingUtilizationPercent && queuePercent >= thresholds.queueWarningPercent) return "MIXED_BOTTLENECK";
  return queuePercent >= thresholds.queueWarningPercent ? "MIXED_BOTTLENECK" : "BALANCED";
}

import type { DeliveryPerson, DeliveryPersonType } from "../domain/types";
import type { QueueFailureReason } from "../dispatch/types";
import type { CampusRouteDiagnostics } from "../routing/diagnostics";
import {
  bucketCounts,
  maximum,
  mean,
  PICKUP_ETA_BOUNDS,
  PICKUP_ETA_OVERFLOW,
  summarize,
  type BucketStats,
  type PercentileStats,
} from "./stats";

export { percentile, type BucketStats, type PercentileStats } from "./stats";

export type CurrentQueueFailureReason = Exclude<QueueFailureReason, "PICKUP_TOO_FAR">;
export type QueueReasonStats = Record<CurrentQueueFailureReason, { count: number; percent: number }>;

export type PickupFeasibilityDiagnostics = {
  queuedOrders: number;
  queuedAsEtaExceeded: number;
  ordersWithRoutedCandidates: number;
  averageRoutedCandidates: number;
  averageRejectedCandidates: number;
  nearestDistanceKm: PercentileStats;
  nearestTravelTimeMinutes: PercentileStats;
  nearestAvailabilityMinutes: PercentileStats;
  nearestEtaMinutes: PercentileStats;
  distanceBuckets: BucketStats;
  etaBuckets: BucketStats;
  travelEtaBuckets: BucketStats;
  assignedEtaBuckets: BucketStats;
  queuedEtaBuckets: BucketStats;
  assignedPickupEta: PickupEtaProfile;
  queuedPickupEta: PickupEtaProfile;
};

export type PickupEtaObservation = {
  riderAvailabilityMinutes: number | null;
  pureTravelMinutes: number | null;
  combinedEtaMinutes: number | null;
};

export type PickupEtaProfile = {
  riderAvailabilityMinutes: PercentileStats;
  pureTravelMinutes: PercentileStats;
  combinedEtaMinutes: PercentileStats;
  buckets: BucketStats;
};

export type IncrementalTimeBreakdown = {
  riderAvailabilityMinutes: number;
  travelToVendorMinutes: number;
  predictedPickupWaitMinutes: number;
  dropoffTravelMinutes: number;
  directTravelMinutes: number;
  pickupServiceMinutes: number;
  incrementalTimeMinutes: number;
};

export type OrderDiagnosticSample = {
  orderId: string;
  state: "ASSIGNED" | "QUEUED";
  vendor: string;
  destination: string;
  orderCreatedAt: number;
  vendorReadyAt: number;
  riderEtaMinutes: number | null;
  pickupArrivalAt: number | null;
  pickupWaitMinutes: number | null;
  pickupDelayMinutes: number | null;
  distanceToVendorKm: number | null;
  queueReason: QueueFailureReason | null;
};

export type SimulationDiagnostics = {
  campusRoutes: CampusRouteDiagnostics;
  pickupFeasibility: PickupFeasibilityDiagnostics;
  orderSamples: OrderDiagnosticSample[];
};

/** A delivery slot held from assignment until expected drop-off. */
export type OccupancyInterval = {
  start: number;
  end: number;
  type: DeliveryPersonType;
};

export type OccupancySummary = {
  /** Time-weighted mean of occupied slots / total slots over [0, windowMinutes], as a fraction. */
  averageUtilization: number;
  /** Highest instantaneous occupied slots / total slots, as a fraction. */
  peakUtilization: number;
  peakActiveAssignments: number;
  peakActiveTrekkers: number;
  peakActiveRiders: number;
};

export type SimulationMetrics = {
  orders: number;
  assigned: number;
  queued: number;
  /** Queued orders that stopped being retried because they waited longer than maxQueueWaitMinutes. */
  expiredOrders: number;
  assignmentSuccessRate: number;
  queueReasons: QueueReasonStats;
  pickupFeasibility: PickupFeasibilityDiagnostics;
  deliveryMinutes: PercentileStats;
  /** Time from order creation to assignment, for assigned orders. */
  queueWaitMinutes: PercentileStats;
  pickupWaitMinutes: PercentileStats;
  pickupDelayMinutes: PercentileStats;
  latePickupCount: number;
  latePickupRate: number;
  slaMissedAssignments: number;
  slaMissRate: number;
  riderFailureEvents: number;
  peakActiveAssignments: number;
  peakActiveTrekkers: number;
  peakActiveRiders: number;
  averageFleetUtilization: number;
  peakFleetUtilization: number;
  averageOrdersPerPerson: number;
  maximumOrdersPerPerson: number;
  averageRiderIdleMinutes: number;
  averageCurrentWorkloadMinutes: number;
  averageIncrementalDistanceKm: number;
  averageIncrementalTimeMinutes: number;
  incrementalTimeBreakdown: IncrementalTimeBreakdown;
  dispatchDecisions: number;
  /** Retry attempts skipped because no courier could possibly pass the pickup gate. */
  skippedRetryAttempts: number;
  totalCandidateEvaluations: number;
  candidatesRejectedBeforeRouting: number;
  candidatesRejectedBeforeScoring: number;
  candidatesScored: number;
  averageEvaluationsPerOrder: number;
  averageScoredCandidatesPerDecision: number;
  dispatchTimeMs: number;
  trekkers: number;
  riders: number;
  riderCapacity: number;
  totalPersonnel: number;
  theoreticalConcurrentCapacity: number;
  ordersPerHour: number;
  assignedOrdersPerHour: number;
  trekkerOrdersPerHour: number;
  riderOrdersPerHour: number;
  horizonMinutes: number;
  strategy: string;
  arrivalPattern: string;
  debugTrace: string | null;
  diagnostics: SimulationDiagnostics | null;
};

export type SimulationMeasurements = {
  strategy: string;
  arrivalPattern: string;
  deliveryMinutes: number[];
  queueWaitMinutes: number[];
  pickupWaitMinutes: number[];
  pickupDelayMinutes: number[];
  latePickupCount: number;
  slaMissedAssignments: number;
  queuedReasons: CurrentQueueFailureReason[];
  expiredOrders: number;
  riderFailureEvents: number;
  occupancyIntervals: OccupancyInterval[];
  assignedOrdersByPerson: number[];
  riderIdleMinutes: number[];
  currentWorkloadMinutes: number[];
  incrementalDistanceKm: number[];
  incrementalTimeMinutes: number[];
  riderAvailabilityComponents: number[];
  travelToVendorComponents: number[];
  predictedPickupWaitComponents: number[];
  dropoffTravelComponents: number[];
  directTravelComponents: number[];
  pickupServiceComponents: number[];
  assignedPickupEtas: PickupEtaObservation[];
  queuedPickupEtas: PickupEtaObservation[];
  pickupFeasibility: Omit<PickupFeasibilityDiagnostics, "assignedEtaBuckets" | "queuedEtaBuckets" | "assignedPickupEta" | "queuedPickupEta">;
  dispatchDecisions: number;
  skippedRetryAttempts: number;
  totalCandidateEvaluations: number;
  candidatesRejectedBeforeRouting: number;
  candidatesRejectedBeforeScoring: number;
  candidatesScored: number;
  dispatchTimeMs: number;
  fleet: DeliveryPerson[];
  horizonMinutes: number;
  debugTrace: string | null;
  diagnostics: Omit<SimulationDiagnostics, "pickupFeasibility"> | null;
};

/**
 * Exact occupancy from assignment intervals via a sweep line.
 * A slot freed at time t is available to an order arriving at t (end events sort before start events),
 * matching the simulator's `expectedCompletionAt > now` rule.
 */
export function summarizeOccupancy(intervals: readonly OccupancyInterval[] = [], totalCapacity: number, windowMinutes: number): OccupancySummary {
  const events: Array<{ at: number; delta: 1 | -1; type: DeliveryPersonType }> = [];
  let occupiedSlotMinutes = 0;
  for (const interval of intervals ?? []) {
    const start = Math.max(0, interval.start);
    const end = Math.max(start, interval.end);
    events.push({ at: start, delta: 1, type: interval.type }, { at: end, delta: -1, type: interval.type });
    occupiedSlotMinutes += Math.max(0, Math.min(end, windowMinutes) - Math.min(start, windowMinutes));
  }
  events.sort((first, second) => first.at - second.at || first.delta - second.delta);

  let active = 0;
  let activeTrekkers = 0;
  let peakActiveAssignments = 0;
  let peakActiveTrekkers = 0;
  let peakActiveRiders = 0;
  for (const event of events) {
    active += event.delta;
    if (event.type === "TREKKER") activeTrekkers += event.delta;
    peakActiveAssignments = Math.max(peakActiveAssignments, active);
    peakActiveTrekkers = Math.max(peakActiveTrekkers, activeTrekkers);
    peakActiveRiders = Math.max(peakActiveRiders, active - activeTrekkers);
  }

  return {
    averageUtilization: totalCapacity > 0 && windowMinutes > 0 ? occupiedSlotMinutes / (totalCapacity * windowMinutes) : 0,
    peakUtilization: totalCapacity > 0 ? peakActiveAssignments / totalCapacity : 0,
    peakActiveAssignments,
    peakActiveTrekkers,
    peakActiveRiders,
  };
}

function nonNull(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

function pickupEtaBuckets(observations: PickupEtaObservation[]): BucketStats {
  return bucketCounts(nonNull(observations.map((observation) => observation.combinedEtaMinutes)), PICKUP_ETA_BOUNDS, PICKUP_ETA_OVERFLOW);
}

function pickupEtaProfile(observations: PickupEtaObservation[]): PickupEtaProfile {
  return {
    riderAvailabilityMinutes: summarize(nonNull(observations.map((observation) => observation.riderAvailabilityMinutes))),
    pureTravelMinutes: summarize(nonNull(observations.map((observation) => observation.pureTravelMinutes))),
    combinedEtaMinutes: summarize(nonNull(observations.map((observation) => observation.combinedEtaMinutes))),
    buckets: pickupEtaBuckets(observations),
  };
}

const QUEUE_REASONS: CurrentQueueFailureReason[] = [
  "NO_AVAILABLE_TREKKER",
  "CAPACITY_FULL",
  "SLA_RISK",
  "PICKUP_ETA_EXCEEDED",
  "NO_FEASIBLE_RIDER",
  "NO_FEASIBLE_ROUTE",
  "OTHER",
];

export function createMetrics(measurements: SimulationMeasurements): SimulationMetrics {
  const assigned = measurements.deliveryMinutes.length;
  const queued = measurements.queuedReasons.length;
  const orders = assigned + queued;
  const reasonCounts = new Map<CurrentQueueFailureReason, number>();
  for (const reason of measurements.queuedReasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  const queueReasons = Object.fromEntries(QUEUE_REASONS.map((reason) => {
    const count = reasonCounts.get(reason) ?? 0;
    return [reason, { count, percent: queued ? count / queued * 100 : 0 }];
  })) as QueueReasonStats;

  const trekkers = measurements.fleet.filter((person) => person.type === "TREKKER");
  const riders = measurements.fleet.filter((person) => person.type === "RIDER");
  const totalCapacity = measurements.fleet.reduce((capacity, person) => capacity + person.maxActiveDeliveries, 0);
  const occupancy = summarizeOccupancy(measurements.occupancyIntervals, totalCapacity, measurements.horizonMinutes);
  const pickupFeasibility: PickupFeasibilityDiagnostics = {
    ...measurements.pickupFeasibility,
    assignedEtaBuckets: pickupEtaBuckets(measurements.assignedPickupEtas),
    queuedEtaBuckets: pickupEtaBuckets(measurements.queuedPickupEtas),
    assignedPickupEta: pickupEtaProfile(measurements.assignedPickupEtas),
    queuedPickupEta: pickupEtaProfile(measurements.queuedPickupEtas),
  };
  let assignedToTrekkers = 0;
  let assignedToRiders = 0;
  measurements.fleet.forEach((person, index) => {
    if (person.type === "TREKKER") assignedToTrekkers += measurements.assignedOrdersByPerson[index];
    else assignedToRiders += measurements.assignedOrdersByPerson[index];
  });
  const simulatedHours = measurements.horizonMinutes / 60;
  const perHour = (count: number) => simulatedHours > 0 ? count / simulatedHours : 0;

  return {
    orders,
    assigned,
    queued,
    expiredOrders: measurements.expiredOrders,
    assignmentSuccessRate: orders ? assigned / orders * 100 : 0,
    queueReasons,
    pickupFeasibility,
    deliveryMinutes: summarize(measurements.deliveryMinutes),
    queueWaitMinutes: summarize(measurements.queueWaitMinutes),
    pickupWaitMinutes: summarize(measurements.pickupWaitMinutes),
    pickupDelayMinutes: summarize(measurements.pickupDelayMinutes),
    latePickupCount: measurements.latePickupCount,
    latePickupRate: assigned ? measurements.latePickupCount / assigned * 100 : 0,
    slaMissedAssignments: measurements.slaMissedAssignments,
    slaMissRate: assigned ? measurements.slaMissedAssignments / assigned * 100 : 0,
    riderFailureEvents: measurements.riderFailureEvents,
    peakActiveAssignments: occupancy.peakActiveAssignments,
    peakActiveTrekkers: occupancy.peakActiveTrekkers,
    peakActiveRiders: occupancy.peakActiveRiders,
    averageFleetUtilization: occupancy.averageUtilization * 100,
    peakFleetUtilization: occupancy.peakUtilization * 100,
    averageOrdersPerPerson: measurements.fleet.length ? assigned / measurements.fleet.length : 0,
    maximumOrdersPerPerson: maximum(measurements.assignedOrdersByPerson),
    averageRiderIdleMinutes: mean(measurements.riderIdleMinutes),
    averageCurrentWorkloadMinutes: mean(measurements.currentWorkloadMinutes),
    averageIncrementalDistanceKm: mean(measurements.incrementalDistanceKm),
    averageIncrementalTimeMinutes: mean(measurements.incrementalTimeMinutes),
    incrementalTimeBreakdown: {
      riderAvailabilityMinutes: mean(measurements.riderAvailabilityComponents),
      travelToVendorMinutes: mean(measurements.travelToVendorComponents),
      predictedPickupWaitMinutes: mean(measurements.predictedPickupWaitComponents),
      dropoffTravelMinutes: mean(measurements.dropoffTravelComponents),
      directTravelMinutes: mean(measurements.directTravelComponents),
      pickupServiceMinutes: mean(measurements.pickupServiceComponents),
      incrementalTimeMinutes: mean(measurements.incrementalTimeMinutes),
    },
    dispatchDecisions: measurements.dispatchDecisions,
    skippedRetryAttempts: measurements.skippedRetryAttempts,
    totalCandidateEvaluations: measurements.totalCandidateEvaluations,
    candidatesRejectedBeforeRouting: measurements.candidatesRejectedBeforeRouting,
    candidatesRejectedBeforeScoring: measurements.candidatesRejectedBeforeScoring,
    candidatesScored: measurements.candidatesScored,
    averageEvaluationsPerOrder: orders ? measurements.totalCandidateEvaluations / orders : 0,
    averageScoredCandidatesPerDecision: measurements.dispatchDecisions ? measurements.candidatesScored / measurements.dispatchDecisions : 0,
    dispatchTimeMs: measurements.dispatchTimeMs,
    trekkers: trekkers.length,
    riders: riders.length,
    riderCapacity: riders[0]?.maxActiveDeliveries ?? 4,
    totalPersonnel: measurements.fleet.length,
    theoreticalConcurrentCapacity: totalCapacity,
    ordersPerHour: perHour(orders),
    assignedOrdersPerHour: perHour(assigned),
    trekkerOrdersPerHour: perHour(assignedToTrekkers),
    riderOrdersPerHour: perHour(assignedToRiders),
    horizonMinutes: measurements.horizonMinutes,
    strategy: measurements.strategy,
    arrivalPattern: measurements.arrivalPattern,
    debugTrace: measurements.debugTrace,
    diagnostics: measurements.diagnostics ? { ...measurements.diagnostics, pickupFeasibility } : null,
  };
}

import type { DeliveryPerson } from "../domain/types";
import type { QueueFailureReason } from "../dispatch/types";
import type { CampusRouteDiagnostics } from "../routing/diagnostics";

export type PercentileStats = {
  average: number;
  p50: number;
  p95: number;
  p99: number;
};

export type CurrentQueueFailureReason = Exclude<QueueFailureReason, "PICKUP_TOO_FAR">;
export type QueueReasonStats = Record<CurrentQueueFailureReason, { count: number; percent: number }>;

export type BucketStats = Record<string, { count: number; percent: number }>;

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
  pickupFeasibility: Omit<PickupFeasibilityDiagnostics, "assignedPickupEta" | "queuedPickupEta">;
  orderSamples: OrderDiagnosticSample[];
};

export type SimulationMetrics = {
  orders: number;
  assigned: number;
  queued: number;
  assignmentSuccessRate: number;
  queueReasons: QueueReasonStats;
  pickupFeasibility: PickupFeasibilityDiagnostics;
  deliveryMinutes: PercentileStats;
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
  pickupWaitMinutes: number[];
  pickupDelayMinutes: number[];
  latePickupCount: number;
  slaMissedAssignments: number;
  queuedReasons: CurrentQueueFailureReason[];
  riderFailureEvents: number;
  peakActiveAssignments: number;
  peakActiveTrekkers: number;
  peakActiveRiders: number;
  utilizationSamples: number[];
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
  totalCandidateEvaluations: number;
  candidatesRejectedBeforeRouting: number;
  candidatesRejectedBeforeScoring: number;
  candidatesScored: number;
  dispatchTimeMs: number;
  fleet: DeliveryPerson[];
  horizonMinutes: number;
  debugTrace: string | null;
  diagnostics: SimulationDiagnostics | null;
};

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index];
}

function summarize(values: number[]): PercentileStats {
  return {
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

function bucketCounts(values: number[], bounds: Array<{ label: string; maximum: number }>): BucketStats {
  const counts = Object.fromEntries([...bounds.map(({ label }) => [label, 0]), [">30 min", 0]]) as Record<string, number>;
  for (const value of values) {
    const label = bounds.find((bound) => value < bound.maximum)?.label ?? ">30 min";
    counts[label] += 1;
  }
  return Object.fromEntries(Object.entries(counts).map(([label, count]) => [label, {
    count,
    percent: values.length ? count / values.length * 100 : 0,
  }]));
}

function pickupEtaBuckets(observations: PickupEtaObservation[]): BucketStats {
  return bucketCounts(
    observations.flatMap((observation) => observation.combinedEtaMinutes === null ? [] : [observation.combinedEtaMinutes]),
    [
      { label: "<5 min", maximum: 5 },
      { label: "5-10 min", maximum: 10 },
      { label: "10-15 min", maximum: 15 },
      { label: "15-20 min", maximum: 20 },
      { label: "20-25 min", maximum: 25 },
      { label: "25-30 min", maximum: 30 },
    ],
  );
}

function pickupEtaProfile(observations: PickupEtaObservation[]): PickupEtaProfile {
  const getValues = (key: keyof PickupEtaObservation) => observations.flatMap((observation) => {
    const value = observation[key];
    return value === null ? [] : [value];
  });
  const availability = getValues("riderAvailabilityMinutes");
  const travel = getValues("pureTravelMinutes");
  const combined = getValues("combinedEtaMinutes");
  return {
    riderAvailabilityMinutes: summarize(availability),
    pureTravelMinutes: summarize(travel),
    combinedEtaMinutes: summarize(combined),
    buckets: pickupEtaBuckets(observations),
  };
}

const QUEUE_REASONS: QueueFailureReason[] = [
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
  const queueReasons = Object.fromEntries(QUEUE_REASONS.map((reason) => {
    const count = measurements.queuedReasons.filter((item) => item === reason).length;
    return [reason, { count, percent: queued ? count / queued * 100 : 0 }];
  })) as QueueReasonStats;
  const trekkers = measurements.fleet.filter((person) => person.type === "TREKKER");
  const riders = measurements.fleet.filter((person) => person.type === "RIDER");
  const pickupFeasibility: PickupFeasibilityDiagnostics = {
    ...measurements.pickupFeasibility,
    assignedEtaBuckets: pickupEtaBuckets(measurements.assignedPickupEtas),
    queuedEtaBuckets: pickupEtaBuckets(measurements.queuedPickupEtas),
    assignedPickupEta: pickupEtaProfile(measurements.assignedPickupEtas),
    queuedPickupEta: pickupEtaProfile(measurements.queuedPickupEtas),
  };
  const assignedToTrekkers = measurements.fleet.reduce((total, person, index) => total + (person.type === "TREKKER" ? measurements.assignedOrdersByPerson[index] : 0), 0);
  const assignedToRiders = measurements.fleet.reduce((total, person, index) => total + (person.type === "RIDER" ? measurements.assignedOrdersByPerson[index] : 0), 0);
  const simulatedHours = measurements.horizonMinutes / 60;
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  return {
    orders,
    assigned,
    queued,
    assignmentSuccessRate: orders ? assigned / orders * 100 : 0,
    queueReasons,
    pickupFeasibility,
    deliveryMinutes: summarize(measurements.deliveryMinutes),
    pickupWaitMinutes: summarize(measurements.pickupWaitMinutes),
    pickupDelayMinutes: summarize(measurements.pickupDelayMinutes),
    latePickupCount: measurements.latePickupCount,
    latePickupRate: assigned ? measurements.latePickupCount / assigned * 100 : 0,
    slaMissedAssignments: measurements.slaMissedAssignments,
    slaMissRate: assigned ? measurements.slaMissedAssignments / assigned * 100 : 0,
    riderFailureEvents: measurements.riderFailureEvents,
    peakActiveAssignments: measurements.peakActiveAssignments,
    peakActiveTrekkers: measurements.peakActiveTrekkers,
    peakActiveRiders: measurements.peakActiveRiders,
    averageFleetUtilization: average(measurements.utilizationSamples) * 100,
    peakFleetUtilization: measurements.utilizationSamples.length ? Math.max(...measurements.utilizationSamples) * 100 : 0,
    averageOrdersPerPerson: measurements.fleet.length ? assigned / measurements.fleet.length : 0,
    maximumOrdersPerPerson: measurements.assignedOrdersByPerson.length ? Math.max(...measurements.assignedOrdersByPerson) : 0,
    averageRiderIdleMinutes: average(measurements.riderIdleMinutes),
    averageCurrentWorkloadMinutes: average(measurements.currentWorkloadMinutes),
    averageIncrementalDistanceKm: average(measurements.incrementalDistanceKm),
    averageIncrementalTimeMinutes: average(measurements.incrementalTimeMinutes),
    incrementalTimeBreakdown: {
      riderAvailabilityMinutes: average(measurements.riderAvailabilityComponents),
      travelToVendorMinutes: average(measurements.travelToVendorComponents),
      predictedPickupWaitMinutes: average(measurements.predictedPickupWaitComponents),
      dropoffTravelMinutes: average(measurements.dropoffTravelComponents),
      directTravelMinutes: average(measurements.directTravelComponents),
      pickupServiceMinutes: average(measurements.pickupServiceComponents),
      incrementalTimeMinutes: average(measurements.incrementalTimeMinutes),
    },
    dispatchDecisions: measurements.dispatchDecisions,
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
    theoreticalConcurrentCapacity: measurements.fleet.reduce((capacity, person) => capacity + person.maxActiveDeliveries, 0),
    ordersPerHour: simulatedHours > 0 ? orders / simulatedHours : 0,
    assignedOrdersPerHour: simulatedHours > 0 ? assigned / simulatedHours : 0,
    trekkerOrdersPerHour: simulatedHours > 0 ? assignedToTrekkers / simulatedHours : 0,
    riderOrdersPerHour: simulatedHours > 0 ? assignedToRiders / simulatedHours : 0,
    horizonMinutes: measurements.horizonMinutes,
    strategy: measurements.strategy,
    arrivalPattern: measurements.arrivalPattern,
    debugTrace: measurements.debugTrace,
    diagnostics: measurements.diagnostics ? { ...measurements.diagnostics, pickupFeasibility } : null,
  };
}

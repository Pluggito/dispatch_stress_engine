import { performance } from "node:perf_hooks";
import type { DeliveryPerson, Order, Vendor } from "../domain/types";
import { dispatch } from "../dispatch/engine";
import type { DispatchStrategyName, QueueFailureReason } from "../dispatch/types";
import { createMetrics, type CurrentQueueFailureReason, type OrderDiagnosticSample, type PickupFeasibilityDiagnostics, type SimulationMetrics } from "./metrics";
import { calculateOrderTimeline } from "./order-timeline";
import { createSeededRandom, randomBetween } from "./random";
import { CAMPUS_HOSTELS, CAMPUS_VENDORS, randomCampusPlace } from "./campus";
import type { DispatchWeights } from "../dispatch/types";
import { sampleCampusRoutes } from "../routing/diagnostics";
import { percentile } from "./metrics";

export type ArrivalPattern = "uniform" | "peak" | "burst" | "lunch-rush" | "evening-rush";

export type SimulationOptions = {
  orders?: number;
  seed?: number;
  strategy?: DispatchStrategyName;
  arrivalPattern?: ArrivalPattern;
  trekkerCount?: number;
  riderCount?: number;
  riderCapacity?: 3 | 4;
  trafficMultiplier?: number;
  preparationErrorMinutes?: number;
  riderFailureRate?: number;
  riderRecoveryRate?: number;
  demandConcentration?: number;
  horizonMinutes?: number;
  maxPickupEtaMinutes?: number;
  maxDeliveryMinutes?: number;
  pickupServiceMinutes?: number;
  weights?: Partial<DispatchWeights>;
  debugOrderId?: string;
  diagnostics?: boolean;
};

type PickupQueueObservation = {
  totalCandidates: number;
  rejectedCandidates: number;
  routedCandidateCount: number;
  nearestDistanceKm: number | null;
  nearestTravelTimeMinutes: number | null;
  nearestAvailabilityMinutes: number | null;
  nearestEtaMinutes: number | null;
};

function deriveStreamSeed(seed: number, stream: number, index = 0, subindex = 0): number {
  return (seed
    ^ Math.imul(stream, 0x9e3779b1)
    ^ Math.imul(index + 1, 0x85ebca6b)
    ^ Math.imul(subindex + 1, 0xc2b2ae35)) >>> 0;
}

function bucketCounts(values: number[], bounds: Array<{ label: string; maximum: number }>, overflowLabel: string): Record<string, { count: number; percent: number }> {
  const counts = Object.fromEntries([...bounds.map(({ label }) => [label, 0]), [overflowLabel, 0]]) as Record<string, number>;
  for (const value of values) {
    const bucket = bounds.find(({ maximum }) => value < maximum)?.label ?? overflowLabel;
    counts[bucket] += 1;
  }
  return Object.fromEntries(Object.entries(counts).map(([label, count]) => [label, {
    count,
    percent: values.length ? count / values.length * 100 : 0,
  }]));
}

function createPickupDiagnostics(
  observations: PickupQueueObservation[],
  queuedOrders: number,
  queuedAsEtaExceeded: number,
): Omit<PickupFeasibilityDiagnostics, "assignedEtaBuckets" | "queuedEtaBuckets" | "assignedPickupEta" | "queuedPickupEta"> {
  const distances = observations.flatMap((observation) => observation.nearestDistanceKm === null ? [] : [observation.nearestDistanceKm]);
  const travelTimes = observations.flatMap((observation) => observation.nearestTravelTimeMinutes === null ? [] : [observation.nearestTravelTimeMinutes]);
  const availabilityTimes = observations.flatMap((observation) => observation.nearestAvailabilityMinutes === null ? [] : [observation.nearestAvailabilityMinutes]);
  const etas = observations.flatMap((observation) => observation.nearestEtaMinutes === null ? [] : [observation.nearestEtaMinutes]);
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    queuedOrders,
    queuedAsEtaExceeded,
    ordersWithRoutedCandidates: observations.filter((observation) => observation.routedCandidateCount > 0).length,
    averageRoutedCandidates: mean(observations.map((observation) => observation.routedCandidateCount)),
    averageRejectedCandidates: mean(observations.map((observation) => observation.rejectedCandidates)),
    nearestDistanceKm: {
      average: mean(distances),
      p50: percentile(distances, 0.5),
      p95: percentile(distances, 0.95),
      p99: percentile(distances, 0.99),
    },
    nearestTravelTimeMinutes: {
      average: mean(travelTimes),
      p50: percentile(travelTimes, 0.5),
      p95: percentile(travelTimes, 0.95),
      p99: percentile(travelTimes, 0.99),
    },
    nearestAvailabilityMinutes: {
      average: mean(availabilityTimes),
      p50: percentile(availabilityTimes, 0.5),
      p95: percentile(availabilityTimes, 0.95),
      p99: percentile(availabilityTimes, 0.99),
    },
    nearestEtaMinutes: {
      average: mean(etas),
      p50: percentile(etas, 0.5),
      p95: percentile(etas, 0.95),
      p99: percentile(etas, 0.99),
    },
    distanceBuckets: bucketCounts(distances, [
      { label: "<100m", maximum: 0.1 },
      { label: "100-250m", maximum: 0.25 },
      { label: "250-500m", maximum: 0.5 },
      { label: "500-750m", maximum: 0.75 },
      { label: "750m-1km", maximum: 1 },
    ], ">1km"),
    etaBuckets: bucketCounts(etas, [
      { label: "<2 min", maximum: 2 },
      { label: "2-5 min", maximum: 5 },
      { label: "5-10 min", maximum: 10 },
      { label: "10-15 min", maximum: 15 },
      { label: "15-20 min", maximum: 20 },
    ], ">20 min"),
    travelEtaBuckets: bucketCounts(travelTimes, [
      { label: "<2 min", maximum: 2 },
      { label: "2-5 min", maximum: 5 },
      { label: "5-10 min", maximum: 10 },
      { label: "10-15 min", maximum: 15 },
      { label: "15-20 min", maximum: 20 },
    ], ">20 min"),
  };
}

function createLocation(random: () => number) {
  return randomCampusPlace(random).location;
}

export function createFleet(seed: number, trekkerCount = 80, riderCount = 25, riderCapacity: 3 | 4 = 4): DeliveryPerson[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: trekkerCount + riderCount }, (_, index) => {
    const type = index < trekkerCount ? "TREKKER" : "RIDER";
    return {
      id: `${type.toLowerCase()}-${index + 1}`,
      type,
      status: random() > 0.12 ? "ONLINE" : "OFFLINE",
      location: createLocation(random),
      maxActiveDeliveries: type === "TREKKER" ? 2 : riderCapacity,
      activeDeliveries: [],
      averageSpeedKph: type === "TREKKER" ? randomBetween(random, 4, 6) : randomBetween(random, 18, 28),
    };
  });
}

function arrivalTime(index: number, total: number, pattern: ArrivalPattern, horizonMinutes: number): number {
  const position = total ? index / total : 0;
  if (pattern === "burst") return position * Math.min(30, horizonMinutes);
  if (pattern === "peak") {
    if (position < 0.2) return position / 0.2 * horizonMinutes * 0.4;
    if (position < 0.8) return horizonMinutes * 0.4 + (position - 0.2) / 0.6 * horizonMinutes * 0.2;
    return horizonMinutes * 0.6 + (position - 0.8) / 0.2 * horizonMinutes * 0.4;
  }
  if (pattern === "lunch-rush") {
    if (position < 0.15) return position / 0.15 * horizonMinutes * 0.2;
    if (position < 0.85) return horizonMinutes * 0.2 + (position - 0.15) / 0.7 * horizonMinutes * 0.6;
    return horizonMinutes * 0.8 + (position - 0.85) / 0.15 * horizonMinutes * 0.2;
  }
  if (pattern === "evening-rush") {
    if (position < 0.55) return position / 0.55 * horizonMinutes * 0.6;
    if (position < 0.9) return horizonMinutes * 0.6 + (position - 0.55) / 0.35 * horizonMinutes * 0.25;
    return horizonMinutes * 0.85 + (position - 0.9) / 0.1 * horizonMinutes * 0.15;
  }
  return position * horizonMinutes;
}

function createOrder(
  random: () => number,
  index: number,
  vendors: Vendor[],
  now: number,
  preparationErrorMinutes: number,
  demandConcentration: number,
): Order {
  const vendorIndex = random() < demandConcentration ? 0 : Math.floor(random() * vendors.length);
  const vendor = vendors[vendorIndex];
  const predictedPrep = vendor.preparationMinutes;
  const actualPrep = Math.max(3, predictedPrep + randomBetween(random, -preparationErrorMinutes, preparationErrorMinutes));
  const customerPlace = CAMPUS_HOSTELS[Math.floor(random() * CAMPUS_HOSTELS.length)];
  return {
    id: `order-${index + 1}`,
    vendorId: vendor.id,
    customerLabel: customerPlace.name,
    vendorLocation: vendor.location,
    customerLocation: customerPlace.location,
    createdAt: now,
    priority: random() > 0.96 ? "URGENT" : random() > 0.88 ? "HIGH" : "STANDARD",
    predictedReadyAt: now + predictedPrep,
    actualReadyAt: now + actualPrep,
  };
}

function debugDecisionTrace(order: Order, vendor: Vendor, decision: ReturnType<typeof dispatch>, selectedId: string | null): string {
  const candidates = decision.candidates
    .filter((candidate) => candidate.scored || candidate.reason)
    .sort((first, second) => {
      if (first.eligible !== second.eligible) return first.eligible ? -1 : 1;
      return (first.score ?? Number.POSITIVE_INFINITY) - (second.score ?? Number.POSITIVE_INFINITY);
    })
    .slice(0, 8);
  const lines = [
    `ORDER ${order.id}`,
    `Vendor: ${vendor.name} (${vendor.zone})`,
    `Destination: ${order.customerLabel}`,
    `Created: T+${order.createdAt.toFixed(1)} min`,
    `Vendor ready: T+${order.actualReadyAt.toFixed(1)} min`,
    "Candidates:",
  ];
  for (const candidate of candidates) {
    lines.push(`${candidate.deliveryPersonId} ${candidate.eligible ? "" : `REJECTED ${candidate.reason}`}`);
    lines.push(`- ETA vendor: ${candidate.etaToVendorMinutes?.toFixed(1) ?? "n/a"} min`);
    lines.push(`- Active orders: ${candidate.currentOrders}; capacity remaining: ${candidate.remainingCapacity}`);
    lines.push(`- Pickup delay: ${candidate.pickupDelayMinutes?.toFixed(1) ?? "n/a"} min`);
    lines.push(`- Incremental time: ${candidate.incrementalTimeMinutes?.toFixed(1) ?? "n/a"} min`);
    lines.push(`- Incremental distance: ${candidate.incrementalDistanceKm?.toFixed(2) ?? "n/a"} km`);
    lines.push(`- SLA risk: ${candidate.slaMissed === null ? "unknown" : candidate.slaMissed ? "HIGH" : "LOW"}`);
    lines.push(`- Score: ${candidate.score?.toFixed(2) ?? "not scored"}`);
  }
  lines.push(`Selected: ${selectedId ?? "none"}`);
  return lines.join("\n");
}

export async function runSimulation(options: SimulationOptions = {}, routingEngine?: import("../routing/routing-engine").RoutingEngine): Promise<SimulationMetrics> {
  const orderCount = options.orders ?? 1000;
  const seed = options.seed ?? 42;
  const strategy = options.strategy ?? "full";
  const arrivalPattern = options.arrivalPattern ?? "uniform";
  const trafficMultiplier = options.trafficMultiplier ?? 1;
  const preparationErrorMinutes = options.preparationErrorMinutes ?? 0;
  const riderFailureRate = options.riderFailureRate ?? 0;
  const riderRecoveryRate = options.riderRecoveryRate ?? 0.15;
  const demandConcentration = options.demandConcentration ?? 0;
  const horizonMinutes = options.horizonMinutes ?? 480;
  const maxPickupEtaMinutes = options.maxPickupEtaMinutes ?? 30;
  const maxDeliveryMinutes = options.maxDeliveryMinutes ?? 90;
  const pickupServiceMinutes = options.pickupServiceMinutes ?? 2;
  const diagnosticsEnabled = options.diagnostics ?? false;
  const vendorRandom = createSeededRandom(deriveStreamSeed(seed, 1));
  const routing = routingEngine ?? new (await import("../routing/deterministic-routing")).HaversineRoutingEngine();
  const vendors: Vendor[] = CAMPUS_VENDORS.map((place, index) => ({
    id: `vendor-${index + 1}`,
    name: place.name,
    zone: place.zone ?? "Campus",
    location: place.location,
    preparationMinutes: randomBetween(vendorRandom, 8, 22),
    preparationVarianceMinutes: preparationErrorMinutes,
  }));
  const fleet = createFleet(seed, options.trekkerCount, options.riderCount, options.riderCapacity);
  const deliveryMinutes: number[] = [];
  const pickupWaitMinutes: number[] = [];
  const pickupDelayMinutes: number[] = [];
  const queuedReasons: CurrentQueueFailureReason[] = [];
  const pendingOrders: Order[] = [];
  const latestFailureByOrder = new Map<string, QueueFailureReason>();
  const pickupObservationByOrder = new Map<string, PickupQueueObservation>();
  const assignedPickupEtas: Array<{ riderAvailabilityMinutes: number | null; pureTravelMinutes: number | null; combinedEtaMinutes: number | null }> = [];
  const queuedPickupEtas: Array<{ riderAvailabilityMinutes: number | null; pureTravelMinutes: number | null; combinedEtaMinutes: number | null }> = [];
  const orderSamples: OrderDiagnosticSample[] = [];
  const assignedOrdersByPerson = Array.from({ length: fleet.length }, () => 0);
  const lastBusyUntilByPerson = Array.from({ length: fleet.length }, () => 0);
  const riderIdleMinutes: number[] = [];
  const currentWorkloadMinutes: number[] = [];
  const incrementalDistanceKm: number[] = [];
  const incrementalTimeMinutes: number[] = [];
  const riderAvailabilityComponents: number[] = [];
  const travelToVendorComponents: number[] = [];
  const predictedPickupWaitComponents: number[] = [];
  const dropoffTravelComponents: number[] = [];
  const directTravelComponents: number[] = [];
  const pickupServiceComponents: number[] = [];
  const utilizationSamples: number[] = [];
  let latePickupCount = 0;
  let slaMissedAssignments = 0;
  let riderFailureEvents = 0;
  let peakActiveAssignments = 0;
  let peakActiveTrekkers = 0;
  let peakActiveRiders = 0;
  let dispatchDecisions = 0;
  let totalCandidateEvaluations = 0;
  let candidatesRejectedBeforeRouting = 0;
  let candidatesRejectedBeforeScoring = 0;
  let candidatesScored = 0;
  let dispatchTimeMs = 0;
  let debugTrace: string | null = null;
  let previousNow = 0;
  let lastRetryAt = Number.NEGATIVE_INFINITY;
  const totalCapacity = fleet.reduce((capacity, person) => capacity + person.maxActiveDeliveries, 0);

  function recordDecisionCounts(decision: ReturnType<typeof dispatch>) {
    dispatchDecisions += 1;
    totalCandidateEvaluations += decision.totalCandidates - decision.candidatesRejectedBeforeRouting;
    candidatesRejectedBeforeRouting += decision.candidatesRejectedBeforeRouting;
    candidatesRejectedBeforeScoring += decision.candidatesRejectedBeforeScoring;
    candidatesScored += decision.candidatesScored;
  }

  async function evaluate(input: Parameters<typeof dispatch>[0]) {
    const startedAt = performance.now();
    const decision = await dispatch(input, strategy);
    dispatchTimeMs += performance.now() - startedAt;
    recordDecisionCounts(decision);
    return decision;
  }

  async function tryAssign(order: Order, now: number): Promise<boolean> {
    const vendor = vendors.find((item) => item.id === order.vendorId)!;
    const dispatchInput = {
      now,
      order,
      vendor,
      deliveryPeople: fleet,
      routing,
      maxDeliveryMinutes,
      maxPickupEtaMinutes,
      pickupServiceMinutes,
      trafficMultiplier,
      weights: options.weights,
    };
    let decision = await evaluate(dispatchInput);
    const canRelaxDeadline = now - order.createdAt >= 30;
    if (!decision.selectedDeliveryPersonId && decision.queueReason === "SLA_RISK" && canRelaxDeadline) {
      decision = await evaluate({ ...dispatchInput, allowLate: true });
    }
    const selectedId = decision.selectedDeliveryPersonId;
    const selectedIndex = selectedId ? fleet.findIndex((person) => person.id === selectedId) : -1;
    const selected = selectedIndex >= 0 ? fleet[selectedIndex] : undefined;
    if (!selected) {
      const queueReason = decision.queueReason ?? "OTHER";
      latestFailureByOrder.set(order.id, queueReason);
      if (diagnosticsEnabled) {
        const routedCandidates = decision.candidates.filter((candidate) => candidate.distanceToVendorKm !== null && candidate.etaToVendorMinutes !== null);
        const nearestByDistance = [...routedCandidates].sort((first, second) => first.distanceToVendorKm! - second.distanceToVendorKm!)[0];
        const nearestByTravelTime = [...routedCandidates].sort((first, second) => first.travelToVendorMinutes! - second.travelToVendorMinutes!)[0];
        const nearestByEta = [...routedCandidates].sort((first, second) => first.etaToVendorMinutes! - second.etaToVendorMinutes!)[0];
        pickupObservationByOrder.set(order.id, {
          totalCandidates: decision.totalCandidates,
          rejectedCandidates: decision.candidates.filter((candidate) => !candidate.eligible).length,
          routedCandidateCount: routedCandidates.length,
          nearestDistanceKm: nearestByDistance?.distanceToVendorKm ?? null,
          nearestTravelTimeMinutes: nearestByTravelTime?.travelToVendorMinutes ?? null,
          nearestAvailabilityMinutes: nearestByEta?.riderAvailableInMinutes ?? null,
          nearestEtaMinutes: nearestByEta?.etaToVendorMinutes ?? null,
        });
        if (orderSamples.filter((sample) => sample.state === "QUEUED").length < 10) {
          orderSamples.push({
            orderId: order.id,
            state: "QUEUED",
            vendor: vendor.name,
            destination: order.customerLabel,
            orderCreatedAt: order.createdAt,
            vendorReadyAt: order.actualReadyAt,
            riderEtaMinutes: nearestByEta?.etaToVendorMinutes ?? null,
            pickupArrivalAt: nearestByEta?.arrivalAt ?? null,
            pickupWaitMinutes: nearestByEta?.pickupWaitMinutes ?? null,
            pickupDelayMinutes: nearestByEta?.pickupDelayMinutes ?? null,
            distanceToVendorKm: nearestByDistance?.distanceToVendorKm ?? null,
            queueReason,
          });
        }
      }
      if (options.debugOrderId === order.id) debugTrace = debugDecisionTrace(order, vendor, decision, null);
      return false;
    }

    const candidate = decision.candidates.find((item) => item.deliveryPersonId === selected.id);
    if (!candidate || candidate.arrivalAt === null || candidate.etaToVendorMinutes === null || candidate.deliveryTravelMinutes === null || candidate.directTravelMinutes === null || candidate.travelToVendorMinutes === null || candidate.pickupServiceMinutes === null || candidate.pickupWaitMinutes === null) {
      throw new Error(`Selected candidate ${selected.id} is missing feasible route estimates`);
    }
    const timeline = calculateOrderTimeline({
      orderCreatedAt: order.createdAt,
      vendorReadyAt: order.actualReadyAt,
      riderAssignedAt: now,
      etaToVendorMinutes: candidate.etaToVendorMinutes,
      pickupServiceMinutes,
      deliveryTravelMinutes: candidate.deliveryTravelMinutes,
    });

    deliveryMinutes.push(timeline.deliveryCompletedAt - timeline.orderCreatedAt);
    pickupWaitMinutes.push(timeline.pickupWaitMinutes);
    pickupDelayMinutes.push(timeline.pickupDelayMinutes);
    if (timeline.pickupDelayMinutes > 0) latePickupCount += 1;
    if (timeline.deliveryCompletedAt > order.createdAt + maxDeliveryMinutes) slaMissedAssignments += 1;
    currentWorkloadMinutes.push(candidate.currentWorkloadMinutes);
    incrementalDistanceKm.push(candidate.incrementalDistanceKm ?? 0);
    incrementalTimeMinutes.push(candidate.incrementalTimeMinutes ?? 0);
    riderAvailabilityComponents.push(candidate.riderAvailableInMinutes);
    travelToVendorComponents.push(candidate.travelToVendorMinutes);
    predictedPickupWaitComponents.push(candidate.pickupWaitMinutes);
    dropoffTravelComponents.push(candidate.deliveryTravelMinutes);
    directTravelComponents.push(candidate.directTravelMinutes);
    pickupServiceComponents.push(candidate.pickupServiceMinutes);
    assignedPickupEtas.push({
      riderAvailabilityMinutes: candidate.riderAvailableInMinutes,
      pureTravelMinutes: candidate.travelToVendorMinutes,
      combinedEtaMinutes: candidate.etaToVendorMinutes,
    });
    if (selected.activeDeliveries.length === 0) {
      riderIdleMinutes.push(Math.max(0, now - lastBusyUntilByPerson[selectedIndex]));
    }
    assignedOrdersByPerson[selectedIndex] += 1;
    lastBusyUntilByPerson[selectedIndex] = Math.max(lastBusyUntilByPerson[selectedIndex], timeline.deliveryCompletedAt);
    selected.activeDeliveries.push({
      orderId: order.id,
      expectedCompletionAt: timeline.deliveryCompletedAt,
      expectedLocation: order.customerLocation,
      latestDropoffAt: order.createdAt + maxDeliveryMinutes,
    });
    latestFailureByOrder.delete(order.id);
    pickupObservationByOrder.delete(order.id);
    if (diagnosticsEnabled && orderSamples.filter((sample) => sample.state === "ASSIGNED").length < 10) {
      orderSamples.push({
        orderId: order.id,
        state: "ASSIGNED",
        vendor: vendor.name,
        destination: order.customerLabel,
        orderCreatedAt: order.createdAt,
        vendorReadyAt: order.actualReadyAt,
        riderEtaMinutes: candidate.etaToVendorMinutes,
        pickupArrivalAt: timeline.riderArrivalAtVendor,
        pickupWaitMinutes: timeline.pickupWaitMinutes,
        pickupDelayMinutes: timeline.pickupDelayMinutes,
        distanceToVendorKm: candidate.distanceToVendorKm,
        queueReason: null,
      });
    }
    if (options.debugOrderId === order.id) debugTrace = debugDecisionTrace(order, vendor, decision, selected.id);
    return true;
  }

  for (let index = 0; index < orderCount; index += 1) {
    const now = arrivalTime(index, orderCount, arrivalPattern, horizonMinutes);
    const elapsedHours = Math.max(0, now - previousNow) / 60;
    previousNow = now;
    const failureChance = 1 - Math.exp(-riderFailureRate * elapsedHours);
    const recoveryChance = 1 - Math.exp(-riderRecoveryRate * elapsedHours);
    for (const [personIndex, person] of fleet.entries()) {
      person.activeDeliveries = person.activeDeliveries.filter((commitment) => commitment.expectedCompletionAt > now);
      const stateRandom = createSeededRandom(deriveStreamSeed(seed, 3, index, personIndex));
      if (person.status === "OFFLINE" && stateRandom() < recoveryChance) person.status = "ONLINE";
      if (person.status === "ONLINE" && stateRandom() < failureChance) {
        person.status = "OFFLINE";
        riderFailureEvents += 1;
      }
    }

    const activeAssignments = fleet.reduce((total, person) => total + person.activeDeliveries.length, 0);
    const activeTrekkers = fleet.filter((person) => person.type === "TREKKER").reduce((total, person) => total + person.activeDeliveries.length, 0);
    const activeRiders = activeAssignments - activeTrekkers;
    peakActiveAssignments = Math.max(peakActiveAssignments, activeAssignments);
    peakActiveTrekkers = Math.max(peakActiveTrekkers, activeTrekkers);
    peakActiveRiders = Math.max(peakActiveRiders, activeRiders);
    utilizationSamples.push(totalCapacity ? activeAssignments / totalCapacity : 0);

    if (now - lastRetryAt >= 5) {
      for (let pendingIndex = pendingOrders.length - 1; pendingIndex >= 0; pendingIndex -= 1) {
        if (await tryAssign(pendingOrders[pendingIndex], now)) pendingOrders.splice(pendingIndex, 1);
      }
      lastRetryAt = now;
    }

    const orderRandom = createSeededRandom(deriveStreamSeed(seed, 2, index));
    const order = createOrder(orderRandom, index, vendors, now, preparationErrorMinutes, demandConcentration);
    if (!(await tryAssign(order, now))) pendingOrders.push(order);
  }

  for (const pendingOrder of pendingOrders) {
    const reason = latestFailureByOrder.get(pendingOrder.id) ?? "OTHER";
    queuedReasons.push(reason === "PICKUP_TOO_FAR" ? "PICKUP_ETA_EXCEEDED" : reason as CurrentQueueFailureReason);
    const observation = pickupObservationByOrder.get(pendingOrder.id);
    queuedPickupEtas.push({
      riderAvailabilityMinutes: observation?.nearestAvailabilityMinutes ?? null,
      pureTravelMinutes: observation?.nearestTravelTimeMinutes ?? null,
      combinedEtaMinutes: observation?.nearestEtaMinutes ?? null,
    });
  }
  const queuedPickupObservations = pendingOrders.flatMap((order) => {
    const observation = pickupObservationByOrder.get(order.id);
    return observation ? [observation] : [];
  });
  const pickupFeasibility = createPickupDiagnostics(
    queuedPickupObservations,
    pendingOrders.length,
    queuedReasons.filter((reason) => reason === "PICKUP_ETA_EXCEEDED").length,
  );
  const diagnostics = diagnosticsEnabled ? {
    campusRoutes: await sampleCampusRoutes(seed),
    pickupFeasibility: {
      ...pickupFeasibility,
      assignedEtaBuckets: bucketCounts(assignedPickupEtas.flatMap((observation) => observation.combinedEtaMinutes === null ? [] : [observation.combinedEtaMinutes]), [
        { label: "<5 min", maximum: 5 }, { label: "5-10 min", maximum: 10 }, { label: "10-15 min", maximum: 15 }, { label: "15-20 min", maximum: 20 }, { label: "20-25 min", maximum: 25 }, { label: "25-30 min", maximum: 30 },
      ], ">30 min"),
      queuedEtaBuckets: bucketCounts(queuedPickupEtas.flatMap((observation) => observation.combinedEtaMinutes === null ? [] : [observation.combinedEtaMinutes]), [
        { label: "<5 min", maximum: 5 }, { label: "5-10 min", maximum: 10 }, { label: "10-15 min", maximum: 15 }, { label: "15-20 min", maximum: 20 }, { label: "20-25 min", maximum: 25 }, { label: "25-30 min", maximum: 30 },
      ], ">30 min"),
    },
    orderSamples,
  } : null;

  return createMetrics({
    strategy,
    arrivalPattern,
    deliveryMinutes,
    pickupWaitMinutes,
    pickupDelayMinutes,
    latePickupCount,
    slaMissedAssignments,
    queuedReasons,
    pickupFeasibility,
    assignedPickupEtas,
    queuedPickupEtas,
    riderFailureEvents,
    peakActiveAssignments,
    peakActiveTrekkers,
    peakActiveRiders,
    utilizationSamples,
    assignedOrdersByPerson,
    riderIdleMinutes,
    currentWorkloadMinutes,
    incrementalDistanceKm,
    incrementalTimeMinutes,
    riderAvailabilityComponents,
    travelToVendorComponents,
    predictedPickupWaitComponents,
    dropoffTravelComponents,
    directTravelComponents,
    pickupServiceComponents,
    dispatchDecisions,
    totalCandidateEvaluations,
    candidatesRejectedBeforeRouting,
    candidatesRejectedBeforeScoring,
    candidatesScored,
    dispatchTimeMs,
    fleet,
    horizonMinutes,
    debugTrace,
    diagnostics,
  });
}

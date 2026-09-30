import type { DeliveryPerson, RouteCommitment } from "../domain/types";
import type { TravelEstimate } from "../routing/routing-engine";
import { DEFAULT_DISPATCH_WEIGHTS } from "./types";
import type {
  CandidateEvaluation,
  DispatchDecision,
  DispatchInput,
  DispatchStrategyName,
  QueueFailureReason,
  ScoreComponent,
} from "./types";

const DEFAULT_MAX_PICKUP_ETA_MINUTES = 30;
const DEFAULT_MAX_DELIVERY_MINUTES = 90;
const DEFAULT_MAX_EXISTING_WORKLOAD_MINUTES = 120;
const DEFAULT_PICKUP_SERVICE_MINUTES = 2;

function isPickupFeasible(riderAvailableInMinutes: number, travelToVendorMinutes: number, maxPickupEtaMinutes: number): boolean {
  return riderAvailableInMinutes + travelToVendorMinutes <= maxPickupEtaMinutes;
}

function latestCommitment(person: DeliveryPerson): RouteCommitment | undefined {
  return person.activeDeliveries.reduce<RouteCommitment | undefined>(
    (latest, commitment) => !latest || commitment.expectedCompletionAt > latest.expectedCompletionAt ? commitment : latest,
    undefined,
  );
}

function isValidEstimate(estimate: TravelEstimate): boolean {
  return Number.isFinite(estimate.distanceKm)
    && estimate.distanceKm >= 0
    && Number.isFinite(estimate.durationMinutes)
    && estimate.durationMinutes >= 0;
}

function rejectedCandidate(
  person: DeliveryPerson,
  input: DispatchInput,
  reason: QueueFailureReason,
  currentWorkloadMinutes: number,
): CandidateEvaluation {
  return {
    deliveryPersonId: person.id,
    eligible: false,
    scored: false,
    slaMissed: null,
    reason,
    currentOrders: person.activeDeliveries.length,
    remainingCapacity: Math.max(0, person.maxActiveDeliveries - person.activeDeliveries.length),
    currentWorkloadMinutes,
    riderAvailableInMinutes: currentWorkloadMinutes,
    travelToVendorMinutes: null,
    etaToVendorMinutes: null,
    arrivalAt: null,
    deliveryEtaAt: null,
    deliveryTravelMinutes: null,
    directTravelMinutes: null,
    pickupServiceMinutes: null,
    pickupWaitMinutes: null,
    pickupDelayMinutes: null,
    distanceToVendorKm: null,
    incrementalDistanceKm: null,
    incrementalTimeMinutes: null,
    score: null,
    components: [],
  };
}

function scoreCandidate(
  input: DispatchInput,
  person: DeliveryPerson,
  strategy: DispatchStrategyName,
  estimates: {
    arrivalAt: number;
    etaToVendorMinutes: number;
    deliveryEtaAt: number;
    deliveryTravelMinutes: number;
    pickupWaitMinutes: number;
    pickupDelayMinutes: number;
    distanceToVendorKm: number;
    incrementalDistanceKm: number;
    incrementalTimeMinutes: number;
    currentWorkloadMinutes: number;
    slaLatenessMinutes: number;
  },
): ScoreComponent[] {
  if (strategy === "nearest" || strategy === "nearest-available") {
    return [{ name: "distance-to-vendor", value: estimates.distanceToVendorKm, weight: 1, contribution: estimates.distanceToVendorKm }];
  }
  if (strategy === "earliest-arrival") {
    return [{ name: "arrival-to-vendor", value: estimates.etaToVendorMinutes, weight: 1, contribution: estimates.etaToVendorMinutes }];
  }
  if (strategy === "ready-time-aware") {
    const readinessDifference = Math.abs(estimates.arrivalAt - input.order.predictedReadyAt);
    return [{ name: "readiness-synchronization", value: readinessDifference, weight: 1, contribution: readinessDifference }];
  }

  const weights = { ...DEFAULT_DISPATCH_WEIGHTS, ...input.weights };
  return [
    { name: "arrival-to-vendor", value: estimates.etaToVendorMinutes, weight: weights.arrivalToVendor, contribution: estimates.etaToVendorMinutes * weights.arrivalToVendor },
    { name: "pickup-delay", value: estimates.pickupDelayMinutes, weight: weights.pickupDelay, contribution: estimates.pickupDelayMinutes * weights.pickupDelay },
    { name: "incremental-time", value: estimates.incrementalTimeMinutes, weight: weights.incrementalTime, contribution: estimates.incrementalTimeMinutes * weights.incrementalTime },
    { name: "route-detour", value: estimates.incrementalDistanceKm, weight: weights.routeDetour, contribution: estimates.incrementalDistanceKm * weights.routeDetour },
    { name: "workload", value: estimates.currentWorkloadMinutes, weight: weights.workload, contribution: estimates.currentWorkloadMinutes * weights.workload },
    { name: "sla-risk", value: estimates.slaLatenessMinutes, weight: weights.slaRisk, contribution: estimates.slaLatenessMinutes * weights.slaRisk },
  ];
}

async function evaluateCandidate(input: DispatchInput, person: DeliveryPerson, strategy: DispatchStrategyName): Promise<CandidateEvaluation> {
  const commitment = latestCommitment(person);
  const currentWorkloadMinutes = Math.max(0, (commitment?.expectedCompletionAt ?? input.now) - input.now);
  const remainingCapacity = Math.max(0, person.maxActiveDeliveries - person.activeDeliveries.length);

  if (person.status !== "ONLINE") {
    return rejectedCandidate(person, input, person.type === "TREKKER" ? "NO_AVAILABLE_TREKKER" : "NO_FEASIBLE_RIDER", currentWorkloadMinutes);
  }
  if (remainingCapacity === 0) return rejectedCandidate(person, input, "CAPACITY_FULL", currentWorkloadMinutes);
  if (currentWorkloadMinutes > (input.maxExistingWorkloadMinutes ?? DEFAULT_MAX_EXISTING_WORKLOAD_MINUTES)) {
    return rejectedCandidate(person, input, "NO_FEASIBLE_RIDER", currentWorkloadMinutes);
  }

  const startingLocation = commitment?.expectedLocation ?? person.location;
  const availableAt = Math.max(input.now, commitment?.expectedCompletionAt ?? input.now);
  const routingContext = { averageSpeedKph: person.averageSpeedKph, trafficMultiplier: input.trafficMultiplier };
  let toVendor: TravelEstimate;
  let vendorToCustomer: TravelEstimate;
  let directToCustomer: TravelEstimate;
  const mode = person.type === "TREKKER" ? "walking" : "driving";
  try {
    toVendor = await input.routing.estimateTravelTime(startingLocation, input.vendor.location, mode, routingContext);
    vendorToCustomer = await input.routing.estimateTravelTime(input.vendor.location, input.order.customerLocation, mode, routingContext);
    directToCustomer = await input.routing.estimateTravelTime(startingLocation, input.order.customerLocation, mode, routingContext);
  } catch {
    return rejectedCandidate(person, input, "NO_FEASIBLE_ROUTE", currentWorkloadMinutes);
  }
  if (![toVendor, vendorToCustomer, directToCustomer].every(isValidEstimate)) {
    return rejectedCandidate(person, input, "NO_FEASIBLE_ROUTE", currentWorkloadMinutes);
  }

  const etaToVendorMinutes = availableAt - input.now + toVendor.durationMinutes;
  const arrivalAt = input.now + etaToVendorMinutes;
  const pickupWaitMinutes = Math.max(0, input.order.predictedReadyAt - arrivalAt);
  const pickupDelayMinutes = Math.max(0, arrivalAt - input.order.predictedReadyAt);
  const deliveryEtaAt = Math.max(arrivalAt, input.order.predictedReadyAt)
    + (input.pickupServiceMinutes ?? DEFAULT_PICKUP_SERVICE_MINUTES)
    + vendorToCustomer.durationMinutes;
  const deadlineAt = input.order.createdAt + (input.maxDeliveryMinutes ?? DEFAULT_MAX_DELIVERY_MINUTES);
  const slaLatenessMinutes = Math.max(0, deliveryEtaAt - deadlineAt);
  const slaMissed = slaLatenessMinutes > 0;
  const maxPickupEta = input.maxPickupEtaMinutes ?? DEFAULT_MAX_PICKUP_ETA_MINUTES;

  if (!isPickupFeasible(currentWorkloadMinutes, toVendor.durationMinutes, maxPickupEta)) {
    return {
      ...rejectedCandidate(person, input, "PICKUP_ETA_EXCEEDED", currentWorkloadMinutes),
      riderAvailableInMinutes: availableAt - input.now,
      travelToVendorMinutes: toVendor.durationMinutes,
      etaToVendorMinutes,
      arrivalAt,
      deliveryEtaAt,
      deliveryTravelMinutes: vendorToCustomer.durationMinutes,
      directTravelMinutes: directToCustomer.durationMinutes,
      pickupServiceMinutes: input.pickupServiceMinutes ?? DEFAULT_PICKUP_SERVICE_MINUTES,
      pickupWaitMinutes,
      pickupDelayMinutes,
      distanceToVendorKm: toVendor.distanceKm,
    };
  }
  if (slaMissed && input.allowLate !== true) {
    return {
      ...rejectedCandidate(person, input, "SLA_RISK", currentWorkloadMinutes),
      slaMissed: true,
      riderAvailableInMinutes: availableAt - input.now,
      travelToVendorMinutes: toVendor.durationMinutes,
      etaToVendorMinutes,
      arrivalAt,
      deliveryEtaAt,
      deliveryTravelMinutes: vendorToCustomer.durationMinutes,
      directTravelMinutes: directToCustomer.durationMinutes,
      pickupServiceMinutes: input.pickupServiceMinutes ?? DEFAULT_PICKUP_SERVICE_MINUTES,
      pickupWaitMinutes,
      pickupDelayMinutes,
      distanceToVendorKm: toVendor.distanceKm,
    };
  }

  const incrementalDistanceKm = Math.max(0, toVendor.distanceKm + vendorToCustomer.distanceKm - directToCustomer.distanceKm);
  const incrementalTimeMinutes = Math.max(0, etaToVendorMinutes + pickupWaitMinutes + vendorToCustomer.durationMinutes - directToCustomer.durationMinutes);
  const estimates = {
    arrivalAt,
    etaToVendorMinutes,
    deliveryEtaAt,
    deliveryTravelMinutes: vendorToCustomer.durationMinutes,
    pickupWaitMinutes,
    pickupDelayMinutes,
    distanceToVendorKm: toVendor.distanceKm,
    incrementalDistanceKm,
    incrementalTimeMinutes,
    currentWorkloadMinutes,
    slaLatenessMinutes,
  };
  const components = scoreCandidate(input, person, strategy, estimates);

  return {
    deliveryPersonId: person.id,
    eligible: true,
    scored: true,
    slaMissed,
    currentOrders: person.activeDeliveries.length,
    remainingCapacity,
    currentWorkloadMinutes,
    riderAvailableInMinutes: availableAt - input.now,
    travelToVendorMinutes: toVendor.durationMinutes,
    etaToVendorMinutes,
    arrivalAt,
    deliveryEtaAt,
    deliveryTravelMinutes: vendorToCustomer.durationMinutes,
    directTravelMinutes: directToCustomer.durationMinutes,
    pickupServiceMinutes: input.pickupServiceMinutes ?? DEFAULT_PICKUP_SERVICE_MINUTES,
    pickupWaitMinutes,
    pickupDelayMinutes,
    distanceToVendorKm: toVendor.distanceKm,
    incrementalDistanceKm,
    incrementalTimeMinutes,
    score: components.reduce((total, component) => total + component.contribution, 0),
    components,
  };
}

function classifyQueueFailure(candidates: CandidateEvaluation[]): QueueFailureReason {
  if (candidates.length === 0) return "NO_FEASIBLE_RIDER";
  const reasons = new Set(candidates.map((candidate) => candidate.reason));
  if (reasons.has("SLA_RISK")) return "SLA_RISK";
  if (reasons.has("PICKUP_ETA_EXCEEDED") || reasons.has("PICKUP_TOO_FAR")) return "PICKUP_ETA_EXCEEDED";
  if (reasons.has("NO_FEASIBLE_ROUTE")) return "NO_FEASIBLE_ROUTE";
  if (reasons.has("CAPACITY_FULL")) return "CAPACITY_FULL";
  if (reasons.has("NO_AVAILABLE_TREKKER")) return "NO_AVAILABLE_TREKKER";
  if (reasons.has("NO_FEASIBLE_RIDER")) return "NO_FEASIBLE_RIDER";
  return "OTHER";
}

export async function dispatch(input: DispatchInput, strategy: DispatchStrategyName = "full"): Promise<DispatchDecision> {
  const candidates = await Promise.all(input.deliveryPeople.map((person) => evaluateCandidate(input, person, strategy)));
  candidates.sort((first, second) => {
    if (first.eligible !== second.eligible) return first.eligible ? -1 : 1;
    return (first.score ?? Number.POSITIVE_INFINITY) - (second.score ?? Number.POSITIVE_INFINITY);
  });
  const selectedDeliveryPersonId = candidates.find((candidate) => candidate.eligible)?.deliveryPersonId ?? null;
  const candidatesRejectedBeforeRouting = candidates.filter((candidate) => candidate.reason === "NO_AVAILABLE_TREKKER" || candidate.reason === "NO_FEASIBLE_RIDER" || candidate.reason === "CAPACITY_FULL").length;
  const candidatesRejectedBeforeScoring = candidates.filter((candidate) => !candidate.scored).length;
  const candidatesScored = candidates.filter((candidate) => candidate.scored).length;

  return {
    strategy,
    selectedDeliveryPersonId,
    candidates,
    totalCandidates: input.deliveryPeople.length,
    candidatesRejectedBeforeRouting,
    candidatesRejectedBeforeScoring,
    candidatesScored,
    queueReason: selectedDeliveryPersonId ? null : classifyQueueFailure(candidates),
  };
}

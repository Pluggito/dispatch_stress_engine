import type { DeliveryPerson, Order, Vendor } from "../domain/types";
import type { RoutingEngine } from "../routing/routing-engine";

export type DispatchStrategyName = "nearest" | "nearest-available" | "earliest-arrival" | "ready-time-aware" | "full" | "shortlist-3" | "shortlist-5" | "shortlist-8" | "shortlist-eta-3" | "shortlist-eta-5" | "shortlist-eta-8";

export type QueueFailureReason =
  | "NO_AVAILABLE_TREKKER"
  | "CAPACITY_FULL"
  | "SLA_RISK"
  | "PICKUP_ETA_EXCEEDED"
  | "PICKUP_TOO_FAR"
  | "NO_FEASIBLE_RIDER"
  | "NO_FEASIBLE_ROUTE"
  | "OTHER";

export type DispatchWeights = {
  arrivalToVendor: number;
  pickupDelay: number;
  incrementalTime: number;
  routeDetour: number;
  workload: number;
  slaRisk: number;
};

export const DEFAULT_DISPATCH_WEIGHTS: DispatchWeights = {
  arrivalToVendor: 0.25,
  pickupDelay: 2,
  incrementalTime: 1,
  routeDetour: 2,
  workload: 0.25,
  slaRisk: 100,
};

export type DispatchInput = {
  now: number;
  order: Order;
  vendor: Vendor;
  deliveryPeople: DeliveryPerson[];
  routing: RoutingEngine;
  maxDeliveryMinutes?: number;
  maxPickupEtaMinutes?: number;
  maxExistingWorkloadMinutes?: number;
  pickupServiceMinutes?: number;
  trafficMultiplier?: number;
  allowLate?: boolean;
  weights?: Partial<DispatchWeights>;
};

export type ScoreComponent = {
  name: string;
  value: number;
  weight: number;
  contribution: number;
};

export type CandidateEvaluation = {
  deliveryPersonId: string;
  eligible: boolean;
  scored: boolean;
  slaMissed: boolean | null;
  reason?: QueueFailureReason;
  currentOrders: number;
  remainingCapacity: number;
  currentWorkloadMinutes: number;
  riderAvailableInMinutes: number;
  travelToVendorMinutes: number | null;
  etaToVendorMinutes: number | null;
  arrivalAt: number | null;
  deliveryEtaAt: number | null;
  deliveryTravelMinutes: number | null;
  directTravelMinutes: number | null;
  pickupServiceMinutes: number | null;
  pickupWaitMinutes: number | null;
  pickupDelayMinutes: number | null;
  distanceToVendorKm: number | null;
  incrementalDistanceKm: number | null;
  incrementalTimeMinutes: number | null;
  score: number | null;
  components: ScoreComponent[];
};

export type DispatchDecision = {
  strategy: DispatchStrategyName;
  selectedDeliveryPersonId: string | null;
  candidates: CandidateEvaluation[];
  totalCandidates: number;
  candidatesRejectedBeforeRouting: number;
  candidatesRejectedBeforeScoring: number;
  candidatesScored: number;
  queueReason: QueueFailureReason | null;
};

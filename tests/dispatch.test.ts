import { describe, expect, it } from "vitest";
import type { DeliveryPerson, Order, Vendor } from "../src/domain/types";
import { dispatch } from "../src/dispatch/engine";
import { HaversineRoutingEngine } from "../src/routing/deterministic-routing";
import { createFleet } from "../src/simulation/simulate";
import { CAMPUS_VENDORS } from "../src/simulation/campus";
import { vendors as vendorCoordinates } from "../src/constants/vendors";

const vendor: Vendor = { id: "vendor-1", name: "Test Vendor", zone: "Campus", location: { latitude: 6.5158, longitude: 3.3896 }, preparationMinutes: 15, preparationVarianceMinutes: 0 };
const order: Order = { id: "order-1", vendorId: vendor.id, customerLabel: "Test Hostel", vendorLocation: vendor.location, customerLocation: { latitude: 6.525, longitude: 3.4 }, createdAt: 0, priority: "STANDARD", predictedReadyAt: 15, actualReadyAt: 15 };
const people: DeliveryPerson[] = [
  { id: "closest", type: "TREKKER", status: "ONLINE", location: { latitude: 6.514, longitude: 3.3896 }, maxActiveDeliveries: 2, activeDeliveries: [], averageSpeedKph: 5 },
  { id: "aligned", type: "RIDER", status: "ONLINE", location: { latitude: 6.5, longitude: 3.38 }, maxActiveDeliveries: 4, activeDeliveries: [{ orderId: "existing", expectedCompletionAt: 9, expectedLocation: { latitude: 6.512, longitude: 3.386 }, latestDropoffAt: 30 }], averageSpeedKph: 24 },
  { id: "full", type: "TREKKER", status: "ONLINE", location: vendor.location, maxActiveDeliveries: 2, activeDeliveries: [{ orderId: "one", expectedCompletionAt: 2, expectedLocation: vendor.location, latestDropoffAt: 20 }, { orderId: "two", expectedCompletionAt: 3, expectedLocation: vendor.location, latestDropoffAt: 20 }], averageSpeedKph: 5 },
];

describe("dispatch engine", () => {
  it("uses canonical campus vendor coordinates without generated offsets", () => {
    const firstVendor = CAMPUS_VENDORS.find((place) => place.name === "2001 cafe");

    expect(firstVendor?.location).toEqual({
      latitude: vendorCoordinates.Zones.Newhall["2001 cafe"].lat,
      longitude: vendorCoordinates.Zones.Newhall["2001 cafe"].lng,
    });
  });

  it("includes food-ready waiting in delivery ETA and deadline eligibility", async () => {
    const nearbyRider: DeliveryPerson = {
      id: "nearby-rider",
      type: "RIDER",
      status: "ONLINE",
      location: vendor.location,
      maxActiveDeliveries: 4,
      activeDeliveries: [],
      averageSpeedKph: 24,
    };
    const input = { now: 0, order, vendor, deliveryPeople: [nearbyRider], routing: new HaversineRoutingEngine(), maxDeliveryMinutes: 17 };
    const candidate = (await dispatch(input)).candidates[0];

    expect(candidate.pickupWaitMinutes).toBeGreaterThan(0);
    expect(candidate.deliveryEtaAt).toBeCloseTo(Math.max(candidate.arrivalAt!, order.predictedReadyAt) + 2 + candidate.deliveryTravelMinutes!);
    expect(candidate).toMatchObject({ eligible: false, reason: "SLA_RISK" });
  });

  it("keeps Trekker capacity at 2 while configuring motorcycle capacity separately", () => {
    const fleet = createFleet(42, 80, 25, 3);
    const trekkers = fleet.filter((person) => person.type === "TREKKER");
    const riders = fleet.filter((person) => person.type === "RIDER");

    expect(trekkers).toHaveLength(80);
    expect(riders).toHaveLength(25);
    expect(new Set(trekkers.map((person) => person.maxActiveDeliveries))).toEqual(new Set([2]));
    expect(new Set(riders.map((person) => person.maxActiveDeliveries))).toEqual(new Set([3]));
    expect(Math.min(...riders.map((person) => person.averageSpeedKph))).toBeGreaterThan(Math.max(...trekkers.map((person) => person.averageSpeedKph)));
  });

  it("can choose a future-aligned rider over the nearest rider", async () => {
    const decision = await dispatch({ now: 0, order, vendor, deliveryPeople: people, routing: new HaversineRoutingEngine() }, "ready-time-aware");
    expect(decision.selectedDeliveryPersonId).toBe("aligned");
  });

  it("filters people at capacity", async () => {
    const decision = await dispatch({ now: 0, order, vendor, deliveryPeople: people, routing: new HaversineRoutingEngine() });
    expect(decision.candidates.find((candidate) => candidate.deliveryPersonId === "full")).toMatchObject({ eligible: false, reason: "CAPACITY_FULL" });
    expect(decision.queueReason).toBeNull();
  });

  it("classifies a fully saturated candidate pool as capacity full", async () => {
    const fullFleet = people.map((person) => ({
      ...person,
      activeDeliveries: Array.from({ length: person.maxActiveDeliveries }, (_, index) => ({
        orderId: `${person.id}-${index}`,
        expectedCompletionAt: 30,
        expectedLocation: person.location,
        latestDropoffAt: 90,
      })),
    }));
    const decision = await dispatch({ now: 0, order, vendor, deliveryPeople: fullFleet, routing: new HaversineRoutingEngine() });
    expect(decision.selectedDeliveryPersonId).toBeNull();
    expect(decision.queueReason).toBe("CAPACITY_FULL");
  });

  it("reports rider ETA, workload, capacity, and incremental route cost", async () => {
    const decision = await dispatch({ now: 0, order, vendor, deliveryPeople: people, routing: new HaversineRoutingEngine() }, "full");
    const candidate = decision.candidates.find((item) => item.deliveryPersonId === "aligned")!;

    expect(candidate).toMatchObject({ scored: true, currentOrders: 1, remainingCapacity: 3 });
    expect(candidate.etaToVendorMinutes).toBeGreaterThan(0);
    expect(candidate.currentWorkloadMinutes).toBe(9);
    expect(candidate.incrementalDistanceKm).toBeGreaterThanOrEqual(0);
    expect(candidate.incrementalTimeMinutes).toBeGreaterThanOrEqual(0);
  });

  it("measures pickup delay when rider arrival is after food readiness", async () => {
    const lateOrder = { ...order, predictedReadyAt: 5 };
    const nearbyRider: DeliveryPerson = {
      id: "nearby-rider",
      type: "RIDER",
      status: "ONLINE",
      location: vendor.location,
      maxActiveDeliveries: 4,
      activeDeliveries: [],
      averageSpeedKph: 24,
    };
    const candidate = (await dispatch({ now: 10, order: lateOrder, vendor, deliveryPeople: [nearbyRider], routing: new HaversineRoutingEngine() })).candidates[0];
    expect(candidate.pickupDelayMinutes).toBeGreaterThan(0);
    expect(candidate.pickupWaitMinutes).toBe(0);
  });

  it("classifies a nearby rider as pickup-infeasible when workload pushes ETA past the gate", async () => {
    const busyNearbyRider: DeliveryPerson = {
      id: "busy-nearby",
      type: "RIDER",
      status: "ONLINE",
      location: vendor.location,
      maxActiveDeliveries: 3,
      activeDeliveries: [{
        orderId: "existing-order",
        expectedCompletionAt: 30.1,
        expectedLocation: vendor.location,
        latestDropoffAt: 60,
      }],
      averageSpeedKph: 24,
    };
    const decision = await dispatch({
      now: 0,
      order,
      vendor,
      deliveryPeople: [busyNearbyRider],
      routing: new HaversineRoutingEngine(),
      maxPickupEtaMinutes: 30,
    });
    const candidate = decision.candidates[0];

    expect(candidate.distanceToVendorKm).toBe(0);
    expect(candidate.currentWorkloadMinutes).toBeCloseTo(30.1);
    expect(candidate.reason).toBe("PICKUP_ETA_EXCEEDED");
    expect(decision.queueReason).toBe("PICKUP_ETA_EXCEEDED");
  });

  it("ranks all baseline strategies deterministically", async () => {
    const input = { now: 0, order, vendor, deliveryPeople: people, routing: new HaversineRoutingEngine() };
    expect((await dispatch(input, "nearest")).selectedDeliveryPersonId).toBe("closest");
    const fullDecision = await dispatch(input, "full");
    const topScoredCandidate = fullDecision.candidates.filter((candidate) => candidate.eligible).sort((first, second) => first.score! - second.score!)[0];
    expect(fullDecision.selectedDeliveryPersonId).toBe(topScoredCandidate.deliveryPersonId);
  });

  it("can fall back to a late assignment instead of orphaning the order", async () => {
    const input = { now: 0, order, vendor, deliveryPeople: people, routing: new HaversineRoutingEngine(), maxDeliveryMinutes: 1 };
    const strictDecision = await dispatch(input, "full");
    const fallbackDecision = await dispatch({ ...input, allowLate: true }, "full");

    expect(strictDecision.selectedDeliveryPersonId).toBeNull();
    expect(fallbackDecision.selectedDeliveryPersonId).not.toBeNull();
    expect(fallbackDecision.candidates.find((candidate) => candidate.deliveryPersonId === fallbackDecision.selectedDeliveryPersonId)?.slaMissed).toBe(true);
  });
});

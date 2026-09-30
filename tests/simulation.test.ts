import { describe, expect, it } from "vitest";
import { runSimulation } from "../src/simulation/simulate";
import { calculateOrderTimeline } from "../src/simulation/order-timeline";

describe("simulation lifecycle", () => {
  it("calculates pickup wait and delay independently from assignment", () => {
    const earlyArrival = calculateOrderTimeline({
      orderCreatedAt: 0,
      vendorReadyAt: 10,
      riderAssignedAt: 0,
      etaToVendorMinutes: 4,
      pickupServiceMinutes: 2,
      deliveryTravelMinutes: 8,
    });
    expect(earlyArrival.riderArrivalAtVendor).toBe(4);
    expect(earlyArrival.pickupStartedAt).toBe(10);
    expect(earlyArrival.pickupWaitMinutes).toBe(6);
    expect(earlyArrival.pickupDelayMinutes).toBe(0);
    expect(earlyArrival.deliveryCompletedAt).toBe(20);

    const lateArrival = calculateOrderTimeline({
      orderCreatedAt: 0,
      vendorReadyAt: 10,
      riderAssignedAt: 0,
      etaToVendorMinutes: 13,
      pickupServiceMinutes: 2,
      deliveryTravelMinutes: 8,
    });
    expect(lateArrival.pickupWaitMinutes).toBe(0);
    expect(lateArrival.pickupDelayMinutes).toBe(3);
    expect(lateArrival.pickupStartedAt).toBe(13);
  });

  it("reproduces operational outcomes for the same seed", async () => {
    const options = { orders: 60, seed: 42, strategy: "full" as const, arrivalPattern: "peak" as const };
    const first = await runSimulation(options);
    const second = await runSimulation(options);

    expect({
      assigned: first.assigned,
      queued: first.queued,
      queueReasons: first.queueReasons,
      delivery: first.deliveryMinutes,
      pickupWait: first.pickupWaitMinutes,
      pickupDelay: first.pickupDelayMinutes,
    }).toEqual({
      assigned: second.assigned,
      queued: second.queued,
      queueReasons: second.queueReasons,
      delivery: second.deliveryMinutes,
      pickupWait: second.pickupWaitMinutes,
      pickupDelay: second.pickupDelayMinutes,
    });
  });

  it("keeps generated order attributes aligned across demand rates with the same seed", async () => {
    const lowDemand = await runSimulation({ orders: 20, seed: 42, arrivalPattern: "peak", diagnostics: true });
    const highDemand = await runSimulation({ orders: 40, seed: 42, arrivalPattern: "peak", diagnostics: true });
    const lowFirstOrder = lowDemand.diagnostics?.orderSamples.find((sample) => sample.orderId === "order-1");
    const highFirstOrder = highDemand.diagnostics?.orderSamples.find((sample) => sample.orderId === "order-1");

    expect(lowFirstOrder).toMatchObject({
      vendor: highFirstOrder?.vendor,
      destination: highFirstOrder?.destination,
      orderCreatedAt: highFirstOrder?.orderCreatedAt,
      vendorReadyAt: highFirstOrder?.vendorReadyAt,
    });
  });

  it("captures an opt-in per-order dispatch trace", async () => {
    const metrics = await runSimulation({ orders: 2, seed: 42, debugOrderId: "order-1" });
    expect(metrics.debugTrace).toContain("ORDER order-1");
    expect(metrics.debugTrace).toContain("Selected:");
  });
});

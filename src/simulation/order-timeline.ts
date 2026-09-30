export type OrderTimelineInput = {
  orderCreatedAt: number;
  vendorReadyAt: number;
  riderAssignedAt: number;
  etaToVendorMinutes: number;
  pickupServiceMinutes: number;
  deliveryTravelMinutes: number;
};

export type OrderTimeline = OrderTimelineInput & {
  riderArrivalAtVendor: number;
  pickupStartedAt: number;
  pickupCompletedAt: number;
  pickupWaitMinutes: number;
  pickupDelayMinutes: number;
  deliveryCompletedAt: number;
};

export function calculateOrderTimeline(input: OrderTimelineInput): OrderTimeline {
  const riderArrivalAtVendor = input.riderAssignedAt + input.etaToVendorMinutes;
  const pickupStartedAt = Math.max(riderArrivalAtVendor, input.vendorReadyAt);
  const pickupCompletedAt = pickupStartedAt + input.pickupServiceMinutes;

  return {
    ...input,
    riderArrivalAtVendor,
    pickupStartedAt,
    pickupCompletedAt,
    pickupWaitMinutes: Math.max(0, input.vendorReadyAt - riderArrivalAtVendor),
    pickupDelayMinutes: Math.max(0, riderArrivalAtVendor - input.vendorReadyAt),
    deliveryCompletedAt: pickupCompletedAt + input.deliveryTravelMinutes,
  };
}

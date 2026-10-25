import type { DispatchDecision } from "../dispatch/types";
import type { Order, Vendor } from "../domain/types";

/** Human-readable explanation of one dispatch decision, used by `--debug-order`. */
export function debugDecisionTrace(order: Order, vendor: Vendor, decision: DispatchDecision, selectedId: string | null): string {
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

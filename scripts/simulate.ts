import { runSimulation, type ArrivalPattern, type SimulationOptions } from "../src/simulation/simulate";
import type { DispatchStrategyName } from "../src/dispatch/types";
import { classifyBottleneck, DEFAULT_BOTTLENECK_THRESHOLDS } from "../src/simulation/demand-analysis";

const argumentsMap = new Map(process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf("=");
  return separator < 0
    ? [argument.replace(/^--/, ""), "true"] as const
    : [argument.slice(2, separator), argument.slice(separator + 1)] as const;
}));

function numberArgument(name: string, fallback: number): number {
  const value = Number(argumentsMap.get(name) ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number`);
  return value;
}

const orders = numberArgument("orders", 1000);
const seed = numberArgument("seed", 42);
const horizonMinutes = numberArgument("horizon", 480);
const defaultStrategy = (argumentsMap.get("strategy") ?? "full") as DispatchStrategyName;
const arrivalPattern = (argumentsMap.get("pattern") ?? "uniform") as ArrivalPattern;
const riderCapacity = numberArgument("rider-capacity", 4) === 3 ? 3 : 4;
const trekkerCount = numberArgument("trekkers", 80);
const riderCount = numberArgument("riders", 25);

function createOptions(orderCount: number, strategy: DispatchStrategyName, diagnostics = argumentsMap.has("diagnostics")): SimulationOptions {
  return {
    orders: orderCount,
    seed,
    strategy,
    arrivalPattern,
    trekkerCount,
    riderCount,
    riderCapacity,
    trafficMultiplier: numberArgument("traffic", 1),
    preparationErrorMinutes: numberArgument("prep-error", 0),
    riderFailureRate: numberArgument("failure-rate", 0),
    demandConcentration: numberArgument("concentration", 0),
    horizonMinutes,
    maxPickupEtaMinutes: numberArgument("max-pickup-eta", 30),
    maxDeliveryMinutes: numberArgument("max-delivery", 90),
    pickupServiceMinutes: numberArgument("pickup-service", 2),
    debugOrderId: argumentsMap.get("debug-order"),
    diagnostics,
    weights: {
      arrivalToVendor: numberArgument("weight-arrival", 0.25),
      pickupDelay: numberArgument("weight-pickup-delay", 2),
      incrementalTime: numberArgument("weight-incremental-time", 1),
      routeDetour: numberArgument("weight-detour", 2),
      workload: numberArgument("weight-workload", 0.25),
      slaRisk: numberArgument("weight-sla", 100),
    },
  };
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function printReport(metrics: Awaited<ReturnType<typeof runSimulation>>, simulationSeed: number, maxPickupEtaMinutes: number) {
  console.log(`
========================================
LOGISTICS ENGINE SIMULATION
========================================

Strategy: ${metrics.strategy}
Arrival pattern: ${metrics.arrivalPattern}
Location: University of Lagos campus
Seed: ${simulationSeed}
Orders: ${metrics.orders}
Simulation horizon: ${metrics.horizonMinutes} min
Demand rate: ${metrics.ordersPerHour.toFixed(1)} orders/hour

----------------------------------------
FLEET
----------------------------------------

Trekkers:               ${metrics.trekkers} (capacity 2 each)
Motorcycle riders:      ${metrics.riders} (capacity ${metrics.riderCapacity} each)
Total personnel:        ${metrics.totalPersonnel}
Concurrent capacity:    ${metrics.theoreticalConcurrentCapacity}
Max pickup ETA:         ${maxPickupEtaMinutes} min
Observed assigned throughput: ${metrics.assignedOrdersPerHour.toFixed(1)} orders/hour
Trekkers:               ${metrics.trekkerOrdersPerHour.toFixed(1)} assigned/hour total; ${(metrics.trekkers ? metrics.trekkerOrdersPerHour / metrics.trekkers : 0).toFixed(2)} per Trekker/hour
Motorcycles:            ${metrics.riderOrdersPerHour.toFixed(1)} assigned/hour total; ${(metrics.riders ? metrics.riderOrdersPerHour / metrics.riders : 0).toFixed(2)} per rider/hour

----------------------------------------
ASSIGNMENT
----------------------------------------

Assigned:               ${metrics.assigned}
Queued:                 ${metrics.queued}
Assignment success:     ${percent(metrics.assignmentSuccessRate)}
SLA-missed assignments: ${metrics.slaMissedAssignments} (${percent(metrics.slaMissRate)})

QUEUE BREAKDOWN
----------------`);
  for (const [reason, stats] of Object.entries(metrics.queueReasons)) {
    console.log(`${reason.padEnd(26)} ${String(stats.count).padStart(6)} (${percent(stats.percent)})`);
  }

  console.log(`
----------------------------------------
PICKUP
----------------------------------------

Average pickup wait:    ${metrics.pickupWaitMinutes.average.toFixed(1)} min
P50 / P95 / P99 wait:   ${metrics.pickupWaitMinutes.p50.toFixed(1)} / ${metrics.pickupWaitMinutes.p95.toFixed(1)} / ${metrics.pickupWaitMinutes.p99.toFixed(1)} min
Average pickup delay:   ${metrics.pickupDelayMinutes.average.toFixed(1)} min
P50 / P95 / P99 delay:  ${metrics.pickupDelayMinutes.p50.toFixed(1)} / ${metrics.pickupDelayMinutes.p95.toFixed(1)} / ${metrics.pickupDelayMinutes.p99.toFixed(1)} min
Late pickup count:      ${metrics.latePickupCount}
Late pickup rate:       ${percent(metrics.latePickupRate)}

----------------------------------------
DELIVERY (ASSIGNED ORDERS)
----------------------------------------

Average delivery:       ${metrics.deliveryMinutes.average.toFixed(1)} min
P50 / P95 / P99:        ${metrics.deliveryMinutes.p50.toFixed(1)} / ${metrics.deliveryMinutes.p95.toFixed(1)} / ${metrics.deliveryMinutes.p99.toFixed(1)} min

----------------------------------------
FLEET UTILIZATION
----------------------------------------

Peak active assignments: ${metrics.peakActiveAssignments}
Peak active Trekkers:    ${metrics.peakActiveTrekkers}
Peak active motorcycles:${metrics.peakActiveRiders}
Average utilization:    ${percent(metrics.averageFleetUtilization)}
Peak utilization:       ${percent(metrics.peakFleetUtilization)}
Average orders/person:  ${metrics.averageOrdersPerPerson.toFixed(1)}
Maximum orders/person:  ${metrics.maximumOrdersPerPerson}
Average idle interval:  ${metrics.averageRiderIdleMinutes.toFixed(1)} min
Average workload at assignment: ${metrics.averageCurrentWorkloadMinutes.toFixed(1)} min

----------------------------------------
DISPATCH EFFICIENCY
----------------------------------------

Dispatch attempts:      ${metrics.dispatchDecisions}
Candidate evaluations:  ${metrics.totalCandidateEvaluations}
Evaluations/order:      ${metrics.averageEvaluationsPerOrder.toFixed(2)}
Rejected before route:  ${metrics.candidatesRejectedBeforeRouting}
Rejected before score:  ${metrics.candidatesRejectedBeforeScoring}
Candidates scored:      ${metrics.candidatesScored}
Scored/decision:        ${metrics.averageScoredCandidatesPerDecision.toFixed(2)}
Decision time total:    ${metrics.dispatchTimeMs.toFixed(1)} ms
Mean incremental estimate (assigned candidates): ${metrics.averageIncrementalDistanceKm.toFixed(3)} km / ${metrics.averageIncrementalTimeMinutes.toFixed(1)} min
Incremental time terms (means): availability ${metrics.incrementalTimeBreakdown.riderAvailabilityMinutes.toFixed(1)} + vendor travel ${metrics.incrementalTimeBreakdown.travelToVendorMinutes.toFixed(1)} + pickup wait ${metrics.incrementalTimeBreakdown.predictedPickupWaitMinutes.toFixed(1)} + dropoff travel ${metrics.incrementalTimeBreakdown.dropoffTravelMinutes.toFixed(1)} - direct travel ${metrics.incrementalTimeBreakdown.directTravelMinutes.toFixed(1)} = ${metrics.incrementalTimeBreakdown.incrementalTimeMinutes.toFixed(1)} min
Pickup service (not included in incremental-time formula): ${metrics.incrementalTimeBreakdown.pickupServiceMinutes.toFixed(1)} min mean
Rider failures:         ${metrics.riderFailureEvents}
========================================
`);
  if (metrics.debugTrace) console.log(`\n${metrics.debugTrace}\n`);
  if (metrics.diagnostics) printDiagnostics(metrics, maxPickupEtaMinutes);
}

function printDiagnostics(metrics: Awaited<ReturnType<typeof runSimulation>>, maxPickupEtaMinutes: number) {
  const diagnostics = metrics.diagnostics!;
  console.log(`\nROUTING FORMULAS\n----------------\nDistance: Haversine straight-line distance between supplied UNILAG coordinates.\nTravel time: max(1, distanceKm / speedKmh * 60 * trafficMultiplier + noiseMinutes).\nRoute type: HAVERSINE_STRAIGHT_LINE_SIMULATED_SPEED (not a campus road graph).\nIncremental distance: max(0, rider->vendor + vendor->customer - rider->customer direct).\nIncremental time: max(0, (rider availability wait + rider->vendor travel) + predicted pickup wait + vendor->customer travel - direct rider->customer travel).\nIncremental time includes existing workload and excludes pickup service time.\nPickup feasibility: rider availability wait + travel-to-vendor <= ${maxPickupEtaMinutes} min.\nPICKUP_TOO_FAR is therefore an ETA-gate label; the gate is not distance-only.\n`);

  console.log("CAMPUS ROUTE SANITY / 100 SEEDED SAMPLES");
  for (const mode of ["TREKKER", "RIDER"] as const) {
    const summary = diagnostics.campusRoutes.speedByMode[mode];
    console.log(`${mode.padEnd(9)} effective km/h min ${summary.min.toFixed(2)} / P50 ${summary.p50.toFixed(2)} / P95 ${summary.p95.toFixed(2)} / max ${summary.max.toFixed(2)}`);
  }
  console.log("Note: short routes are floored to 1 minute; effective speed can appear below configured speed on these samples.");
  console.log("\n20 SAMPLE ROUTES");
  for (const route of diagnostics.campusRoutes.displayedSamples) {
    console.log(`${route.originName} -> ${route.destinationName} | ${route.distanceKm.toFixed(3)} km | ${route.travelTimeMinutes.toFixed(1)} min | effective ${route.effectiveSpeedKph.toFixed(2)} km/h | assumed ${route.assumedSpeedKph.toFixed(2)} | ${route.routeType}`);
  }

  const pickup = metrics.pickupFeasibility;
  console.log(`\nPICKUP_ETA_EXCEEDED DISTRIBUTION / ${pickup.queuedAsEtaExceeded} FINAL QUEUED ORDERS`);
  console.log(`Candidates in pool: ${metrics.totalPersonnel}; routeable at this attempt: ${pickup.averageRoutedCandidates.toFixed(1)} avg; rejected candidates: ${pickup.averageRejectedCandidates.toFixed(1)} avg`);
  console.log(`Nearest measured distance km: avg ${pickup.nearestDistanceKm.average.toFixed(3)} / P50 ${pickup.nearestDistanceKm.p50.toFixed(3)} / P95 ${pickup.nearestDistanceKm.p95.toFixed(3)} / P99 ${pickup.nearestDistanceKm.p99.toFixed(3)}`);
  console.log(`Nearest pure travel min: avg ${pickup.nearestTravelTimeMinutes.average.toFixed(1)} / P50 ${pickup.nearestTravelTimeMinutes.p50.toFixed(1)} / P95 ${pickup.nearestTravelTimeMinutes.p95.toFixed(1)} / P99 ${pickup.nearestTravelTimeMinutes.p99.toFixed(1)}`);
  console.log(`Rider availability min: avg ${pickup.nearestAvailabilityMinutes.average.toFixed(1)} / P50 ${pickup.nearestAvailabilityMinutes.p50.toFixed(1)} / P95 ${pickup.nearestAvailabilityMinutes.p95.toFixed(1)} / P99 ${pickup.nearestAvailabilityMinutes.p99.toFixed(1)}`);
  console.log(`Combined pickup ETA min: avg ${pickup.nearestEtaMinutes.average.toFixed(1)} / P50 ${pickup.nearestEtaMinutes.p50.toFixed(1)} / P95 ${pickup.nearestEtaMinutes.p95.toFixed(1)} / P99 ${pickup.nearestEtaMinutes.p99.toFixed(1)}`);
  console.log("Distance buckets:");
  for (const [bucket, value] of Object.entries(pickup.distanceBuckets)) console.log(`  ${bucket.padEnd(12)} ${String(value.count).padStart(6)} (${percent(value.percent)})`);
  console.log("ETA buckets:");
  for (const [bucket, value] of Object.entries(pickup.etaBuckets)) console.log(`  ${bucket.padEnd(12)} ${String(value.count).padStart(6)} (${percent(value.percent)})`);
  console.log("Pure travel-time buckets:");
  for (const [bucket, value] of Object.entries(pickup.travelEtaBuckets)) console.log(`  ${bucket.padEnd(12)} ${String(value.count).padStart(6)} (${percent(value.percent)})`);

  console.log("\nASSIGNED / QUEUED ORDER SAMPLES (T+ minutes)");
  for (const sample of diagnostics.orderSamples) {
    console.log(`${sample.orderId} ${sample.state} | ${sample.vendor} -> ${sample.destination} | created ${sample.orderCreatedAt.toFixed(1)} | ready ${sample.vendorReadyAt.toFixed(1)} | ETA ${sample.riderEtaMinutes?.toFixed(1) ?? "n/a"} | arrival ${sample.pickupArrivalAt?.toFixed(1) ?? "n/a"} | wait ${sample.pickupWaitMinutes?.toFixed(1) ?? "n/a"} | delay ${sample.pickupDelayMinutes?.toFixed(1) ?? "n/a"} | distance ${sample.distanceToVendorKm?.toFixed(3) ?? "n/a"} km | ${sample.queueReason ?? ""}`);
  }
}

async function printComparison(results: Array<import("../src/simulation/metrics").SimulationMetrics>, compareStrategies: DispatchStrategyName[]) {
  console.log("\nSTRATEGY COMPARISON (same seed and generated scenario)\n");
  console.log("METRIC                     " + compareStrategies.map((strategy) => strategy.padStart(20)).join(""));
  console.log("-".repeat(25 + results.length * 20));
  const rows: Array<[string, (metrics: import("../src/simulation/metrics").SimulationMetrics) => string]> = [
    ["Assignment rate", (metrics) => percent(metrics.assignmentSuccessRate)],
    ["Queue rate", (metrics) => percent(metrics.orders ? metrics.queued / metrics.orders * 100 : 0)],
    ["Late pickup", (metrics) => percent(metrics.latePickupRate)],
    ["Avg pickup delay", (metrics) => `${metrics.pickupDelayMinutes.average.toFixed(1)} min`],
    ["Avg delivery", (metrics) => `${metrics.deliveryMinutes.average.toFixed(1)} min`],
    ["P95 delivery", (metrics) => `${metrics.deliveryMinutes.p95.toFixed(1)} min`],
    ["Utilization", (metrics) => percent(metrics.averageFleetUtilization)],
    ["Queue / evaluations", (metrics) => `${metrics.queued} / ${metrics.totalCandidateEvaluations}`],
  ];
  for (const [label, value] of rows) console.log(label.padEnd(27) + results.map((result) => value(result).padStart(20)).join(""));
}

async function printDemandSweep(demandRates: number[], routingEngine?: import("../src/routing/routing-engine").RoutingEngine) {
  const results: { demandRate: number; metrics: import("../src/simulation/metrics").SimulationMetrics }[] = [];
  for (const demandRate of demandRates) {
    const orderCount = Math.round(demandRate * horizonMinutes / 60);
    const options = createOptions(orderCount, defaultStrategy, true);
    results.push({ demandRate, metrics: await runSimulation(options, routingEngine) });
  }
  const thresholds = {
    underutilizedPercent: numberArgument("classify-underutilized", DEFAULT_BOTTLENECK_THRESHOLDS.underutilizedPercent),
    approachingUtilizationPercent: numberArgument("classify-approaching", DEFAULT_BOTTLENECK_THRESHOLDS.approachingUtilizationPercent),
    highUtilizationPercent: numberArgument("classify-high", DEFAULT_BOTTLENECK_THRESHOLDS.highUtilizationPercent),
    saturatedUtilizationPercent: numberArgument("classify-saturated", DEFAULT_BOTTLENECK_THRESHOLDS.saturatedUtilizationPercent),
    queueWarningPercent: numberArgument("classify-queue-warning", DEFAULT_BOTTLENECK_THRESHOLDS.queueWarningPercent),
    availabilityDominanceRatio: numberArgument("classify-availability-ratio", DEFAULT_BOTTLENECK_THRESHOLDS.availabilityDominanceRatio),
  };

  console.log(`\n================================================\nLAGCHOW DEMAND / THROUGHPUT ANALYSIS\n================================================\n\nStrategy: ${defaultStrategy}\nPattern: ${arrivalPattern}\nSeed: ${seed}\nHorizon: ${horizonMinutes} min\nFleet: ${trekkerCount} Trekkers / ${riderCount} motorcycles\nConcurrent capacity: ${trekkerCount * 2 + riderCount * riderCapacity}\nPickup ETA limit: ${numberArgument("max-pickup-eta", 30)} min\nRandom streams: vendor prep=seed^1; order attributes=hash(seed, orderIndex); rider state=hash(seed, orderIndex, personIndex)\nThe same order index shares generated vendor/hostel/priority/prep-error draws across demand rates.\n`);

  console.log("DEMAND / THROUGHPUT SWEEP\n=========================");
  console.log("Demand   Assigned/hr  Assign%  Queue%  Avg util  Peak util  Avg delay  Late pickup  P95 delivery");
  for (const { demandRate, metrics } of results) {
    const queueRate = metrics.orders ? metrics.queued / metrics.orders * 100 : 0;
    console.log(`${String(demandRate).padStart(6)}   ${metrics.assignedOrdersPerHour.toFixed(1).padStart(10)}  ${percent(metrics.assignmentSuccessRate).padStart(7)}  ${percent(queueRate).padStart(6)}  ${percent(metrics.averageFleetUtilization).padStart(8)}  ${percent(metrics.peakFleetUtilization).padStart(9)}  ${`${metrics.pickupDelayMinutes.average.toFixed(1)}m`.padStart(9)}  ${percent(metrics.latePickupRate).padStart(11)}  ${`${metrics.deliveryMinutes.p95.toFixed(1)}m`.padStart(12)}`);
  }

  console.log("\nFULL DEMAND DETAILS\n-------------------");
  for (const { demandRate, metrics } of results) {
    const classification = classifyBottleneck(metrics, thresholds);
    const pickup = metrics.pickupFeasibility;
    console.log(`\n${demandRate} orders/hour (${metrics.orders} generated): assigned ${metrics.assigned}; queued ${metrics.queued}; success ${percent(metrics.assignmentSuccessRate)}; observed ${metrics.assignedOrdersPerHour.toFixed(1)} assigned/hour`);
    console.log(`Pickup: wait avg/P50/P95 ${pickup.assignedPickupEta.riderAvailabilityMinutes.average.toFixed(1)}/${pickup.assignedPickupEta.riderAvailabilityMinutes.p50.toFixed(1)}/${pickup.assignedPickupEta.riderAvailabilityMinutes.p95.toFixed(1)} min availability; route avg/P50/P95 ${pickup.assignedPickupEta.pureTravelMinutes.average.toFixed(1)}/${pickup.assignedPickupEta.pureTravelMinutes.p50.toFixed(1)}/${pickup.assignedPickupEta.pureTravelMinutes.p95.toFixed(1)} min travel; assigned combined ETA avg/P50/P95 ${pickup.assignedPickupEta.combinedEtaMinutes.average.toFixed(1)}/${pickup.assignedPickupEta.combinedEtaMinutes.p50.toFixed(1)}/${pickup.assignedPickupEta.combinedEtaMinutes.p95.toFixed(1)} min`);
    console.log(`Queued best-candidate pickup ETA avg/P50/P95 ${pickup.queuedPickupEta.combinedEtaMinutes.average.toFixed(1)}/${pickup.queuedPickupEta.combinedEtaMinutes.p50.toFixed(1)}/${pickup.queuedPickupEta.combinedEtaMinutes.p95.toFixed(1)} min; nearest route avg ${pickup.nearestDistanceKm.average.toFixed(3)} km; nearest travel avg ${pickup.nearestTravelTimeMinutes.average.toFixed(1)} min; availability avg ${pickup.nearestAvailabilityMinutes.average.toFixed(1)} min`);
    console.log(`Delivery avg/P50/P95/P99 ${metrics.deliveryMinutes.average.toFixed(1)}/${metrics.deliveryMinutes.p50.toFixed(1)}/${metrics.deliveryMinutes.p95.toFixed(1)}/${metrics.deliveryMinutes.p99.toFixed(1)} min; pickup delay avg/P95 ${metrics.pickupDelayMinutes.average.toFixed(1)}/${metrics.pickupDelayMinutes.p95.toFixed(1)} min; late pickup ${percent(metrics.latePickupRate)}`);
    console.log(`Utilization avg/peak ${percent(metrics.averageFleetUtilization)}/${percent(metrics.peakFleetUtilization)}; throughput Trekkers ${metrics.trekkerOrdersPerHour.toFixed(1)}/hr (${(metrics.trekkers ? metrics.trekkerOrdersPerHour / metrics.trekkers : 0).toFixed(2)}/Trekker/hr), motorcycles ${metrics.riderOrdersPerHour.toFixed(1)}/hr (${(metrics.riders ? metrics.riderOrdersPerHour / metrics.riders : 0).toFixed(2)}/rider/hr)`);
    console.log(`Pickup ETA buckets assigned: ${Object.entries(pickup.assignedEtaBuckets).map(([bucket, data]) => `${bucket}=${data.count}`).join(" | ")}`);
    console.log(`Pickup ETA buckets queued:   ${Object.entries(pickup.queuedEtaBuckets).map(([bucket, data]) => `${bucket}=${data.count}`).join(" | ")}`);
    console.log(`Queue reasons: ${Object.entries(metrics.queueReasons).map(([reason, data]) => `${reason}=${data.count} (${percent(data.percent)})`).join(" | ")}`);
    console.log(`Dispatch: ${metrics.dispatchDecisions} decisions, ${metrics.totalCandidateEvaluations} route evaluations, ${metrics.candidatesScored} scored, ${metrics.dispatchTimeMs.toFixed(1)} ms total`);
    console.log(`Dominant measured constraint: ${classification}`);
  }

  const firstUtilization = (minimum: number) => results.find(({ metrics }) => metrics.averageFleetUtilization >= minimum)?.demandRate;
  const etaIncrease = numberArgument("pickup-eta-rise-minutes", 5);
  const assignmentDecline = numberArgument("assignment-decline-pp", 5);
  const queueIncrease = numberArgument("queue-increase-pp", 5);
  const firstDelta = (selector: (metrics: import("../src/simulation/metrics").SimulationMetrics) => number, amount: number, falling = false) => {
    for (let index = 1; index < results.length; index += 1) {
      const previous = selector(results[index - 1].metrics);
      const current = selector(results[index].metrics);
      if (falling ? previous - current >= amount : current - previous >= amount) return results[index].demandRate;
    }
    return undefined;
  };
  const labelRate = (value: number | undefined) => value === undefined ? "not observed in tested range" : `${value} orders/hour`;
  console.log(`\nAPPARENT SATURATION REGION\n--------------------------\nAverage utilization first reaches ${thresholds.approachingUtilizationPercent}% at: ${labelRate(firstUtilization(thresholds.approachingUtilizationPercent))}\nAverage utilization first reaches ${thresholds.highUtilizationPercent}% at: ${labelRate(firstUtilization(thresholds.highUtilizationPercent))}\nAverage utilization first reaches ${thresholds.saturatedUtilizationPercent}% at: ${labelRate(firstUtilization(thresholds.saturatedUtilizationPercent))}\nQueued-candidate pickup ETA P95 rises by >=${etaIncrease} min at: ${labelRate(firstDelta((metrics) => metrics.pickupFeasibility.queuedPickupEta.combinedEtaMinutes.p95, etaIncrease))}\nAssignment rate falls by >=${assignmentDecline} percentage points at: ${labelRate(firstDelta((metrics) => metrics.assignmentSuccessRate, assignmentDecline, true))}\nQueue rate rises by >=${queueIncrease} percentage points at: ${labelRate(firstDelta((metrics) => metrics.orders ? metrics.queued / metrics.orders * 100 : 0, queueIncrease))}\nThese are measured transitions in this scenario, not a declared maximum fleet capacity.\n`);
}

async function main() {
  const routingEngineType = argumentsMap.get("routing") ?? "haversine";
  let routingEngine: import("../src/routing/routing-engine").RoutingEngine | undefined;
  
  if (routingEngineType === "ors") {
    const { ORSRoutingEngine } = await import("../src/routing/ors-routing");
    routingEngine = new ORSRoutingEngine();
  } else if (routingEngineType === "valhalla") {
    const { ValhallaRoutingEngine } = await import("../src/routing/valhalla-routing");
    routingEngine = new ValhallaRoutingEngine();
  }

  const compareStrategies = argumentsMap.get("compare")?.split(",").filter(Boolean) as DispatchStrategyName[] | undefined;
  if (compareStrategies?.length) {
    const results = await Promise.all(compareStrategies.map((strategy) => runSimulation(createOptions(orders, strategy), routingEngine)));
    await printComparison(results, compareStrategies);
  } else if (argumentsMap.has("demand-sweep")) {
    const rates = argumentsMap.get("demand-sweep")!.split(",").map(Number);
    if (rates.some((rate) => !Number.isFinite(rate) || rate <= 0)) throw new Error("--demand-sweep must be comma-separated positive orders/hour values");
    await printDemandSweep(rates, routingEngine);
  } else {
    await printReport(await runSimulation(createOptions(orders, defaultStrategy), routingEngine), seed, numberArgument("max-pickup-eta", 30));
  }

  if (routingEngineType === "ors" && routingEngine) {
    const orsEngine = routingEngine as any;
    console.log(`
ORS ROUTING
-----------
API requests: ${orsEngine.stats.apiRequests}
Cache hits: ${orsEngine.stats.cacheHits}
Cache misses: ${orsEngine.stats.cacheMisses}
Walking routes: ${orsEngine.stats.walkingRoutes}
Driving routes: ${orsEngine.stats.drivingRoutes}
Route failures: ${orsEngine.stats.routeFailures}
Haversine fallbacks: ${orsEngine.stats.haversineFallbacks}
`);
  } else if (routingEngineType === "valhalla" && routingEngine) {
    const valhallaEngine = routingEngine as any;
    console.log(`
VALHALLA ROUTING
----------------
API requests: ${valhallaEngine.stats.apiRequests}
Cache hits: ${valhallaEngine.stats.cacheHits}
Cache misses: ${valhallaEngine.stats.cacheMisses}
Walking routes: ${valhallaEngine.stats.walkingRoutes}
Driving routes: ${valhallaEngine.stats.drivingRoutes}
Route failures: ${valhallaEngine.stats.routeFailures}
Haversine fallbacks: ${valhallaEngine.stats.haversineFallbacks}
`);
  }
}

main().catch(console.error);

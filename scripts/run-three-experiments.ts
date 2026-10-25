import { runSimulation, type SimulationOptions } from "../src/simulation/simulate";
import { ValhallaRoutingEngine } from "../src/routing/valhalla-routing";
import type { DispatchStrategyName } from "../src/dispatch/types";

// Ratio: 76% trekkers / 24% riders (fixed mix, unoptimized)
function makeFleet(total: number) {
  const riders = Math.max(1, Math.round(total * 0.24));
  const trekkers = total - riders;
  return { total, trekkers, riders, capacity: trekkers * 2 + riders * 4 };
}

export type ViabilityCheck = {
  isViable: boolean;
  reasons: string[];
};

function checkViability(r: { successRate: number; latePickupRate: number; p95DeliveryMin: number }): ViabilityCheck {
  const reasons: string[] = [];
  if (r.successRate < 95.0) reasons.push(`Success < 95% (${r.successRate.toFixed(1)}%)`);
  if (r.latePickupRate > 15.0) reasons.push(`Late Pickup > 15% (${r.latePickupRate.toFixed(1)}%)`);
  if (r.p95DeliveryMin > 45.0) reasons.push(`P95 Delivery > 45m (${r.p95DeliveryMin.toFixed(1)}m)`);
  return { isViable: reasons.length === 0, reasons };
}

async function runFleetSweep(routingEngine: ValhallaRoutingEngine) {
  console.log(`\n============================================================`);
  console.log(`EXPERIMENT 1: FLEET SWEEP WITH MULTI-MEASURE VIABILITY`);
  console.log(`============================================================`);
  console.log(`Viability Rule: Success >= 95% AND Late Pickup <= 15% AND P95 Delivery <= 45m`);
  console.log(`------------------------------------------------------------\n`);

  // Specific tiers per rate to find exact boundary
  const scenarios: { rate: number; tiers: number[] }[] = [
    { rate: 25,  tiers: [5, 7, 10, 15, 20] },
    { rate: 50,  tiers: [10, 15, 20, 25, 30] },
    { rate: 100, tiers: [20, 21, 23, 25, 30, 35, 40, 50, 70, 105] },
  ];

  type SweepRow = {
    demandRate: number;
    fleetTotal: number;
    trekkers: number;
    riders: number;
    capacity: number;
    orders: number;
    assigned: number;
    queued: number;
    successRate: number;
    systemOnTimeRate: number;
    latePickupRate: number;
    avgDeliveryMin: number;
    p95DeliveryMin: number;
    peakUtil: number;
    isViable: boolean;
    viabilityNote: string;
  };

  const rows: SweepRow[] = [];

  for (const sc of scenarios) {
    for (const total of sc.tiers) {
      const fleet = makeFleet(total);
      const horizonMinutes = 240;
      const orderCount = Math.round((sc.rate * horizonMinutes) / 60);

      const options: SimulationOptions = {
        orders: orderCount,
        horizonMinutes,
        trekkerCount: fleet.trekkers,
        riderCount: fleet.riders,
        strategy: "full",
        arrivalPattern: "uniform",
        seed: 42,
      };

      const metrics = await runSimulation(options, routingEngine);
      const assignedOnTime = Math.max(0, metrics.assigned - metrics.slaMissedAssignments);
      const systemOnTimeRate = orderCount > 0 ? (assignedOnTime / orderCount) * 100 : 0;
      const viab = checkViability({
        successRate: metrics.assignmentSuccessRate,
        latePickupRate: metrics.latePickupRate,
        p95DeliveryMin: metrics.deliveryMinutes.p95,
      });

      rows.push({
        demandRate: sc.rate,
        fleetTotal: total,
        trekkers: fleet.trekkers,
        riders: fleet.riders,
        capacity: fleet.capacity,
        orders: orderCount,
        assigned: metrics.assigned,
        queued: metrics.queued,
        successRate: metrics.assignmentSuccessRate,
        systemOnTimeRate,
        latePickupRate: metrics.latePickupRate,
        avgDeliveryMin: metrics.deliveryMinutes.average,
        p95DeliveryMin: metrics.deliveryMinutes.p95,
        peakUtil: metrics.peakFleetUtilization,
        isViable: viab.isViable,
        viabilityNote: viab.isViable ? "YES" : `NO (${viab.reasons.join(", ")})`,
      });

      process.stdout.write(`Done: Rate ${sc.rate}/hr @ Fleet ${total} -> Viable: ${viab.isViable ? "YES" : "NO"}\n`);
    }
  }

  console.log(`\n---------------------------------------------------------------------------------------------------------------------------------------------------`);
  console.log(`SWEEP RESULTS WITH MULTI-MEASURE VIABILITY`);
  console.log(`---------------------------------------------------------------------------------------------------------------------------------------------------`);
  console.log(`Demand Rate | Fleet Size | Trekkers/Bikes | Success% | System On-Time% | Late Pickup% | Avg Delivery | P95 Delivery | Peak Util% | Viable?`);
  console.log(`---------------------------------------------------------------------------------------------------------------------------------------------------`);
  for (const r of rows) {
    console.log(
      `${(r.demandRate + " /hr").padStart(11)} | ` +
      `${String(r.fleetTotal).padStart(10)} | ` +
      `${(r.trekkers + "/" + r.riders).padStart(14)} | ` +
      `${(r.successRate.toFixed(1) + "%").padStart(8)} | ` +
      `${(r.systemOnTimeRate.toFixed(1) + "%").padStart(15)} | ` +
      `${(r.latePickupRate.toFixed(1) + "%").padStart(12)} | ` +
      `${(r.avgDeliveryMin.toFixed(1) + "m").padStart(12)} | ` +
      `${(r.p95DeliveryMin.toFixed(1) + "m").padStart(12)} | ` +
      `${(r.peakUtil.toFixed(1) + "%").padStart(10)} | ` +
      `${r.viabilityNote}`
    );
  }

  // Derive genuine minimum viable fleets
  console.log(`\n>>> HONEST MINIMUM VIABLE FLEET FINDINGS:`);
  for (const sc of scenarios) {
    const viableTiers = rows.filter((r) => r.demandRate === sc.rate && r.isViable).sort((a, b) => a.fleetTotal - b.fleetTotal);
    if (viableTiers.length > 0) {
      const minV = viableTiers[0];
      console.log(
        `⭐ Honest Minimum Viable Fleet for ${sc.rate} orders/hr: ` +
        `FLEET OF ${minV.fleetTotal} (${minV.trekkers} Trekkers, ${minV.riders} Bikes) ` +
        `-> Late Pickup: ${minV.latePickupRate.toFixed(1)}%, P95 Delivery: ${minV.p95DeliveryMin.toFixed(1)}m`
      );
    } else {
      console.log(`⚠️ No tested fleet met the multi-measure viability standard at ${sc.rate} orders/hr.`);
    }
  }

  return rows;
}

// Strategy Comparison with ETA-Aware Shortlist
async function runStrategyComparison(routingEngine: ValhallaRoutingEngine) {
  console.log(`\n============================================================`);
  console.log(`EXPERIMENT 2: STRATEGY COMPARISON (ETA-AWARE VS EUCLIDEAN VS FULL)`);
  console.log(`============================================================\n`);

  const strategies: DispatchStrategyName[] = [
    "full",
    "shortlist-5",
    "shortlist-eta-5",
    "shortlist-eta-8",
    "nearest",
  ];

  type StratResult = {
    setupLabel: string;
    strategy: string;
    candidatesScored: number;
    avgDecisionMs: number;
    successRate: number;
    systemOnTimeRate: number;
    avgDeliveryMin: number;
    p95DeliveryMin: number;
    avgPickupWaitMin: number;
    avgIncrementalMin: number;
  };

  const results: StratResult[] = [];
  const setups = [
    { label: "Fleet 105 @ 25/hr (Abundant)", fleet: makeFleet(105), orders: 200, horizon: 480 },
    { label: "Fleet 35 @ 100/hr (Tight Capacity)", fleet: makeFleet(35), orders: 400, horizon: 240 },
  ];

  for (const s of setups) {
    console.log(`Testing setup: ${s.label}`);
    for (const strat of strategies) {
      const options: SimulationOptions = {
        orders: s.orders,
        horizonMinutes: s.horizon,
        trekkerCount: s.fleet.trekkers,
        riderCount: s.fleet.riders,
        strategy: strat,
        arrivalPattern: "uniform",
        seed: 42,
      };

      const metrics = await runSimulation(options, routingEngine);
      const assignedOnTime = Math.max(0, metrics.assigned - metrics.slaMissedAssignments);
      const systemOnTimeRate = s.orders > 0 ? (assignedOnTime / s.orders) * 100 : 0;

      results.push({
        setupLabel: s.label,
        strategy: strat,
        candidatesScored: metrics.averageScoredCandidatesPerDecision,
        avgDecisionMs: metrics.dispatchDecisions ? metrics.dispatchTimeMs / metrics.dispatchDecisions : 0,
        successRate: metrics.assignmentSuccessRate,
        systemOnTimeRate,
        avgDeliveryMin: metrics.deliveryMinutes.average,
        p95DeliveryMin: metrics.deliveryMinutes.p95,
        avgPickupWaitMin: metrics.pickupWaitMinutes.average,
        avgIncrementalMin: metrics.averageIncrementalTimeMinutes,
      });

      process.stdout.write(`  [${s.label}] ${strat.padEnd(16)} -> Pickup Wait: ${metrics.pickupWaitMinutes.average.toFixed(1)}m, Detour: ${metrics.averageIncrementalTimeMinutes.toFixed(1)}m\n`);
    }
  }

  console.log(`\n-------------------------------------------------------------------------------------------------------------------------------------------------------`);
  console.log(`STRATEGY DISPATCH METRICS: ETA-AWARE PRE-FILTER VS DISTANCE PRE-FILTER VS FULL`);
  console.log(`-------------------------------------------------------------------------------------------------------------------------------------------------------`);
  console.log(`Scenario                        | Strategy         | Scored/Order | Avg Decision | Success% | Total Delivery | Pickup Wait | Incremental Detour`);
  console.log(`-------------------------------------------------------------------------------------------------------------------------------------------------------`);
  for (const r of results) {
    console.log(
      `${r.setupLabel.padEnd(31)} | ` +
      `${r.strategy.padEnd(16)} | ` +
      `${r.candidatesScored.toFixed(1).padStart(12)} | ` +
      `${(r.avgDecisionMs.toFixed(2) + " ms").padStart(12)} | ` +
      `${(r.successRate.toFixed(1) + "%").padStart(8)} | ` +
      `${(r.avgDeliveryMin.toFixed(1) + "m").padStart(14)} | ` +
      `${(r.avgPickupWaitMin.toFixed(1) + "m").padStart(11)} | ` +
      `${(r.avgIncrementalMin.toFixed(1) + "m").padStart(18)}`
    );
  }

  return results;
}

// Burst Shock on Realistic Fleet Sizes
async function runBurstAcrossFleets(routingEngine: ValhallaRoutingEngine) {
  console.log(`\n============================================================`);
  console.log(`EXPERIMENT 3: 200-ORDER RUSH-HOUR BURST ACROSS FLEET SIZES`);
  console.log(`============================================================\n`);

  const orderCount = 200;
  const horizonMinutes = 480;
  const burstFleets = [105, 70, 50, 35];

  type BurstResult = {
    fleetTotal: number;
    trekkers: number;
    riders: number;
    capacity: number;
    assigned: number;
    queued: number;
    successRate: number;
    systemOnTimeRate: number;
    peakActiveAssignments: number;
    peakConcurrentTrekkers: number;
    peakConcurrentRiders: number;
    avgDeliveryMin: number;
    p95DeliveryMin: number;
    latePickupRate: number;
  };

  const results: BurstResult[] = [];

  for (const total of burstFleets) {
    const fleet = makeFleet(total);
    const options: SimulationOptions = {
      orders: orderCount,
      horizonMinutes,
      trekkerCount: fleet.trekkers,
      riderCount: fleet.riders,
      strategy: "full",
      arrivalPattern: "burst",
      seed: 42,
    };

    const metrics = await runSimulation(options, routingEngine);
    const assignedOnTime = Math.max(0, metrics.assigned - metrics.slaMissedAssignments);
    const systemOnTimeRate = orderCount > 0 ? (assignedOnTime / orderCount) * 100 : 0;

    results.push({
      fleetTotal: total,
      trekkers: fleet.trekkers,
      riders: fleet.riders,
      capacity: fleet.capacity,
      assigned: metrics.assigned,
      queued: metrics.queued,
      successRate: metrics.assignmentSuccessRate,
      systemOnTimeRate,
      peakActiveAssignments: metrics.peakActiveAssignments,
      peakConcurrentTrekkers: metrics.peakActiveTrekkers,
      peakConcurrentRiders: metrics.peakActiveRiders,
      avgDeliveryMin: metrics.deliveryMinutes.average,
      p95DeliveryMin: metrics.deliveryMinutes.p95,
      latePickupRate: metrics.latePickupRate,
    });

    process.stdout.write(`Done: Burst on Fleet ${total} -> Success: ${metrics.assignmentSuccessRate.toFixed(1)}%, Peak: ${metrics.peakActiveAssignments}/${fleet.capacity}\n`);
  }

  console.log(`\n---------------------------------------------------------------------------------------------------------------------------------------`);
  console.log(`BURST TEST RESULTS ACROSS REALISTIC FLEET SIZES (200 ORDERS IN FIRST 30 MINUTES)`);
  console.log(`---------------------------------------------------------------------------------------------------------------------------------------`);
  console.log(`Fleet Size | Capacity | Assigned | Queued | Success% | System On-Time% | Peak Active / Cap | Late Pickup% | Avg Delivery | P95 Delivery`);
  console.log(`---------------------------------------------------------------------------------------------------------------------------------------`);
  for (const r of results) {
    console.log(
      `${String(r.fleetTotal).padStart(10)} | ` +
      `${String(r.capacity).padStart(8)} | ` +
      `${String(r.assigned).padStart(8)} | ` +
      `${String(r.queued).padStart(6)} | ` +
      `${(r.successRate.toFixed(1) + "%").padStart(8)} | ` +
      `${(r.systemOnTimeRate.toFixed(1) + "%").padStart(15)} | ` +
      `${(r.peakActiveAssignments + " / " + r.capacity).padStart(17)} | ` +
      `${(r.latePickupRate.toFixed(1) + "%").padStart(12)} | ` +
      `${(r.avgDeliveryMin.toFixed(1) + "m").padStart(12)} | ` +
      `${(r.p95DeliveryMin.toFixed(1) + "m").padStart(12)}`
    );
  }

  return results;
}

async function main() {
  const routingEngine = new ValhallaRoutingEngine();
  console.log(`Starting comprehensive investigation...`);

  await runFleetSweep(routingEngine);
  await runStrategyComparison(routingEngine);
  await runBurstAcrossFleets(routingEngine);

  console.log(`\nALL SIMULATION EXPERIMENTS COMPLETED SUCCESSFULLY!`);
}

main().catch(console.error);

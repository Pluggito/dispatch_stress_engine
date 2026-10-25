import { ValhallaRoutingEngine } from "../src/routing/valhalla-routing";
import { CAMPUS_VENDORS, CAMPUS_HOSTELS } from "../src/simulation/campus";

async function runSmokeTest() {
  const endpoint = process.env.VALHALLA_URL || "http://localhost:8002/route";
  console.log(`SMOKE TEST: Valhalla Routing Engine`);
  console.log(`Endpoint: ${endpoint}`);

  const engine = new ValhallaRoutingEngine();

  // Find a vendor and a hostel
  const vendor = CAMPUS_VENDORS.find(v => v.name.toLowerCase().includes("2001")) || CAMPUS_VENDORS[0];
  const hall = CAMPUS_HOSTELS.find(h => h.name.toLowerCase().includes("moremi") || h.name.toLowerCase().includes("hall")) || CAMPUS_HOSTELS[0];

  console.log(`From: ${vendor.name} (${vendor.location.latitude}, ${vendor.location.longitude})`);
  console.log(`To: ${hall.name} (${hall.location.latitude}, ${hall.location.longitude})`);
  console.log(`--------------------------------------------------`);

  try {
    console.log(`Testing walking mode (pedestrian)...`);
    const walkingResult = await engine.estimateTravelTime(vendor.location, hall.location, "walking");
    console.log(`  Distance: ${walkingResult.distanceKm.toFixed(3)} km`);
    console.log(`  Duration: ${walkingResult.durationMinutes.toFixed(1)} min\n`);

    console.log(`Testing driving mode (motorcycle)...`);
    const drivingResult = await engine.estimateTravelTime(vendor.location, hall.location, "driving");
    console.log(`  Distance: ${drivingResult.distanceKm.toFixed(3)} km`);
    console.log(`  Duration: ${drivingResult.durationMinutes.toFixed(1)} min\n`);

    console.log("Valhalla stats:", engine.stats);
    if (engine.stats.routeFailures > 0) {
      console.warn("⚠️ Warning: Valhalla encountered failures and fell back to Haversine.");
    } else {
      console.log("✅ Valhalla smoke test completed successfully with real routes!");
    }
  } catch (error) {
    console.error("Valhalla smoke test encountered fatal error:", error);
    process.exit(1);
  }
}

runSmokeTest().catch(console.error);

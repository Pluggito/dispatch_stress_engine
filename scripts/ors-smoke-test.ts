import { ORSRoutingEngine } from "../src/routing/ors-routing";
import { CAMPUS_VENDORS, CAMPUS_HOSTELS } from "../src/simulation/campus";

async function runSmokeTest() {
  if (!process.env.ORS_API_KEY) {
    console.error("Missing ORS_API_KEY environment variable. Cannot run smoke test.");
    process.exit(1);
  }

  const engine = new ORSRoutingEngine();
  
  // Find a vendor and a hall
  const vendor = CAMPUS_VENDORS.find(v => v.name.toLowerCase().includes("2001")) || CAMPUS_VENDORS[0];
  const hall = CAMPUS_HOSTELS.find(h => h.name.toLowerCase().includes("moremi") || h.name.toLowerCase().includes("hall")) || CAMPUS_HOSTELS[0];

  console.log(`SMOKE TEST: ORS Routing Engine`);
  console.log(`From: ${vendor.name} (${vendor.location.latitude}, ${vendor.location.longitude})`);
  console.log(`To: ${hall.name} (${hall.location.latitude}, ${hall.location.longitude})`);
  console.log(`--------------------------------------------------`);

  try {
    console.log(`Testing walking mode...`);
    const walkingResult = await engine.estimateTravelTime(vendor.location, hall.location, "walking");
    console.log(`  Distance: ${walkingResult.distanceKm.toFixed(3)} km`);
    console.log(`  Duration: ${walkingResult.durationMinutes.toFixed(1)} min\n`);

    console.log(`Testing driving mode...`);
    const drivingResult = await engine.estimateTravelTime(vendor.location, hall.location, "driving");
    console.log(`  Distance: ${drivingResult.distanceKm.toFixed(3)} km`);
    console.log(`  Duration: ${drivingResult.durationMinutes.toFixed(1)} min\n`);

    console.log("Smoke test completed successfully!");
  } catch (error) {
    console.error("Smoke test failed:", error);
    process.exit(1);
  }
}

runSmokeTest().catch(console.error);

const endpoint = process.env.VALHALLA_URL || "http://localhost:8002";
const cleanEndpoint = endpoint.replace(/\/route\/?$/, "").replace(/\/+$/, "");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const map: Record<string, string> = {};
  for (const arg of args) {
    const [k, v] = arg.replace(/^--/, "").split("=");
    map[k] = v || "true";
  }
  return {
    requests: parseInt(map.requests || "100", 10),
    concurrency: parseInt(map.concurrency || "10", 10),
  };
};

// Sample UNILAG coordinates
const SAMPLE_LOCATIONS = [
  { name: "2001 Cafe", lat: 6.5194749, lon: 3.3916999 },
  { name: "Makama Hall", lat: 6.5194166, lon: 3.3921825 },
  { name: "Moremi Hall", lat: 6.5162, lon: 3.3895 },
  { name: "Faculty of Science", lat: 6.5178, lon: 3.3941 },
  { name: "New Hall", lat: 6.5205, lon: 3.3962 },
  { name: "Jaja Complex", lat: 6.5185, lon: 3.3882 },
  { name: "Sports Centre", lat: 6.5142, lon: 3.3928 },
  { name: "Faculty of Arts", lat: 6.5169, lon: 3.3955 },
];

async function main() {
  const { requests, concurrency } = parseArgs();
  console.log(`\n========================================`);
  console.log(`VALHALLA SERVER CONCURRENCY STRESS TEST`);
  console.log(`========================================`);
  console.log(`Target:      ${cleanEndpoint}`);
  console.log(`Requests:    ${requests}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`----------------------------------------\n`);

  let completed = 0;
  let successful = 0;
  let failed = 0;
  const latencies: number[] = [];

  const queue = Array.from({ length: requests }, (_, i) => i);
  const startedAt = performance.now();

  async function worker() {
    while (queue.length > 0) {
      const idx = queue.shift()!;
      const from = SAMPLE_LOCATIONS[idx % SAMPLE_LOCATIONS.length];
      const to = SAMPLE_LOCATIONS[(idx + 1) % SAMPLE_LOCATIONS.length];
      const isWalking = idx % 2 === 0;

      const payload = {
        locations: [
          { lat: from.lat, lon: from.lon },
          { lat: to.lat, lon: to.lon },
        ],
        costing: isWalking ? "pedestrian" : "motorcycle",
        units: "kilometers",
      };

      const reqStart = performance.now();
      try {
        const res = await fetch(`${cleanEndpoint}/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const elapsed = performance.now() - reqStart;
        latencies.push(elapsed);

        if (res.ok) {
          const data = await res.json();
          if (data.trip?.summary) {
            successful++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
      } finally {
        completed++;
        if (completed % Math.max(1, Math.floor(requests / 10)) === 0 || completed === requests) {
          process.stdout.write(`Progress: ${completed}/${requests} (${Math.round((completed / requests) * 100)}%)\r`);
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, requests) }, () => worker());
  await Promise.all(workers);

  const totalTimeSeconds = (performance.now() - startedAt) / 1000;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p90 = latencies[Math.floor(latencies.length * 0.9)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  const rps = requests / (totalTimeSeconds || 1);

  console.log(`\n\n----------------------------------------`);
  console.log(`BENCHMARK RESULTS`);
  console.log(`----------------------------------------`);
  console.log(`Total Time:     ${totalTimeSeconds.toFixed(2)}s`);
  console.log(`Throughput:     ${rps.toFixed(1)} req/sec`);
  console.log(`Successful:     ${successful}/${requests} (${((successful / requests) * 100).toFixed(1)}%)`);
  console.log(`Failed:         ${failed}/${requests}`);
  console.log(`Latency Avg:    ${avg.toFixed(1)} ms`);
  console.log(`Latency P50:    ${p50.toFixed(1)} ms`);
  console.log(`Latency P90:    ${p90.toFixed(1)} ms`);
  console.log(`Latency P95:    ${p95.toFixed(1)} ms`);
  console.log(`Latency P99:    ${p99.toFixed(1)} ms`);
  console.log(`========================================\n`);
}

main().catch(console.error);

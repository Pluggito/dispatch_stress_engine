# Logistics Delivery Engine Simulator

A CLI-first, deterministic simulator for time-aware delivery dispatch. The core engine is independent of the Next.js shell so it can be pressure-tested without a database or external routing API.

The simulated operating area is the University of Lagos campus. Vendors are sampled from campus food points, customers are sampled around named hostels, and riders start within the same campus boundary.

## Validate

```powershell
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## Environment Setup

To use the OpenRouteService (ORS) routing engine, you must provide an API key. 
Create a `.env` file in the root directory and add your key:

```env
ORS_API_KEY=your_api_key_here
VALHALLA_URL=http://localhost:8002/route # Optional: custom Valhalla endpoint
```

## Smoke Test

Before running full simulations, you can verify your routing setup (like the ORS engine) using the smoke test:

```powershell
npx tsx --env-file=.env scripts/ors-smoke-test.ts
```

## Run simulations

```powershell
pnpm simulate --orders=1000 --seed=42 --strategy=full
pnpm simulate --orders=10000 --seed=42 --strategy=full --pattern=peak
pnpm simulate --orders=100000 --seed=42 --strategy=full --pattern=lunch-rush
```

## Simulation Controls

```text
--orders=1000                 number of simulated orders
--seed=42                     reproducible scenario seed
--strategy=full               dispatch strategy to use
--pattern=uniform|peak|burst|lunch-rush|evening-rush
--routing=haversine|ors|valhalla routing engine (default: haversine)

Fleet Options:
--trekkers=80                 number of foot couriers (capacity 2)
--riders=25                   number of motorcycle riders (capacity 3 or 4)
--rider-capacity=4            motorcycle capacity (3 or 4)

Stress & Environment:
--traffic=1.0                 traffic multiplier
--prep-error=0                vendor preparation error in minutes
--failure-rate=0              rider failures per simulated hour
--concentration=0             fraction of orders sent to one hotspot vendor
--horizon=480                 simulated operating window in minutes
--max-pickup-eta=30           max pickup time allowed (minutes)
--max-delivery=90             max delivery time allowed (minutes)

Analysis & Reporting:
--diagnostics                 print detailed route/bucket diagnostics
--compare=strategy1,strategy2 run multiple strategies and compare results
--demand-sweep=100,500,1000   run analysis across multiple demand rates
```

Example pressure test:

```powershell
pnpm simulate --orders=10000 --seed=42 --strategy=full --pattern=burst --traffic=1.5 --prep-error=6 --failure-rate=0.02 --concentration=0.8 --rider-capacity=3 --trekkers=50 --riders=20 --routing=ors
```

The report includes assignment success, queue size, rider failures, average/P50/P95/P99 delivery time, pickup waiting, late pickup rate, and peak active assignments.

## Current phases

- Phase 1: typed domain model and deterministic routing.
- Phase 2: seeded fleet/order simulation and baseline dispatch strategies.
- Stress modeling: burst demand, rush patterns, traffic, preparation error, capacity pressure, geographic concentration, and rider failure/recovery.

The simulator is intentionally in-memory. Persistence, Redis, queues, and NestJS infrastructure come after the dispatch behavior and scaling limits are measured.

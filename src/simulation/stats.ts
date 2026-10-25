export type PercentileStats = {
  average: number;
  p50: number;
  p95: number;
  p99: number;
};

export type BucketStats = Record<string, { count: number; percent: number }>;

export type BucketBound = { label: string; maximum: number };

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * Loop-based maximum. `Math.max(...values)` throws a RangeError once the array
 * exceeds the engine's argument limit (~100k+ entries), which large simulations hit.
 */
export function maximum(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let result = Number.NEGATIVE_INFINITY;
  for (const value of values) if (value > result) result = value;
  return result;
}

function percentileOfSorted(sorted: readonly number[], percentileValue: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index];
}

/** Nearest-rank percentile. `percentileValue` is a fraction in [0, 1]. */
export function percentile(values: readonly number[], percentileValue: number): number {
  return percentileOfSorted([...values].sort((a, b) => a - b), percentileValue);
}

/** Average plus P50/P95/P99, sorting the input once. */
export function summarize(values: readonly number[]): PercentileStats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    average: mean(sorted),
    p50: percentileOfSorted(sorted, 0.5),
    p95: percentileOfSorted(sorted, 0.95),
    p99: percentileOfSorted(sorted, 0.99),
  };
}

/** Counts values into the first bucket whose `maximum` exceeds the value; everything else lands in `overflowLabel`. */
export function bucketCounts(values: readonly number[], bounds: readonly BucketBound[], overflowLabel: string): BucketStats {
  const counts = new Map<string, number>([...bounds.map(({ label }) => [label, 0] as const), [overflowLabel, 0]]);
  for (const value of values) {
    const label = bounds.find((bound) => value < bound.maximum)?.label ?? overflowLabel;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].map(([label, count]) => [label, {
    count,
    percent: values.length ? count / values.length * 100 : 0,
  }]));
}

export const PICKUP_ETA_BOUNDS: readonly BucketBound[] = [
  { label: "<5 min", maximum: 5 },
  { label: "5-10 min", maximum: 10 },
  { label: "10-15 min", maximum: 15 },
  { label: "15-20 min", maximum: 20 },
  { label: "20-25 min", maximum: 25 },
  { label: "25-30 min", maximum: 30 },
];
export const PICKUP_ETA_OVERFLOW = ">30 min";

export const NEAREST_DISTANCE_BOUNDS: readonly BucketBound[] = [
  { label: "<100m", maximum: 0.1 },
  { label: "100-250m", maximum: 0.25 },
  { label: "250-500m", maximum: 0.5 },
  { label: "500-750m", maximum: 0.75 },
  { label: "750m-1km", maximum: 1 },
];
export const NEAREST_DISTANCE_OVERFLOW = ">1km";

export const SHORT_ETA_BOUNDS: readonly BucketBound[] = [
  { label: "<2 min", maximum: 2 },
  { label: "2-5 min", maximum: 5 },
  { label: "5-10 min", maximum: 10 },
  { label: "10-15 min", maximum: 15 },
  { label: "15-20 min", maximum: 20 },
];
export const SHORT_ETA_OVERFLOW = ">20 min";

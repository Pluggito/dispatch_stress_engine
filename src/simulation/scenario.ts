import type { DeliveryPerson, Order, Vendor } from "../domain/types";
import { CAMPUS_HOSTELS, CAMPUS_VENDORS, randomCampusPlace } from "./campus";
import { createSeededRandom, randomBetween } from "./random";

export const ARRIVAL_PATTERNS = ["uniform", "peak", "burst", "lunch-rush", "evening-rush"] as const;
export type ArrivalPattern = (typeof ARRIVAL_PATTERNS)[number];

/** Independent random streams so changing one dimension (e.g. demand) does not reshuffle another (e.g. fleet). */
export const RANDOM_STREAM = {
  VENDOR_PREP: 1,
  ORDER_ATTRIBUTES: 2,
  RIDER_STATE: 3,
} as const;

export function deriveStreamSeed(seed: number, stream: number, index = 0, subindex = 0): number {
  return (seed
    ^ Math.imul(stream, 0x9e3779b1)
    ^ Math.imul(index + 1, 0x85ebca6b)
    ^ Math.imul(subindex + 1, 0xc2b2ae35)) >>> 0;
}

export function createFleet(seed: number, trekkerCount = 80, riderCount = 25, riderCapacity: 3 | 4 = 4): DeliveryPerson[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: trekkerCount + riderCount }, (_, index) => {
    const type = index < trekkerCount ? "TREKKER" : "RIDER";
    return {
      id: `${type.toLowerCase()}-${index + 1}`,
      type,
      status: random() > 0.12 ? "ONLINE" : "OFFLINE",
      location: randomCampusPlace(random).location,
      maxActiveDeliveries: type === "TREKKER" ? 2 : riderCapacity,
      activeDeliveries: [],
      averageSpeedKph: type === "TREKKER" ? randomBetween(random, 4, 6) : randomBetween(random, 18, 28),
    };
  });
}

export function createVendors(seed: number, preparationErrorMinutes: number): Vendor[] {
  const vendorRandom = createSeededRandom(deriveStreamSeed(seed, RANDOM_STREAM.VENDOR_PREP));
  return CAMPUS_VENDORS.map((place, index) => ({
    id: `vendor-${index + 1}`,
    name: place.name,
    zone: place.zone ?? "Campus",
    location: place.location,
    preparationMinutes: randomBetween(vendorRandom, 8, 22),
    preparationVarianceMinutes: preparationErrorMinutes,
  }));
}

/** Maps order `index` of `total` onto a creation time in [0, horizonMinutes) according to the demand curve. */
export function arrivalTime(index: number, total: number, pattern: ArrivalPattern, horizonMinutes: number): number {
  const position = total ? index / total : 0;
  if (pattern === "burst") return position * Math.min(30, horizonMinutes);
  if (pattern === "peak") {
    if (position < 0.2) return position / 0.2 * horizonMinutes * 0.4;
    if (position < 0.8) return horizonMinutes * 0.4 + (position - 0.2) / 0.6 * horizonMinutes * 0.2;
    return horizonMinutes * 0.6 + (position - 0.8) / 0.2 * horizonMinutes * 0.4;
  }
  if (pattern === "lunch-rush") {
    if (position < 0.15) return position / 0.15 * horizonMinutes * 0.2;
    if (position < 0.85) return horizonMinutes * 0.2 + (position - 0.15) / 0.7 * horizonMinutes * 0.6;
    return horizonMinutes * 0.8 + (position - 0.85) / 0.15 * horizonMinutes * 0.2;
  }
  if (pattern === "evening-rush") {
    if (position < 0.55) return position / 0.55 * horizonMinutes * 0.6;
    if (position < 0.9) return horizonMinutes * 0.6 + (position - 0.55) / 0.35 * horizonMinutes * 0.25;
    return horizonMinutes * 0.85 + (position - 0.9) / 0.1 * horizonMinutes * 0.15;
  }
  return position * horizonMinutes;
}

export function createOrder(
  random: () => number,
  index: number,
  vendors: Vendor[],
  now: number,
  preparationErrorMinutes: number,
  demandConcentration: number,
): Order {
  const vendorIndex = random() < demandConcentration ? 0 : Math.floor(random() * vendors.length);
  const vendor = vendors[vendorIndex];
  const predictedPrep = vendor.preparationMinutes;
  const actualPrep = Math.max(3, predictedPrep + randomBetween(random, -preparationErrorMinutes, preparationErrorMinutes));
  const customerPlace = CAMPUS_HOSTELS[Math.floor(random() * CAMPUS_HOSTELS.length)];
  return {
    id: `order-${index + 1}`,
    vendorId: vendor.id,
    customerLabel: customerPlace.name,
    vendorLocation: vendor.location,
    customerLocation: customerPlace.location,
    createdAt: now,
    priority: random() > 0.96 ? "URGENT" : random() > 0.88 ? "HIGH" : "STANDARD",
    predictedReadyAt: now + predictedPrep,
    actualReadyAt: now + actualPrep,
  };
}

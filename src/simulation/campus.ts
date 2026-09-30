import { landmarks } from "../constants/campus-landmarks";
import { faculty } from "../constants/faculties";
import { hostels } from "../constants/hostels";
import { vendors } from "../constants/vendors";
import type { Location } from "../domain/types";
import type { Coordinates } from "../constants/types";

export type CampusPlaceType = "VENDOR" | "HOSTEL" | "LANDMARK" | "FACULTY";

export type CampusPlace = {
  name: string;
  zone?: string;
  type: CampusPlaceType;
  location: Location;
};

export const UNIVERSITY_OF_LAGOS: Location = {
  latitude: 6.5154,
  longitude: 3.3898,
};

function toLocation(coordinates: Coordinates): Location {
  return { latitude: coordinates.lat, longitude: coordinates.lng };
}

function flattenZoneData(
  data: { Zones: Record<string, Record<string, Coordinates>> },
  type: "VENDOR" | "HOSTEL",
): CampusPlace[] {
  return Object.entries(data.Zones).flatMap(([zone, places]) =>
    Object.entries(places).map(([name, coordinates]) => ({
      name,
      zone,
      type,
      location: toLocation(coordinates),
    })),
  );
}

export const CAMPUS_VENDORS = flattenZoneData(vendors, "VENDOR");
export const CAMPUS_HOSTELS = flattenZoneData(hostels, "HOSTEL");
export const CAMPUS_LANDMARKS: CampusPlace[] = Object.entries(landmarks).map(([name, coordinates]) => ({
  name,
  type: "LANDMARK",
  location: toLocation(coordinates),
}));
export const CAMPUS_FACULTIES: CampusPlace[] = Object.entries(faculty).map(([name, coordinates]) => ({
  name,
  type: "FACULTY",
  location: toLocation(coordinates),
}));

export const UNILAG_CAMPUS_PLACES: CampusPlace[] = [
  ...CAMPUS_VENDORS,
  ...CAMPUS_HOSTELS,
  ...CAMPUS_LANDMARKS,
  ...CAMPUS_FACULTIES,
];

export function randomCampusPlace(random: () => number, type?: CampusPlaceType): CampusPlace {
  const places = type ? UNILAG_CAMPUS_PLACES.filter((place) => place.type === type) : UNILAG_CAMPUS_PLACES;
  if (places.length === 0) throw new Error(`No campus places configured for type: ${type}`);
  return places[Math.floor(random() * places.length)];
}

export type Coordinates = {
  lat: number;
  lng: number;
};

export type ZonedLocations = Record<string, Record<string, Coordinates>>;

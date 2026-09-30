import type { ZonedLocations } from "./types";

export const vendors = {
  Zones: {
    Newhall: {
      "2001 cafe": { lat: 6.5194749, lng: 3.3916999 },
      "Seun spag unilag": { lat: 6.5192689, lng: 3.3925635 },
    },
    Education: {
      "korede spag": { lat: 6.5148446, lng: 3.386704 },
      "Opvine": { lat: 6.5146224, lng: 3.3864505 },
      "Stacy's place": { lat: 6.51575, lng: 3.3850171 },
      "iya basira": { lat: 6.5144346, lng: 3.3863819 },
    },
    DLI: {
      "Iya moria": { lat: 6.5116163, lng: 3.3924897 },
    },
    Campus: {
      "foodian": { lat: 6.5159912, lng: 3.397066 },
      "Cosmos": { lat: 6.5163355, lng: 3.3969823 },
      "Mavise": { lat: 6.516665, lng: 3.3982721 },
      "Shop 10": { lat: 6.5165837, lng: 3.3983398 },
    },
  },
} satisfies { Zones: ZonedLocations };

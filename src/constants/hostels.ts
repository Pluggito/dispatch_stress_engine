import type { ZonedLocations } from "./types";

export const hostels = {
  Zones: {
    Newhall: {
      "makama hall of residence": { lat: 6.5194166, lng: 3.3921825 },
      "faguwa hall of residence": { lat: 6.5200243, lng: 3.3917542 },
      "mth hall of residence": { lat: 6.5202185, lng: 3.3914859 },
      "sodeinde hall of residdence": { lat: 6.5192571, lng: 3.3923835 },
      "enijoku hall of residence": { lat: 6.5191127, lng: 3.3937119 },
    },
    Campus: {
      "moremi hall of resisdence": { lat: 6.5177211, lng: 3.3970446 },
      "mariere hall of resisdence": { lat: 6.5181919, lng: 3.3981794 },
      "jaja hall of resisdence": { lat: 6.5162355, lng: 3.3976334 },
    },
    Education: {
      "Gbaja hall of residence": { lat: 6.5171219, lng: 3.3847943 },
      "elkanemi hall of resisdence": { lat: 6.5160105, lng: 3.384877 },
      "amina hall of resisdenc": { lat: 6.5153503, lng: 3.3857726 },
      "Kofo Ademola hall of residence": { lat: 6.5154004, lng: 3.3863073 },
      "Biobaku hall of residence": { lat: 6.5146966, lng: 3.3871066 },
    },
    DLI: {
      "Honors hall of residence": { lat: 6.5106261, lng: 3.3930725 },
      "women society hall of residence": { lat: 6.5109143, lng: 3.3931332 },
    },
  },
} satisfies { Zones: ZonedLocations };

export const campuszone = hostels;

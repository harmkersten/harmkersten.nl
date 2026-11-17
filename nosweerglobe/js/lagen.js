// Hoe elke datalaag eruitziet: kleurschaal en getallen bij de legenda.
// De data zelf komt uit data/<id>.json; een laag zonder regel hier krijgt 'standaard'.
// Een kleur is [waarde, 'hex', dekking 0–1 (optioneel)].
// glad (optioneel): hoe vaak het raster wordt gladgestreken voor het getekend wordt.

export const LAGEN = {
  temperatuur: {
    schaal: [
      [-40, '#4a1486'], [-25, '#2a4fa8'], [-10, '#3f8fd0'], [0, '#bde0ee'],
      [8, '#f5f0b8'], [16, '#fbc45a'], [24, '#f08a2c'], [32, '#d9361e'], [42, '#7a0f1a'],
    ],
    streepjes: [-40, -20, 0, 20, 40],
  },
  windsnelheid: {
    schaal: [
      [0, '#ffffff', 0], [4, '#a6d8e8', 0.7], [9, '#5fb7a2'], [14, '#f2d24b'],
      [20, '#ee8a2f'], [28, '#d5301f'], [40, '#7a1260'],
    ],
    streepjes: [0, 10, 20, 30, 40],
  },
  luchtdruk: {
    schaal: [
      [955, '#4a1486'], [985, '#3f8fd0'], [1013, '#f3efe5'], [1030, '#f08a2c'], [1050, '#a8201a'],
    ],
    streepjes: [960, 980, 1000, 1020, 1040],
  },
  // Lichte neerslag is een dunne lichtblauwe waas die opgaat in de kaart. Daarna
  // cyaan en groen (die steken af tegen de zee) en voor zware neerslag het
  // NOS-verloop van helder blauw via indigo naar donkerpaars. De donkere kern
  // ligt altijd binnen een lichtere rand, en blijft daardoor ook op zee leesbaar.
  neerslag: {
    schaal: [
      [0, '#9fdcf5', 0], [0.1, '#9fdcf5', 0.2], [0.6, '#6fe6ff', 0.75], [1.5, '#14d977'],
      [4, '#2f7bff'], [8, '#5b2bd9'], [16, '#4a0d73'],
    ],
    streepjes: [0, 4, 8, 12, 16],
  },
  vochtigheid: {
    schaal: [[0, '#c98a3d'], [40, '#f1e3b0'], [70, '#a8d8c8'], [100, '#1f5fa8']],
    streepjes: [0, 25, 50, 75, 100],
  },
  pm25: {
    schaal: [
      [0, '#ffeca0', 0], [5, '#ffeca0', 0.5], [15, '#f6c244'], [35, '#ee7d2b'],
      [75, '#c9301f'], [150, '#7a1260'], [250, '#3a0a3a'],
    ],
    streepjes: [0, 50, 100, 150, 200, 250],
  },
  standaard: {
    schaal: [[0, '#ffffff', 0], [1, '#e61e14']],
    streepjes: [],
  },
};

// Radar en satellietneerslag gebruiken dezelfde kleuren als de neerslag uit het model.
LAGEN.radar = LAGEN.neerslag;
LAGEN.imerg = LAGEN.neerslag;

// De vaste kaartstijl. Uitgangspunt is bron/base globe.svg, maar land en water
// zijn donkerder en voller van kleur, zodat witte lijnen en labels er goed op
// te lezen zijn: wit op land is 3,4 : 1 en wit op water 6,6 : 1 (eis voor
// grafische elementen: minstens 3 : 1).
export const STIJL = {
  ruimte: '#9ac3de',
  ruimteVerloop: '#537d9a',
  // Allemaal dezelfde helderheid als de vorige, grauwere kleuren: alleen de tint
  // is frisser, dus het contrast met de datalagen en de labels blijft gelijk.
  water: '#126199',          // helder petrolblauw, weg van het blauw van neerslag
  land: '#838e8c',           // koel grijs met een zweem groenblauw
  nederland: '#bfc7c6',      // lichter, zodat Nederland eruit springt
  grens: '#4f5b5e',          // koel donkergrijs
  dieptes: {
    200: '#0f5c93', 1000: '#0e578b', 2000: '#0e5587', 3000: '#0d5283',
    4000: '#0d507f', 5000: '#0c4d7b', 6000: '#0c4a76', 7000: '#0b4873',
    8000: '#0b456f', 9000: '#0b436b', 10000: '#0a4167',
  },
};

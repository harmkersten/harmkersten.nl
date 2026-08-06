/* Kaderposities voor de fotocompilatie.
   Alle waarden in pixels op een canvas van 1080 x 1080.

   Bron: measure photoframes-01/02/03.svg (Illustrator-export). De rechthoeken
   daarin staan geroteerd met een transform; hier zijn ze uitgerekend naar
   assenparallelle kaders. Elk kader is 527.47 x 395.61 (liggend) of
   395.61 x 527.47 (staand) — in alle indelingen even groot.

   Volgorde in de array = stapelvolgorde: [0] onderop, [2] bovenop. Ze staan
   op hoogte gesorteerd, zodat een lager kader over een hoger kader valt. */

const LAYOUTS = [
  {
    id: 'variant-1',
    naam: 'Variant 1',
    frames: [
      { x:  68.78, y: 234.71, w: 527.47, h: 395.61 }, // linksboven, liggend
      { x: 615.61, y: 347.27, w: 395.61, h: 527.47 }, // rechts, staand
      { x: 216.28, y: 593.27, w: 527.47, h: 395.61 }, // onder, liggend
    ],
  },
  {
    id: 'variant-2',
    naam: 'Variant 2',
    frames: [
      { x: 490.89, y: 168.56, w: 527.47, h: 395.61 }, // rechtsboven, liggend
      { x:  61.63, y: 235.81, w: 395.61, h: 527.47 }, // links, staand
      { x: 385.57, y: 593.27, w: 527.47, h: 395.61 }, // rechtsonder, liggend
    ],
  },
  {
    id: 'variant-3',
    naam: 'Variant 3',
    frames: [
      { x: 175.80, y: 163.21, w: 527.47, h: 395.61 }, // boven, liggend
      { x: 631.60, y: 388.81, w: 395.61, h: 527.47 }, // rechts, staand
      { x:  70.47, y: 587.92, w: 527.47, h: 395.61 }, // linksonder, liggend
    ],
  },

  /* Variant 4 t/m 6 komen uit measure zonder overlap-07/08/09.svg: geen
     overlap, en per indeling een eigen kadermaat. Alle drie beginnen op
     y = 204,29 en eindigen op y = 1017,73. */

  {
    id: 'variant-4',
    naam: 'Variant 4',
    frames: [
      { x:  68.78, y: 204.29, w: 527.47, h: 395.61 }, // linksboven, liggend
      { x: 620.33, y: 204.30, w: 390.90, h: 813.44 }, // rechts, hoog staand
      { x:  68.78, y: 622.12, w: 527.47, h: 395.61 }, // linksonder, liggend
    ],
  },
  {
    id: 'variant-5',
    naam: 'Variant 5',
    frames: [
      { x:  61.64, y: 204.29, w: 465.29, h: 455.27 }, // linksboven, bijna vierkant
      { x: 553.07, y: 204.29, w: 465.29, h: 455.27 }, // rechtsboven, bijna vierkant
      { x:  61.64, y: 682.25, w: 956.73, h: 335.48 }, // onder, breed
    ],
  },
  {
    id: 'variant-6',
    naam: 'Variant 6',
    frames: [
      { x:  68.77, y: 204.29, w: 390.90, h: 813.44 }, // links, hoog staand
      { x: 483.76, y: 204.29, w: 527.47, h: 395.61 }, // rechtsboven, liggend
      { x: 483.76, y: 622.12, w: 527.47, h: 395.61 }, // rechtsonder, liggend
    ],
  },
];

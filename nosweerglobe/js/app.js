// NOS Weerglobe — tekent een draaibare aardbol in NOS-stijl met een kleurlaag
// (temperatuur, neerslag, …) en bewegende windlijnen.
//
// Opbouw van het beeld, van onder naar boven:
//   canvas #kaart     achtergrond, zee + dieptes, land, kleurlaag, grenzen
//   canvas #deeltjes  de windlijnen (worden elk beeldje een stukje verder getekend)
//   canvas #etiketten labels van de isobaren (H, L en drukwaarden)
//   canvas #plaatsen  steden met bewegend weericoon, temperaturen en naam
// Beide zijn intern 1920 × 1920; de browser schaalt ze naar het scherm.

import { LAGEN, STIJL } from './lagen.js';

const B = 1920;                 // breedte en hoogte van het beeld
const MIDDEN = B / 2;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const BEGIN = { lon: 9, lat: 47.65, R: 525 };   // beginstand, zoals in de basis-SVG
const AANTAL_DEELTJES = 3500;
const MAX_LEEFTIJD = 110;       // beeldjes dat een windlijn leeft

const $ = (id) => document.getElementById(id);
const kaart = $('kaart');
const ctx = kaart.getContext('2d');
const dctx = $('deeltjes').getContext('2d');
const stage = $('stage');

const zicht = { ...BEGIN };     // middelpunt van de bol (graden) en straal (pixels)
let as = {};                    // de drie assen van het beeld, zie rekenAssen()
const projectie = d3.geoOrthographic().translate([MIDDEN, MIDDEN]).clipAngle(90).precision(0.4);
const pad = d3.geoPath(projectie, ctx);

const geo = { land: null, landGrof: null, grenzen: null, grenzenGrof: null, dieptes: null, dieptesGrof: null, meren: null };
let index = null;               // inhoud van data/index.json
const rasters = new Map();      // bestandsnaam -> geladen raster
let laag = null;                // { meta, raster, lut } van de gekozen kleurlaag
let wind = null;                // { meta, u, v, snelheid }
let sleept = false;

// ---------------------------------------------------------------- projectie

// Orthografisch: we kijken van oneindig ver recht op de bol. Elk punt op de bol
// is een vector (X, Y, Z); het beeld heeft een as naar rechts (e), omhoog (n)
// en naar de kijker toe (c).
function rekenAssen() {
  const l = zicht.lon * RAD, f = zicht.lat * RAD;
  const sl = Math.sin(l), cl = Math.cos(l), sf = Math.sin(f), cf = Math.cos(f);
  as = { ex: -sl, ey: cl, nx: -sf * cl, ny: -sf * sl, nz: cf, cx: cf * cl, cy: cf * sl, cz: sf };
  projectie.rotate([-zicht.lon, -zicht.lat]).scale(zicht.R);
}

// beeldpunt -> [lengte, breedte], of null buiten de bol
function naarLonLat(x, y) {
  const px = (x - MIDDEN) / zicht.R, py = (MIDDEN - y) / zicht.R;
  const d = px * px + py * py;
  if (d > 1) return null;
  const pz = Math.sqrt(1 - d);
  const X = px * as.ex + py * as.nx + pz * as.cx;
  const Y = px * as.ey + py * as.ny + pz * as.cy;
  const Z = py * as.nz + pz * as.cz;
  return [Math.atan2(Y, X) * DEG, Math.asin(Z) * DEG];
}

// [lengte, breedte] -> beeldpunt in sx, sy; geeft false aan de achterkant van de bol
let sx = 0, sy = 0;
function naarBeeld(lon, lat) {
  const l = lon * RAD, f = lat * RAD, cf = Math.cos(f);
  const X = cf * Math.cos(l), Y = cf * Math.sin(l), Z = Math.sin(f);
  if (X * as.cx + Y * as.cy + Z * as.cz <= 0) return false;
  sx = MIDDEN + zicht.R * (X * as.ex + Y * as.ey);
  sy = MIDDEN - zicht.R * (X * as.nx + Y * as.ny + Z * as.nz);
  return true;
}

// ---------------------------------------------------------------- rasters

// Waarde op een willekeurige plek, vloeiend tussen de vier omliggende rasterpunten.
function monster(r, d, lon, lat) {
  let gx = (lon - r.lon0) / r.dx;
  let gy = (lat - r.lat0) / r.dy;
  if (r.regionaal) {                             // raster van een deel van de wereld (radar)
    if (gx < 0) gx += 360 / r.dx;                // lengte -180…180 of 0…360: beide goed
    if (gx > r.nx - 1 || gy < 0 || gy > r.ny - 1) return NaN;   // erbuiten: geen waarde
  }
  gx -= Math.floor(gx / r.nx) * r.nx;            // rondom de aarde doorlopen
  if (gy < 0) gy = 0; else if (gy > r.ny - 1) gy = r.ny - 1;
  const x0 = gx | 0, y0 = gy | 0;
  const x1 = (x0 + 1) % r.nx, y1 = y0 + 1 < r.ny ? y0 + 1 : y0;
  const fx = gx - x0, fy = gy - y0;
  const boven = d[y0 * r.nx + x0] * (1 - fx) + d[y0 * r.nx + x1] * fx;
  const onder = d[y1 * r.nx + x0] * (1 - fx) + d[y1 * r.nx + x1] * fx;
  return boven * (1 - fy) + onder * fy;
}

// Strijkt een raster glad: elk punt wordt het gemiddelde van zichzelf en zijn
// acht buren, 'keer' maal achter elkaar. Het resultaat komt terug in d.
function strijkGlad(d, nx, ny, keer) {
  let a = d, b = new Float32Array(d.length);
  for (let n = 0; n < keer; n++) {
    for (let y = 0; y < ny; y++) {
      const y0 = (y > 0 ? y - 1 : y) * nx, y1 = y * nx, y2 = (y < ny - 1 ? y + 1 : y) * nx;
      for (let x = 0; x < nx; x++) {
        const l = (x + nx - 1) % nx, r = (x + 1) % nx;
        b[y1 + x] = (a[y0 + l] + a[y0 + x] + a[y0 + r] + a[y1 + l] + a[y1 + x] + a[y1 + r]
          + a[y2 + l] + a[y2 + x] + a[y2 + r]) / 9;
      }
    }
    [a, b] = [b, a];
  }
  if (a !== d) d.set(a);
}

const naarGetallen = (lijst) => Float32Array.from(lijst, (w) => (w == null ? NaN : w));

async function laadRaster(meta, bestand = meta.bestand) {
  if (!rasters.has(bestand)) {
    const j = await (await fetch('data/' + bestand, { cache: 'no-cache' })).json();
    const r = { nx: j.nx, ny: j.ny, lon0: j.lon0, lat0: j.lat0, dx: j.dx, dy: j.dy, regionaal: !!j.regionaal };
    if (j.soort === 'vector') {
      r.u = naarGetallen(j.u);
      r.v = naarGetallen(j.v);
      r.snelheid = r.u.map((u, i) => Math.hypot(u, r.v[i]));
    } else {
      r.waarden = naarGetallen(j.waarden);
    }
    rasters.set(bestand, r);
  }
  return rasters.get(bestand);
}

// ---------------------------------------------------------------- kleuren

// Maakt van een kleurschaal een opzoektabel van 1024 kleuren tussen min en max.
function maakLut(schaal) {
  const stops = schaal.map(([w, hex, a = 1]) => {
    const n = parseInt(hex.slice(1), 16);
    return [w, n >> 16, (n >> 8) & 255, n & 255, a * 255];
  });
  const min = stops[0][0], max = stops[stops.length - 1][0];
  const tabel = new Uint32Array(1024);
  let s = 0;
  for (let i = 0; i < 1024; i++) {
    const w = min + (max - min) * i / 1023;
    while (s < stops.length - 2 && w > stops[s + 1][0]) s++;
    const a = stops[s], b = stops[s + 1];
    const t = Math.min(1, Math.max(0, (w - a[0]) / (b[0] - a[0])));
    const k = (n) => Math.round(a[n] + (b[n] - a[n]) * t);
    tabel[i] = ((k(4) << 24) | (k(3) << 16) | (k(2) << 8) | k(1)) >>> 0;   // volgorde ABGR
  }
  return { min, max, tabel };
}

// ---------------------------------------------------------------- tekenen

const lapje = document.createElement('canvas');   // de kleurlaag op lagere resolutie

function tekenKleurlaag(maat) {
  lapje.width = lapje.height = maat;
  const lctx = lapje.getContext('2d');
  const beeld = lctx.createImageData(maat, maat);
  const px = new Uint32Array(beeld.data.buffer);
  const { raster, lut } = laag;
  const d = laag.waarden;
  const stap = B / maat;
  const factor = 1023 / (lut.max - lut.min);
  // alleen het vierkant rond de bol doorlopen
  const van = Math.max(0, Math.floor((MIDDEN - zicht.R) / stap));
  const tot = Math.min(maat, Math.ceil((MIDDEN + zicht.R) / stap));
  for (let j = van; j < tot; j++) {
    for (let i = van; i < tot; i++) {
      const p = naarLonLat((i + 0.5) * stap, (j + 0.5) * stap);
      if (!p) continue;
      const w = monster(raster, d, p[0], p[1]);
      if (w !== w) continue;                       // geen waarde (NaN)
      let n = (w - lut.min) * factor;
      n = n < 0 ? 0 : n > 1023 ? 1023 : n | 0;
      px[j * maat + i] = lut.tabel[n];
    }
  }
  lctx.putImageData(beeld, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.arc(MIDDEN, MIDDEN, zicht.R, 0, 2 * Math.PI);
  ctx.clip();
  ctx.globalAlpha = $('dekking').value / 100;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lapje, 0, 0, B, B);
  ctx.restore();
}

// ---- beeldlagen: een wereldkaart als plaatje (reliëf, satellietwolken)

let relief = null, wolken = null;   // { w, h, d: grijswaarde per pixel, … }

// Reliëf: 206 is in het Natural Earth-beeld 'vlak'. Donkerder wordt een
// zwarte schaduw, lichter een wit lichtje; vlak land blijft onaangeroerd.
const RELIEF_TABEL = new Uint32Array(256).map((_, v) => {
  if (v < 206) return (Math.round(Math.min(1, (206 - v) / 90) * 105) << 24) >>> 0;
  return ((Math.round(Math.min(1, (v - 206) / 49) * 70) << 24) | 0xffffff) >>> 0;
});

// Wolken: infraroodbeeld, hoe kouder (= hoger wolkendek) hoe lichter. Onder een
// drempel is het aardoppervlak te zien en tekenen we niets; 0 = geen opname.
const WOLKEN_TABEL = new Uint32Array(256).map((_, v) => {
  const t = Math.min(1, Math.max(0, (v - 100) / 110));
  return ((Math.round(Math.pow(t, 1.15) * 240) << 24) | 0xffffff) >>> 0;
});

function laadBeeld(url) {
  return new Promise((klaar, mislukt) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const cctx = c.getContext('2d', { willReadFrequently: true });
      cctx.drawImage(img, 0, 0);
      const rgba = cctx.getImageData(0, 0, c.width, c.height).data;
      const d = new Uint8Array(c.width * c.height);
      for (let i = 0; i < d.length; i++) d[i] = rgba[i * 4];
      klaar({ w: c.width, h: c.height, d });
    };
    img.onerror = mislukt;
    img.src = url;
  });
}

// Tekent een wereldkaart-plaatje (lengte -180…180, breedte 90…-90) op de bol.
// knip() geeft het pad waarbinnen getekend mag worden.
function tekenBeeldlaag(beeld, tabel, maat, knip) {
  lapje.width = lapje.height = maat;
  const lctx = lapje.getContext('2d');
  const uit = lctx.createImageData(maat, maat);
  const px = new Uint32Array(uit.data.buffer);
  const { w, h, d } = beeld;
  const stap = B / maat, R = zicht.R;
  const van = Math.max(0, Math.floor((MIDDEN - R) / stap));
  const tot = Math.min(maat, Math.ceil((MIDDEN + R) / stap));
  for (let j = van; j < tot; j++) {
    const py = (MIDDEN - (j + 0.5) * stap) / R;
    for (let i = van; i < tot; i++) {
      const pxx = ((i + 0.5) * stap - MIDDEN) / R;
      const afstand = pxx * pxx + py * py;
      if (afstand > 1) continue;
      const pz = Math.sqrt(1 - afstand);
      const X = pxx * as.ex + py * as.nx + pz * as.cx;
      const Y = pxx * as.ey + py * as.ny + pz * as.cy;
      const Z = py * as.nz + pz * as.cz;
      // vloeiend tussen de vier omliggende pixels van het plaatje
      let u = (Math.atan2(Y, X) / Math.PI + 1) / 2 * w - 0.5;
      let v = (0.5 - Math.asin(Z) / Math.PI) * h - 0.5;
      if (u < 0) u += w;
      if (v < 0) v = 0; else if (v > h - 1) v = h - 1;
      const u0 = u | 0, v0 = v | 0, u1 = (u0 + 1) % w, v1 = v0 + 1 < h ? v0 + 1 : v0;
      const fu = u - u0, fv = v - v0;
      const boven = d[v0 * w + u0] * (1 - fu) + d[v0 * w + u1] * fu;
      const onder = d[v1 * w + u0] * (1 - fu) + d[v1 * w + u1] * fu;
      px[j * maat + i] = tabel[(boven * (1 - fv) + onder * fv + 0.5) | 0];
    }
  }
  lctx.putImageData(uit, 0, 0);
  ctx.save();
  ctx.beginPath();
  knip();
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lapje, 0, 0, B, B);
  ctx.restore();
}

// ---- satellietkaart: een kleurenfoto van de aarde als ondergrond

// De foto is bewerkt voor leesbaarheid van wat eroverheen komt:
// - wit:   het lichtste punt (ijs, woestijn) wordt teruggebracht tot deze waarde.
//          Bij 146 haalt een witte lijn of letter overal minstens 3 : 1; nu
//          staat hij hoger omdat het beeld anders te vlak wordt (op ijs en
//          woestijn is wit dan ongeveer 1,9 : 1).
// - zwart: het donkerste punt (diepe oceaan) wordt opgetild, zodat de zee niet dichtloopt
// - gamma: kleiner dan 1 maakt de middentonen lichter (meer tekening in het land)
// - kleur: 1 = de kleuren van de foto, 0 = zwart-wit
const SATELLIET = { zwart: 10, wit: 190, gamma: 0.9, kleur: 0.92 };
const SATELLIET_TOON = new Uint8Array(256).map((_, v) =>
  SATELLIET.zwart + Math.pow(v / 255, SATELLIET.gamma) * (SATELLIET.wit - SATELLIET.zwart));
let satelliet = null;   // { w, h, px: kleur per pixel }, pas geladen als de keuze aan gaat

function laadSatelliet() {
  return new Promise((klaar, mislukt) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const cctx = c.getContext('2d', { willReadFrequently: true });
      cctx.drawImage(img, 0, 0);
      const data = cctx.getImageData(0, 0, c.width, c.height).data;
      klaar({ w: c.width, h: c.height, px: new Uint32Array(data.buffer) });
    };
    img.onerror = mislukt;
    img.src = 'geo/satelliet.jpg';
  });
}

function tekenSatelliet(maat) {
  lapje.width = lapje.height = maat;
  const lctx = lapje.getContext('2d');
  const uit = lctx.createImageData(maat, maat);
  const px = new Uint32Array(uit.data.buffer);
  const { w, h, px: d } = satelliet;
  const stap = B / maat, R = zicht.R;
  const van = Math.max(0, Math.floor((MIDDEN - R) / stap));
  const tot = Math.min(maat, Math.ceil((MIDDEN + R) / stap));
  for (let j = van; j < tot; j++) {
    const py = (MIDDEN - (j + 0.5) * stap) / R;
    for (let i = van; i < tot; i++) {
      const pxx = ((i + 0.5) * stap - MIDDEN) / R;
      const afstand = pxx * pxx + py * py;
      if (afstand > 1) continue;
      const pz = Math.sqrt(1 - afstand);
      const X = pxx * as.ex + py * as.nx + pz * as.cx;
      const Y = pxx * as.ey + py * as.ny + pz * as.cy;
      const Z = py * as.nz + pz * as.cz;
      let u = (Math.atan2(Y, X) / Math.PI + 1) / 2 * w - 0.5;
      let v = (0.5 - Math.asin(Z) / Math.PI) * h - 0.5;
      if (u < 0) u += w;
      if (v < 0) v = 0; else if (v > h - 1) v = h - 1;
      const u0 = u | 0, v0 = v | 0, u1 = (u0 + 1) % w, v1 = v0 + 1 < h ? v0 + 1 : v0;
      const fu = u - u0, fv = v - v0;
      const a = d[v0 * w + u0], b = d[v0 * w + u1], c = d[v1 * w + u0], e = d[v1 * w + u1];
      // per kleur (rood, groen, blauw) vloeiend tussen de vier omliggende pixels
      const g0 = (1 - fu) * (1 - fv), g1 = fu * (1 - fv), g2 = (1 - fu) * fv, g3 = fu * fv;
      const rood = (a & 255) * g0 + (b & 255) * g1 + (c & 255) * g2 + (e & 255) * g3;
      const groen = (a >> 8 & 255) * g0 + (b >> 8 & 255) * g1 + (c >> 8 & 255) * g2 + (e >> 8 & 255) * g3;
      const blauw = (a >> 16 & 255) * g0 + (b >> 16 & 255) * g1 + (c >> 16 & 255) * g2 + (e >> 16 & 255) * g3;
      // toon aanpassen (zie SATELLIET_TOON) en de kleur iets richting grijs
      const tr = SATELLIET_TOON[rood | 0], tg = SATELLIET_TOON[groen | 0], tb = SATELLIET_TOON[blauw | 0];
      const grijs = 0.3 * tr + 0.59 * tg + 0.11 * tb;
      px[j * maat + i] = (0xff000000
        | ((grijs + (tb - grijs) * SATELLIET.kleur) << 16)
        | ((grijs + (tg - grijs) * SATELLIET.kleur) << 8)
        | (grijs + (tr - grijs) * SATELLIET.kleur)) >>> 0;
    }
  }
  lctx.putImageData(uit, 0, 0);
  ctx.save();
  ctx.beginPath();
  ctx.arc(MIDDEN, MIDDEN, R, 0, 2 * Math.PI);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lapje, 0, 0, B, B);
  ctx.restore();
}

function tekenAchtergrond() {
  ctx.fillStyle = STIJL.ruimte;
  ctx.fillRect(0, 0, B, B);
  const doorzichtig = STIJL.ruimteVerloop + '00';
  const onder = ctx.createLinearGradient(0, 932, 0, B);
  onder.addColorStop(0, doorzichtig);
  onder.addColorStop(1, STIJL.ruimteVerloop);
  ctx.fillStyle = onder;
  ctx.fillRect(0, 932, B, B - 932);
  const boven = ctx.createLinearGradient(0, 1670, 0, 0);
  boven.addColorStop(0, doorzichtig);
  boven.addColorStop(1, STIJL.ruimteVerloop);
  ctx.fillStyle = boven;
  ctx.fillRect(0, 0, B, 1670);
}

// De ondergrond (ruimte, zee, dieptes, land, reliëf, meren) verandert alleen als
// het beeld draait of zoomt. Het scherpe resultaat bewaren we, zodat een
// nieuwe tijdstap of andere laag niet alles opnieuw hoeft te tekenen.
const basis = document.createElement('canvas');
basis.width = basis.height = B;
let basisKlopt = false;

function tekenBasis(snel) {
  tekenAchtergrond();

  // zachte gloed achter de bol: licht aan de rand, uitlopend naar niets
  const R = zicht.R;
  const gloed = ctx.createRadialGradient(MIDDEN, MIDDEN, R * 0.9, MIDDEN, MIDDEN, R * 1.28);
  gloed.addColorStop(0, 'rgba(225, 242, 255, 0.55)');
  gloed.addColorStop(0.35, 'rgba(225, 242, 255, 0.22)');
  gloed.addColorStop(1, 'rgba(225, 242, 255, 0)');
  ctx.fillStyle = gloed;
  ctx.beginPath();
  ctx.arc(MIDDEN, MIDDEN, R * 1.28, 0, 2 * Math.PI);
  ctx.fill();
  if (satelliet && $('satelliet').checked) {    // de foto vervangt zee, land en reliëf
    tekenSatelliet(snel ? 480 : B);
    return;
  }

  ctx.beginPath();
  ctx.arc(MIDDEN, MIDDEN, zicht.R, 0, 2 * Math.PI);
  ctx.fillStyle = STIJL.water;
  ctx.fill();

  const dieptes = snel ? geo.dieptesGrof : geo.dieptes || geo.dieptesGrof;
  if (dieptes) {
    for (const [diepte, vorm] of dieptes) {
      ctx.beginPath();
      pad(vorm);
      ctx.fillStyle = STIJL.dieptes[diepte];
      ctx.fill();
    }
  }

  const land = snel ? geo.landGrof : geo.land || geo.landGrof;
  if (land) {
    ctx.beginPath();
    pad(land);
    ctx.fillStyle = STIJL.land;
    ctx.fill();
    const nederland = snel ? geo.nederlandGrof : geo.nederland || geo.nederlandGrof;
    if (nederland) {            // Nederland lichter dan de rest van het land
      ctx.beginPath();
      pad(nederland);
      ctx.fillStyle = STIJL.nederland;
      ctx.fill();
    }
    if (relief && $('relief').checked) {
      tekenBeeldlaag(relief, RELIEF_TABEL, snel ? 480 : B, () => pad(land));
    }
    if (geo.meren) {            // onder meer het IJsselmeer
      ctx.beginPath();
      pad(geo.meren);
      ctx.fillStyle = STIJL.water;
      ctx.fill();
    }
  }
}

const grenslaag = document.createElement('canvas');
grenslaag.width = grenslaag.height = B;
let grenzenKloppen = null;      // null = opnieuw tekenen; anders: was er een kleurlaag?

function tekenGrenzen(c, land, grenzen) {
  // op de donkere satellietfoto zijn donkere grenzen niet te zien: daar licht
  c.strokeStyle = satelliet && $('satelliet').checked ? 'rgba(255, 255, 255, 0.6)' : STIJL.grens;
  c.lineJoin = 'round';
  if (laag) {                   // onder een kleurlaag is de kust anders niet te zien
    c.beginPath();
    pad(land);
    c.lineWidth = 1.2;
    c.stroke();
  }
  if (!$('grenzen').checked) return;
  c.beginPath();
  pad(grenzen);
  c.lineWidth = 1.4;
  c.stroke();
}

// snel = tijdens slepen: grove kaart en dieptes, kleurlaag op lage resolutie
// film = tijdens afspelen: scherpe ondergrond uit de tussenopslag, kleurlaag grover
function tekenKaart(snel, film = false) {
  rekenAssen();
  if (!snel && basisKlopt) {
    ctx.drawImage(basis, 0, 0);
  } else {
    tekenBasis(snel);
    if (!snel) {
      basis.getContext('2d').drawImage(kaart, 0, 0);
      basisKlopt = true;
    }
  }
  const land = snel ? geo.landGrof : geo.land || geo.landGrof;

  if (laag) tekenKleurlaag(snel ? 384 : film ? 480 : 960);
  // het satellietbeeld is één opname: alleen tonen bij het eerste tijdstip
  if (wolken && $('wolken').checked && tijd.pos < 0.01) {
    tekenBeeldlaag(wolken, WOLKEN_TABEL, snel ? 384 : 1280,
      () => ctx.arc(MIDDEN, MIDDEN, zicht.R, 0, 2 * Math.PI));
  }

  const grenzen = snel ? geo.grenzenGrof : geo.grenzen || geo.grenzenGrof;
  if (land && grenzen) {
    if (snel) {
      tekenGrenzen(ctx, land, grenzen);
    } else {
      // ook de scherpe grenzen bewaren we; ze veranderen alleen met het beeld
      if (grenzenKloppen !== !!laag) {
        const gctx = grenslaag.getContext('2d');
        gctx.clearRect(0, 0, B, B);
        pad.context(gctx);
        tekenGrenzen(gctx, land, grenzen);
        pad.context(ctx);
        grenzenKloppen = !!laag;
      }
      ctx.drawImage(grenslaag, 0, 0);
    }
  }

  ectx.clearRect(0, 0, B, B);
  vast = meetTijdlabel();   // het vaste label gaat voor alles: andere labels wijken ervoor
  plaatsSteden();   // eerst de steden: die hebben voorrang op de labels van de isobaren
  if (druk && $('isobaren').checked) tekenIsobaren(snel, film);
  tekenTijdlabel();
}

// ---------------------------------------------------------------- dag en tijd

// Vast label met dag (wit vlak) en tijd in hele uren (donker vlak), links in
// beeld op twee derde van de hoogte, zoals in het weerbericht.
const TIJDLABEL = { x: 110, y: Math.round(B / 3), hoogte: 76 };
let vast = null;   // { dag, uur, bDag, bUur, kader } of null als het label uit staat

function meetTijdlabel() {
  // een laag met één eigen tijdstip (radar, satelliet) bepaalt zelf wat het label toont
  const eigenTijd = laag && !(laag.meta.stappen && laag.meta.stappen.length > 1);
  const nu = eigenTijd ? new Date(laag.meta.tijd) : huidigeTijd();
  if (!nu || !$('tijdlabel').checked) return null;
  const heelUur = new Date(Math.round(nu.getTime() / 36e5) * 36e5);
  const dag = heelUur.toLocaleDateString('nl-NL', { weekday: 'long' });
  const uur = String(heelUur.getHours()).padStart(2, '0') + ':00';
  const { x, y, hoogte } = TIJDLABEL;
  ectx.font = `600 ${Math.round(hoogte * 0.7)}px "Effra CC", sans-serif`;
  const bDag = Math.ceil(ectx.measureText(dag).width + hoogte * 0.7);
  const bUur = Math.ceil(ectx.measureText('00:00').width + hoogte * 0.7);   // vaste breedte
  return { dag, uur, bDag, bUur, kader: [x - 12, y - hoogte / 2 - 12, x + bDag + bUur + 12, y + hoogte / 2 + 12] };
}

function tekenTijdlabel() {
  if (!vast) return;
  const { x, y, hoogte } = TIJDLABEL;
  ectx.font = `600 ${Math.round(hoogte * 0.7)}px "Effra CC", sans-serif`;
  ectx.textAlign = 'center';
  ectx.textBaseline = 'middle';
  ectx.fillStyle = '#fff';
  ectx.fillRect(x, y - hoogte / 2, vast.bDag, hoogte);
  ectx.fillStyle = '#1c1c1c';
  ectx.fillText(vast.dag, x + vast.bDag / 2, y + hoogte * 0.03);
  ectx.fillStyle = 'rgba(0, 0, 0, 0.4)';     // zwart, 60% doorzichtig
  ectx.fillRect(x + vast.bDag, y - hoogte / 2, vast.bUur, hoogte);
  ectx.fillStyle = '#fff';
  ectx.fillText(vast.uur, x + vast.bDag + vast.bUur / 2, y + hoogte * 0.03);
}

// ---------------------------------------------------------------- isobaren

let druk = null;   // { lijnen: [{ waarde, vorm }], kernen: [{ lon, lat, waarde, hoog }] }

// Maakt van het luchtdrukraster lijnen van gelijke druk (om de 4 hPa) en zoekt
// de kernen van hoge- en lagedrukgebieden.
let hoogte = null;   // hoogte van het land in meters (geo/hoogte.json), zelfde raster van 1°

function maakIsobaren(r, waarden = r.waarden) {
  const { nx, ny } = r;
  // eerst wat gladstrijken: boven bergen is de druk in het model erg grillig
  let d = Float32Array.from(waarden, (w) => (w === w ? w : 1013));
  for (let keer = 0; keer < 3; keer++) {
    const uit = new Float32Array(d.length);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        let som = 0;
        for (let b = -1; b <= 1; b++) {
          const yy = Math.min(ny - 1, Math.max(0, y + b));
          for (let a = -1; a <= 1; a++) som += d[yy * nx + (x + a + nx) % nx];
        }
        uit[y * nx + x] = som / 9;
      }
    }
    d = uit;
  }

  // een kolom extra (gelijk aan de eerste), zodat de lijnen rond de aarde doorlopen
  const w = nx + 1;
  const veld = new Float64Array(w * ny);
  for (let y = 0; y < ny; y++) for (let x = 0; x < w; x++) veld[y * w + x] = d[y * nx + x % nx];
  let laagste = Infinity, hoogste = -Infinity;
  for (const w0 of d) { if (w0 < laagste) laagste = w0; if (w0 > hoogste) hoogste = w0; }
  const lijnen = d3.contours().size([w, ny]).thresholds(d3.range(Math.ceil(laagste / 4) * 4, hoogste, 4))(veld).map((c) => {
    const stukken = [];
    for (const veelhoek of c.coordinates) {
      for (const ring of veelhoek) {
        let stuk = [];
        for (const [x, y] of ring) {
          // d3 sluit elke vorm langs de rand van het raster; die stukken horen er niet bij
          if (x < 0.25 || x > w - 0.25 || y < 0.25 || y > ny - 0.25) {
            if (stuk.length > 1) stukken.push(stuk);
            stuk = [];
          } else {
            stuk.push([r.lon0 + (x - 0.5) * r.dx, r.lat0 + (y - 0.5) * r.dy]);
          }
        }
        if (stuk.length > 1) stukken.push(stuk);
      }
    }
    return { waarde: c.value, vorm: { type: 'MultiLineString', coordinates: stukken } };
  }).filter((l) => l.vorm.coordinates.length);

  // kernen: de hoogste of laagste waarde in een ruime omgeving (± 10°)
  const kernen = [];
  for (let y = 11; y < ny - 11; y++) {
    const breed = Math.min(60, Math.round(10 / Math.cos((r.lat0 + y * r.dy) * RAD)));
    for (let x = 0; x < nx; x++) {
      const w0 = d[y * nx + x];
      const hoog = w0 >= 1020, laag = w0 <= 1004;
      if (!hoog && !laag) continue;
      // Boven hoog terrein (Groenland, Tibet, Antarctica) is de 'druk op
      // zeeniveau' een rekensom door het land heen: zulke kernen bestaan niet echt.
      if (hoogte && hoogte.nx === nx && hoogte.waarden[y * nx + x] > 1000) continue;
      let uiterste = true;
      for (let b = -10; b <= 10 && uiterste; b++) {
        for (let a = -breed; a <= breed; a++) {
          const buur = d[(y + b) * nx + (x + a + nx) % nx];
          if (hoog ? buur > w0 : buur < w0) { uiterste = false; break; }
        }
      }
      // bij een vlak stuk met gelijke waarden niet twee keer dezelfde kern
      if (uiterste && !kernen.some((k) => Math.abs(k.lat - (r.lat0 + y * r.dy)) < 8
          && Math.abs(((k.lon - x * r.dx + 540) % 360) - 180) < 8 / Math.cos(k.lat * RAD))) {
        kernen.push({ lon: r.lon0 + x * r.dx, lat: r.lat0 + y * r.dy, waarde: Math.round(w0), hoog });
      }
    }
  }
  druk = { lijnen, kernen };
}

// Een NOS-label: gekleurd vlak met tekst, gecentreerd op (x, y). Labels staan
// op een eigen laag bóven de windlijnen, zodat ze altijd leesbaar blijven.
const ectx = $('etiketten').getContext('2d');
function label(x, y, tekst, vlak, kleur, hoogte, breedte) {
  ectx.font = `600 ${Math.round(hoogte * 0.68)}px "Effra CC", sans-serif`;
  const b = breedte || Math.ceil(ectx.measureText(tekst).width + hoogte * 0.55);
  ectx.fillStyle = vlak;
  ectx.fillRect(Math.round(x - b / 2), Math.round(y - hoogte / 2), b, hoogte);
  ectx.fillStyle = kleur;
  ectx.textAlign = 'center';
  ectx.textBaseline = 'middle';
  ectx.fillText(tekst, x, y + hoogte * 0.04);
  return b;
}

const raakt = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

function tekenIsobaren(snel, film) {
  ctx.save();
  ctx.beginPath();
  for (const l of druk.lijnen) pad(l.vorm);
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = snel || film ? 0 : 5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 2.6;
  ctx.stroke();
  ctx.restore();

  // Labels mogen elkaar nooit raken. Volgorde van voorrang: steden (staan al
  // vast), dan de H- en L-kernen, dan de waarden op de lijnen.
  const bezet = stedenInBeeld.flatMap((s) => s.kaders);
  if (vast) bezet.push(vast.kader);
  const past = (kader) => !bezet.some((b) => raakt(kader, b));
  const inBeeld = (rand) => sx > rand && sx < B - rand && sy > rand && sy < B - rand
    && Math.hypot(sx - MIDDEN, sy - MIDDEN) < zicht.R * 0.94;
  for (const k of druk.kernen) {
    if (!naarBeeld(k.lon, k.lat) || !inBeeld(70)) continue;
    const kader = [sx - 56, sy - 64, sx + 56, sy + 59];
    if (!past(kader)) continue;
    bezet.push(kader);
    label(sx, sy - 30, k.hoog ? 'H' : 'L', k.hoog ? '#e61e14' : '#2a6cb5', '#fff', 50, 50);
    label(sx, sy + 28, String(k.waarde), '#1c1c1c', '#fff', 44);
  }
  // tijdens slepen en afspelen geen waarden op de lijnen: die verspringen dan steeds
  if (snel || film) return;
  const waarden = [];   // middelpunten van al geplaatste waardelabels, voor de spreiding
  for (const l of druk.lijnen) {
    for (const stuk of l.vorm.coordinates) {
      if (stuk.length < 60) continue;       // alleen lange lijnen krijgen een waarde
      // het punt van de lijn dat het dichtst bij het midden van het beeld ligt
      let beste = null, kleinste = Infinity;
      for (let i = 0; i < stuk.length; i += 3) {
        if (!naarBeeld(stuk[i][0], stuk[i][1]) || !inBeeld(60)) continue;
        const afstand = Math.hypot(sx - MIDDEN, sy - MIDDEN);
        if (afstand >= kleinste) continue;
        if (!past([sx - 58, sy - 32, sx + 58, sy + 32])) continue;
        if (waarden.some(([wx, wy]) => Math.hypot(wx - sx, wy - sy) < 620)) continue;
        kleinste = afstand;
        beste = [sx, sy];
      }
      if (beste) {
        waarden.push(beste);
        bezet.push([beste[0] - 58, beste[1] - 32, beste[0] + 58, beste[1] + 32]);
        label(beste[0], beste[1], String(l.waarde), '#1c1c1c', '#fff', 44);
      }
    }
  }
}

// ---------------------------------------------------------------- steden

// Elke stad krijgt een bewegend weericoon met rechts ernaast minimum (donker)
// en maximum (wit) en daaronder de plaatsnaam, zoals in 'plinth assets NOS.psd'.
// De iconen staan in iconen/<naam>.png: 100 beeldjes van 180 px in een raster
// van 10 × 10, af te spelen met 25 beeldjes per seconde.
const pctx = $('plaatsen').getContext('2d');
const ICOON = 138, VAK = 46, DONKER = '#1c1c1c';
let steden = [];            // uit data/steden.json
let stedenInBeeld = [];     // wat er bij deze stand getekend wordt, met plek en maten
const plaatjes = new Map(); // naam van het icoon -> Image
let vorigBeeldje = -1;

function plaatje(naam) {
  if (!plaatjes.has(naam)) {
    const img = new Image();
    img.onload = () => { vorigBeeldje = -1; };
    img.src = `iconen/${naam}.png`;
    plaatjes.set(naam, img);
  }
  return plaatjes.get(naam);
}

// Bepaalt na elke verandering van het beeld welke steden passen. Steden die
// eerder in de lijst staan gaan voor; wie een ander zou overlappen valt af.
function plaatsSteden() {
  stedenInBeeld = [];
  vorigBeeldje = -1;
  if (!$('steden').checked) return;
  pctx.font = `600 ${Math.round(VAK * 0.68)}px "Effra CC", sans-serif`;
  const breed = (tekst) => Math.ceil(pctx.measureText(tekst).width + VAK * 0.5);
  for (const stad of steden) {
    if (!naarBeeld(stad.lon, stad.lat)) continue;
    if (Math.hypot(sx - MIDDEN, sy - MIDDEN) > zicht.R * 0.97) continue;
    const s = {
      ...stad, x: Math.round(sx), y: Math.round(sy),
      bMin: breed(String(stad.min)), bMax: breed(String(stad.max)), bNaam: breed(stad.naam),
    };
    const links = s.x - ICOON / 2, boven = s.y - ICOON / 2;
    const rechts = s.x + ICOON / 2 + 6 + Math.max(s.bMin + s.bMax, s.bNaam);
    const onder = s.y + VAK * 1.5 + 8;
    if (links < 0 || rechts > B || boven < 0 || onder > B) continue;   // alleen als het hele label past
    // Twee kaders per stad: het icoon en het blok met getallen en naam. Zo telt
    // de lege hoek onder het icoon niet mee en passen er meer steden naast elkaar.
    const lx = s.x + ICOON / 2 + 6;
    s.kaders = [
      [links - 6, boven - 6, s.x + ICOON / 2 + 6, s.y + ICOON / 2 + 6],
      [lx - 6, s.y - VAK / 2 - 6, rechts + 6, onder + 6],
    ];
    if (vast && s.kaders.some((k) => raakt(k, vast.kader))) continue;
    if (stedenInBeeld.some((ander) => s.kaders.some((k) => ander.kaders.some((a) => raakt(k, a))))) continue;
    stedenInBeeld.push(s);
  }
}

function tekenSteden(nu) {
  const beeldje = Math.floor(nu / 40) % 100;      // 25 beeldjes per seconde
  if (beeldje === vorigBeeldje) return;
  vorigBeeldje = beeldje;
  pctx.clearRect(0, 0, B, B);
  pctx.font = `600 ${Math.round(VAK * 0.68)}px "Effra CC", sans-serif`;
  pctx.textAlign = 'center';
  pctx.textBaseline = 'middle';
  const vak = (x, y, b, tekst, vlak, kleur) => {
    pctx.fillStyle = vlak;
    pctx.fillRect(x, y - VAK / 2, b, VAK);
    pctx.fillStyle = kleur;
    pctx.fillText(tekst, x + b / 2, y + VAK * 0.04);
  };
  for (const s of stedenInBeeld) {
    const img = plaatje(s.icoon);
    if (img.complete && img.naturalWidth) {
      pctx.drawImage(img, (beeldje % 10) * 180, Math.floor(beeldje / 10) * 180, 180, 180,
        s.x - ICOON / 2, s.y - ICOON / 2, ICOON, ICOON);
    }
    const x = s.x + ICOON / 2 + 6;
    vak(x, s.y, s.bMin, String(s.min), DONKER, '#fff');
    vak(x + s.bMin, s.y, s.bMax, String(s.max), '#fff', DONKER);
    vak(x, s.y + VAK + 8, s.bNaam, s.naam, '#fff', DONKER);
  }
}

let tekenWacht = 0, scherpWacht = 0;
// Na een verandering: meteen een snel beeld, en zodra het stil is een scherp beeld.
function ververs() {
  basisKlopt = false;
  grenzenKloppen = null;
  dctx.clearRect(0, 0, B, B);
  if (!tekenWacht) {
    tekenWacht = requestAnimationFrame(() => { tekenWacht = 0; tekenKaart(true); });
  }
  clearTimeout(scherpWacht);
  scherpWacht = setTimeout(() => { tekenKaart(false); herplaatsDeeltjes(); }, 180);
}

// ---------------------------------------------------------------- tijdlijn

// De GFS-lagen hebben een reeks tijdstappen (om de 3 uur). tijd.pos is de plek
// in die reeks en mag tussen twee stappen in liggen: dan mengen we de twee
// rasters, zodat het weer vloeiend verschuift in plaats van te verspringen.
const tijd = { stappen: [], pos: 0, speelt: false };
const reeksen = new Map();      // id van de laag -> rasters per tijdstap
const STAPPEN_PER_SECONDE = 0.5;  // afspeelsnelheid: een halve stap = 1,5 uur weer per seconde
let drukRaster = null, drukWaarden = null;

function huidigeTijd() {
  const n = tijd.stappen.length;
  if (!n) return null;
  const i = Math.min(n - 1, Math.floor(tijd.pos));
  const a = Date.parse(tijd.stappen[i]), b = Date.parse(tijd.stappen[Math.min(n - 1, i + 1)]);
  return new Date(a + (b - a) * (tijd.pos - i));
}

async function laadReeks(meta) {
  if (!reeksen.has(meta.id)) {
    const perTijd = new Map(meta.stappen.map((s) => [s.tijd, s.bestand]));
    reeksen.set(meta.id, await Promise.all(tijd.stappen.map((t) =>
      (perTijd.has(t) ? laadRaster(meta, perTijd.get(t)).catch(() => null) : null))));
  }
  return reeksen.get(meta.id);
}

// Laadt alle tijdstappen van de lagen die nu in beeld zijn (eenmalig per laag).
async function laadReeksen() {
  const nodig = ['wind', 'luchtdruk', laag && laag.meta.id]
    .map((id) => index.lagen.find((l) => l.id === id))
    .filter((meta) => meta && meta.stappen && meta.stappen.length > 1 && !reeksen.has(meta.id));
  if (!nodig.length) return;
  melding('Tijdstappen laden…', 'melding wacht');
  await Promise.all(nodig.map(laadReeks));
  melding('');
}

function meng(reeks, veld, uit) {
  const i = Math.min(reeks.length - 1, Math.floor(tijd.pos)), f = tijd.pos - i;
  const a = reeks[i] && reeks[i][veld];
  const volgende = reeks[Math.min(reeks.length - 1, i + 1)];
  const b = (volgende && volgende[veld]) || a;
  if (!a) return;
  if (f === 0 || a === b) uit.set(a);
  else for (let k = 0; k < uit.length; k++) uit[k] = a[k] + (b[k] - a[k]) * f;
}

// Zet alle lagen op tijd.pos en tekent opnieuw.
function toonTijd(film) {
  const w = reeksen.get('wind');
  if (w && wind) {
    meng(w, 'u', wind.u);
    meng(w, 'v', wind.v);
    for (let k = 0; k < wind.u.length; k++) wind.snelheid[k] = Math.hypot(wind.u[k], wind.v[k]);
  }
  if (laag && laag.eigen && reeksen.has(laag.meta.id)) {
    meng(reeksen.get(laag.meta.id), 'waarden', laag.waarden);
    if (laag.glad) strijkGlad(laag.waarden, laag.raster.nx, laag.raster.ny, laag.glad);
  }
  if (drukRaster && reeksen.has('luchtdruk') && $('isobaren').checked) {
    meng(reeksen.get('luchtdruk'), 'waarden', drukWaarden);
    maakIsobaren(drukRaster, drukWaarden);
  }
  const nu = huidigeTijd();
  $('tijdstip').textContent = nu ? nu.toLocaleString('nl-NL',
    { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  $('tijdschuif').value = tijd.pos;
  toonBron();
  tekenKaart(false, film);
}

function speel(aan) {
  tijd.speelt = aan;
  $('speel').textContent = aan ? '❚❚ Pauze' : '▶ Afspelen';
  if (!aan) toonTijd(false);     // bij stilstaan weer het scherpe beeld
}

// ---------------------------------------------------------------- windlijnen

const deeltjes = new Float32Array(AANTAL_DEELTJES * 3);   // lengte, breedte, leeftijd

function nieuwDeeltje(i) {
  const van = Math.max(0, MIDDEN - zicht.R), breed = Math.min(B, MIDDEN + zicht.R) - van;
  for (let poging = 0; poging < 8; poging++) {
    const p = naarLonLat(van + Math.random() * breed, van + Math.random() * breed);
    if (p) {
      deeltjes[i * 3] = p[0];
      deeltjes[i * 3 + 1] = p[1];
      deeltjes[i * 3 + 2] = Math.random() * MAX_LEEFTIJD;
      return;
    }
  }
  deeltjes[i * 3 + 2] = 0;      // niets gevonden: volgend beeldje opnieuw proberen
}

function herplaatsDeeltjes() {
  for (let i = 0; i < AANTAL_DEELTJES; i++) nieuwDeeltje(i);
}

let vorigeNu = 0;

function beweeg(nu) {
  requestAnimationFrame(beweeg);
  if (tijd.speelt && !sleept) {
    tijd.pos += Math.min(100, nu - vorigeNu) / 1000 * STAPPEN_PER_SECONDE;
    if (tijd.pos >= tijd.stappen.length - 1) tijd.pos = 0;     // opnieuw van voren af aan
    toonTijd(true);             // elk beeldje opnieuw, zo vloeiend als de computer kan
  }
  vorigeNu = nu;
  tekenSteden(nu);
  if (!wind || !$('wind').checked || sleept) return;

  // wat er stond een beetje laten vervagen: zo krijgt elke lijn een staart
  dctx.globalCompositeOperation = 'destination-out';
  dctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
  dctx.fillRect(0, 0, B, B);
  dctx.globalCompositeOperation = 'source-over';

  // 10 m/s is ongeveer een halve pixel per beeldje, bij elke zoomstand
  const tempo = 0.005 * BEGIN.R / zicht.R;
  dctx.beginPath();
  for (let i = 0; i < AANTAL_DEELTJES; i++) {
    const k = i * 3;
    if (--deeltjes[k + 2] <= 0) { nieuwDeeltje(i); continue; }
    const lon = deeltjes[k], lat = deeltjes[k + 1];
    const u = monster(wind, wind.u, lon, lat), v = monster(wind, wind.v, lon, lat);
    if (u !== u || !naarBeeld(lon, lat)) { deeltjes[k + 2] = 0; continue; }
    const x0 = sx, y0 = sy;
    const lat1 = lat + v * tempo;
    const lon1 = lon + u * tempo / Math.max(0.05, Math.cos(lat * RAD));
    if (Math.abs(lat1) > 89.5 || !naarBeeld(lon1, lat1)) { deeltjes[k + 2] = 0; continue; }
    dctx.moveTo(x0, y0);
    dctx.lineTo(sx, sy);
    deeltjes[k] = lon1;
    deeltjes[k + 1] = lat1;
  }
  dctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  dctx.lineWidth = 2;
  dctx.lineCap = 'round';
  dctx.stroke();
}

// ---------------------------------------------------------------- bediening

const getal = (w, decimalen = 1) =>
  w.toLocaleString('nl-NL', { minimumFractionDigits: decimalen, maximumFractionDigits: decimalen });

function tijdTekst(iso) {
  return new Date(iso).toLocaleString('nl-NL',
    { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function melding(tekst, soort = 'waarschuwing') {
  $('meldingen').innerHTML = tekst ? `<p class="${soort}">${tekst}</p>` : '';
}

function tekenLegenda() {
  $('legenda').hidden = !laag;
  if (!laag) return;
  const balk = $('legenda-balk'), bctx = balk.getContext('2d');
  const beeld = bctx.createImageData(balk.width, 1);
  const px = new Uint32Array(beeld.data.buffer);
  for (let i = 0; i < balk.width; i++) px[i] = laag.lut.tabel[Math.round(i / (balk.width - 1) * 1023)];
  bctx.clearRect(0, 0, balk.width, balk.height);
  for (let y = 0; y < balk.height; y++) bctx.putImageData(beeld, 0, y);
  const { min, max } = laag.lut;
  $('legenda-streepjes').innerHTML = laag.streepjes.map((w, i, alle) =>
    `<span style="left:${(w - min) / (max - min) * 100}%">${getal(w, 0)}${i === alle.length - 1 ? ' ' + laag.meta.eenheid : ''}</span>`).join('');
}

function toonBron() {
  const meta = laag ? laag.meta : wind && wind.meta;
  const regels = [];
  const reeks = meta && meta.stappen && meta.stappen.length > 1;
  if (meta) regels.push(`${meta.bron} · geldig ${tijdTekst(reeks ? huidigeTijd() : meta.tijd)}`);
  if (wolken && $('wolken').checked) regels.push(`Wolken: ${wolken.bron} · ${tijdTekst(wolken.tijd)}`);
  $('bron').innerHTML = regels.join('<br>');
}

async function kiesLaag(id) {
  melding('');
  if (!id) {
    laag = null;
  } else {
    const meta = id === 'windsnelheid'
      ? { ...wind.meta, id, naam: 'Windsnelheid' }
      : index.lagen.find((l) => l.id === id);
    const raster = id === 'windsnelheid' ? wind : await laadRaster(meta);
    const vorm = LAGEN[id] || LAGEN.standaard;
    laag = {
      meta, raster,
      // eigen = een eigen kopie van de waarden, die per tijdstap overschreven wordt
      eigen: id !== 'windsnelheid',
      waarden: id === 'windsnelheid' ? raster.snelheid : Float32Array.from(raster.waarden),
      lut: maakLut(vorm.schaal), streepjes: vorm.streepjes, glad: vorm.glad || 0,
    };
    if (laag.glad) strijkGlad(laag.waarden, raster.nx, raster.ny, laag.glad);
  }
  tekenLegenda();
  if (tijd.pos > 0 || tijd.speelt) { await laadReeksen(); toonTijd(tijd.speelt); } else { toonBron(); ververs(); }
}

function toonAflezing(ev) {
  const maat = B / kaart.clientWidth;
  const p = naarLonLat(ev.offsetX * maat, ev.offsetY * maat);
  if (!p) { $('aflezing').innerHTML = '&nbsp;'; return; }
  const delen = [
    `${getal(Math.abs(p[1]))}° ${p[1] >= 0 ? 'N' : 'Z'}, ${getal(Math.abs(p[0]))}° ${p[0] >= 0 ? 'O' : 'W'}`,
  ];
  if (laag && laag.meta.id !== 'windsnelheid') {
    const w = monster(laag.raster, laag.waarden, p[0], p[1]);
    if (w === w) delen.push(`${laag.meta.naam} ${getal(w)} ${laag.meta.eenheid}`);
  }
  if (wind) {
    const s = monster(wind, wind.snelheid, p[0], p[1]);
    if (s === s) delen.push(`wind ${getal(s)} m/s (${getal(s * 3.6, 0)} km/u)`);
  }
  $('aflezing').textContent = delen.join(' · ');
}

function koppelBediening() {
  let vorige = null;
  stage.addEventListener('pointerdown', (ev) => {
    vorige = [ev.clientX, ev.clientY];
    sleept = true;
    stage.classList.add('sleept');
    stage.setPointerCapture(ev.pointerId);
  });
  stage.addEventListener('pointermove', (ev) => {
    if (!vorige) { toonAflezing(ev); return; }
    const maat = B / kaart.clientWidth;
    const dx = (ev.clientX - vorige[0]) * maat, dy = (ev.clientY - vorige[1]) * maat;
    vorige = [ev.clientX, ev.clientY];
    zicht.lon -= dx / zicht.R * DEG;
    zicht.lat = Math.max(-90, Math.min(90, zicht.lat + dy / zicht.R * DEG));
    ververs();
  });
  const los = () => { vorige = null; sleept = false; stage.classList.remove('sleept'); };
  stage.addEventListener('pointerup', los);
  stage.addEventListener('pointercancel', los);
  stage.addEventListener('pointerleave', () => { $('aflezing').innerHTML = '&nbsp;'; });
  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    zicht.R = Math.max(300, Math.min(8000, zicht.R * Math.exp(-ev.deltaY * 0.0015)));
    ververs();
  }, { passive: false });
  stage.addEventListener('dblclick', () => { Object.assign(zicht, BEGIN); ververs(); });

  $('laag').addEventListener('change', (ev) => kiesLaag(ev.target.value));
  $('dekking').addEventListener('input', () => {
    $('dekking-waarde').textContent = $('dekking').value + '%';
    ververs();
  });
  $('dekking-waarde').textContent = $('dekking').value + '%';
  $('wind').addEventListener('change', () => dctx.clearRect(0, 0, B, B));
  $('isobaren').addEventListener('change', () => { if (tijd.pos > 0) toonTijd(false); else ververs(); });
  $('steden').addEventListener('change', ververs);
  $('relief').addEventListener('change', ververs);
  $('grenzen').addEventListener('change', ververs);
  $('tijdlabel').addEventListener('change', ververs);
  $('satelliet').addEventListener('change', async () => {
    if ($('satelliet').checked && !satelliet) {
      melding('Satellietkaart laden…', 'melding wacht');
      try {
        satelliet = await laadSatelliet();
        melding('');
      } catch {
        melding('De satellietkaart (geo/satelliet.jpg) kon niet worden geladen.');
        $('satelliet').checked = false;
      }
    }
    ververs();
  });
  $('wolken').addEventListener('change', () => { toonBron(); ververs(); });

  $('speel').addEventListener('click', async () => {
    if (!tijd.speelt) await laadReeksen();
    speel(!tijd.speelt);
  });
  let schuifWacht = 0;
  $('tijdschuif').addEventListener('input', async () => {
    if (tijd.speelt) speel(false);
    tijd.pos = Number($('tijdschuif').value);
    await laadReeksen();
    toonTijd(true);
    clearTimeout(schuifWacht);
    schuifWacht = setTimeout(() => toonTijd(false), 200);
  });

  $('download').addEventListener('click', () => {
    const uit = document.createElement('canvas');
    uit.width = uit.height = B;
    const uctx = uit.getContext('2d');
    uctx.drawImage(kaart, 0, 0);
    uctx.drawImage($('deeltjes'), 0, 0);
    uctx.drawImage($('etiketten'), 0, 0);
    uctx.drawImage($('plaatsen'), 0, 0);
    uit.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `weerglobe-${laag ? laag.meta.id : 'wind'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  });
}

// ---------------------------------------------------------------- opstarten

async function laadKaart() {
  const json = (pad_) => fetch(pad_).then((r) => r.json());
  const grof = await json('geo/countries-110m.json');
  geo.landGrof = topojson.merge(grof, grof.objects.countries.geometries);
  geo.grenzenGrof = topojson.mesh(grof, grof.objects.countries, (a, b) => a !== b);
  // 528 is de landcode (ISO 3166) van Nederland
  const nederlandUit = (topo) => {
    const g = topo.objects.countries.geometries.find((land) => land.id === '528');
    return g ? topojson.feature(topo, g) : null;
  };
  geo.nederlandGrof = nederlandUit(grof);
  ververs();
  const fijn = await json('geo/countries-50m.json');
  geo.land = topojson.merge(fijn, fijn.objects.countries.geometries);
  geo.grenzen = topojson.mesh(fijn, fijn.objects.countries, (a, b) => a !== b);
  geo.nederland = nederlandUit(fijn);
  ververs();
  const metVormen = (j) => Object.entries(j).filter(([, vorm]) => vorm.coordinates.length);
  geo.dieptesGrof = await json('geo/dieptes-grof.json').then(metVormen).catch(() => null);
  ververs();
  geo.dieptes = metVormen(await json('geo/dieptes.json'));
  geo.meren = await json('geo/meren.json').catch(() => null);
  ververs();
}

async function laadData() {
  try {
    index = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
  } catch {
    melding('Nog geen weerdata gevonden. Draai eerst <code>python3 haal_data.py</code> in de projectmap.');
    return;
  }
  const keuze = $('laag');
  keuze.innerHTML = '<option value="">Geen</option>';
  const windMeta = index.lagen.find((l) => l.soort === 'vector');
  if (windMeta) {
    const r = await laadRaster(windMeta);
    // eigen kopieën: die worden per tijdstap overschreven
    wind = { ...r, u: Float32Array.from(r.u), v: Float32Array.from(r.v),
      snelheid: Float32Array.from(r.snelheid), meta: windMeta };
    tijd.stappen = (windMeta.stappen || []).map((st) => st.tijd);
    if (tijd.stappen.length > 1) {
      $('tijdschuif').max = tijd.stappen.length - 1;
      $('tijdpaneel').hidden = false;
      const uren = (Date.parse(tijd.stappen.at(-1)) - Date.parse(tijd.stappen[0])) / 36e5;
      $('tijduitleg').textContent = `GFS-verwachting, ${tijd.stappen.length} stappen van 3 uur (${uren} uur vooruit). De steden en het satellietbeeld bewegen niet mee.`;
    }
    keuze.add(new Option('Windsnelheid', 'windsnelheid'));
  }
  for (const l of index.lagen) if (l.soort === 'scalar') keuze.add(new Option(l.naam, l.id));
  const drukMeta = index.lagen.find((l) => l.id === 'luchtdruk');
  $('isobaren').closest('label').hidden = !drukMeta;
  if (drukMeta) {
    hoogte = await fetch('geo/hoogte.json').then((r) => r.json())
      .then((j) => ({ nx: j.nx, waarden: j.waarden })).catch(() => null);
    drukRaster = await laadRaster(drukMeta);
    drukWaarden = Float32Array.from(drukRaster.waarden);
    maakIsobaren(drukRaster, drukWaarden);
  }
  const eerste = '';            // standaard een lege kaart: geen kleurlaag
  keuze.value = eerste;
  await kiesLaag(eerste);
  $('tijdstip').textContent = huidigeTijd() ? tijdTekst(huidigeTijd()) : '';
}

rekenAssen();
koppelBediening();
tekenKaart(true);
laadKaart();
laadData();
fetch('data/steden.json', { cache: 'no-cache' }).then((r) => r.json())
  .then((j) => { steden = j.steden; ververs(); })
  .catch(() => { $('steden').closest('label').hidden = true; });
laadBeeld('geo/relief.jpg').then((b) => { relief = b; ververs(); })
  .catch(() => { $('relief').closest('label').hidden = true; });
fetch('data/wolken.json', { cache: 'no-cache' }).then((r) => r.json())
  .then(async (meta) => { wolken = { ...await laadBeeld('data/wolken.png?' + meta.tijd), ...meta }; toonBron(); ververs(); })
  .catch(() => { $('wolken').closest('label').hidden = true; });
document.fonts.load('600 30px "Effra CC"').then(ververs);
requestAnimationFrame(beweeg);

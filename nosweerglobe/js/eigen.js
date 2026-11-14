// Eigen bestanden inlezen: NetCDF (3 en 4), GeoJSON en shapefiles.
//
// De leescode komt uit de Datakaart-tool (NetCDF naar GeoJSON: app.js, nc3.js en
// vector.js) en is hier teruggebracht tot wat de globe nodig heeft. Alles
// gebeurt in de browser; er gaat geen data naar een server.
//
// leesBestanden(files) geeft één van deze twee terug:
//
//   { soort: 'raster', naam, formaat, tijden: [Date|null, …],
//     vars: [{ naam, label, eenheid, heeftTijd, lees(tijdIndex) -> { raster, waarden } }] }
//
//   { soort: 'vector', naam, formaat, features: [{ geom, props }],
//     kolommen: [{ naam, label, soort: 'kleur' | 'num' | 'tekst' | 'egaal', … }],
//     omhullende: [west, zuid, oost, noord], punten: aantal hoekpunten }
//
// 'raster' is hetzelfde rasterformaat als de bestanden in data/ (zie README.md).

const H5_URL = 'https://cdn.jsdelivr.net/npm/h5wasm@0.7.8/dist/iife/h5wasm.js';
const VECTOR_EXT = /\.(geojson|json|shp|dbf|prj|cpg|shx|zip)$/i;
const RD_DEF = '+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs';
const MAX_CATEGORIEEN = 24;
const MAX_CELLEN = 2_000_000;      // grootste raster dat we voor een geprojecteerd bestand maken

// Hulpbibliotheken pas ophalen als ze nodig zijn.
const geladen = new Map();
function laadScript(url, fout) {
  if (!geladen.has(url)) {
    geladen.set(url, new Promise((klaar, mislukt) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = klaar;
      s.onerror = () => { geladen.delete(url); mislukt(new Error(fout)); };
      document.head.appendChild(s);
    }));
  }
  return geladen.get(url);
}
const laadProj4 = () => laadScript('vendor/proj4.js', 'De projectie-bibliotheek (vendor/proj4.js) kon niet laden.');
const laadZip = () => laadScript('vendor/jszip.min.js', 'De zip-lezer (vendor/jszip.min.js) kon niet laden.');

export async function leesBestanden(files) {
  files = [...files];
  if (!files.length) throw new Error('Geen bestand gekozen.');
  if (files.every((f) => VECTOR_EXT.test(f.name))) return leesVector(files);
  const nc = files.find((f) => !VECTOR_EXT.test(f.name));
  return leesNetCDF(nc);
}

// ================================================================ NetCDF

function attr(obj, naam) {
  const a = obj.attrs && obj.attrs[naam];
  if (!a) return undefined;
  let v = a.value;
  if (v && typeof v === 'object' && 'length' in v && typeof v !== 'string') v = v.length === 1 ? v[0] : Array.from(v);
  if (typeof v === 'bigint') v = Number(v);
  return v;
}
const getallen = (v) => Array.from(v, (x) => (typeof x === 'bigint' ? Number(x) : x));

// 'hours since 1900-01-01' -> functie die een getal omzet naar een datum
function tijdOmrekenaar(eenheid) {
  const m = /^\s*(\w+)\s+since\s+(.+?)\s*$/i.exec(eenheid || '');
  if (!m) return null;
  const keer = { seconds: 1e3, second: 1e3, s: 1e3, minutes: 6e4, minute: 6e4, hours: 36e5, hour: 36e5, h: 36e5, days: 864e5, day: 864e5, d: 864e5 }[m[1].toLowerCase()];
  if (!keer) return null;
  let ref = m[2].trim().replace(' ', 'T');
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(ref)) ref += 'T00:00:00';
  ref = ref.replace(/^(\d{4})-(\d)-/, '$1-0$2-').replace(/-(\d)T/, '-0$1T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(ref)) ref += 'Z';
  const basis = Date.parse(ref);
  return Number.isNaN(basis) ? null : (x) => new Date(basis + x * keer);
}

// Projectie uit de attributen van de 'grid_mapping'-variabele -> proj4-tekst
function projectieTekst(gm) {
  const a = (n) => attr(gm, n), num = (n, d) => (a(n) === undefined ? d : Number(a(n)));
  const naam = String(a('grid_mapping_name') || '');
  let bol = '+ellps=WGS84';
  if (a('semi_major_axis') !== undefined) {
    bol = `+a=${num('semi_major_axis')}` + (a('inverse_flattening') !== undefined && num('inverse_flattening') > 0 ? ` +rf=${num('inverse_flattening')}`
      : a('semi_minor_axis') !== undefined ? ` +b=${num('semi_minor_axis')}` : ` +b=${num('semi_major_axis')}`);
  }
  const rest = ` +x_0=${num('false_easting', 0)} +y_0=${num('false_northing', 0)} ${bol} +units=m +no_defs`;
  if (naam === 'lambert_azimuthal_equal_area') return `+proj=laea +lat_0=${num('latitude_of_projection_origin', 90)} +lon_0=${num('longitude_of_projection_origin', 0)}` + rest;
  if (naam === 'polar_stereographic') {
    const lat0 = num('latitude_of_projection_origin', 90), lon0 = num('straight_vertical_longitude_from_pole', num('longitude_of_projection_origin', 0));
    const ts = a('standard_parallel') !== undefined ? ` +lat_ts=${[].concat(a('standard_parallel'))[0]}`
      : a('scale_factor_at_projection_origin') !== undefined ? ` +k_0=${num('scale_factor_at_projection_origin')}` : '';
    return `+proj=stere +lat_0=${lat0} +lon_0=${lon0}${ts}` + rest;
  }
  if (naam === 'lambert_conformal_conic') {
    const sp = [].concat(a('standard_parallel') ?? 45);
    return `+proj=lcc +lat_1=${sp[0]} +lat_2=${sp[1] ?? sp[0]} +lat_0=${num('latitude_of_projection_origin', 0)} +lon_0=${num('longitude_of_central_meridian', 0)}` + rest;
  }
  if (naam === 'transverse_mercator') return `+proj=tmerc +lat_0=${num('latitude_of_projection_origin', 0)} +lon_0=${num('longitude_of_central_meridian', 0)} +k_0=${num('scale_factor_at_central_meridian', 1)}` + rest;
  const p4 = a('proj4_string') || a('proj4text') || a('proj4');
  return p4 ? String(p4) : null;
}

// Raster op lengte- en breedtegraad: rijen van noord naar zuid, kolommen van west naar oost.
// rij[r] en kolom[c] zeggen welke rij en kolom van het bestand daar hoort.
function lengteBreedteRaster(latArr, lonArr) {
  const lat = Array.from(latArr), lon = Array.from(lonArr).map((x) => (x > 180 ? x - 360 : x));
  const rij = lat.map((_, i) => i).sort((a, b) => lat[b] - lat[a]);
  const kolom = lon.map((_, i) => i).sort((a, b) => lon[a] - lon[b]);
  const ny = rij.length, nx = kolom.length;
  const dy = ny > 1 ? Math.abs(lat[rij[0]] - lat[rij[ny - 1]]) / (ny - 1) : 1;
  const dx = nx > 1 ? Math.abs(lon[kolom[nx - 1]] - lon[kolom[0]]) / (nx - 1) : 1;
  const raster = { nx, ny, lon0: lon[kolom[0]], lat0: lat[rij[0]], dx, dy: -dy, regionaal: nx * dx < 359.5 };
  const bron = new Int32Array(nx * ny);     // per cel van ons raster: rij * breedte + kolom in het bestand
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) bron[r * nx + c] = rij[r] * nx + kolom[c];
  return { raster, bron, breedte: nx };
}

// Geprojecteerd raster (x/y in meters, bijvoorbeeld een poolkaart): we maken er een
// raster op lengte/breedte van door voor elke nieuwe cel de dichtstbijzijnde bronkcel te zoeken.
function geprojecteerdRaster(xArr, yArr, perMeter, def) {
  const x = xArr.map((v) => v * perMeter), y = yArr.map((v) => v * perMeter);
  const w = x.length, h = y.length;
  const dxm = (x[w - 1] - x[0]) / (w - 1), dym = (y[h - 1] - y[0]) / (h - 1);
  const p = proj4(def, 'EPSG:4326');
  // omhullende in lengte/breedte: de rand van het raster omrekenen
  let w0 = Infinity, o0 = -Infinity, z0 = Infinity, n0 = -Infinity;
  const neem = (px, py) => {
    const [lo, la] = p.forward([px, py]);
    if (!Number.isFinite(lo) || !Number.isFinite(la)) return;
    if (lo < w0) w0 = lo; if (lo > o0) o0 = lo; if (la < z0) z0 = la; if (la > n0) n0 = la;
  };
  const stapX = Math.max(1, Math.floor(w / 200)), stapY = Math.max(1, Math.floor(h / 200));
  for (let i = 0; i < w; i += stapX) { neem(x[i], y[0]); neem(x[i], y[h - 1]); }
  for (let j = 0; j < h; j += stapY) { neem(x[0], y[j]); neem(x[w - 1], y[j]); }
  // ligt een pool binnen het raster, dan beslaat het alle lengtegraden
  const binnen = (px, py) => (px - x[0]) / dxm >= 0 && (px - x[0]) / dxm <= w - 1 && (py - y[0]) / dym >= 0 && (py - y[0]) / dym <= h - 1;
  for (const pool of [90, -90]) {
    const xy = p.inverse([0, pool]);
    if (xy.every(Number.isFinite) && binnen(xy[0], xy[1])) { w0 = -180; o0 = 180; if (pool > 0) n0 = 90; else z0 = -90; }
  }
  if (!Number.isFinite(w0)) throw new Error('De projectie van dit raster kon niet worden omgerekend.');
  if (o0 - w0 > 300) { w0 = -180; o0 = 180; }
  let cel = Math.min(1, Math.max(0.05, Math.abs(dxm) / 111000));
  while (((o0 - w0) / cel) * ((n0 - z0) / cel) > MAX_CELLEN) cel *= 1.25;
  const nx = Math.max(2, Math.round((o0 - w0) / cel)), ny = Math.max(2, Math.round((n0 - z0) / cel));
  const raster = { nx, ny, lon0: w0 + cel / 2, lat0: n0 - cel / 2, dx: cel, dy: -cel, regionaal: nx * cel < 359.5 };
  const bron = new Int32Array(nx * ny).fill(-1);
  for (let r = 0; r < ny; r++) {
    const la = raster.lat0 - r * cel;
    for (let c = 0; c < nx; c++) {
      const xy = p.inverse([raster.lon0 + c * cel, la]);
      const kol = Math.round((xy[0] - x[0]) / dxm), rij = Math.round((xy[1] - y[0]) / dym);
      if (kol >= 0 && kol < w && rij >= 0 && rij < h) bron[r * nx + c] = rij * w + kol;
    }
  }
  return { raster, bron, breedte: w };
}

const ROLNAMEN = {
  lat: ['latitude', 'lat', 'y', 'nav_lat', 'rlat'],
  lon: ['longitude', 'lon', 'x', 'nav_lon', 'rlon'],
  tijd: ['time', 'valid_time', 't', 'date'],
};

async function leesNetCDF(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let f, formaat;
  if (typeof NC3 !== 'undefined' && NC3.isNC3(buf)) {   // NC3 komt uit js/nc3.js
    f = NC3.open(buf);
    formaat = f.format;
  } else {
    if (!(buf[1] === 0x48 && buf[2] === 0x44 && buf[3] === 0x46)) {
      const kop = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
      throw new Error(kop === 'GRIB' ? 'Dit is een GRIB-bestand. Kies bij het downloaden NetCDF als formaat.'
        : `${file.name} is geen NetCDF, GeoJSON of shapefile.`);
    }
    await laadScript(H5_URL, 'De NetCDF4-lezer kon niet laden. Daarvoor is een internetverbinding nodig.');
    const module = await window.h5wasm.ready;
    const pad = '/in_' + Date.now() + '.nc';
    module.FS.writeFile(pad, buf);
    f = new window.h5wasm.File(pad, 'r');
    formaat = 'NetCDF4';
  }

  const sets = [];
  (function loop(groep, voor) {
    for (const k of groep.keys()) {
      const o = groep.get(k);
      if (!o) continue;
      if (o.type === 'Group') loop(o, voor + k + '/');
      else if (o.type === 'Dataset') sets.push({ naam: voor + k, kort: k, obj: o });
    }
  })(f, '');

  const perDimensie = {};
  for (const d of sets) {
    const id = attr(d.obj, '_Netcdf4Dimid');
    if (id !== undefined && d.obj.shape && d.obj.shape.length === 1) perDimensie[Number(id)] = d;
  }
  const rol = (d) => {
    if (!d) return null;
    const n = d.kort.toLowerCase(), u = String(attr(d.obj, 'units') || '').toLowerCase(), sn = String(attr(d.obj, 'standard_name') || '').toLowerCase();
    if (sn === 'latitude' || u.startsWith('degrees_n') || u === 'degree_north' || ROLNAMEN.lat.includes(n)) return 'lat';
    if (sn === 'longitude' || u.startsWith('degrees_e') || u === 'degree_east' || ROLNAMEN.lon.includes(n)) return 'lon';
    if (sn === 'time' || / since /.test(u) || ROLNAMEN.tijd.includes(n)) return 'tijd';
    const as = String(attr(d.obj, 'axis') || '').toUpperCase();
    if (sn === 'projection_x_coordinate' || (as === 'X' && /^(k?m|meters?|metres?)$/.test(u)) || (['xc', 'x'].includes(n) && /^(k?m)$/.test(u))) return 'x';
    if (sn === 'projection_y_coordinate' || (as === 'Y' && /^(k?m|meters?|metres?)$/.test(u)) || (['yc', 'y'].includes(n) && /^(k?m)$/.test(u))) return 'y';
    return 'anders';
  };
  const assen = sets.filter((d) => d.obj.shape && d.obj.shape.length === 1);
  const projecties = Object.fromEntries(sets.filter((d) => attr(d.obj, 'grid_mapping_name') !== undefined).map((d) => [d.kort, d.obj]));

  const vars = [];
  let net = null, tijden = null, fout = null;
  for (const d of sets) {
    const vorm = d.obj.shape || [];
    if (vorm.length < 2) continue;
    if (/^(latitude|longitude)$/.test(String(attr(d.obj, 'standard_name') || '')) || /^(lat|lon|latitude|longitude|nav_lat|nav_lon)$/i.test(d.kort) || d.kort.endsWith('_bnds')) continue;
    if (String(d.obj.dtype).includes('S') || /^O/.test(String(d.obj.dtype))) continue;   // tekst
    let coords = [];
    const ids = attr(d.obj, '_Netcdf4Coordinates');
    if (ids !== undefined) {
      const lijst = (Array.isArray(ids) ? ids : String(ids).split(',')).map(Number);
      if (lijst.length === vorm.length) coords = lijst.map((i) => perDimensie[i]);
    }
    if (coords.length !== vorm.length) {
      coords = vorm.map((n, as) => {
        const kandidaten = assen.filter((c) => c.obj.shape[0] === n);
        const liefst = as === vorm.length - 1 ? 'lon' : as === vorm.length - 2 ? 'lat' : 'tijd';
        return kandidaten.find((c) => rol(c) === liefst) || kandidaten[0];
      });
    }
    const dims = coords.map((c, as) => ({ naam: c ? c.kort : 'dim' + as, rol: rol(c), maat: vorm[as], coord: c }));
    let iLat = dims.findIndex((x) => x.rol === 'lat'), iLon = dims.findIndex((x) => x.rol === 'lon');
    let ditNet = null;
    try {
      if (iLat < 0 || iLon < 0) {
        const iy = dims.findIndex((x) => x.rol === 'y'), ix = dims.findIndex((x) => x.rol === 'x');
        if (iy < 0 || ix < 0) continue;
        const naamGm = String(attr(d.obj, 'grid_mapping') || '').split(':')[0].trim();
        const gm = projecties[naamGm] || Object.values(projecties)[0];
        if (!gm) { fout = fout || 'Het raster staat in een projectie (x/y), maar het bestand zegt niet welke.'; continue; }
        const def = projectieTekst(gm);
        if (!def) { fout = fout || `Projectie ‘${attr(gm, 'grid_mapping_name')}’ wordt nog niet ondersteund.`; continue; }
        if (!net) {
          await laadProj4();
          const eenheid = String(attr(dims[ix].coord.obj, 'units') || 'm').toLowerCase();
          net = geprojecteerdRaster(getallen(dims[ix].coord.obj.value), getallen(dims[iy].coord.obj.value), eenheid.startsWith('km') ? 1000 : 1, def);
          net.vorm = [vorm[iy], vorm[ix]];
        }
        iLat = iy; iLon = ix;
      } else if (!net) {
        if (!dims[iLat].coord || !dims[iLon].coord) continue;
        net = lengteBreedteRaster(getallen(dims[iLat].coord.obj.value), getallen(dims[iLon].coord.obj.value));
        net.vorm = [vorm[iLat], vorm[iLon]];
      }
      ditNet = net;
    } catch (e) { fout = fout || e.message; continue; }
    if (ditNet.vorm[0] !== vorm[iLat] || ditNet.vorm[1] !== vorm[iLon]) continue;   // een ander raster in hetzelfde bestand

    const iT = dims.findIndex((x) => x.rol === 'tijd');
    if (iT >= 0 && !tijden && dims[iT].coord) {
      const reken = tijdOmrekenaar(attr(dims[iT].coord.obj, 'units'));
      const ruw = getallen(dims[iT].coord.obj.value);
      tijden = reken ? ruw.map(reken) : ruw.map(() => null);
    }
    const schaal = Number(attr(d.obj, 'scale_factor') ?? 1), verschuiving = Number(attr(d.obj, 'add_offset') ?? 0);
    const leeg = [attr(d.obj, '_FillValue'), attr(d.obj, 'missing_value')].filter((x) => x !== undefined && x !== null && !Number.isNaN(Number(x))).map(Number);
    const stappen = vorm.map((_, i) => vorm.slice(i + 1).reduce((a, b) => a * b, 1));
    const obj = d.obj;
    let alles = null;
    vars.push({
      naam: d.naam,
      label: String(attr(obj, 'long_name') || d.kort),
      eenheid: String(attr(obj, 'units') || ''),
      heeftTijd: iT >= 0,
      vlag: /flag|uncert|status|bnds|raw_/i.test(d.naam + String(attr(obj, 'standard_name') || '')),
      lees(tijdIndex) {
        if (!alles) alles = obj.value;
        const { raster, bron, breedte } = ditNet;
        const waarden = new Float32Array(raster.nx * raster.ny);
        // overige assen (hoogte, lid van een ensemble …): de eerste waarde
        const basis = iT >= 0 ? tijdIndex * stappen[iT] : 0;
        const sLat = stappen[iLat], sLon = stappen[iLon];
        for (let i = 0; i < waarden.length; i++) {
          const b = bron[i];
          if (b < 0) { waarden[i] = NaN; continue; }
          let v = Number(alles[basis + Math.floor(b / breedte) * sLat + (b % breedte) * sLon]);
          if (leeg.includes(v) || !Number.isFinite(v) || Math.abs(v) > 1e30) v = NaN; else v = v * schaal + verschuiving;
          waarden[i] = v;
        }
        return { raster, waarden };
      },
    });
  }
  if (!vars.length) throw new Error(fout || 'Geen kaartlaag gevonden: het bestand heeft geen variabele met lengte- én breedtegraad (of x/y met een projectie).');
  vars.sort((a, b) => (a.vlag - b.vlag) || (b.heeftTijd - a.heeftTijd));   // nuttigste laag eerst
  return { soort: 'raster', naam: file.name, formaat, tijden: tijden || [null], vars };
}

// ================================================================ GeoJSON en shapefile

function ringOppervlak(r) { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; }
function inRing(pt, r) {
  let binnen = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) binnen = !binnen;
  }
  return binnen;
}
function mapCoords(geom, f) {
  const m = (c) => (typeof c[0] === 'number' ? f(c) : c.map(m));
  if (geom.type === 'GeometryCollection') return { type: geom.type, geometries: geom.geometries.map((g) => mapCoords(g, f)) };
  return { type: geom.type, coordinates: m(geom.coordinates) };
}
function omhullende(feats) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const loop = (c) => { if (typeof c[0] === 'number') { if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1]; } else c.forEach(loop); };
  const geo = (g) => { if (!g) return; if (g.type === 'GeometryCollection') g.geometries.forEach(geo); else loop(g.coordinates); };
  feats.forEach((f) => geo(f.geom));
  return b;
}

function projectieUitGeojson(gj) {
  const n = gj && gj.crs && gj.crs.properties && gj.crs.properties.name;
  if (!n || /4326|CRS84/i.test(n)) return null;
  if (/28992/.test(n)) return RD_DEF;
  if (/3857|900913|3785/.test(n)) return 'EPSG:3857';
  const m = n.match(/EPSG:+(\d+)/i);
  return m ? 'EPSG:' + m[1] : null;
}
// geen of onbekende projectie: aan de getallen zien of het RD of webmercator is
function raadProjectie([x0, y0, x1, y1]) {
  if (x0 >= -181 && x1 <= 361 && y0 >= -91 && y1 <= 91) return null;
  if (x0 > -8000 && x1 < 310000 && y0 > 280000 && y1 < 640000) return RD_DEF;
  if (Math.abs(x0) <= 20037509 && Math.abs(y0) <= 20048967) return 'EPSG:3857';
  return null;
}

function leesGeojson(tekst, naam) {
  let gj;
  try { gj = JSON.parse(tekst); } catch { throw new Error(`${naam} is geen geldige JSON.`); }
  let lijst;
  if (gj.type === 'FeatureCollection') lijst = gj.features || [];
  else if (gj.type === 'Feature') lijst = [gj];
  else if (gj.type && (gj.coordinates || gj.geometries)) lijst = [{ type: 'Feature', properties: {}, geometry: gj }];
  else throw new Error(`${naam} is geen GeoJSON (geen FeatureCollection, Feature of geometrie).`);
  return { feats: lijst.filter((f) => f && f.geometry).map((f) => ({ geom: f.geometry, props: f.properties || {} })), def: projectieUitGeojson(gj) };
}

// shapefile-ringen -> polygonen: buitenranden met de klok mee, gaten tegen de klok in
function ringenNaarPolygonen(ringen) {
  const buiten = [], gaten = [];
  for (const r of ringen) { if (r.length < 4) continue; (ringOppervlak(r) <= 0 ? buiten : gaten).push(r); }
  if (!buiten.length) return gaten.map((r) => [r]);
  const nieuw = (o) => {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, y] of o) { if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; }
    return { ringen: [o], bb: [a, b, c, d], opp: Math.abs(ringOppervlak(o)) };
  };
  const polys = buiten.map(nieuw).sort((p, q) => p.opp - q.opp);
  for (const g of gaten) {
    const gb = nieuw(g).bb, proef = g.filter((_, i) => i % Math.max(1, Math.floor(g.length / 8)) === 0).slice(0, 9);
    const gastheer = polys.find((p) => gb[0] >= p.bb[0] && gb[1] <= p.bb[1] && gb[2] >= p.bb[2] && gb[3] <= p.bb[3] && proef.some((pt) => inRing(pt, p.ringen[0])));
    if (gastheer) gastheer.ringen.push(g); else polys.push(nieuw(g));
  }
  return polys.map((p) => p.ringen);
}
function leesShp(buf) {
  const dv = new DataView(buf);
  if (dv.getInt32(0, false) !== 9994) throw new Error('Dit .shp-bestand is geen shapefile.');
  const lengte = dv.getInt32(24, false) * 2, uit = [];
  let p = 100;
  while (p + 8 <= lengte && p + 8 <= buf.byteLength) {
    const inhoud = dv.getInt32(p + 4, false) * 2, s = p + 8;
    p = s + inhoud;
    const type = dv.getInt32(s, true);
    if (type === 0) { uit.push(null); continue; }
    const basis = type % 10;   // 1 punt, 3 lijn, 5 vlak, 8 meerdere punten (ook de Z- en M-varianten)
    if (basis === 1) { uit.push({ type: 'Point', coordinates: [dv.getFloat64(s + 4, true), dv.getFloat64(s + 12, true)] }); continue; }
    if (basis === 8) {
      const n = dv.getInt32(s + 36, true), pts = [];
      for (let i = 0; i < n; i++) pts.push([dv.getFloat64(s + 40 + i * 16, true), dv.getFloat64(s + 48 + i * 16, true)]);
      uit.push({ type: 'MultiPoint', coordinates: pts });
      continue;
    }
    if (basis === 3 || basis === 5) {
      const nDelen = dv.getInt32(s + 36, true), nPunten = dv.getInt32(s + 40, true);
      const starts = [];
      for (let i = 0; i < nDelen; i++) starts.push(dv.getInt32(s + 44 + i * 4, true));
      const o = s + 44 + nDelen * 4, delen = [];
      for (let i = 0; i < nDelen; i++) {
        const a = starts[i], b = i + 1 < nDelen ? starts[i + 1] : nPunten, r = [];
        for (let k = a; k < b; k++) r.push([dv.getFloat64(o + k * 16, true), dv.getFloat64(o + k * 16 + 8, true)]);
        delen.push(r);
      }
      uit.push(basis === 3 ? { type: 'MultiLineString', coordinates: delen } : { type: 'MultiPolygon', coordinates: ringenNaarPolygonen(delen) });
      continue;
    }
    uit.push(null);
  }
  return uit;
}
function leesDbf(buf, codering) {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  const n = dv.getUint32(4, true), kop = dv.getUint16(8, true), recLen = dv.getUint16(10, true);
  let dec;
  try { dec = new TextDecoder(codering || 'utf-8', { fatal: !codering }); } catch { dec = new TextDecoder('utf-8'); }
  const latijn = new TextDecoder('windows-1252');
  const lees = (a, z) => { const s = b.subarray(a, z); try { return dec.decode(s); } catch { return latijn.decode(s); } };
  const velden = [];
  for (let o = 32; o + 32 <= kop && b[o] !== 0x0d; o += 32) {
    let e = o;
    while (e < o + 11 && b[e]) e++;
    velden.push({ naam: latijn.decode(b.subarray(o, e)), type: String.fromCharCode(b[o + 11]), lengte: b[o + 16] });
  }
  const rijen = [];
  for (let r = 0; r < n; r++) {
    let o = kop + r * recLen;
    if (o + recLen > b.length) break;
    const rij = {};
    o++;
    for (const v of velden) {
      const t = lees(o, o + v.lengte).trim();
      o += v.lengte;
      if ('NFOI'.includes(v.type)) rij[v.naam] = t === '' || /^\*+$/.test(t) ? null : Number(t.replace(',', '.'));
      else if (v.type === 'L') rij[v.naam] = /^[YyTt]$/.test(t) ? true : /^[NnFf]$/.test(t) ? false : null;
      else rij[v.naam] = t;
    }
    rijen.push(rij);
  }
  return rijen;
}
function leesShapefileSet(set, naam) {
  if (!set.shp) throw new Error(`${naam}: het .shp-bestand ontbreekt (kies .shp, .dbf en .prj samen, of een .zip).`);
  const geoms = leesShp(set.shp);
  const rijen = set.dbf ? leesDbf(set.dbf, set.cpg && set.cpg.trim()) : [];
  const feats = [];
  geoms.forEach((g, i) => { if (g) feats.push({ geom: g, props: rijen[i] || {} }); });
  let def = null;
  if (set.prj && !/^\s*GEOGCS/i.test(set.prj)) def = /Amersfoort|RD_New|28992/i.test(set.prj) ? RD_DEF : set.prj;
  return { feats, def };
}

// d3 tekent een vlak 'binnenstebuiten' als de buitenrand tegen de klok in loopt
// (zoals GeoJSON voorschrijft). Daarom alle ringen de goede kant op draaien.
function draaiVoorD3(geom) {
  const vlak = (ringen) => ringen.map((r, i) => {
    const ring = r.slice();
    const a = ring[0], z = ring[ring.length - 1];
    if (a && z && (a[0] !== z[0] || a[1] !== z[1])) ring.push(a.slice());
    return (ringOppervlak(ring) > 0) === (i === 0) ? ring.reverse() : ring;
  });
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: vlak(geom.coordinates) };
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map(vlak) };
  if (geom.type === 'GeometryCollection') return { type: geom.type, geometries: geom.geometries.map(draaiVoorD3) };
  return geom;
}

async function leesVector(files) {
  const sets = {}, delen = [];
  const neem = async (naam, haal) => {
    const m = naam.match(/^(.*)\.(shp|dbf|prj|cpg|shx|geojson|json)$/i);
    if (!m || /(^|\/)__MACOSX\//.test(naam) || /(^|\/)\./.test(naam.split('/').pop())) return;
    const ext = m[2].toLowerCase(), basis = m[1];
    if (ext === 'geojson' || ext === 'json') {
      try { delen.push({ naam: basis.split('/').pop(), ...leesGeojson(await haal('text'), naam) }); }
      catch (e) { if (ext === 'geojson' || (files.length === 1 && /\.json$/i.test(files[0].name))) throw e; }   // losse .json in een zip: overslaan
      return;
    }
    if (ext === 'shx') return;
    (sets[basis] = sets[basis] || {})[ext] = await haal(ext === 'prj' || ext === 'cpg' ? 'text' : 'arraybuffer');
  };
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      await laadZip();
      const zip = await window.JSZip.loadAsync(await f.arrayBuffer());
      for (const e of Object.values(zip.files)) if (!e.dir) await neem(e.name, (t) => e.async(t === 'text' ? 'string' : 'arraybuffer'));
    } else await neem(f.name, (t) => (t === 'text' ? f.text() : f.arrayBuffer()));
  }
  let namen = Object.keys(sets);
  // de export van Datakaart (per laag + alle_lagen): alleen alle_lagen, anders staat alles dubbel
  const alle = namen.filter((n) => /(^|\/)alle_lagen$/.test(n));
  if (alle.length) namen = alle;
  for (const n of namen) delen.push({ naam: n.split('/').pop(), ...leesShapefileSet(sets[n], n) });
  if (!delen.length) throw new Error('Geen GeoJSON of shapefile gevonden in de gekozen bestanden.');

  const feats = [];
  for (const d of delen) {
    const def = d.def || raadProjectie(omhullende(d.feats));
    let reken = null;
    if (def) {
      await laadProj4();
      try { const p = proj4(def, 'EPSG:4326'); reken = (xy) => p.forward(xy); }
      catch { throw new Error(`De projectie van ${d.naam} wordt niet herkend.`); }
    }
    for (const x of d.feats) {
      const geom = draaiVoorD3(reken ? mapCoords(x.geom, reken) : x.geom);
      feats.push({ geom, props: delen.length > 1 ? { laag: d.naam, ...x.props } : x.props });
    }
  }
  if (!feats.length) throw new Error('Het bestand heeft geen vlakken, lijnen of punten.');
  const naam = files.length === 1 ? files[0].name : `${files.length} bestanden · ${files[0].name}…`;
  // omhullende en aantal punten: de globe gebruikt die om een groot bestand vlot te kunnen draaien
  let punten = 0;
  const tel = (c) => { if (typeof c[0] === 'number') punten++; else c.forEach(tel); };
  const telGeom = (g) => { if (g.type === 'GeometryCollection') g.geometries.forEach(telGeom); else tel(g.coordinates); };
  feats.forEach((f) => telGeom(f.geom));
  return { soort: 'vector', naam, formaat: namen.length ? 'Shapefile' : 'GeoJSON', features: feats, kolommen: kolommenVan(feats),
    omhullende: omhullende(feats), punten };
}

const isKleur = (v) => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());

// Elke kolom van het bestand wordt een keuze: getallen krijgen een kleurenschaal,
// tekst een kleur per soort, en een kolom met kleuren (fill, kleur) wordt letterlijk gebruikt.
function kolommenVan(feats) {
  const sleutels = [...new Set(feats.flatMap((f) => Object.keys(f.props)))];
  const kolommen = [];
  const kleurVeld = ['fill', 'kleur', 'color', 'colour', 'KLEUR', 'FILL', 'COLOR'].find((k) => feats.some((f) => isKleur(f.props[k])));
  if (kleurVeld) {
    kolommen.push({ naam: '__kleur', label: 'Kleuren uit het bestand', soort: 'kleur',
      kleur: (f) => (isKleur(f.props[kleurVeld]) ? f.props[kleurVeld].trim() : '#999999') });
  }
  const getalKolommen = [], tekstKolommen = [], idKolommen = [];
  const isId = (k) => /^(fid|id|gid|objectid|ogc_fid|ogr_fid|fid_\d*)$/i.test(k) || /_id$/i.test(k);
  for (const k of sleutels) {
    if (!k.trim()) continue;
    const w = feats.map((f) => f.props[k]).filter((x) => x !== null && x !== undefined && x !== '');
    if (!w.length || w.some((x) => typeof x === 'object')) continue;
    const getal = w.every((x) => typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x.replace(',', '.')))));
    const uniek = [...new Set(w.map(String))];
    if (getal && uniek.length > 1) {
      (isId(k) ? idKolommen : getalKolommen).push({ naam: k, label: `${k} (getal)`, soort: 'num',
        waarde: (f) => { const x = f.props[k]; return x === null || x === undefined || x === '' ? NaN : Number(String(x).replace(',', '.')); } });
    } else if (uniek.length > 1 && uniek.length <= MAX_CATEGORIEEN && !isKleur(w[0])) {
      const soorten = uniek.sort((p, q) => p.localeCompare(q, 'nl', { numeric: true }));
      (isId(k) ? idKolommen : tekstKolommen).push({ naam: k, label: `${k} (${uniek.length} soorten)`, soort: 'tekst', soorten,
        waarde: (f) => { const x = f.props[k]; return x === null || x === undefined || x === '' ? -1 : soorten.indexOf(String(x)); } });
    }
  }
  const eenheidVeld = ['eenheid', 'EENHEID', 'unit', 'units', 'UNIT'].find((k) => sleutels.includes(k));
  const eenheden = eenheidVeld ? [...new Set(feats.map((f) => f.props[eenheidVeld]).filter(Boolean))] : [];
  for (const k of getalKolommen) k.eenheid = eenheden.length === 1 ? String(eenheden[0]) : '';
  kolommen.push(...getalKolommen, ...tekstKolommen, ...idKolommen);
  kolommen.push({ naam: '__egaal', label: 'Alles in één kleur', soort: 'egaal' });
  return kolommen;
}

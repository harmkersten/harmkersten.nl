/* NetCDF3-lezer (classic CDF-1, 64-bit offset CDF-2 en CDF-5), zonder bibliotheek.

   Geeft een object terug dat zich gedraagt als een h5wasm-bestand: keys(), get(naam)
   met { type: "Dataset", shape, dtype, attrs: {naam: {value}}, value }. Zo kan
   openNetCDF() in app.js NetCDF3 en NetCDF4 op dezelfde manier lezen.

   Welke as bij welke coördinaat hoort zetten we in dezelfde attributen die
   NetCDF4 zelf gebruikt (_Netcdf4Dimid en _Netcdf4Coordinates).

   Formaat: https://docs.unidata.ucar.edu/netcdf-c/current/file_format_specifications.html */
"use strict";

const NC3 = (() => {
  const TYPES = {
    1: { n: "i1", size: 1, get: (dv, o) => dv.getInt8(o), arr: Int8Array },
    2: { n: "S1", size: 1, get: (dv, o) => dv.getUint8(o), arr: Uint8Array },
    3: { n: "i2", size: 2, get: (dv, o) => dv.getInt16(o), arr: Int16Array },
    4: { n: "i4", size: 4, get: (dv, o) => dv.getInt32(o), arr: Int32Array },
    5: { n: "f4", size: 4, get: (dv, o) => dv.getFloat32(o), arr: Float32Array },
    6: { n: "f8", size: 8, get: (dv, o) => dv.getFloat64(o), arr: Float64Array },
    7: { n: "u1", size: 1, get: (dv, o) => dv.getUint8(o), arr: Uint8Array },
    8: { n: "u2", size: 2, get: (dv, o) => dv.getUint16(o), arr: Uint16Array },
    9: { n: "u4", size: 4, get: (dv, o) => dv.getUint32(o), arr: Uint32Array },
    10: { n: "i8", size: 8, get: (dv, o) => Number(dv.getBigInt64(o)), arr: Float64Array },
    11: { n: "u8", size: 8, get: (dv, o) => Number(dv.getBigUint64(o)), arr: Float64Array },
  };
  const pad4 = (n) => (4 - (n % 4)) % 4;

  function isNC3(buf) {
    return buf.length > 4 && buf[0] === 0x43 && buf[1] === 0x44 && buf[2] === 0x46 && [1, 2, 5].includes(buf[3]);
  }

  function open(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const version = buf[3];
    const big = version === 5; // CDF-5: aantallen en lengtes zijn 64-bit
    let p = 4;
    const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
    const u64 = () => { const v = Number(dv.getBigUint64(p)); p += 8; return v; };
    const count = () => (big ? u64() : u32());
    const name = () => {
      const n = count();
      const s = new TextDecoder().decode(buf.subarray(p, p + n));
      p += n + pad4(n);
      return s;
    };
    const values = (type, n) => {
      const T = TYPES[type];
      if (!T) throw new Error(`Onbekend gegevenstype ${type} in het NetCDF3-bestand.`);
      let v;
      if (type === 2) {
        v = new TextDecoder().decode(buf.subarray(p, p + n)).replace(/\0+$/, "");
      } else {
        v = new T.arr(n);
        for (let i = 0; i < n; i++) v[i] = T.get(dv, p + i * T.size);
      }
      p += n * T.size; p += pad4(n * T.size);
      return v;
    };
    const attList = () => {
      const tag = u32(), n = count();
      const out = {};
      if (tag === 0 && n === 0) return out;
      if (tag !== 0x0c) throw new Error("NetCDF3-kop is beschadigd (attributen).");
      for (let i = 0; i < n; i++) {
        const nm = name(), type = u32(), len = count();
        out[nm] = { value: values(type, len) };
      }
      return out;
    };

    let numrecs = u32();
    if (big) { p -= 4; numrecs = u64(); }
    const streaming = numrecs === 0xffffffff;

    // dimensies
    const dims = [];
    {
      const tag = u32(), n = count();
      if (!(tag === 0 && n === 0)) {
        if (tag !== 0x0a) throw new Error("NetCDF3-kop is beschadigd (dimensies).");
        for (let i = 0; i < n; i++) dims.push({ name: name(), len: count() });
      }
    }
    const gattrs = attList();

    // variabelen
    const vars = [];
    {
      const tag = u32(), n = count();
      if (!(tag === 0 && n === 0)) {
        if (tag !== 0x0b) throw new Error("NetCDF3-kop is beschadigd (variabelen).");
        for (let i = 0; i < n; i++) {
          const nm = name();
          const nd = count();
          const dimids = [];
          for (let k = 0; k < nd; k++) dimids.push(count());
          const attrs = attList();
          const type = u32();
          const vsize = big ? u64() : u32();
          const begin = version === 1 ? u32() : u64();
          vars.push({ name: nm, dimids, attrs, type, vsize, begin });
        }
      }
    }

    const recDim = dims.findIndex((d) => d.len === 0);
    const isRec = (v) => v.dimids.length > 0 && v.dimids[0] === recDim;
    const recVars = vars.filter(isRec);
    // eén recordvariabele: geen opvulling tussen de records
    const recSize = recVars.length === 1 ? recVars[0].dimids.slice(1).reduce((a, d) => a * dims[d].len, 1) * TYPES[recVars[0].type].size
      : recVars.reduce((a, v) => a + v.vsize, 0);
    if (streaming && recVars.length) {
      const first = Math.min(...recVars.map((v) => v.begin));
      numrecs = recSize ? Math.floor((buf.length - first) / recSize) : 0;
    }
    const nRec = numrecs;

    function shapeOf(v) { return v.dimids.map((d) => (d === recDim ? nRec : dims[d].len)); }

    function readValue(v) {
      const T = TYPES[v.type], shape = shapeOf(v);
      const total = shape.reduce((a, b) => a * b, 1);
      if (v.type === 2) {
        // tekst: als één string (of een rij strings bij 2D)
        const last = shape[shape.length - 1] || 1, rows = total / last, out = [];
        const blockOf = (r) => (isRec(v) ? v.begin + Math.floor(r / (rows / Math.max(1, nRec))) * recSize : v.begin);
        for (let r = 0; r < rows; r++) {
          const o = isRec(v) ? blockOf(r) + (r % (rows / Math.max(1, nRec))) * last : v.begin + r * last;
          out.push(new TextDecoder().decode(buf.subarray(o, o + last)).replace(/\0+$/, ""));
        }
        return out.length === 1 ? out[0] : out;
      }
      const out = new T.arr(total);
      if (!isRec(v)) {
        if (v.begin + total * T.size > buf.length) throw new Error(`Variabele ${v.name} loopt voorbij het einde van het bestand (afgebroken download?).`);
        for (let i = 0; i < total; i++) out[i] = T.get(dv, v.begin + i * T.size);
        return out;
      }
      const per = total / Math.max(1, nRec);
      for (let r = 0; r < nRec; r++) {
        const o = v.begin + r * recSize;
        if (o + per * T.size > buf.length) throw new Error(`Variabele ${v.name} loopt voorbij het einde van het bestand (afgebroken download?).`);
        for (let i = 0; i < per; i++) out[r * per + i] = T.get(dv, o + i * T.size);
      }
      return out;
    }

    // NetCDF4-achtige hulpattributen, zodat app.js de assen kan koppelen
    const coordVarOfDim = {};
    vars.forEach((v) => { if (v.dimids.length === 1 && dims[v.dimids[0]].name === v.name) coordVarOfDim[v.dimids[0]] = v; });

    const objects = new Map();
    for (const v of vars) {
      const attrs = { ...v.attrs };
      attrs._Netcdf4Coordinates = { value: Int32Array.from(v.dimids) };
      const dimHere = Object.keys(coordVarOfDim).find((d) => coordVarOfDim[d] === v);
      if (dimHere !== undefined) attrs._Netcdf4Dimid = { value: Int32Array.of(Number(dimHere)) };
      let cache;
      objects.set(v.name, {
        type: "Dataset",
        shape: shapeOf(v),
        dtype: TYPES[v.type] ? TYPES[v.type].n : "?",
        attrs,
        get value() { if (cache === undefined) cache = readValue(v); return cache; },
      });
    }

    return {
      type: "Group",
      format: { 1: "NetCDF3 classic", 2: "NetCDF3 64-bit offset", 5: "NetCDF3 CDF-5" }[version],
      attrs: gattrs,
      keys: () => [...objects.keys()],
      get: (k) => objects.get(k),
      close() {},
    };
  }

  return { isNC3, open };
})();

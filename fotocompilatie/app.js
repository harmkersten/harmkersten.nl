/* Fotocompilatie — NOS Weer
   Drie foto's, automatisch bijgesneden in de kaders van layouts.js,
   op een canvas van 1080 x 1080. */

const SIZE = 1080;

/* Opmaak van de kaders. schaduw is een sterkte van 0 (uit) tot 1 (zwaar);
   0.35 is de subtiele stand die we standaard gebruiken. */
const stijl = { rand: true, randDikte: 6, schaduw: 0.35 };

/* Sterkte -> concrete schaduwwaarden. */
function schaduwWaarden(s) {
  return { blur: 46 * s, offsetY: 17 * s, alpha: 0.5 * s };
}

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const fileInput = document.getElementById('file-input');
const toastEl = document.getElementById('toast');

/* diepe kopie zodat de kader-editor layouts.js niet muteert */
const layouts = JSON.parse(JSON.stringify(LAYOUTS));

let layoutIndex = 0;
/* per slot: { img, name, zoom, ox, oy }  (ox/oy = verschuiving in canvas-px) */
const slots = [null, null, null];

let bg = null;

/* ---------- achtergrond ---------- */

const bgImg = new Image();
bgImg.onload = () => { bg = bgImg; render(); };
bgImg.onerror = () => { console.warn('Achtergrond niet gevonden: assets/bg-square.jpg'); render(); };
bgImg.src = 'assets/bg-square.jpg';

/* ---------- tekenen ---------- */

function frames() { return layouts[layoutIndex].frames; }

/* Cover-fit: kleinste schaal waarbij de foto het kader volledig vult. */
function placement(slot, f) {
  const img = slot.img;
  const base = Math.max(f.w / img.naturalWidth, f.h / img.naturalHeight);
  const scale = base * slot.zoom;
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const maxOx = Math.max(0, (dw - f.w) / 2);
  const maxOy = Math.max(0, (dh - f.h) / 2);
  const ox = Math.min(maxOx, Math.max(-maxOx, slot.ox));
  const oy = Math.min(maxOy, Math.max(-maxOy, slot.oy));
  return {
    dx: f.x + (f.w - dw) / 2 + ox,
    dy: f.y + (f.h - dh) / 2 + oy,
    dw, dh, maxOx, maxOy,
  };
}

function render() {
  ctx.clearRect(0, 0, SIZE, SIZE);

  if (bg) {
    ctx.drawImage(bg, 0, 0, SIZE, SIZE);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, SIZE);
    g.addColorStop(0, '#96bede');
    g.addColorStop(1, '#5b7f9d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  frames().forEach((f, i) => {
    const slot = slots[i];

    if (!slot) {
      /* leeg kader: witte omlijning zoals in het ontwerp */
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 3;
      ctx.strokeRect(f.x + 1.5, f.y + 1.5, f.w - 3, f.h - 3);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '600 44px -apple-system, Helvetica, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), f.x + f.w / 2, f.y + f.h / 2);
      ctx.restore();
      return;
    }

    /* Witte rand + slagschaduw in één vlak onder de foto. De rand valt buiten
       het gemeten kader, zodat de foto zelf precies het kader vult. */
    const b = stijl.rand ? stijl.randDikte : 0;
    const sh = schaduwWaarden(stijl.schaduw);
    ctx.save();
    if (sh.alpha > 0) {
      ctx.shadowBlur = sh.blur;
      ctx.shadowOffsetY = sh.offsetY;
      ctx.shadowColor = 'rgba(0,0,0,' + sh.alpha + ')';
    }
    ctx.fillStyle = stijl.rand ? '#fff' : '#000';
    ctx.fillRect(f.x - b, f.y - b, f.w + b * 2, f.h + b * 2);
    ctx.restore();

    /* foto, bijgesneden op het kader */
    const p = placement(slot, f);
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.x, f.y, f.w, f.h);
    ctx.clip();
    ctx.drawImage(slot.img, p.dx, p.dy, p.dw, p.dh);
    ctx.restore();
  });
}

/* ---------- foto's laden ---------- */

function loadFiles(files, startSlot) {
  const images = [...files].filter(f => f.type.startsWith('image/'));
  if (!images.length) return;

  /* Doelkaders vooraf vastleggen: het laden is async, dus achteraf zoeken
     naar een leeg kader zou alle foto's in hetzelfde kader laten belanden. */
  const taken = slots.map(s => s !== null);
  const targets = [];
  images.forEach((_, n) => {
    let idx;
    if (n === 0 && startSlot !== null && startSlot !== undefined) {
      idx = startSlot;
    } else {
      idx = taken.indexOf(false);
      if (idx === -1) idx = targets.length % slots.length;
    }
    taken[idx] = true;
    targets.push(idx);
  });

  images.slice(0, slots.length).forEach((file, n) => {
    const idx = targets[n];
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      slots[idx] = { img, name: file.name, zoom: 1, ox: 0, oy: 0 };
      buildSlots();
      render();
    };
    img.onerror = () => toast('Kon ' + file.name + ' niet laden');
    img.src = url;
  });
}

/* ---------- indelingskiezer ---------- */

function buildVariants() {
  const wrap = document.getElementById('variants');
  wrap.innerHTML = '';
  layouts.forEach((lay, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(i === layoutIndex));
    btn.innerHTML = miniPreview(lay) + '<span>' + lay.naam + '</span>';
    btn.onclick = () => { layoutIndex = i; buildVariants(); buildFrameInputs(); render(); };
    wrap.appendChild(btn);
  });
}

function miniPreview(lay) {
  const rects = lay.frames.map(f =>
    `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="rgba(255,255,255,.16)" stroke="#fff" stroke-width="14"/>`
  ).join('');
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="xMidYMid meet">
    <rect width="${SIZE}" height="${SIZE}" fill="#7ba4c6"/>${rects}</svg>`;
}

/* ---------- slotlijst ---------- */

function buildSlots() {
  const wrap = document.getElementById('slots');
  wrap.innerHTML = '';

  slots.forEach((slot, i) => {
    const row = document.createElement('div');
    row.className = 'slot';

    const thumb = document.createElement('div');
    thumb.className = 'thumb' + (slot ? ' filled' : '');
    thumb.title = 'Kies een foto voor kader ' + (i + 1);
    if (slot) {
      const im = document.createElement('img');
      im.src = slot.img.src;
      thumb.appendChild(im);
    } else {
      thumb.textContent = '+';
    }
    thumb.onclick = () => { fileInput.dataset.slot = i; fileInput.click(); };

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<div class="name">${slot ? escapeHtml(slot.name) : 'Kader ' + (i + 1) + ' — leeg'}</div>`;
    if (slot) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = slot.img.naturalWidth + ' × ' + slot.img.naturalHeight + ' px';
      meta.appendChild(sub);

      const zoom = document.createElement('input');
      zoom.type = 'range'; zoom.className = 'zoom';
      zoom.min = '1'; zoom.max = '3'; zoom.step = '0.01'; zoom.value = String(slot.zoom);
      zoom.oninput = () => { slot.zoom = parseFloat(zoom.value); render(); };
      meta.appendChild(zoom);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    if (slot) {
      actions.appendChild(mini('Midden', () => { slot.zoom = 1; slot.ox = 0; slot.oy = 0; buildSlots(); render(); }));
      actions.appendChild(mini('Wissen', () => { slots[i] = null; buildSlots(); render(); }));
    }

    row.append(thumb, meta, actions);
    wrap.appendChild(row);
  });
}

function mini(label, fn) {
  const b = document.createElement('button');
  b.className = 'mini';
  b.type = 'button';
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------- muis: slepen en zoomen in een kader ---------- */

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / r.width * SIZE,
    y: (e.clientY - r.top) / r.height * SIZE,
  };
}

/* bovenste kader op deze positie (laatste in de array ligt bovenop) */
function frameAt(pt) {
  const fs = frames();
  for (let i = fs.length - 1; i >= 0; i--) {
    const f = fs[i];
    if (pt.x >= f.x && pt.x <= f.x + f.w && pt.y >= f.y && pt.y <= f.y + f.h) return i;
  }
  return -1;
}

let drag = null;

canvas.addEventListener('pointerdown', e => {
  const pt = canvasPoint(e);
  const i = frameAt(pt);
  if (i === -1 || !slots[i]) return;
  drag = { i, startX: pt.x, startY: pt.y, ox: slots[i].ox, oy: slots[i].oy };
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointermove', e => {
  if (!drag) {
    const i = frameAt(canvasPoint(e));
    canvas.style.cursor = (i !== -1 && slots[i]) ? 'grab' : 'default';
    return;
  }
  const pt = canvasPoint(e);
  const slot = slots[drag.i];
  slot.ox = drag.ox + (pt.x - drag.startX);
  slot.oy = drag.oy + (pt.y - drag.startY);
  const p = placement(slot, frames()[drag.i]);
  slot.ox = Math.min(p.maxOx, Math.max(-p.maxOx, slot.ox));
  slot.oy = Math.min(p.maxOy, Math.max(-p.maxOy, slot.oy));
  render();
});

['pointerup', 'pointercancel'].forEach(ev =>
  canvas.addEventListener(ev, () => { drag = null; canvas.style.cursor = 'default'; })
);

canvas.addEventListener('wheel', e => {
  const i = frameAt(canvasPoint(e));
  if (i === -1 || !slots[i]) return;
  e.preventDefault();
  const slot = slots[i];
  slot.zoom = Math.min(3, Math.max(1, slot.zoom - e.deltaY * 0.0015));
  buildSlots();
  render();
}, { passive: false });

/* ---------- slepen vanaf de desktop ---------- */

['dragenter', 'dragover'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('dragover'); })
);
['dragleave', 'drop'].forEach(ev =>
  stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.remove('dragover'); })
);
stage.addEventListener('drop', e => {
  const pt = canvasPoint(e);
  const i = frameAt(pt);
  loadFiles(e.dataTransfer.files, i === -1 ? null : i);
});

fileInput.addEventListener('change', () => {
  const s = fileInput.dataset.slot;
  loadFiles(fileInput.files, s === undefined || s === '' ? null : parseInt(s, 10));
  fileInput.value = '';
  fileInput.dataset.slot = '';
});

/* ---------- opmaak ---------- */

const borderToggle = document.getElementById('border-toggle');
const borderWidth = document.getElementById('border-width');
const borderWidthOut = document.getElementById('border-width-out');
const shadowSlider = document.getElementById('shadow');
const shadowOut = document.getElementById('shadow-out');

borderToggle.onchange = () => {
  stijl.rand = borderToggle.checked;
  borderWidth.disabled = !stijl.rand;
  render();
};
borderWidth.oninput = () => {
  stijl.randDikte = parseInt(borderWidth.value, 10);
  borderWidthOut.textContent = stijl.randDikte + ' px';
  render();
};
shadowSlider.oninput = () => {
  stijl.schaduw = parseInt(shadowSlider.value, 10) / 100;
  shadowOut.textContent = shadowSlider.value + '%';
  render();
};

/* ---------- kader-editor ---------- */

document.getElementById('toggle-frames').onclick = () => {
  document.getElementById('frame-editor').classList.toggle('open');
};

function buildFrameInputs() {
  const wrap = document.getElementById('frame-inputs');
  wrap.innerHTML = '';
  frames().forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'cols';
    row.style.marginBottom = '6px';
    ['x', 'y', 'w', 'h'].forEach(key => {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.value = f[key];
      inp.title = 'Kader ' + (i + 1) + ' — ' + key;
      inp.oninput = () => {
        const v = parseFloat(inp.value);
        if (!Number.isNaN(v)) { f[key] = v; render(); buildVariants(); }
      };
      row.appendChild(inp);
    });
    wrap.appendChild(row);
  });
}

document.getElementById('copy-json').onclick = async () => {
  const json = JSON.stringify(layouts.map(l => ({ id: l.id, naam: l.naam, frames: l.frames })), null, 2);
  try {
    await navigator.clipboard.writeText(json);
    toast('JSON gekopieerd');
  } catch {
    console.log(json);
    toast('Kopiëren geblokkeerd — JSON staat in de console');
  }
};

/* ---------- export ---------- */

document.getElementById('download').onclick = () => {
  canvas.toBlob(blob => {
    const d = new Date();
    const stamp = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'weercompilatie-' + stamp + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
};

document.getElementById('clear').onclick = () => {
  slots.fill(null);
  buildSlots();
  render();
};

/* ---------- toast ---------- */

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* ---------- start ---------- */

buildVariants();
buildSlots();
buildFrameInputs();
render();

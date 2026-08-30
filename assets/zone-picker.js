/**
 * Zone picker — merchant tool for setting a Canvas block's restricted
 * area by dragging a box on the real garment photo.
 *
 * Reads the designer page's own [data-kc-config] JSON rather than
 * duplicating canvas settings, so adding a garment or swapping a photo
 * needs no change here.
 *
 * Note the zone's x/y are the box CENTRE, matching how the studio's
 * clampOutsideZone derives its edges (left = x - w / 2) and how the
 * theme-editor sliders are labelled.
 */

const DEFAULT_ZONE = { x: 50, y: 30, w: 30, h: 20 };
const round = (n) => Math.round(n);

class ZonePicker extends HTMLElement {
  async connectedCallback() {
    this.statusEl = this.querySelector('[data-zp-status]');
    this.mainEl = this.querySelector('[data-zp-main]');
    this.frame = this.querySelector('[data-zp-frame]');
    this.photo = this.querySelector('[data-zp-photo]');
    this.box = this.querySelector('[data-zp-box]');

    this.view = 'front';
    this.zone = { ...DEFAULT_ZONE };
    this.drag = null;

    try {
      this.canvases = await this.loadCanvases();
    } catch (error) {
      console.error('[zone picker] could not read the designer page:', error);
      this.canvases = [];
    }

    if (this.canvases.length === 0) {
      this.statusEl.textContent =
        'Could not read any garments. Check the Designer page setting on this section.';
      return;
    }

    this.statusEl.hidden = true;
    this.mainEl.hidden = false;

    this.renderCanvasOptions();
    this.bindEvents();
    this.setCanvas(0);
  }

  /* -- data -------------------------------------------------------------- */

  async loadCanvases() {
    const response = await fetch(this.dataset.designerUrl, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`designer page returned ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const configEl = doc.querySelector('[data-kc-config]');
    if (!configEl) throw new Error('no [data-kc-config] on the designer page');
    const parsed = JSON.parse(configEl.textContent);
    return (parsed.canvases || []).filter(Boolean).map((canvas) => ({
      ...canvas,
      colorways: (canvas.colorways || []).filter(Boolean),
    }));
  }

  get canvas() {
    return this.canvases[this.canvasIndex];
  }

  get colorway() {
    return this.canvas.colorways[this.colorwayIndex] || this.canvas.colorways[0];
  }

  /* -- setup ------------------------------------------------------------- */

  renderCanvasOptions() {
    this.querySelector('[data-zp-canvas]').innerHTML = this.canvases
      .map((canvas, i) => `<option value="${i}">${canvas.label}</option>`)
      .join('');
  }

  bindEvents() {
    this.querySelector('[data-zp-canvas]').addEventListener('change', (event) =>
      this.setCanvas(Number(event.target.value))
    );
    this.querySelector('[data-zp-colorway]').addEventListener('change', (event) =>
      this.setColorway(Number(event.target.value))
    );

    this.addEventListener('click', (event) => {
      const viewButton = event.target.closest('[data-zp-view]');
      if (viewButton) return this.setView(viewButton.dataset.zpView);
      if (event.target.closest('[data-zp-copy]')) return this.copy();
      if (event.target.closest('[data-zp-clear]')) return this.clear();
    });

    this.bindPointer();
    this.bindKeyboard();
  }

  /* -- state ------------------------------------------------------------- */

  setCanvas(index) {
    this.canvasIndex = index;
    this.colorwayIndex = 0;
    this.view = 'front';
    // Start from whatever the merchant already saved, so they are editing
    // an existing zone rather than guessing it again from scratch.
    this.zone = this.canvas.noGoZone ? { ...this.canvas.noGoZone } : { ...DEFAULT_ZONE };

    const colorways = this.canvas.colorways;
    const field = this.querySelector('[data-zp-colorway-field]');
    field.hidden = colorways.length < 2;
    this.querySelector('[data-zp-colorway]').innerHTML = colorways
      .map((c, i) => `<option value="${i}">${c.name}</option>`)
      .join('');

    this.querySelector('[data-zp-canvas-name]').textContent = this.canvas.label;
    this.updatePhoto();
    this.render();
  }

  setColorway(index) {
    this.colorwayIndex = index;
    if (this.view === 'back' && !this.colorway.back) this.setView('front');
    else this.updatePhoto();
  }

  setView(view) {
    if (view === 'back' && !this.colorway.back) return;
    this.view = view;
    this.querySelectorAll('[data-zp-view]').forEach((b) =>
      b.setAttribute('aria-current', String(b.dataset.zpView === view))
    );
    this.updatePhoto();
  }

  updatePhoto() {
    const colorway = this.colorway;
    if (!colorway) return;
    const showBack = this.view === 'back' && colorway.back;
    this.photo.src = showBack ? colorway.back : colorway.front;
    this.photo.alt = `${this.canvas.label} — ${colorway.name}`;
    // The zone is per canvas, not per side, so the side toggle is only for
    // eyeballing the box against the other photo.
    this.querySelector('[data-zp-view-field]').hidden = !this.canvas.colorways.some((c) => c.back);
  }

  /* -- interaction ------------------------------------------------------- */

  bindPointer() {
    this.frame.addEventListener('pointerdown', (event) => {
      const handle = event.target.closest('[data-zp-handle]');
      const onBox = event.target.closest('[data-zp-box]');
      if (!handle && !onBox) return;
      event.preventDefault();
      event.target.setPointerCapture(event.pointerId);
      this.drag = {
        pointerId: event.pointerId,
        mode: handle ? handle.dataset.zpHandle : 'move',
        x: event.clientX,
        y: event.clientY,
        zone: { ...this.zone },
        rect: this.frame.getBoundingClientRect(),
        target: event.target,
      };
    });

    this.frame.addEventListener('pointermove', (event) => {
      const drag = this.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = ((event.clientX - drag.x) / drag.rect.width) * 100;
      const dy = ((event.clientY - drag.y) / drag.rect.height) * 100;
      this.zone = this.clamp(this.applyDrag(drag, dx, dy));
      this.render();
    });

    const end = (event) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.drag = null;
    };
    this.frame.addEventListener('pointerup', end);
    this.frame.addEventListener('pointercancel', end);
  }

  applyDrag(drag, dx, dy) {
    const start = drag.zone;
    if (drag.mode === 'move') return { ...start, x: start.x + dx, y: start.y + dy };

    let left = start.x - start.w / 2;
    let right = start.x + start.w / 2;
    let top = start.y - start.h / 2;
    let bottom = start.y + start.h / 2;

    if (drag.mode.includes('w')) left += dx;
    if (drag.mode.includes('e')) right += dx;
    if (drag.mode.includes('n')) top += dy;
    if (drag.mode.includes('s')) bottom += dy;

    // Allow dragging a handle past its opposite edge.
    if (right < left) [left, right] = [right, left];
    if (bottom < top) [top, bottom] = [bottom, top];

    return {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      w: right - left,
      h: bottom - top,
    };
  }

  clamp(zone) {
    const w = Math.min(100, Math.max(2, zone.w));
    const h = Math.min(100, Math.max(2, zone.h));
    return {
      w,
      h,
      x: Math.min(100 - w / 2, Math.max(w / 2, zone.x)),
      y: Math.min(100 - h / 2, Math.max(h / 2, zone.y)),
    };
  }

  bindKeyboard() {
    this.box.addEventListener('keydown', (event) => {
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const step = steps[event.key];
      if (!step) return;
      event.preventDefault();
      const amount = event.shiftKey ? 5 : 1;
      const [sx, sy] = [step[0] * amount, step[1] * amount];
      // Alt resizes, everything else nudges — how you land an exact value.
      this.zone = this.clamp(
        event.altKey
          ? { ...this.zone, w: this.zone.w + sx, h: this.zone.h + sy }
          : { ...this.zone, x: this.zone.x + sx, y: this.zone.y + sy }
      );
      this.render();
    });
  }

  clear() {
    this.zone = { ...DEFAULT_ZONE };
    this.render();
  }

  /* -- output ------------------------------------------------------------ */

  // Everything the merchant sees and copies is whole-percent, because the
  // theme editor's sliders are step:1 — emitting 37.4 would silently round
  // and their preview would drift from what they placed.
  get rounded() {
    return {
      x: round(this.zone.x),
      y: round(this.zone.y),
      w: round(this.zone.w),
      h: round(this.zone.h),
    };
  }

  render() {
    const zone = this.rounded;
    this.box.style.left = `${zone.x}%`;
    this.box.style.top = `${zone.y}%`;
    this.box.style.width = `${zone.w}%`;
    this.box.style.height = `${zone.h}%`;

    Object.entries(zone).forEach(([key, value]) => {
      const out = this.querySelector(`[data-zp-out="${key}"]`);
      if (out) out.textContent = value;
    });

    const link = this.querySelector('[data-zp-preview]');
    if (link) {
      const base = this.dataset.designerUrl || '/pages/designer';
      link.href = `${base}?canvas=${encodeURIComponent(this.canvas.key)}&zone=${zone.x},${zone.y},${zone.w},${zone.h}`;
    }
  }

  async copy() {
    const zone = this.rounded;
    const text = [
      `${this.canvas.label} → Restricted area`,
      `Center — horizontal: ${zone.x}`,
      `Center — vertical: ${zone.y}`,
      `Width: ${zone.w}`,
      `Height: ${zone.h}`,
    ].join('\n');

    const button = this.querySelector('[data-zp-copy]');
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      // Clipboard API needs a secure context; fall back for plain http.
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try {
        document.execCommand('copy');
      } catch (fallbackError) {
        console.error('[zone picker] copy failed:', fallbackError);
      }
      field.remove();
    }
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = original;
    }, 1600);
  }
}

customElements.define('zone-picker', ZonePicker);

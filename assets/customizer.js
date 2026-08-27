/**
 * KA Design Studio.
 *
 * Photo mode: real garment "canvases" (photo + colorway swatches + size
 * variants + product) defined as section blocks; the picker page links
 * here with ?canvas=<handle>. Placements are stored per canvas as
 * percentages of the stage.
 *
 * On add-to-cart the design is rendered to a PNG: a thumbnail is kept
 * in localStorage so the cart shows the actual design, and — when a
 * Cloudinary unsigned preset is configured in theme settings — the
 * full preview is uploaded and its URL attached to the order as the
 * "Design preview" line item property.
 *
 * Designs may carry a per-placement price; the total is charged by
 * adding the configured $1 "fee product" at quantity = total fee.
 *
 * Legacy mode (no canvas blocks): the original tee/hoodie SVG mockups.
 */

function money(cents) {
  return (cents / 100).toLocaleString(document.documentElement.lang || 'en', {
    style: 'currency',
    currency: window.Shopify?.currency?.active || 'USD',
  });
}

class KaCustomizer extends HTMLElement {
  connectedCallback() {
    try {
      const parsed = JSON.parse(this.querySelector('[data-kc-config]').textContent);
      this.config = {
        designs: (parsed.designs || []).filter(Boolean),
        canvases: (parsed.canvases || []).filter(Boolean).map((canvas) => ({
          ...canvas,
          colorways: (canvas.colorways || []).filter(Boolean),
          variants: (canvas.variants || []).filter(Boolean),
        })),
        variants: parsed.variants || {},
        prices: parsed.prices || {},
        feeVariant: parsed.feeVariant || null,
        upload: parsed.upload || {},
      };
    } catch (error) {
      console.error('[studio] bad config', error);
      this.config = { designs: [], canvases: [], variants: {}, prices: {}, upload: {} };
    }

    this.photoMode = this.config.canvases.length > 0;
    this.feesEnabled = Boolean(this.config.feeVariant);

    this.state = {
      canvasIndex: 0,
      colorwayIndex: 0,
      sizeIndex: 0,
      garment: 'tee',
      view: 'front',
      color: '#ffffff',
      placements: {},
      selected: null,
    };

    this.pointers = new Map();
    this.dragBase = null;
    this.gestureBase = null;

    this.stage = this.querySelector('[data-kc-stage]');
    this.placementsEl = this.querySelector('[data-kc-placements]');
    this.tools = this.querySelector('[data-kc-tools]');
    this.photoEl = this.querySelector('[data-kc-photo]');
    this.zoneEl = this.querySelector('[data-kc-restricted]');

    const params = new URLSearchParams(window.location.search);
    const requestedCanvas = params.get('canvas') || params.get('garment');
    this.requestedColorway = params.get('colorway');
    if (this.photoMode && requestedCanvas) {
      const index = this.config.canvases.findIndex((c) => c.key === requestedCanvas);
      if (index >= 0) this.state.canvasIndex = index;
    } else if (!this.photoMode && (requestedCanvas === 'tee' || requestedCanvas === 'hoodie')) {
      this.state.garment = requestedCanvas;
      this.querySelectorAll('[data-kc-garment]').forEach((b) =>
        b.setAttribute('aria-current', b.dataset.kcGarment === requestedCanvas ? 'true' : 'false')
      );
    }

    this.renderDesignTray();
    if (this.photoMode) this.setCanvas(this.state.canvasIndex);
    else {
      this.updateGarment();
      this.updateCommerce();
    }
    this.bindEvents();
  }

  get currentCanvas() {
    return this.config.canvases[this.state.canvasIndex];
  }

  get key() {
    return this.photoMode ? `${this.currentCanvas.key}-${this.state.view}` : `${this.state.garment}-${this.state.view}`;
  }

  get currentPlacements() {
    return (this.state.placements[this.key] ||= []);
  }

  /* -- setup ------------------------------------------------------------ */

  renderDesignTray() {
    const tray = this.querySelector('[data-kc-designs]');
    const empty = this.querySelector('[data-kc-designs-empty]');
    if (this.config.designs.length === 0) return;
    empty?.remove();
    tray.insertAdjacentHTML(
      'beforeend',
      this.config.designs
        .map((d, i) => {
          const badge = this.feesEnabled && d.price > 0 ? `<span class="kc__design-price">+$${d.price}</span>` : '';
          return `
        <button type="button" class="kc__design" data-kc-design="${i}" title="${d.label}">
          <img src="${d.src}" alt="${d.label}" loading="lazy" crossorigin="anonymous">
          ${badge}
        </button>`;
        })
        .join('')
    );
  }

  bindEvents() {
    this.addEventListener('click', (event) => {
      const canvasButton = event.target.closest('[data-kc-canvas]');
      if (canvasButton) {
        const index = this.config.canvases.findIndex((c) => c.key === canvasButton.dataset.kcCanvas);
        if (index >= 0) this.setCanvas(index);
        return;
      }

      const colorwayButton = event.target.closest('[data-kc-colorway]');
      if (colorwayButton) return this.setColorway(Number(colorwayButton.dataset.kcColorway));

      const sizeButton = event.target.closest('[data-kc-size]');
      if (sizeButton && !sizeButton.disabled) return this.setSize(Number(sizeButton.dataset.kcSize));

      const garmentButton = event.target.closest('[data-kc-garment]');
      if (garmentButton) return this.setGarment(garmentButton.dataset.kcGarment);

      const viewButton = event.target.closest('[data-kc-view]');
      if (viewButton) return this.setView(viewButton.dataset.kcView);

      const colorButton = event.target.closest('[data-kc-color]');
      if (colorButton) return this.setColor(colorButton);

      const designButton = event.target.closest('[data-kc-design]');
      if (designButton) return this.addPlacement(Number(designButton.dataset.kcDesign));

      const tool = event.target.closest('[data-kc-tool]');
      if (tool) return this.applyTool(tool.dataset.kcTool);

      if (event.target.closest('[data-kc-add]')) return this.addToCart();
      if (event.target.closest('[data-kc-download]')) return this.download();
    });

    this.bindPointerEvents();

    // Subtle perspective tilt (desktop hover only, never during touch).
    const wrap = this.querySelector('[data-kc-tilt]');
    if (wrap && window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) {
      this.stage.addEventListener('pointermove', (event) => {
        if (this.dragBase || this.gestureBase) return;
        const rect = this.stage.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        wrap.style.transform = `rotateY(${x * 10}deg) rotateX(${y * -7}deg)`;
      });
      this.stage.addEventListener('pointerleave', () => {
        wrap.style.transform = '';
      });
    }
  }

  /* -- pointer input: drag, and two-finger pinch/rotate ------------------ */

  bindPointerEvents() {
    this.stage.addEventListener('pointerdown', (event) => {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const item = event.target.closest('[data-kc-item]');
      if (item) {
        event.preventDefault();
        this.select(Number(item.dataset.kcItem));
        const placement = this.currentPlacements[this.state.selected];
        this.dragBase = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          px: placement.x,
          py: placement.y,
        };
      } else if (this.pointers.size === 1) {
        this.select(null);
      }

      // Second finger while a design is selected: begin pinch/rotate.
      if (this.pointers.size === 2 && this.state.selected !== null) {
        const [a, b] = [...this.pointers.values()];
        const placement = this.currentPlacements[this.state.selected];
        if (placement) {
          this.gestureBase = {
            dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
            angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
            scale: placement.scale,
            rot: placement.rot,
          };
        }
      }
    });

    window.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const placement = this.state.selected !== null ? this.currentPlacements[this.state.selected] : null;
      if (!placement) return;

      if (this.gestureBase && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        placement.scale = Math.min(2.4, Math.max(0.3, this.gestureBase.scale * (dist / this.gestureBase.dist)));
        placement.rot = Math.round(this.gestureBase.rot + (angle - this.gestureBase.angle));
        this.renderPlacements();
        return;
      }

      if (this.dragBase && event.pointerId === this.dragBase.pointerId) {
        const rect = this.stage.getBoundingClientRect();
        let x = Math.min(95, Math.max(5, this.dragBase.px + ((event.clientX - this.dragBase.x) / rect.width) * 100));
        let y = Math.min(95, Math.max(5, this.dragBase.py + ((event.clientY - this.dragBase.y) / rect.height) * 100));
        const zone = this.photoMode ? this.currentCanvas.noGoZone : null;
        if (zone) [x, y] = this.clampOutsideZone(x, y, zone);
        placement.x = x;
        placement.y = y;
        this.renderPlacements();
      }
    });

    const endPointer = (event) => {
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.gestureBase = null;
      if (this.dragBase && event.pointerId === this.dragBase.pointerId) {
        // Hand the drag to a remaining finger, if any.
        const remaining = [...this.pointers.entries()][0];
        const placement = this.state.selected !== null ? this.currentPlacements[this.state.selected] : null;
        this.dragBase = remaining && placement
          ? { pointerId: remaining[0], x: remaining[1].x, y: remaining[1].y, px: placement.x, py: placement.y }
          : null;
      }
    };
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);
  }

  /* -- photo mode: canvases, colorways, sizes ---------------------------- */

  setCanvas(index) {
    this.state.canvasIndex = index;
    this.state.colorwayIndex = 0;
    this.state.view = 'front';
    this.state.selected = null;

    // Honor a colorway carried over from the picker page, once.
    if (this.requestedColorway) {
      const wanted = this.config.canvases[index].colorways.findIndex(
        (c) => (c.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === this.requestedColorway
      );
      if (wanted >= 0) this.state.colorwayIndex = wanted;
      this.requestedColorway = null;
    }
    const firstAvailable = this.currentCanvas.variants.findIndex((v) => v.available);
    this.state.sizeIndex = firstAvailable >= 0 ? firstAvailable : 0;
    if (this.tools) this.tools.hidden = true;

    this.querySelectorAll('[data-kc-canvas]').forEach((b) =>
      b.setAttribute('aria-current', b.dataset.kcCanvas === this.currentCanvas.key ? 'true' : 'false')
    );
    const viewGroup = this.querySelector('[data-kc-photo-view-group]');
    if (viewGroup) {
      viewGroup.hidden = !this.currentCanvas.colorways.some((c) => c.back);
      viewGroup.querySelectorAll('[data-kc-view]').forEach((b) =>
        b.setAttribute('aria-current', b.dataset.kcView === 'front' ? 'true' : 'false')
      );
    }
    this.updatePhoto();
    this.renderColorways();
    this.renderSizes();
    this.renderZone();
    this.updateCommerce();
    this.renderPlacements();
  }

  renderZone() {
    if (!this.zoneEl) return;
    const zone = this.photoMode ? this.currentCanvas.noGoZone : null;
    this.zoneEl.hidden = !zone;
    if (zone) {
      this.zoneEl.style.left = `${zone.x}%`;
      this.zoneEl.style.top = `${zone.y}%`;
      this.zoneEl.style.width = `${zone.w}%`;
      this.zoneEl.style.height = `${zone.h}%`;
    }
  }

  // Pushes a point that falls inside a restricted rectangle out to its
  // nearest edge, so a design placement slides around it instead of
  // landing on it.
  clampOutsideZone(px, py, zone) {
    const left = zone.x - zone.w / 2;
    const right = zone.x + zone.w / 2;
    const top = zone.y - zone.h / 2;
    const bottom = zone.y + zone.h / 2;
    if (px < left || px > right || py < top || py > bottom) return [px, py];

    const margin = 1.5;
    const distances = { left: px - left, right: right - px, top: py - top, bottom: bottom - py };
    const nearest = Object.keys(distances).reduce((a, b) => (distances[a] <= distances[b] ? a : b));
    if (nearest === 'left') return [Math.max(5, left - margin), py];
    if (nearest === 'right') return [Math.min(95, right + margin), py];
    if (nearest === 'top') return [px, Math.max(5, top - margin)];
    return [px, Math.min(95, bottom + margin)];
  }

  setColorway(index) {
    this.state.colorwayIndex = index;
    if (this.state.view === 'back' && !this.currentCanvas.colorways[index]?.back) {
      this.state.view = 'front';
      this.querySelectorAll('[data-kc-photo-view-group] [data-kc-view]').forEach((b) =>
        b.setAttribute('aria-current', b.dataset.kcView === 'front' ? 'true' : 'false')
      );
    }
    this.state.selected = null;
    this.updatePhoto();
    this.renderColorways();
    this.renderPlacements();
  }

  setSize(index) {
    this.state.sizeIndex = index;
    this.renderSizes();
    this.updateCommerce();
  }

  updatePhoto() {
    if (!this.photoEl) return;
    const colorway = this.currentCanvas.colorways[this.state.colorwayIndex] || this.currentCanvas.colorways[0];
    const showBack = this.state.view === 'back' && colorway.back;
    this.photoEl.src = showBack ? colorway.back : colorway.front;
    this.photoEl.alt = `${this.currentCanvas.label} — ${colorway.name}${showBack ? ' (back)' : ''}`;
  }

  renderColorways() {
    const group = this.querySelector('[data-kc-colorway-group]');
    const holder = this.querySelector('[data-kc-colorways]');
    const nameEl = this.querySelector('[data-kc-colorway-name]');
    if (!group || !holder) return;

    const colorways = this.currentCanvas.colorways;
    group.hidden = colorways.length < 2;
    if (nameEl) nameEl.textContent = colorways[this.state.colorwayIndex]?.name || '';

    holder.innerHTML = colorways
      .map(
        (c, i) => `
      <button type="button" class="kc__colorway" data-kc-colorway="${i}" aria-current="${i === this.state.colorwayIndex}" title="${c.name}">
        <img src="${c.front}" alt="${c.name}" loading="lazy">
      </button>`
      )
      .join('');
  }

  renderSizes() {
    const group = this.querySelector('[data-kc-size-group]');
    const holder = this.querySelector('[data-kc-sizes]');
    if (!group || !holder) return;

    const variants = this.currentCanvas.variants;
    const hasSizes = variants.length > 1 || (variants.length === 1 && variants[0].title !== 'Default Title');
    group.hidden = !hasSizes;
    if (!hasSizes) return;

    holder.innerHTML = variants
      .map(
        (v, i) => `
      <button type="button" class="kc__size" data-kc-size="${i}" aria-current="${i === this.state.sizeIndex}" ${v.available ? '' : 'disabled'}>
        ${v.title}
      </button>`
      )
      .join('');
  }

  /* -- legacy mode state changes ----------------------------------------- */

  setGarment(garment) {
    this.state.garment = garment;
    this.state.selected = null;
    this.querySelectorAll('[data-kc-garment]').forEach((b) =>
      b.setAttribute('aria-current', b.dataset.kcGarment === garment ? 'true' : 'false')
    );
    this.updateGarment();
    this.updateCommerce();
  }

  setView(view) {
    this.state.view = view;
    this.state.selected = null;
    this.querySelectorAll('[data-kc-view]').forEach((b) =>
      b.setAttribute('aria-current', b.dataset.kcView === view ? 'true' : 'false')
    );
    if (this.photoMode) {
      this.updatePhoto();
      this.renderPlacements();
    } else {
      this.updateGarment();
    }
  }

  setColor(button) {
    this.state.color = button.dataset.kcColor;
    this.querySelectorAll('[data-kc-color]').forEach((b) =>
      b.setAttribute('aria-current', b === button ? 'true' : 'false')
    );
    this.style.setProperty('--kc-garment-color', this.state.color);
  }

  updateGarment() {
    const shape = `${this.state.garment}-${this.state.view}`;
    this.querySelectorAll('[data-kc-shape]').forEach((g) => {
      g.hidden = g.dataset.kcShape !== shape;
    });
    this.style.setProperty('--kc-garment-color', this.state.color);
    this.renderPlacements();
  }

  /* -- commerce ----------------------------------------------------------- */

  selectedVariant() {
    if (!this.photoMode) return this.config.variants[this.state.garment];
    const variants = this.currentCanvas.variants;
    return variants[this.state.sizeIndex]?.id || this.currentCanvas.variant;
  }

  basePriceCents() {
    if (!this.photoMode) return this.config.prices[this.state.garment];
    const variants = this.currentCanvas.variants;
    return variants[this.state.sizeIndex]?.price ?? this.currentCanvas.price;
  }

  feeDollars() {
    if (!this.feesEnabled || !this.photoMode) return 0;
    const canvas = this.currentCanvas;
    const all = [
      ...(this.state.placements[`${canvas.key}-front`] || []),
      ...(this.state.placements[`${canvas.key}-back`] || []),
    ];
    return all.reduce((sum, p) => sum + Math.max(0, Math.round(this.config.designs[p.design]?.price || 0)), 0);
  }

  updateCommerce() {
    const addButton = this.querySelector('[data-kc-add]');
    const note = this.querySelector('[data-kc-note]');
    const variant = this.selectedVariant();
    if (addButton) addButton.hidden = !variant;
    if (note) note.hidden = Boolean(variant);
    const priceEl = this.querySelector('[data-kc-price]');
    const base = this.basePriceCents();
    if (priceEl && base != null) priceEl.textContent = money(base + this.feeDollars() * 100);
  }

  /* -- placements ------------------------------------------------------- */

  addPlacement(designIndex) {
    let x = 50;
    let y = 42;
    const zone = this.photoMode ? this.currentCanvas.noGoZone : null;
    if (zone) [x, y] = this.clampOutsideZone(x, y, zone);
    this.currentPlacements.push({ design: designIndex, x, y, scale: 1, rot: 0 });
    this.select(this.currentPlacements.length - 1);
    this.updateCommerce();
  }

  select(index) {
    this.state.selected = index;
    if (this.tools) this.tools.hidden = index === null;
    this.renderPlacements();
  }

  applyTool(tool) {
    const placement = this.currentPlacements[this.state.selected];
    if (!placement) return;
    if (tool === 'bigger') placement.scale = Math.min(2.4, placement.scale + 0.12);
    if (tool === 'smaller') placement.scale = Math.max(0.3, placement.scale - 0.12);
    if (tool === 'rotate-left') placement.rot -= 10;
    if (tool === 'rotate-right') placement.rot += 10;
    if (tool === 'delete') {
      this.currentPlacements.splice(this.state.selected, 1);
      this.state.selected = null;
      if (this.tools) this.tools.hidden = true;
      this.updateCommerce();
    }
    this.renderPlacements();
  }

  renderPlacements() {
    this.placementsEl.innerHTML = this.currentPlacements
      .map((p, i) => {
        const design = this.config.designs[p.design];
        if (!design) return '';
        return `
      <div class="kc__item${i === this.state.selected ? ' kc__item--selected' : ''}"
           data-kc-item="${i}"
           style="left: ${p.x}%; top: ${p.y}%; width: ${24 * p.scale}%; transform: translate(-50%, -50%) rotate(${p.rot}deg);">
        <img src="${design.src}" alt="${design.label}" draggable="false" crossorigin="anonymous">
      </div>`;
      })
      .join('');
  }

  /* -- output ----------------------------------------------------------- */

  describePlacement(p) {
    const label = this.config.designs[p.design]?.label || 'Design';
    const scale = p.scale !== 1 ? ` ×${p.scale.toFixed(2)}` : '';
    const rot = p.rot ? ` ${p.rot}°` : '';
    return `${label} @ (${Math.round(p.x)}%, ${Math.round(p.y)}%)${scale}${rot}`;
  }

  summarize() {
    if (this.photoMode) {
      const canvas = this.currentCanvas;
      const sides = [
        ['Front', this.state.placements[`${canvas.key}-front`] || []],
        ['Back', this.state.placements[`${canvas.key}-back`] || []],
      ].filter(([, list]) => list.length > 0);
      if (sides.length === 0) return 'blank';
      return sides.map(([side, list]) => `${side}: ${list.map((p) => this.describePlacement(p)).join('; ')}`).join(' | ');
    }
    const parts = [];
    for (const [key, list] of Object.entries(this.state.placements)) {
      if (!key.startsWith(this.state.garment) || list.length === 0) continue;
      const side = key.split('-')[1];
      parts.push(`${side}: ${list.map((p) => this.describePlacement(p)).join('; ')}`);
    }
    return parts.join(' | ') || 'blank';
  }

  /* -- preview rendering / persistence ---------------------------------- */

  loadImage(src, cors) {
    return new Promise((resolve) => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async renderPreview() {
    if (this.photoMode) return this.renderPhotoPreview();

    const width = 900;
    let baseImage = null;
    let svgUrl = null;
    try {
      const svg = this.querySelector('[data-kc-garment-svg]').cloneNode(true);
      svg.querySelectorAll('[data-kc-shape]').forEach((g) => {
        if (g.dataset.kcShape !== `${this.state.garment}-${this.state.view}`) g.remove();
        else g.hidden = false;
      });
      svg.querySelectorAll('.kc-fill').forEach((p) => p.setAttribute('fill', this.state.color));
      svg.setAttribute('width', width);
      svg.setAttribute('height', 1080);
      svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      baseImage = await this.loadImage(svgUrl, false);
      if (!baseImage) return null;

      const height = 1080;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(baseImage, 0, 0, width, height);
      await this.paintPlacements(ctx, this.currentPlacements, 0, width, height);
      return canvas;
    } catch (error) {
      console.error('[studio] preview render failed:', error);
      return null;
    } finally {
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    }
  }

  async paintPlacements(ctx, placements, offsetX, panelWidth, panelHeight) {
    for (const p of placements) {
      const design = this.config.designs[p.design];
      if (!design) continue;
      const img = await this.loadImage(design.src, true);
      if (!img) continue;
      const w = panelWidth * 0.24 * p.scale;
      const h = w * (img.naturalHeight / img.naturalWidth);
      ctx.save();
      ctx.translate(offsetX + (p.x / 100) * panelWidth, (p.y / 100) * panelHeight);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  async renderPhotoPreview() {
    try {
      const width = 900;
      const canvasDef = this.currentCanvas;
      const colorway = canvasDef.colorways[this.state.colorwayIndex];
      const frontPlacements = this.state.placements[`${canvasDef.key}-front`] || [];
      const backPlacements = this.state.placements[`${canvasDef.key}-back`] || [];
      const showBack = Boolean(colorway.back) && backPlacements.length > 0;

      const frontImage = await this.loadImage(colorway.front, true);
      if (!frontImage) return null;
      const backImage = showBack ? await this.loadImage(colorway.back, true) : null;

      const gap = showBack ? 8 : 0;
      const panelWidth = showBack ? Math.round((width - gap) / 2) : width;
      const panelHeight = Math.round(panelWidth * (frontImage.naturalHeight / frontImage.naturalWidth));

      const canvas = document.createElement('canvas');
      canvas.width = showBack ? panelWidth * 2 + gap : panelWidth;
      canvas.height = panelHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(frontImage, 0, 0, panelWidth, panelHeight);
      await this.paintPlacements(ctx, frontPlacements, 0, panelWidth, panelHeight);

      if (showBack && backImage) {
        const backX = panelWidth + gap;
        ctx.drawImage(backImage, backX, 0, panelWidth, panelHeight);
        await this.paintPlacements(ctx, backPlacements, backX, panelWidth, panelHeight);
      }
      return canvas;
    } catch (error) {
      console.error('[studio] preview render failed:', error);
      return null;
    }
  }

  thumbnailDataUrl(canvas) {
    const thumb = document.createElement('canvas');
    const width = 320;
    thumb.width = width;
    thumb.height = Math.round(width * (canvas.height / canvas.width));
    thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
    return thumb.toDataURL('image/jpeg', 0.75);
  }

  async uploadPreview(canvas) {
    const { cloud, preset } = this.config.upload;
    if (!cloud || !preset) return null;
    try {
      const body = new FormData();
      body.append('file', canvas.toDataURL('image/jpeg', 0.85));
      body.append('upload_preset', preset);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await response.json();
      return data.secure_url || null;
    } catch (error) {
      console.error('[studio] preview upload failed (order will carry coordinates only):', error);
      return null;
    }
  }

  /* -- cart --------------------------------------------------------------- */

  buildProperties(designId, previewUrl) {
    const base = this.photoMode
      ? {
          Product: this.currentCanvas.label,
          Colorway: this.currentCanvas.colorways[this.state.colorwayIndex]?.name || 'Standard',
        }
      : {
          Garment: this.state.garment === 'tee' ? 'Tee' : 'Hoodie',
          Color: this.querySelector(`[data-kc-color="${this.state.color}"]`)?.getAttribute('aria-label') || this.state.color,
        };
    return {
      ...base,
      Design: this.summarize(),
      ...(previewUrl ? { 'Design preview': previewUrl } : {}),
      _design_id: designId,
      _config: JSON.stringify({
        canvas: this.photoMode ? this.currentCanvas.key : this.state.garment,
        colorway: this.photoMode ? this.currentCanvas.colorways[this.state.colorwayIndex]?.name : this.state.color,
        placements: this.photoMode
          ? {
              front: this.state.placements[`${this.currentCanvas.key}-front`] || [],
              back: this.state.placements[`${this.currentCanvas.key}-back`] || [],
            }
          : this.currentPlacements,
      }),
    };
  }

  async addToCart() {
    const variant = this.selectedVariant();
    if (!variant) return;

    const addButton = this.querySelector('[data-kc-add]');
    addButton?.setAttribute('aria-disabled', 'true');

    try {
      const designId = `kad-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
      const preview = await this.renderPreview();
      let previewUrl = null;
      if (preview) {
        window.themeDesignPreviews?.put(designId, this.thumbnailDataUrl(preview));
        previewUrl = await this.uploadPreview(preview);
      }

      const properties = this.buildProperties(designId, previewUrl);
      const items = [{ id: Number(variant), quantity: 1, properties }];

      const fee = this.feeDollars();
      if (fee > 0 && this.config.feeVariant) {
        items.push({
          id: Number(this.config.feeVariant),
          quantity: fee,
          properties: { For: this.currentCanvas.label, _design_id: designId },
        });
      }

      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await response.json();
      if (!response.ok || data.status) throw new Error(data.description || data.message);
      const cart = await (await fetch('/cart.js')).json();
      document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
      document.querySelector('cart-drawer')?.open();
    } catch (error) {
      console.error('[studio] add to cart failed:', error);
    } finally {
      addButton?.removeAttribute('aria-disabled');
    }
  }

  async download() {
    const canvas = await this.renderPreview();
    if (!canvas) {
      console.error('[studio] preview export failed');
      return;
    }
    const link = document.createElement('a');
    link.download = `ka-custom-${this.photoMode ? this.currentCanvas.key : this.key}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }
}

customElements.define('ka-customizer', KaCustomizer);

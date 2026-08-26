/**
 * KA Design Studio.
 *
 * Photo mode: real garment "canvases" (photo + colorway swatches +
 * product) defined as section blocks; the picker page links here with
 * ?canvas=<handle> to open the chosen garment. Placements are stored
 * per canvas as percentages of the stage.
 *
 * Legacy mode (no canvas blocks): the original tee/hoodie SVG mockups
 * with flat colors and front/back views.
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
        })),
        variants: parsed.variants || {},
        prices: parsed.prices || {},
      };
    } catch (error) {
      console.error('[studio] bad config', error);
      this.config = { designs: [], canvases: [], variants: {}, prices: {} };
    }

    this.photoMode = this.config.canvases.length > 0;

    this.state = {
      canvasIndex: 0,
      colorwayIndex: 0,
      garment: 'tee',
      view: 'front',
      color: '#ffffff',
      placements: {},
      selected: null,
    };

    this.stage = this.querySelector('[data-kc-stage]');
    this.placementsEl = this.querySelector('[data-kc-placements]');
    this.tools = this.querySelector('[data-kc-tools]');
    this.photoEl = this.querySelector('[data-kc-photo]');

    // The picker page links here with ?canvas=<handleized name> (or the
    // legacy ?garment=tee|hoodie).
    const params = new URLSearchParams(window.location.search);
    const requestedCanvas = params.get('canvas') || params.get('garment');
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
    return this.photoMode ? this.currentCanvas.key : `${this.state.garment}-${this.state.view}`;
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
        .map(
          (d, i) => `
        <button type="button" class="kc__design" data-kc-design="${i}" title="${d.label}">
          <img src="${d.src}" alt="${d.label}" loading="lazy" crossorigin="anonymous">
        </button>`
        )
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

    // Dragging placements.
    this.placementsEl.addEventListener('pointerdown', (event) => {
      const item = event.target.closest('[data-kc-item]');
      if (!item) return;
      event.preventDefault();
      this.select(Number(item.dataset.kcItem));
      const rect = this.stage.getBoundingClientRect();
      const placement = this.currentPlacements[this.state.selected];
      const startX = event.clientX;
      const startY = event.clientY;
      const origX = placement.x;
      const origY = placement.y;
      this.dragging = true;

      const move = (e) => {
        placement.x = Math.min(95, Math.max(5, origX + ((e.clientX - startX) / rect.width) * 100));
        placement.y = Math.min(95, Math.max(5, origY + ((e.clientY - startY) / rect.height) * 100));
        this.renderPlacements();
      };
      const up = () => {
        this.dragging = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    // Deselect when tapping empty stage space.
    this.stage.addEventListener('pointerdown', (event) => {
      if (!event.target.closest('[data-kc-item]')) this.select(null);
    });

    // Subtle perspective tilt.
    const wrap = this.querySelector('[data-kc-tilt]');
    if (wrap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.stage.addEventListener('pointermove', (event) => {
        if (this.dragging) return;
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

  /* -- photo mode: canvases & colorways --------------------------------- */

  setCanvas(index) {
    this.state.canvasIndex = index;
    this.state.colorwayIndex = 0;
    this.state.selected = null;
    if (this.tools) this.tools.hidden = true;

    this.querySelectorAll('[data-kc-canvas]').forEach((b) =>
      b.setAttribute('aria-current', b.dataset.kcCanvas === this.currentCanvas.key ? 'true' : 'false')
    );
    this.updatePhoto();
    this.renderColorways();
    this.updateCommerce();
    this.renderPlacements();
  }

  setColorway(index) {
    this.state.colorwayIndex = index;
    this.updatePhoto();
    this.renderColorways();
  }

  updatePhoto() {
    if (!this.photoEl) return;
    const colorway = this.currentCanvas.colorways[this.state.colorwayIndex] || this.currentCanvas.colorways[0];
    this.photoEl.src = colorway.src;
    this.photoEl.alt = `${this.currentCanvas.label} — ${colorway.name}`;
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
        <img src="${c.src}" alt="${c.name}" loading="lazy">
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
    this.updateGarment();
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

  currentVariant() {
    return this.photoMode ? this.currentCanvas.variant : this.config.variants[this.state.garment];
  }

  currentPrice() {
    return this.photoMode ? this.currentCanvas.price : this.config.prices[this.state.garment];
  }

  updateCommerce() {
    const addButton = this.querySelector('[data-kc-add]');
    const note = this.querySelector('[data-kc-note]');
    const variant = this.currentVariant();
    if (addButton) addButton.hidden = !variant;
    if (note) note.hidden = Boolean(variant);
    const priceEl = this.querySelector('[data-kc-price]');
    if (priceEl && this.currentPrice()) priceEl.textContent = money(this.currentPrice());
  }

  /* -- placements ------------------------------------------------------- */

  addPlacement(designIndex) {
    this.currentPlacements.push({ design: designIndex, x: 50, y: 42, scale: 1, rot: 0 });
    this.select(this.currentPlacements.length - 1);
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
      const list = this.currentPlacements;
      return list.length ? list.map((p) => this.describePlacement(p)).join('; ') : 'blank';
    }
    const parts = [];
    for (const [key, list] of Object.entries(this.state.placements)) {
      if (!key.startsWith(this.state.garment) || list.length === 0) continue;
      const side = key.split('-')[1];
      parts.push(`${side}: ${list.map((p) => this.describePlacement(p)).join('; ')}`);
    }
    return parts.join(' | ') || 'blank';
  }

  buildProperties() {
    if (this.photoMode) {
      const colorway = this.currentCanvas.colorways[this.state.colorwayIndex];
      return {
        Product: this.currentCanvas.label,
        Colorway: colorway?.name || 'Standard',
        Design: this.summarize(),
        _config: JSON.stringify({
          canvas: this.currentCanvas.key,
          colorway: colorway?.name,
          placements: this.currentPlacements,
        }),
      };
    }
    const colorButton = this.querySelector(`[data-kc-color="${this.state.color}"]`);
    return {
      Garment: this.state.garment === 'tee' ? 'Tee' : 'Hoodie',
      Color: colorButton?.getAttribute('aria-label') || this.state.color,
      Design: this.summarize(),
      _config: JSON.stringify({
        color: this.state.color,
        placements: {
          [`${this.state.garment}-front`]: this.state.placements[`${this.state.garment}-front`] || [],
          [`${this.state.garment}-back`]: this.state.placements[`${this.state.garment}-back`] || [],
        },
      }),
    };
  }

  async addToCart() {
    const variant = this.currentVariant();
    if (!variant) return;

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: Number(variant), quantity: 1, properties: this.buildProperties() }] }),
      });
      const data = await response.json();
      if (!response.ok || data.status) throw new Error(data.description || data.message);
      const cart = await (await fetch('/cart.js')).json();
      document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
      document.querySelector('cart-drawer')?.open();
    } catch (error) {
      console.error('[studio] add to cart failed:', error);
    }
  }

  loadImage(src, cors) {
    return new Promise((resolve) => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async download() {
    const width = 900;
    let baseImage = null;
    let svgUrl = null;

    if (this.photoMode) {
      const colorway = this.currentCanvas.colorways[this.state.colorwayIndex];
      baseImage = await this.loadImage(colorway.src, true);
      if (!baseImage) {
        console.error('[studio] preview export failed: photo did not load');
        return;
      }
    } else {
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
    }

    try {
      const height = this.photoMode
        ? Math.round(width * (baseImage.naturalHeight / baseImage.naturalWidth))
        : 1080;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(0, 0, width, height);
      if (baseImage) ctx.drawImage(baseImage, 0, 0, width, height);

      for (const p of this.currentPlacements) {
        const design = this.config.designs[p.design];
        if (!design) continue;
        const img = await this.loadImage(design.src, true);
        if (!img) continue;
        const w = width * 0.24 * p.scale;
        const h = w * (img.naturalHeight / img.naturalWidth);
        ctx.save();
        ctx.translate((p.x / 100) * width, (p.y / 100) * height);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }

      const link = document.createElement('a');
      link.download = `ka-custom-${this.key}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('[studio] preview export failed:', error);
    } finally {
      if (svgUrl) URL.revokeObjectURL(svgUrl);
    }
  }
}

customElements.define('ka-customizer', KaCustomizer);

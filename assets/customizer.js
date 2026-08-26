/**
 * KA Design Studio: place brand designs on a tee/hoodie mockup.
 * Placements are stored per garment+side as percentages of the stage,
 * so they survive garment/view/color switches and window resizes.
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
      this.config = JSON.parse(this.querySelector('[data-kc-config]').textContent);
    } catch (error) {
      console.error('[studio] bad config', error);
      this.config = { designs: [], variants: {}, prices: {} };
    }

    this.state = {
      garment: 'tee',
      view: 'front',
      color: '#ffffff',
      // placements['tee-front'] = [{design, x, y, scale, rot}] with x/y as
      // percentages of the stage and scale relative to a 30%-wide base.
      placements: {},
      selected: null,
    };

    this.stage = this.querySelector('[data-kc-stage]');
    this.placementsEl = this.querySelector('[data-kc-placements]');
    this.tools = this.querySelector('[data-kc-tools]');

    // The picker page links here with ?garment=tee|hoodie preselected.
    const requested = new URLSearchParams(window.location.search).get('garment');
    if (requested === 'tee' || requested === 'hoodie') {
      this.state.garment = requested;
      this.querySelectorAll('[data-kc-garment]').forEach((b) =>
        b.setAttribute('aria-current', b.dataset.kcGarment === requested ? 'true' : 'false')
      );
    }

    this.renderDesignTray();
    this.updateGarment();
    this.updateCommerce();
    this.bindEvents();
  }

  get key() {
    return `${this.state.garment}-${this.state.view}`;
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

  /* -- state changes ---------------------------------------------------- */

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

  updateCommerce() {
    const addButton = this.querySelector('[data-kc-add]');
    const note = this.querySelector('[data-kc-note]');
    const variant = this.config.variants[this.state.garment];
    if (addButton) addButton.hidden = !variant;
    if (note) note.hidden = Boolean(variant);
    const priceEl = this.querySelector('[data-kc-price]');
    if (priceEl && this.config.prices[this.state.garment]) {
      priceEl.textContent = money(this.config.prices[this.state.garment]);
    }
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
           style="left: ${p.x}%; top: ${p.y}%; width: ${30 * p.scale}%; transform: translate(-50%, -50%) rotate(${p.rot}deg);">
        <img src="${design.src}" alt="${design.label}" draggable="false" crossorigin="anonymous">
      </div>`;
      })
      .join('');
  }

  /* -- output ----------------------------------------------------------- */

  summarize() {
    const parts = [];
    for (const [key, list] of Object.entries(this.state.placements)) {
      if (!key.startsWith(this.state.garment) || list.length === 0) continue;
      const side = key.split('-')[1];
      parts.push(`${side}: ${list.map((p) => this.config.designs[p.design]?.label).join(', ')}`);
    }
    return parts.join(' | ') || 'blank';
  }

  async addToCart() {
    const variant = this.config.variants[this.state.garment];
    if (!variant) return;
    const colorButton = this.querySelector(`[data-kc-color="${this.state.color}"]`);
    const properties = {
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

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: Number(variant), quantity: 1, properties }] }),
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

  async download() {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const svg = this.querySelector('[data-kc-garment-svg]').cloneNode(true);
    svg.querySelectorAll('[data-kc-shape]').forEach((g) => {
      if (g.dataset.kcShape !== `${this.state.garment}-${this.state.view}`) g.remove();
      else g.hidden = false;
    });
    svg.querySelectorAll('.kc-fill').forEach((p) => p.setAttribute('fill', this.state.color));
    svg.setAttribute('width', 900);
    svg.setAttribute('height', 1080);

    const svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    try {
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, 900, 1080);
          resolve();
        };
        img.onerror = reject;
        img.src = svgUrl;
      });

      for (const p of this.currentPlacements) {
        const design = this.config.designs[p.design];
        if (!design) continue;
        await new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const w = 900 * 0.3 * p.scale;
            const h = w * (img.naturalHeight / img.naturalWidth);
            ctx.save();
            ctx.translate((p.x / 100) * 900, (p.y / 100) * 1080);
            ctx.rotate((p.rot * Math.PI) / 180);
            ctx.drawImage(img, -w / 2, -h / 2, w, h);
            ctx.restore();
            resolve();
          };
          img.onerror = resolve;
          img.src = design.src;
        });
      }

      const link = document.createElement('a');
      link.download = `ka-custom-${this.state.garment}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('[studio] preview export failed:', error);
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }
}

customElements.define('ka-customizer', KaCustomizer);

/**
 * Auto-playing design showcase: an animated cursor "drops" the brand's
 * designs onto a garment photo in a loop — a living demo of what the
 * design studio can do, built from the same design images the studio
 * uses (no video file to produce or maintain).
 *
 * Placements land inside a configurable "print zone" (data-zone =
 * "centerX,centerY,width,height" as percentages of the photo) so the
 * designs sit on the garment instead of scattering across the frame.
 *
 * If the stage holds multiple [data-demo-frame] photos (colorways),
 * each scene crossfades to the next one.
 */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ShowcaseDemo extends HTMLElement {
  connectedCallback() {
    this.stage = this.querySelector('[data-demo-stage]');
    this.layer = this.querySelector('[data-demo-placements]');
    this.cursor = this.querySelector('[data-demo-cursor]');
    this.chips = Array.from(this.querySelectorAll('[data-demo-chip]'));
    this.frames = Array.from(this.querySelectorAll('[data-demo-frame]'));
    this.compact = this.hasAttribute('data-compact');
    this.sceneOffset = 0;
    this.frameIndex = 0;

    const zone = (this.dataset.zone || '50,44,36,32').split(',').map(Number);
    this.zone = { cx: zone[0], cy: zone[1], w: zone[2], h: zone[3] };
    this.itemSize = Number(this.dataset.itemSize) || 22;

    try {
      // The Liquid-built array ends with a null sentinel (trailing-comma
      // safety); drop it and anything else falsy.
      this.designs = JSON.parse(this.querySelector('[data-demo-designs]').textContent).filter(Boolean);
    } catch (error) {
      this.designs = [];
    }
    if (!this.stage || !this.layer || this.designs.length === 0) return;

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this.reducedMotion) {
      this.renderStaticArrangement();
      return;
    }

    this.active = false;
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) this.start();
        else this.active = false;
      },
      { threshold: 0.35 }
    );
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.active = false;
    this.observer?.disconnect();
  }

  /* -- spot sampling inside the print zone ------------------------------ */

  randomSpot() {
    const { cx, cy, w, h } = this.zone;
    return [cx - w / 2 + Math.random() * w, cy - h / 2 + Math.random() * h];
  }

  sampleSpots(count) {
    const spots = [];
    const minDistance = Math.min(this.zone.w, this.zone.h) * 0.55;
    let attempts = 0;
    while (spots.length < count && attempts < 60) {
      attempts += 1;
      const candidate = this.randomSpot();
      const tooClose = spots.some(
        ([x, y]) => Math.hypot(x - candidate[0], y - candidate[1]) < minDistance
      );
      if (!tooClose) spots.push(candidate);
    }
    while (spots.length < count) spots.push(this.randomSpot());
    return spots;
  }

  renderStaticArrangement() {
    this.sampleSpots(Math.min(3, this.designs.length)).forEach(([x, y], i) =>
      this.placeDesign(this.designs[i], x, y, false)
    );
  }

  /* -- loop -------------------------------------------------------------- */

  start() {
    if (this.active) return;
    this.active = true;
    this.loop();
  }

  async loop() {
    while (this.active) {
      this.advanceFrame();
      await this.playScene();
      if (!this.active) break;
      await wait(1800);
      await this.clearScene();
      await wait(500);
    }
    this.cursor?.classList.remove('showcase__cursor--active');
  }

  advanceFrame() {
    // A shopper-picked colorway pins the frame; stop cycling.
    if (this.pinnedFrame != null || this.frames.length < 2) return;
    this.showFrame((this.frameIndex + 1) % this.frames.length);
  }

  showFrame(index) {
    this.frameIndex = index;
    this.frames.forEach((frame, i) =>
      frame.classList.toggle('showcase__frame--active', i === index)
    );
  }

  pinFrame(index) {
    this.pinnedFrame = index;
    this.showFrame(index);
  }

  async playScene() {
    const count = Math.min(this.compact ? 2 : 3, this.designs.length);
    const spots = this.sampleSpots(count);

    for (let i = 0; i < count; i += 1) {
      if (!this.active) return;
      const design = this.designs[(this.sceneOffset + i) % this.designs.length];
      const chip = this.chips[(this.sceneOffset + i) % (this.chips.length || 1)];
      const [x, y] = spots[i];

      if (this.cursor) {
        this.cursor.classList.add('showcase__cursor--active');
        if (chip) {
          await this.moveCursorToElement(chip);
          this.pulseCursor();
          await wait(250);
        } else if (i === 0) {
          this.jumpCursorToCorner();
          await wait(60);
        }
        await this.moveCursorToSpot(x, y);
      }

      this.placeDesign(design, x, y, true);
      this.pulseCursor();
      await wait(650);
    }
    this.sceneOffset += count;
  }

  async clearScene() {
    this.layer.classList.add('showcase__layer--fading');
    await wait(420);
    this.layer.innerHTML = '';
    this.layer.classList.remove('showcase__layer--fading');
  }

  placeDesign(design, x, y, animate) {
    const el = document.createElement('div');
    el.className = `showcase__item${animate ? ' showcase__item--pop' : ''}`;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.style.width = `${this.itemSize}%`;
    el.style.rotate = `${(Math.random() * 10 - 5).toFixed(1)}deg`;
    el.innerHTML = `<img src="${design.src}" alt="" loading="lazy" draggable="false">`;
    this.layer.appendChild(el);
  }

  /* -- cursor movement (coordinates relative to this element) ---------- */

  localPoint(clientX, clientY) {
    const host = this.getBoundingClientRect();
    return [clientX - host.left, clientY - host.top];
  }

  setCursor(x, y, instant) {
    if (instant) this.cursor.style.transition = 'none';
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
    if (instant) {
      // Force the jump before re-enabling the transition.
      void this.cursor.offsetWidth;
      this.cursor.style.transition = '';
    }
  }

  jumpCursorToCorner() {
    const host = this.getBoundingClientRect();
    this.setCursor(host.width * 0.9, host.height * 0.95, true);
  }

  async moveCursorToElement(el) {
    const rect = el.getBoundingClientRect();
    const [x, y] = this.localPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    this.setCursor(x, y);
    await wait(700);
  }

  async moveCursorToSpot(pctX, pctY) {
    const rect = this.stage.getBoundingClientRect();
    const [x, y] = this.localPoint(rect.left + (pctX / 100) * rect.width, rect.top + (pctY / 100) * rect.height);
    this.setCursor(x, y);
    await wait(750);
  }

  pulseCursor() {
    if (!this.cursor) return;
    this.cursor.classList.remove('showcase__cursor--pulse');
    void this.cursor.offsetWidth;
    this.cursor.classList.add('showcase__cursor--pulse');
  }
}

customElements.define('showcase-demo', ShowcaseDemo);

/* -------------------------------------------------------------------------
 * Picker cards: choosing a colorway swatch pins that photo on the card and
 * carries the choice into the designer link.
 * ---------------------------------------------------------------------- */
document.addEventListener('click', (event) => {
  const swatch = event.target.closest('[data-picker-swatch]');
  if (!swatch) return;

  const card = swatch.closest('.picker-card');
  if (!card) return;

  card.querySelectorAll('[data-picker-swatch]').forEach((el) =>
    el.setAttribute('aria-current', el === swatch ? 'true' : 'false')
  );

  card.querySelector('showcase-demo')?.pinFrame(Number(swatch.dataset.pickerSwatch));

  const link = card.querySelector('.picker-card__link');
  if (link && swatch.dataset.colorway) {
    const url = new URL(link.getAttribute('href'), window.location.origin);
    url.searchParams.set('colorway', swatch.dataset.colorway);
    link.setAttribute('href', `${url.pathname}${url.search}`);
  }
});

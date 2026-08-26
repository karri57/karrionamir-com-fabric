/**
 * Auto-playing design showcase: an animated cursor "drops" the brand's
 * designs onto a garment photo in a loop — a living demo of what the
 * design studio can do, built from the same design images the studio
 * uses (no video file to produce or maintain).
 *
 * Used on the home page promo (with a visible design tray the cursor
 * picks from) and on the picker page's product cards (compact mode:
 * no tray, cursor enters from the corner).
 */

const SPOTS = [
  [50, 36], [33, 30], [67, 30], [50, 54], [35, 56], [65, 56], [50, 70],
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

class ShowcaseDemo extends HTMLElement {
  connectedCallback() {
    this.stage = this.querySelector('[data-demo-stage]');
    this.layer = this.querySelector('[data-demo-placements]');
    this.cursor = this.querySelector('[data-demo-cursor]');
    this.chips = Array.from(this.querySelectorAll('[data-demo-chip]'));
    this.compact = this.hasAttribute('data-compact');
    this.sceneOffset = 0;

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

  renderStaticArrangement() {
    const spots = SPOTS.slice(0, Math.min(3, this.designs.length));
    spots.forEach(([x, y], i) => this.placeDesign(this.designs[i], x, y, false));
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.loop();
  }

  async loop() {
    while (this.active) {
      await this.playScene();
      if (!this.active) break;
      await wait(1800);
      await this.clearScene();
      await wait(500);
    }
    this.cursor?.classList.remove('showcase__cursor--active');
  }

  async playScene() {
    const count = Math.min(this.compact ? 2 : 3, this.designs.length);
    const spots = shuffled(SPOTS).slice(0, count);

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

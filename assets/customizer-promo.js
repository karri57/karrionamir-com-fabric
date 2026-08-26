/**
 * Home page teaser demo: pick up a design from the tray and drop it
 * anywhere on the shirt photo. Purely visual (no cart, no server) —
 * the point is to show what's possible before sending people to the
 * real /pages/design-studio.
 */
class PromoDemo extends HTMLElement {
  connectedCallback() {
    this.stage = this.querySelector('[data-promo-stage]');
    this.placements = this.querySelector('[data-promo-placements]');
    this.hint = this.querySelector('[data-promo-hint]');

    this.querySelectorAll('[data-promo-design]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => this.beginDragFromTray(event, button));
    });

    this.querySelector('[data-promo-clear]')?.addEventListener('click', () => this.clear());
  }

  beginDragFromTray(event, button) {
    event.preventDefault();
    const src = button.dataset.src;
    const label = button.getAttribute('aria-label') || '';
    const rect = this.stage.getBoundingClientRect();

    const ghost = document.createElement('img');
    ghost.src = src;
    ghost.alt = '';
    ghost.className = 'promo-demo__ghost';
    document.body.appendChild(ghost);

    const positionGhost = (x, y) => {
      ghost.style.left = `${x}px`;
      ghost.style.top = `${y}px`;
    };
    positionGhost(event.clientX, event.clientY);

    let overStage = false;

    const move = (e) => {
      positionGhost(e.clientX, e.clientY);
      overStage = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      this.stage.classList.toggle('promo-demo__stage--hover', overStage);
    };

    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      this.stage.classList.remove('promo-demo__stage--hover');
      if (overStage) {
        const x = Math.min(92, Math.max(8, ((e.clientX - rect.left) / rect.width) * 100));
        const y = Math.min(92, Math.max(8, ((e.clientY - rect.top) / rect.height) * 100));
        this.addPlacement(src, label, x, y);
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  addPlacement(src, label, x, y) {
    const el = document.createElement('div');
    el.className = 'promo-demo__item';
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.innerHTML = `<img src="${src}" alt="${label}" draggable="false">`;
    this.placements.appendChild(el);
    if (this.hint) this.hint.hidden = true;
    this.makeDraggable(el);
  }

  // Already-placed designs can be picked up again and moved.
  makeDraggable(el) {
    el.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = this.stage.getBoundingClientRect();
      el.classList.add('promo-demo__item--dragging');

      const move = (e) => {
        const x = Math.min(92, Math.max(8, ((e.clientX - rect.left) / rect.width) * 100));
        const y = Math.min(92, Math.max(8, ((e.clientY - rect.top) / rect.height) * 100));
        el.style.left = `${x}%`;
        el.style.top = `${y}%`;
      };
      const up = () => {
        el.classList.remove('promo-demo__item--dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    // Double-click/tap a placed design to remove it.
    el.addEventListener('dblclick', () => {
      el.remove();
      if (this.placements.children.length === 0 && this.hint) this.hint.hidden = false;
    });
  }

  clear() {
    this.placements.innerHTML = '';
    if (this.hint) this.hint.hidden = false;
  }
}

customElements.define('promo-demo', PromoDemo);

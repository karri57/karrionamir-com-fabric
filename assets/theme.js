/**
 * Theme behavior: mobile menu, cart drawer, add-to-cart, variant selection.
 * Vanilla custom elements, no build step.
 */

function formatMoney(cents) {
  return (cents / 100).toLocaleString(document.documentElement.lang || 'en', {
    style: 'currency',
    currency: window.Shopify?.currency?.active || 'USD',
  });
}

async function addToCart({ id, quantity }) {
  // /cart/add.js with a JSON content type requires the {items: [...]} shape;
  // a flat {id, quantity} JSON body is rejected.
  const response = await fetch('/cart/add.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ items: [{ id: Number(id), quantity: Number(quantity) || 1 }] }),
  });
  const data = await response.json();
  if (!response.ok || data.status) throw new Error(data.description || data.message);

  const cartResponse = await fetch('/cart.js');
  const cart = await cartResponse.json();
  document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
  return cart;
}

/* -------------------------------------------------------------------------
 * Mobile menu
 * ---------------------------------------------------------------------- */
class MobileMenu extends HTMLElement {
  connectedCallback() {
    this.toggle = document.querySelector(`[aria-controls="${this.id}"]`);
    this.closeButton = this.querySelector('[data-close]');
    this.toggle?.addEventListener('click', () => this.open());
    this.closeButton?.addEventListener('click', () => this.close());
    this.addEventListener('click', (event) => {
      if (event.target === this) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.hasAttribute('open')) this.close();
    });
  }

  open() {
    this.setAttribute('open', '');
    this.toggle?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.removeAttribute('open');
    this.toggle?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
}
customElements.define('mobile-menu', MobileMenu);

/* -------------------------------------------------------------------------
 * Cart drawer
 * ---------------------------------------------------------------------- */
class CartDrawer extends HTMLElement {
  connectedCallback() {
    this.querySelectorAll('[data-close]').forEach((button) =>
      button.addEventListener('click', () => this.close())
    );
    this.querySelector('.cart-drawer__backdrop')?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.hasAttribute('open')) this.close();
    });
    document.addEventListener('cart:updated', (event) => this.render(event.detail.cart));

    document.querySelectorAll('[data-cart-open]').forEach((button) =>
      button.addEventListener('click', (event) => {
        if (button.tagName === 'A') event.preventDefault();
        this.open();
      })
    );

    this.addEventListener('submit', (event) => {
      const form = event.target.closest('form[data-cart-update]');
      if (!form) return;
      event.preventDefault();
      const formData = new FormData(form);
      this.updateLine(formData.get('id'), formData.get('quantity'));
    });

    // The +/- steppers fire change, not submit (the line forms have no
    // submit button), so quantity edits flow through here.
    this.addEventListener('change', (event) => {
      const form = event.target.closest('form[data-cart-update]');
      if (!form) return;
      const formData = new FormData(form);
      this.updateLine(formData.get('id'), formData.get('quantity'));
    });

    this.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-cart-remove]');
      if (!removeButton) return;
      event.preventDefault();
      this.updateLine(removeButton.dataset.cartRemove, 0);
    });

    // Populate "complete your outfit" for the server-rendered initial state.
    fetch('/cart.js')
      .then((r) => r.json())
      .then((cart) => this.renderUpsell(cart))
      .catch(() => {});
  }

  open() {
    this.setAttribute('open', '');
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.removeAttribute('open');
    document.body.style.overflow = '';
  }

  async updateLine(id, quantity) {
    const response = await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, quantity: Number(quantity) }),
    });
    const cart = await response.json();
    if (!response.ok || cart.status) return;
    document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
  }

  render(cart) {
    const itemsEl = this.querySelector('[data-cart-items]');
    const footerEl = this.querySelector('[data-cart-footer]');
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = cart.item_count;
      el.hidden = cart.item_count === 0;
    });

    this.renderShippingBar(cart);

    const totalEl = this.querySelector('[data-checkout-total]');
    if (totalEl) totalEl.textContent = formatMoney(cart.total_price);

    if (!itemsEl) return;

    if (cart.item_count === 0) {
      itemsEl.innerHTML = `<div class="cart-empty">
        <p>${window.themeStrings.cartEmpty}</p>
        <a href="/collections/all" class="button button--secondary" data-close>${window.themeStrings.cartEmptyLink}</a>
      </div>`;
      if (footerEl) footerEl.hidden = true;
      const upsell = this.querySelector('[data-cart-upsell]');
      if (upsell) upsell.hidden = true;
      return;
    }

    if (footerEl) footerEl.hidden = false;

    const deleteIcon = this.querySelector('template[data-icon-delete]')?.innerHTML || window.themeStrings.cartRemove;

    itemsEl.innerHTML = cart.items
      .map((item) => {
        const options = (item.options_with_values || [])
          .filter((o) => o.value !== 'Default Title')
          .map((o) => `${o.name}: ${o.value}`)
          .join(' · ');
        const properties = Object.entries(item.properties || {})
          .filter(([key, value]) => value && !key.startsWith('_'))
          .map(([key, value]) => `<div class="cart-item__variant">${key}: ${value}</div>`)
          .join('');
        return `
      <div class="cart-item">
        <a href="${item.url}" class="cart-item__media">
          ${item.image ? `<img src="${item.image}" alt="${item.product_title}" width="100" height="125" loading="lazy">` : ''}
        </a>
        <div class="cart-item__info">
          <a href="${item.url}" class="cart-item__title">${item.product_title}</a>
          <div class="cart-item__price">${formatMoney(item.final_line_price)}</div>
          ${options ? `<div class="cart-item__variant">${options}</div>` : ''}
          ${properties}
          <div class="cart-item__controls">
            <form data-cart-update>
              <input type="hidden" name="id" value="${item.key}">
              <quantity-input>
                <div class="quantity-selector">
                  <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
                  <input type="number" name="quantity" value="${item.quantity}" min="0" aria-label="Quantity">
                  <button type="button" data-step="1" aria-label="Increase quantity">+</button>
                </div>
              </quantity-input>
            </form>
            <button type="button" class="cart-item__remove" data-cart-remove="${item.key}" aria-label="${window.themeStrings.cartRemove}">${deleteIcon}</button>
          </div>
        </div>
      </div>`;
      })
      .join('');

    this.renderUpsell(cart);
  }

  renderShippingBar(cart) {
    const bar = this.querySelector('[data-shipping-bar]');
    if (!bar) return;
    const threshold = Number(bar.dataset.threshold);
    if (!threshold) return;
    const remaining = threshold - cart.total_price;
    const textEl = bar.querySelector('[data-shipping-text]');
    const fillEl = bar.querySelector('[data-shipping-fill]');
    if (textEl) {
      textEl.innerHTML = remaining > 0
        ? window.themeStrings.freeShippingProgress.replace('[amount]', formatMoney(remaining))
        : window.themeStrings.freeShippingUnlocked;
    }
    if (fillEl) fillEl.style.width = `${Math.min(100, (cart.total_price / threshold) * 100)}%`;
  }

  async renderUpsell(cart) {
    const upsell = this.querySelector('[data-cart-upsell]');
    const row = this.querySelector('[data-cart-upsell-items]');
    if (!upsell || !row || cart.item_count === 0) return;

    try {
      const inCart = new Set(cart.items.map((item) => item.product_id));
      const response = await fetch(`/recommendations/products.json?product_id=${cart.items[0].product_id}&limit=6`);
      const data = await response.json();
      const picks = (data.products || [])
        .filter((p) => !inCart.has(p.id) && p.available !== false)
        .slice(0, 3);

      if (picks.length === 0) {
        upsell.hidden = true;
        return;
      }

      row.innerHTML = picks
        .map((p) => {
          const variant = (p.variants || []).find((v) => v.available) || p.variants?.[0];
          if (!variant) return '';
          return `
        <div class="cart-upsell__item">
          <a href="${p.url}" class="cart-upsell__media">
            ${p.featured_image ? `<img src="${p.featured_image}" alt="${p.title}" width="80" height="100" loading="lazy">` : ''}
          </a>
          <div class="cart-upsell__details">
            <a href="${p.url}" class="cart-upsell__title">${p.title}</a>
            <div class="cart-upsell__price">${formatMoney(p.price)}</div>
          </div>
          <button type="button" class="button button--small" data-quick-add data-variant-id="${variant.id}">
            ${window.themeStrings.addLabel} +
          </button>
        </div>`;
        })
        .join('');
      upsell.hidden = false;
    } catch (error) {
      upsell.hidden = true;
    }
  }
}
customElements.define('cart-drawer', CartDrawer);

/* -------------------------------------------------------------------------
 * Quantity input (+/- buttons)
 * ---------------------------------------------------------------------- */
class QuantityInput extends HTMLElement {
  connectedCallback() {
    this.input = this.querySelector('input');
    this.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-step]');
      if (!button) return;
      const step = Number(button.dataset.step);
      const min = Number(this.input.min || 0);
      const next = Math.max(min, Number(this.input.value || 0) + step);
      this.input.value = next;
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
}
customElements.define('quantity-input', QuantityInput);

/* -------------------------------------------------------------------------
 * Product form: add to cart via AJAX
 * ---------------------------------------------------------------------- */
class ProductForm extends HTMLElement {
  connectedCallback() {
    this.form = this.querySelector('form');
    this.submitButton = this.querySelector('[type="submit"]');
    this.form?.addEventListener('submit', (event) => this.onSubmit(event));
  }

  async onSubmit(event) {
    event.preventDefault();
    this.submitButton?.setAttribute('aria-disabled', 'true');
    this.showError('');

    try {
      // Post the form's own fields as form data - the encoding /cart/add
      // has accepted forever - rather than reshaping into JSON.
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(this.form),
      });
      const data = await response.json();
      if (!response.ok || data.status) throw new Error(data.description || data.message);

      const cartResponse = await fetch('/cart.js');
      const cart = await cartResponse.json();
      document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
      document.querySelector('cart-drawer')?.open();
    } catch (error) {
      // Whatever broke the AJAX path, the native submit still adds the item
      // server-side and lands on the cart page - never a dead button.
      console.error('[theme] AJAX add-to-cart failed, falling back to native submit:', error);
      this.form.submit();
    } finally {
      this.submitButton?.removeAttribute('aria-disabled');
    }
  }

  showError(message) {
    const errorEl = this.querySelector('[data-form-error]');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }
}
customElements.define('product-form', ProductForm);

/* -------------------------------------------------------------------------
 * Variant picker: swap selected variant, price, media, availability
 * ---------------------------------------------------------------------- */
class VariantPicker extends HTMLElement {
  connectedCallback() {
    try {
      this.variants = JSON.parse(this.querySelector('[data-variant-json]').textContent);
    } catch (error) {
      console.error('[theme] variant JSON failed to parse:', error);
      this.variants = [];
    }
    this.form = this.closest('product-form')?.querySelector('form') || this.closest('form');
    this.addEventListener('change', () => this.onChange());
  }

  getSelectedOptions() {
    return Array.from(this.querySelectorAll('[data-option-index]'))
      .map((fieldset) => {
        const checked = fieldset.querySelector('input:checked, select');
        return checked ? checked.value : null;
      });
  }

  onChange() {
    const selected = this.getSelectedOptions();
    const variant = this.variants.find((v) => v.options.every((opt, i) => opt === selected[i]));

    this.querySelectorAll('[data-option-index]').forEach((fieldset) => {
      fieldset.querySelectorAll('input, option').forEach((input) => {
        const label = fieldset.querySelector(`[data-value="${input.value}"]`) || input;
        label.setAttribute?.('aria-current', input.checked ? 'true' : 'false');
      });
    });

    if (!variant) return;

    const idInput = this.form?.querySelector('input[name="id"]');
    if (idInput) idInput.value = variant.id;

    const priceEl = document.querySelector('[data-product-price]');
    if (priceEl) {
      priceEl.innerHTML = variant.compare_at_price > variant.price
        ? `<span class="price--sale">${formatMoney(variant.price)}</span><span class="price__compare">${formatMoney(variant.compare_at_price)}</span>`
        : `<span>${formatMoney(variant.price)}</span>`;
    }

    const submitButton = this.form?.querySelector('[type="submit"]');
    if (submitButton) {
      submitButton.textContent = variant.available ? window.themeStrings.addToCart : window.themeStrings.soldOut;
      submitButton.toggleAttribute('aria-disabled', !variant.available);
    }

    if (variant.featured_media) {
      const mainImage = document.querySelector('[data-gallery-main] img');
      if (mainImage) {
        mainImage.src = variant.featured_media.preview_image.src.replace(/(\.[a-z]+)(\?|$)/i, '_800x$1$2');
        mainImage.alt = variant.featured_media.alt || '';
      }
    }

    const url = new URL(window.location);
    url.searchParams.set('variant', variant.id);
    window.history.replaceState({}, '', url);
  }
}
customElements.define('variant-picker', VariantPicker);

/* -------------------------------------------------------------------------
 * Quick add: "+" button on a product card adds its default variant directly
 * ---------------------------------------------------------------------- */
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-quick-add]');
  if (!button || button.hasAttribute('aria-disabled')) return;

  button.setAttribute('aria-disabled', 'true');
  try {
    await addToCart({ id: button.dataset.variantId, quantity: 1 });
    document.querySelector('cart-drawer')?.open();
  } catch (error) {
    console.error('[theme] quick add failed:', error);
  } finally {
    button.removeAttribute('aria-disabled');
  }
});

/* -------------------------------------------------------------------------
 * Filter tabs: client-side filter of a product grid by product type
 * ---------------------------------------------------------------------- */
class FilterTabs extends HTMLElement {
  connectedCallback() {
    this.grid = this.nextElementSibling;
    this.addEventListener('click', (event) => {
      const tab = event.target.closest('.filter-tab');
      if (!tab) return;
      this.querySelectorAll('.filter-tab').forEach((el) => el.setAttribute('aria-current', 'false'));
      tab.setAttribute('aria-current', 'true');
      this.filter(tab.dataset.filter);
    });
  }

  filter(type) {
    if (!this.grid) return;
    this.grid.querySelectorAll('[data-product-type]').forEach((item) => {
      item.hidden = type !== 'all' && item.dataset.productType !== type;
    });
  }
}
customElements.define('filter-tabs', FilterTabs);

/* -------------------------------------------------------------------------
 * Product gallery: click a thumbnail to swap the main image
 * ---------------------------------------------------------------------- */
class ProductGallery extends HTMLElement {
  connectedCallback() {
    this.mainImage = this.querySelector('[data-gallery-main] img');
    this.addEventListener('click', (event) => {
      const thumb = event.target.closest('[data-thumbnail]');
      if (thumb) {
        this.show(thumb.dataset.fullSrc, thumb.dataset.alt);
        return;
      }
      if (event.target.closest('[data-gallery-next]')) {
        this.showNext();
        return;
      }
      if (event.target.closest('[data-gallery-zoom]')) {
        this.openZoom();
      }
    });
  }

  get dots() {
    return Array.from(this.querySelectorAll('.product__gallery-dots [data-thumbnail]'));
  }

  get allThumbs() {
    return Array.from(this.querySelectorAll('[data-thumbnail]'));
  }

  show(src, alt) {
    if (!this.mainImage || !src) return;
    this.mainImage.src = src;
    this.mainImage.alt = alt || '';
    this.allThumbs.forEach((el) => el.setAttribute('aria-current', el.dataset.fullSrc === src ? 'true' : 'false'));
  }

  showNext() {
    const dots = this.dots;
    if (dots.length < 2) return;
    const currentIndex = dots.findIndex((el) => el.getAttribute('aria-current') === 'true');
    const next = dots[(currentIndex + 1) % dots.length];
    if (next) this.show(next.dataset.fullSrc, next.dataset.alt);
  }

  openZoom() {
    const dialog = document.querySelector('[data-gallery-zoom-dialog]');
    const zoomImage = dialog?.querySelector('[data-gallery-zoom-image]');
    if (!dialog || !zoomImage || !this.mainImage) return;
    zoomImage.src = this.mainImage.src;
    zoomImage.alt = this.mainImage.alt;
    dialog.showModal();
  }
}
customElements.define('product-gallery', ProductGallery);

/* -------------------------------------------------------------------------
 * Generic <dialog> open/close: [data-dialog-open="id"] opens #id,
 * [data-dialog-close] closes its nearest dialog, clicking the backdrop
 * (the dialog element itself, outside its content) closes it too.
 * ---------------------------------------------------------------------- */
document.addEventListener('click', (event) => {
  const opener = event.target.closest('[data-dialog-open]');
  if (opener) {
    document.getElementById(opener.dataset.dialogOpen)?.showModal();
    return;
  }
  if (event.target.closest('[data-dialog-close]')) {
    event.target.closest('dialog')?.close();
    return;
  }
  if (event.target.tagName === 'DIALOG') {
    event.target.close();
  }
});

/* -------------------------------------------------------------------------
 * Sticky add-to-cart bar: mirrors the main product form's submit button
 * ---------------------------------------------------------------------- */
(function stickyAddToCart() {
  const bar = document.querySelector('[data-sticky-add-to-cart]');
  const mainButton = document.querySelector('[data-add-to-cart-button]');
  if (!bar || !mainButton) return;

  bar.hidden = false;

  bar.querySelector('[data-sticky-add-to-cart-button]')?.addEventListener('click', () => {
    const form = mainButton.closest('form');
    // requestSubmit is missing on older iOS Safari; clicking the real submit
    // button fires the same submit event there.
    if (form?.requestSubmit) form.requestSubmit();
    else mainButton.click();
  });

  const observer = new IntersectionObserver(
    ([entry]) => {
      bar.classList.toggle('sticky-add-to-cart--visible', !entry.isIntersecting);
    },
    { threshold: 0 }
  );
  observer.observe(mainButton);
})();

/* -------------------------------------------------------------------------
 * Recently viewed: records visited products to localStorage
 * ---------------------------------------------------------------------- */
window.themeRecentlyViewed = {
  key: 'theme:recently-viewed',
  max: 12,

  record(product) {
    if (!product?.id) return;
    try {
      const items = this.list().filter((item) => item.id !== product.id);
      items.unshift(product);
      localStorage.setItem(this.key, JSON.stringify(items.slice(0, this.max)));
    } catch (error) {
      // localStorage unavailable (private mode, etc.) - skip silently.
    }
  },

  list(excludeId) {
    try {
      const items = JSON.parse(localStorage.getItem(this.key) || '[]');
      return excludeId ? items.filter((item) => item.id !== excludeId) : items;
    } catch (error) {
      return [];
    }
  },
};

/* -------------------------------------------------------------------------
 * Product recommendations: fetch the section re-rendered by Shopify's
 * recommendations endpoint and swap in the populated markup
 * ---------------------------------------------------------------------- */
class ProductRecommendations extends HTMLElement {
  connectedCallback() {
    const url = this.dataset.url;
    if (!url) return;
    fetch(url)
      .then((response) => response.text())
      .then((text) => {
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const fresh = doc.querySelector('product-recommendations');
        if (fresh && fresh.innerHTML.trim().length) this.innerHTML = fresh.innerHTML;
      })
      .catch(() => {});
  }
}
customElements.define('product-recommendations', ProductRecommendations);

class RecentlyViewedProducts extends HTMLElement {
  connectedCallback() {
    const excludeId = Number(this.dataset.excludeId);
    const items = window.themeRecentlyViewed.list(excludeId).slice(0, 8);
    if (items.length === 0) return;

    const row = this.querySelector('[data-recently-viewed-items]');
    if (!row) return;

    row.innerHTML = items.map((item) => this.renderCard(item)).join('');
    this.hidden = false;
  }

  renderCard(item) {
    const onSale = item.compareAtPrice > item.price;
    const priceHtml = onSale
      ? `<span class="price--sale">${formatMoney(item.price)}</span><span class="price__compare">${formatMoney(item.compareAtPrice)}</span>`
      : `<span>${formatMoney(item.price)}</span>`;

    return `
      <div class="carousel-row__item">
        <div class="product-card">
          <div class="product-card__media">
            <a href="${item.url}" class="product-card__media-link">
              <img src="${item.image}" alt="" width="600" height="750" loading="lazy">
            </a>
          </div>
          <a href="${item.url}" class="product-card__link">
            <div class="product-card__title">${item.title}</div>
            <div class="product-card__price">${priceHtml}</div>
          </a>
        </div>
      </div>`;
  }
}
customElements.define('recently-viewed-products', RecentlyViewedProducts);

/* -------------------------------------------------------------------------
 * Header shadow on scroll (subtle, optional)
 * ---------------------------------------------------------------------- */
(function headerScrollState() {
  const header = document.querySelector('.header');
  if (!header) return;
  let lastScroll = 0;
  document.addEventListener('scroll', () => {
    const scrolled = window.scrollY > 4;
    header.classList.toggle('header--scrolled', scrolled);
    lastScroll = window.scrollY;
  }, { passive: true });
})();

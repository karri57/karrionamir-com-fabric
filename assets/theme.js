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

async function addToCart(body) {
  const response = await fetch('/cart/add.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (data.status) throw new Error(data.description || data.message);

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
      this.updateLine(new FormData(form).get('id'), new FormData(form).get('quantity'));
    });

    this.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-cart-remove]');
      if (!removeButton) return;
      event.preventDefault();
      this.updateLine(removeButton.dataset.cartRemove, 0);
    });
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
    document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } }));
  }

  render(cart) {
    const itemsEl = this.querySelector('[data-cart-items]');
    const footerEl = this.querySelector('[data-cart-footer]');
    const countEls = document.querySelectorAll('[data-cart-count]');
    countEls.forEach((el) => {
      el.textContent = cart.item_count;
      el.hidden = cart.item_count === 0;
    });

    if (!itemsEl) return;

    if (cart.item_count === 0) {
      itemsEl.innerHTML = `<div class="cart-empty">
        <p>${window.themeStrings.cartEmpty}</p>
        <a href="/collections/all" class="button button--secondary" data-close>${window.themeStrings.cartEmptyLink}</a>
      </div>`;
      if (footerEl) footerEl.hidden = true;
      return;
    }

    if (footerEl) footerEl.hidden = false;

    itemsEl.innerHTML = cart.items
      .map(
        (item) => `
      <div class="cart-item">
        <a href="${item.url}" class="cart-item__media">
          ${item.image ? `<img src="${item.image}" alt="${item.product_title}" width="90" height="112" loading="lazy">` : ''}
        </a>
        <div class="cart-item__details">
          <a href="${item.url}" class="cart-item__title">${item.product_title}</a>
          ${item.variant_title ? `<div class="cart-item__variant">${item.variant_title}</div>` : ''}
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
        </div>
        <div class="cart-item__end">
          <div class="cart-item__price">${formatMoney(item.final_line_price)}</div>
          <button type="button" class="cart-item__remove" data-cart-remove="${item.key}">${window.themeStrings.cartRemove}</button>
        </div>
      </div>`
      )
      .join('');

    const subtotalEl = this.querySelector('[data-cart-subtotal]');
    if (subtotalEl) subtotalEl.textContent = formatMoney(cart.total_price);
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
      await addToCart(Object.fromEntries(new FormData(this.form)));
      document.querySelector('cart-drawer')?.open();
    } catch (error) {
      this.showError(error.message || window.themeStrings.genericError);
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
    this.variants = JSON.parse(this.querySelector('[data-variant-json]').textContent);
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
    // Swallow: the item is likely out of stock by the time this ran.
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
      if (!thumb || !this.mainImage) return;
      this.mainImage.src = thumb.dataset.fullSrc;
      this.mainImage.alt = thumb.dataset.alt || '';
      this.querySelectorAll('[data-thumbnail]').forEach((el) => el.setAttribute('aria-current', 'false'));
      thumb.setAttribute('aria-current', 'true');
    });
  }
}
customElements.define('product-gallery', ProductGallery);

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

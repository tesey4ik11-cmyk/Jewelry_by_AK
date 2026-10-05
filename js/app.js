/* ============================================================================
   Jewelry by AK — логика сайта
   Каталог, фильтры, избранное, карточка украшения, заявка в мессенджер.
   Данные берутся из js/shop.config.js — правьте только его.
   ========================================================================== */
(function () {
  'use strict';

  const CFG = window.SHOP || {};
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ── Иконки ───────────────────────────────────────────────────────────── */
  const ICONS = {
    telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.2 4.3 2.9 11.4c-.9.3-.9 1.5 0 1.8l4 1.3 1.5 4.7c.3.8 1.3 1 1.8.3l2.1-2.7 4.1 3c.7.5 1.6.1 1.8-.7l3-13.6c.2-.9-.7-1.6-1.5-1.2Z"/><path d="m8.4 14.2 8.4-6.6-6.5 7.6"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.6a8.4 8.4 0 0 1-12.4 7.5L4 20.4l1.4-4.4A8.4 8.4 0 1 1 21 11.6Z"/><path d="M8.8 8.4c0 3.4 2.8 6.2 6.2 6.2.5 0 1.4-.6 1.4-1.3 0-.3-1.6-1.2-1.9-1.2-.4 0-.7.7-1 .7-.6 0-2.4-1.8-2.4-2.4 0-.3.7-.6.7-1 0-.3-.9-1.9-1.2-1.9-.7 0-1.8.4-1.8.9Z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="16.9" cy="7.1" r="1.1" fill="currentColor" stroke="none"/></svg>',
    vk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.2h2.3c.3 0 .5.2.6.4.5 1.5 1.3 3 2.2 4 .2.2.4.1.5-.2V9.6c0-.8-.4-1.1-.9-1.3 0 0 .5-.6 2-.6 1.1 0 1.7.3 1.7.3.3.1.4.4.4.8v3.4c0 .2.1.3.3.2.4-.3 1-1 1.5-2 .4-.8.7-1.5.8-2 .1-.3.3-.5.7-.5h2c.5 0 .7.3.6.8-.2.9-.8 2-1.5 3-.3.4-.3.6 0 .9.6.6 1.3 1.4 1.8 2.3.2.4 0 .7-.5.7h-2c-.4 0-.6-.2-.9-.5-.5-.6-1-1.2-1.6-1.6-.3-.2-.4-.1-.4.2v1.4c0 .4-.2.5-.6.5-1.2 0-2.6-.7-3.8-2.2-1.5-1.8-2.6-4.2-3.2-6.1-.1-.4.1-.6.5-.6Z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6L16.5 13l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-9.7A4.3 4.3 0 0 1 12 8.2a4.3 4.3 0 0 1 7.5 2.6c0 5.1-7.5 9.7-7.5 9.7Z"/></svg>',
    heartFilled: '<svg viewBox="0 0 24 24" aria-hidden="true" class="is-filled"><path d="M12 20.5s-7.5-4.6-7.5-9.7A4.3 4.3 0 0 1 12 8.2a4.3 4.3 0 0 1 7.5 2.6c0 5.1-7.5 9.7-7.5 9.7Z" fill="currentColor"/></svg>',
  };

  const STATUS = {
    'in-stock':    { label: 'В наличии',  cls: 'status-stock' },
    'rent':        { label: 'В аренду',   cls: 'status-rent' },
    'made-to-order': { label: 'Под заказ', cls: 'status-order' },
  };

  const money = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  /* ── Путь к фото: <picture> с webp + jpg, адаптивный srcset ───────────── */
  function pictureMarkup(name, alt, sizes, { eager = false, width = 800, height = 1000 } = {}) {
    const base = `assets/img/${name}`;
    return `
      <picture>
        <source type="image/webp"
          srcset="${base}-thumb.webp 480w, ${base}-sm.webp 800w, ${base}-lg.webp 1400w"
          sizes="${sizes}">
        <img src="${base}-sm.jpg"
          srcset="${base}-thumb.jpg 480w, ${base}-sm.jpg 800w, ${base}-lg.jpg 1400w"
          sizes="${sizes}" alt="${alt}" width="${width}" height="${height}"
          loading="${eager ? 'eager' : 'lazy'}" decoding="async">
      </picture>`;
  }

  const productById = (id) => (CFG.products || []).find((p) => p.id === id);

  /* ── Ссылка «написать» с готовым текстом ──────────────────────────────── */
  function orderLink(product, intent) {
    const list = CFG.contacts || [];
    const ch = list.find((c) => c.primary && /t\.me|wa\.me/.test(c.href || ''))
            || list.find((c) => /t\.me|wa\.me/.test(c.href || ''))
            || list.find((c) => (c.href || '').startsWith('mailto:'));

    const title = product ? product.title : 'украшение';
    const text = intent || `Здравствуйте! Меня заинтересовало «${title}»${product ? ` (${money(product.price)} ${CFG.brand?.currency || '₽'})` : ''}. Подскажите, пожалуйста, детали.`;

    if (!ch) return { href: '#contact', text, channel: null };
    if (ch.href.startsWith('mailto:')) {
      return { href: `${ch.href}?subject=${encodeURIComponent('Заявка: ' + title)}&body=${encodeURIComponent(text)}`, text, channel: ch };
    }
    if (ch.href.includes('wa.me')) {
      return { href: `${ch.href}?text=${encodeURIComponent(text)}`, text, channel: ch };
    }
    // Telegram: t.me/nick -> нужен ?text= (работает для личных чатов)
    const base = ch.href.split('?')[0];
    const isBot = /bot/i.test(base.split('/').pop() || '');
    return {
      href: isBot ? `${base}?text=${encodeURIComponent(text)}` : `${base}?text=${encodeURIComponent(text)}`,
      text, channel: ch,
    };
  }

  /* ══════════════ КАТАЛОГ ══════════════ */
  const grid = $('#productGrid');
  const filtersBox = $('#filters');
  const emptyState = $('#emptyState');
  let activeFilter = 'all';

  function cardMarkup(p) {
    const st = STATUS[p.status] || STATUS['in-stock'];
    const currency = CFG.brand?.currency || '₽';
    const gallery = (p.gallery && p.gallery.length) ? p.gallery : ['pearl-necklace'];
    return `
      <article class="card reveal" data-id="${p.id}" data-category="${p.category}">
        <button class="card-fav" type="button" data-fav="${p.id}"
                aria-label="Добавить «${p.title}» в избранное" aria-pressed="false">
          ${ICONS.heart}
        </button>

        <button class="card-media" type="button" data-open="${p.id}" aria-label="Открыть «${p.title}»">
          ${pictureMarkup(gallery[0], p.alt || p.title, '(max-width: 620px) 92vw, (max-width: 1100px) 44vw, 30vw')}
          ${p.badge ? `<span class="card-badge">${p.badge}</span>` : ''}
        </button>

        <div class="card-body">
          <span class="card-status ${st.cls}">${st.label}</span>
          <h3 class="card-title">
            <button type="button" data-open="${p.id}">${p.title}</button>
          </h3>
          <p class="card-sub">${p.subtitle || ''}</p>
          <p class="card-tagline">${p.tagline || ''}</p>
          <div class="card-foot">
            <span class="card-price">${money(p.price)} <i>${currency}</i></span>
            <button class="btn btn-sm btn-outline" type="button" data-open="${p.id}">Подробнее</button>
          </div>
        </div>
      </article>`;
  }

  function renderCards() {
    if (!grid) return;
    const list = (CFG.products || []).filter((p) => activeFilter === 'all' || p.category === activeFilter);
    grid.innerHTML = list.map(cardMarkup).join('');

    // Если украшений нечётное количество, последняя карточка осталась бы
    // одна в ряду — растягиваем её на всю ширину как «витринную».
    const cards = $$('.card', grid);
    if (cards.length > 2 && cards.length % 2 === 1) {
      cards[cards.length - 1].classList.add('card--wide');
    }

    if (emptyState) emptyState.hidden = list.length > 0;
    observeReveal(grid);
    syncFavUI();
  }

  function renderFilters() {
    if (!filtersBox) return;
    filtersBox.innerHTML = (CFG.categories || [])
      .map((c) => {
        const count = c.id === 'all'
          ? (CFG.products || []).length
          : (CFG.products || []).filter((p) => p.category === c.id).length;
        if (!count) return '';
        return `<button class="chip${c.id === activeFilter ? ' is-active' : ''}" type="button"
                  data-filter="${c.id}" aria-pressed="${c.id === activeFilter}">
                  ${c.label}<span class="chip-count">${count}</span>
                </button>`;
      })
      .join('');
  }

  filtersBox?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    activeFilter = chip.dataset.filter;
    $$('.chip', filtersBox).forEach((c) => {
      const on = c === chip;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    renderCards();
  });

  grid?.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-open]');
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) { toggleFav(favBtn.dataset.fav, favBtn); return; }
    if (openBtn) openModal(openBtn.dataset.open);
  });

  /* ══════════════ КАРТОЧКА УКРАШЕНИЯ (модальное окно) ══════════════ */
  const modal = $('#productModal');
  const modalBody = $('#modalBody');
  let lastFocused = null;

  function modalMarkup(p) {
    const st = STATUS[p.status] || STATUS['in-stock'];
    const currency = CFG.brand?.currency || '₽';
    const gallery = (p.gallery && p.gallery.length) ? p.gallery : ['pearl-necklace'];
    const isRent = p.status === 'rent';
    const cta = isRent ? (CFG.copy?.rentCta || 'Забронировать дату') : (CFG.copy?.orderCta || 'Хочу это украшение');

    const intent = isRent
      ? `Здравствуйте! Хочу взять в аренду «${p.title}». Подскажите, пожалуйста, свободные даты и условия.`
      : `Здравствуйте! Меня заинтересовало «${p.title}» (${money(p.price)} ${currency}). Подскажите, пожалуйста, наличие.`;
    const link = orderLink(p, intent);

    const materials = (p.materials || []).map((m) => `<li>${m}</li>`).join('');
    const details = (p.details || []).map((d) => `<li>${d}</li>`).join('');

    return `
      <div class="modal-gallery" data-count="${gallery.length}">
        ${gallery.map((g, i) => `
          <figure class="modal-shot">
            ${pictureMarkup(g, p.alt || p.title, '(max-width: 900px) 92vw, 46vw', { eager: true, width: 800, height: 1000 })}
          </figure>`).join('')}
      </div>

      <div class="modal-info">
        <span class="card-status ${st.cls}">${st.label}</span>
        <h2 id="modalTitle">${p.title}</h2>
        <p class="modal-sub">${p.subtitle || ''}</p>
        <p class="modal-price">${money(p.price)} <i>${currency}</i>${isRent ? ' <small>· стоимость аренды уточняется</small>' : ''}</p>

        <p class="modal-desc">${p.description || ''}</p>

        ${materials ? `<div class="modal-block"><h4>Материалы</h4><ul class="tag-list">${materials}</ul></div>` : ''}
        ${details ? `<div class="modal-block"><h4>Детали</h4><ul class="dot-list">${details}</ul></div>` : ''}

        <div class="modal-actions">
          <a class="btn btn-solid btn-full" href="${link.href}" target="_blank" rel="noopener" data-order="${p.id}">
            ${cta}
          </a>
          <button class="btn btn-outline btn-full" type="button" data-fav-modal="${p.id}">
            <span class="fav-label">${isFav(p.id) ? 'В избранном' : 'В избранное'}</span>
          </button>
        </div>

        <p class="modal-note">
          Ответлю ${CFG.brand?.workHours || 'в рабочее время'}.
          ${CFG.brand?.deliveryNote ? CFG.brand.deliveryNote + '.' : ''}
        </p>
      </div>`;
  }

  function openModal(id) {
    const p = productById(id);
    if (!p || !modal) return;
    lastFocused = document.activeElement;
    modalBody.innerHTML = modalMarkup(p);
    modal.hidden = false;
    document.body.classList.add('is-locked');
    requestAnimationFrame(() => modal.classList.add('is-open'));
    const closeBtn = $('.modal-close', modal);
    closeBtn?.focus();
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.classList.remove('is-open');
    document.body.classList.remove('is-locked');
    setTimeout(() => { modal.hidden = true; modalBody.innerHTML = ''; }, 260);
    lastFocused?.focus?.();
  }

  modal?.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeModal(); return; }
    const favBtn = e.target.closest('[data-fav-modal]');
    if (favBtn) {
      const id = favBtn.dataset.favModal;
      toggleFav(id);
      $('.fav-label', favBtn).textContent = isFav(id) ? 'В избранном' : 'В избранное';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeSaved(); closeMenu(); }
  });

  /* ══════════════ ИЗБРАННОЕ ══════════════ */
  const FAV_KEY = 'ak-favorites-v1';
  let favorites = [];
  try { favorites = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (_) { favorites = []; }
  if (!Array.isArray(favorites)) favorites = [];

  const isFav = (id) => favorites.includes(id);

  function persistFavs() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); } catch (_) {}
  }

  function toggleFav(id, btn) {
    const i = favorites.indexOf(id);
    if (i === -1) { favorites.push(id); showToast('Добавлено в избранное'); }
    else { favorites.splice(i, 1); showToast('Убрано из избранного'); }
    persistFavs();
    if (btn) btn.setAttribute('aria-pressed', String(isFav(id)));
    syncFavUI();
  }

  function syncFavUI() {
    const count = favorites.length;
    const badge = $('#savedCount');
    if (badge) { badge.textContent = String(count); badge.hidden = count === 0; }
    $$('[data-fav]').forEach((b) => {
      const on = isFav(b.dataset.fav);
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-active', on);
    });
    if (savedPanel && !savedPanel.hidden) renderSaved();
  }

  /* ── Панель избранного ─────────────────────────────────────────────────── */
  let savedPanel = null;

  function ensureSavedPanel() {
    if (savedPanel) return savedPanel;
    savedPanel = document.createElement('div');
    savedPanel.className = 'saved-panel';
    savedPanel.hidden = true;
    savedPanel.setAttribute('role', 'dialog');
    savedPanel.setAttribute('aria-label', CFG.copy?.savedTitle || 'Избранное');
    savedPanel.innerHTML = `
      <div class="saved-head">
        <h3>${CFG.copy?.savedTitle || 'Избранное'}</h3>
        <button class="modal-close" type="button" data-saved-close aria-label="Закрыть">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <div class="saved-list" id="savedList"></div>`;
    document.body.appendChild(savedPanel);
    savedPanel.addEventListener('click', (e) => {
      if (e.target.closest('[data-saved-close]')) { closeSaved(); return; }
      const open = e.target.closest('[data-open]');
      if (open) { closeSaved(); openModal(open.dataset.open); }
      const rm = e.target.closest('[data-fav]');
      if (rm) toggleFav(rm.dataset.fav, null);
    });
    return savedPanel;
  }

  function renderSaved() {
    const list = $('#savedList');
    if (!list) return;
    const items = favorites.map(productById).filter(Boolean);
    if (!items.length) {
      list.innerHTML = `<p class="saved-empty">Пока пусто. Нажмите на ♡ на карточке украшения — и оно появится здесь.</p>`;
      return;
    }
    list.innerHTML = items.map((p) => `
      <div class="saved-item">
        <button type="button" class="saved-thumb" data-open="${p.id}" aria-label="Открыть «${p.title}»">
          <img src="assets/img/${p.gallery[0]}-thumb.jpg" alt="" width="120" height="120" loading="lazy">
        </button>
        <div class="saved-info">
          <b>${p.title}</b>
          <span>${money(p.price)} ${CFG.brand?.currency || '₽'}</span>
        </div>
        <button class="saved-remove" type="button" data-fav="${p.id}" aria-label="Убрать «${p.title}» из избранного">✕</button>
      </div>`).join('');
  }

  function openSaved() {
    ensureSavedPanel();
    renderSaved();
    savedPanel.hidden = false;
    requestAnimationFrame(() => savedPanel.classList.add('is-open'));
    const bd = $('#savedBackdrop');
    if (bd) {
      bd.hidden = false;
      requestAnimationFrame(() => bd.classList.add('is-open'));
    }
  }
  function closeSaved() {
    if (!savedPanel || savedPanel.hidden) return;
    savedPanel.classList.remove('is-open');
    const bd = $('#savedBackdrop');
    if (bd) {
      bd.classList.remove('is-open');
      setTimeout(() => { bd.hidden = true; }, 350);
    }
    setTimeout(() => { savedPanel.hidden = true; }, 240);
  }

  $('#savedBtn')?.addEventListener('click', openSaved);
  $('#savedBackdrop')?.addEventListener('click', closeSaved);

  /* ══════════════ КОНТАКТЫ ══════════════ */
  function renderContacts() {
    const list = $('#contactList');
    const social = $('#footerSocial');
    const items = CFG.contacts || [];

    if (list) {
      list.innerHTML = items.map((c) => `
        <li>
          <a class="contact-item" href="${c.href}" target="_blank" rel="noopener">
            <span class="contact-ico">${ICONS[c.icon] || ICONS.phone}</span>
            <span class="contact-text">
              <b>${c.label}</b>
              <span>${c.value}</span>
            </span>
            <span class="contact-note">${c.note || ''}</span>
          </a>
        </li>`).join('');
    }

    if (social) {
      social.innerHTML = items
        .filter((c) => c.icon && c.icon !== 'phone')
        .map((c) => `<a href="${c.href}" target="_blank" rel="noopener" aria-label="${c.label}">${ICONS[c.icon]}</a>`)
        .join('');
    }

    const primary = items.find((c) => c.primary) || items[0];
    const float = $('#floatWa');
    if (float && primary) {
      const link = orderLink(null, `Здравствуйте! Пишу с сайта Jewelry by AK — хочу узнать про украшения.`);
      float.href = /t\.me|wa\.me|mailto/.test(primary.href) ? link.href : primary.href;
    }
  }

  /* ══════════════ ФОРМА ══════════════ */
  const form = $('#contactForm');

  function validate(form) {
    let ok = true;
    $$('.field', form).forEach((field) => {
      const input = $('input, textarea, select', field);
      if (!input) return;
      const err = $('.field-error', field);
      let msg = '';
      if (input.required && !input.value.trim()) msg = 'Пожалуйста, заполните это поле';
      else if (input.type === 'text' && input.id === 'fContact' && input.value.trim().length < 4) msg = 'Слишком коротко — укажите телефон или ник';
      if (err) err.textContent = msg;
      input.classList.toggle('has-error', Boolean(msg));
      input.setAttribute('aria-invalid', String(Boolean(msg)));
      if (msg) ok = false;
    });
    return ok;
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const status = $('#formStatus');
    if (!validate(form)) {
      if (status) { status.textContent = 'Проверьте выделенные поля.'; status.className = 'form-status is-error'; }
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    const text = [
      'Заявка с сайта Jewelry by AK',
      `Имя: ${data.name}`,
      `Контакт: ${data.contact}`,
      `Интересует: ${data.interest}`,
      data.message ? `Сообщение: ${data.message}` : null,
    ].filter(Boolean).join('\n');

    const link = orderLink(null, text);
    if (status) {
      status.className = 'form-status is-ok';
      status.innerHTML = `Спасибо, ${String(data.name).split(' ')[0]}! Открываю чат, чтобы вы отправили заявку — <a href="${link.href}" target="_blank" rel="noopener">открыть вручную</a>, если окно не появилось.`;
    }
    window.open(link.href, '_blank', 'noopener');
    showToast('Заявка готова к отправке');
    form.reset();
    $$('.field-error', form).forEach((el) => (el.textContent = ''));
  });

  /* ══════════════ UI: меню, шапка, наверх, анимации ══════════════ */
  const burger = $('#burger');
  const nav = $('#primaryNav');
  const navBackdrop = $('#navBackdrop');
  const header = $('#siteHeader');
  const toTop = $('#toTop');

  function closeMenu() {
    if (!nav || !nav.classList.contains('is-open')) return;
    nav.classList.remove('is-open');
    burger?.classList.remove('is-active');
    burger?.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('is-locked');
    if (navBackdrop) {
      navBackdrop.classList.remove('is-open');
      setTimeout(() => { navBackdrop.hidden = true; }, 350);
    }
  }

  function openMenu() {
    if (!nav) return;
    nav.classList.add('is-open');
    burger?.classList.add('is-active');
    burger?.setAttribute('aria-expanded', 'true');
    document.body.classList.add('is-locked');
    if (navBackdrop) {
      navBackdrop.hidden = false;
      requestAnimationFrame(() => navBackdrop.classList.add('is-open'));
    }
  }

  burger?.addEventListener('click', () => {
    nav.classList.contains('is-open') ? closeMenu() : openMenu();
  });

  navBackdrop?.addEventListener('click', closeMenu);
  $('#navClose')?.addEventListener('click', closeMenu);

  nav?.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });

  // Плавная прокрутка с учётом липкой шапки
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const offset = (header?.offsetHeight || 0) + 12;
      const y = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, y), behavior: prefersReduced() ? 'auto' : 'smooth' });
      // Заявка из блока «Аренда» — сразу подставляем тему
      const intent = a.dataset.intent;
      if (intent) {
        const msg = $('#fMessage');
        const interest = $('#fInterest');
        if (interest) interest.value = 'Аренда на мероприятие';
        if (msg && !msg.value) msg.value = intent;
        setTimeout(() => $('#fName')?.focus(), prefersReduced() ? 0 : 620);
      }
    });
  });

  function prefersReduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  let ticking = false;
  function onScroll() {
    const y = window.scrollY;
    header?.classList.toggle('is-stuck', y > 24);
    if (toTop) toTop.hidden = y < 700;
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScroll);
  }, { passive: true });
  onScroll();

  toTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' }));

  /* Появление блоков при прокрутке */
  let io = null;
  function observeReveal(root = document) {
    const items = $$('.reveal:not(.is-visible)', root);
    if (!items.length) return;
    if (prefersReduced() || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    if (!io) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const delay = Number(entry.target.dataset.delay || 0);
          setTimeout(() => entry.target.classList.add('is-visible'), Math.min(delay, 4) * 90);
          io.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    }
    items.forEach((el) => io.observe(el));
  }

  /* ══════════════ TOAST ══════════════ */
  let toastTimer = null;
  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add('is-open'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('is-open');
      setTimeout(() => { toast.hidden = true; }, 240);
    }, 2600);
  }

  /* ══════════════ Мягкая обработка битых изображений ══════════════ */
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    img.classList.add('is-broken');
    img.closest('picture')?.classList.add('is-broken');
    img.alt = img.alt || 'Фотография украшения';
  }, true);

  /* ══════════════ СТАРТ ══════════════ */
  function init() {
    const year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());
    renderFilters();
    renderCards();
    renderContacts();
    observeReveal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

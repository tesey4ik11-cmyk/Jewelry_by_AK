/* ============================================================================
   Панель управления Jewelry by AK — интерфейс.
   Работает без сборщиков и модулей: обычный скрипт, поэтому открывается
   и по file://, и с локального сервера.
   ========================================================================== */
(function () {
  'use strict';

  const Store = window.AKStore;
  const Photos = window.AKPhotos;

  /* ── Утилиты ─────────────────────────────────────────────────────────── */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'dataset') Object.assign(node.dataset, attrs[k]);
        else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    (Array.isArray(children) ? children : children ? [children] : []).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const money = (n) => String(n === null || n === undefined || n === '' ? '' : n)
    .replace(/\s|&nbsp;/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  function toLines(arr) {
    return (Array.isArray(arr) ? arr : []).join('\n');
  }
  function linesToArray(text) {
    return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* ── Состояние ───────────────────────────────────────────────────────── */
  const STATUS_OPTIONS = [
    { value: 'in-stock', label: 'В наличии' },
    { value: 'rent', label: 'В аренду' },
    { value: 'made-to-order', label: 'Под заказ' },
  ];
  const ICON_OPTIONS = [
    { value: 'telegram', label: 'Telegram' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'vk', label: 'ВКонтакте' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'phone', label: 'Телефон' },
  ];

  const state = {
    config: null,
    /** активный адаптер: Store.GitHub или Store.Folder */
    adapter: null,
    /** данные подключения: для GitHub — данные репозитория, для папки — имя папки */
    conn: null,
    dirty: false,
    saving: false,
    publishing: false,
    activeTab: 'products',
    activeProduct: null,
    search: '',
    pendingPhotos: [],
    previews: {},
    hero: { facts: [], hotId: '' },
    /** копия index.html: нужна, чтобы править плашку «Хит сезона» и цифры */
    indexHtml: null,
    lastSavedAt: null,
    commitUrl: null,
    counts: { products: 0, categories: 0, contacts: 0 },
  };

  function modeIsGithub() {
    return Boolean(state.adapter && state.adapter.kind === 'github');
  }

  function configSnapshot() {
    const c = clone(state.config);
    c.hero = { facts: clone(state.hero.facts), hotId: state.hero.hotId };
    return c;
  }

  function markDirty() {
    if (state.dirty) return;
    state.dirty = true;
    updateStatus();
  }

  function updateStatus() {
    const box = $('#connStatus');
    const text = $('#connText');
    const saveBtn = $('#saveAll');
    const offBtn = $('#disconnect');
    if (offBtn) offBtn.hidden = !state.adapter;
    if (!box || !text) return;

    if (!state.adapter) {
      box.dataset.state = 'off';
      text.textContent = 'Сохранение не настроено';
      saveBtn.disabled = true;
      return;
    }
    if (state.publishing) {
      box.dataset.state = 'saving';
      text.textContent = 'Отправляю в GitHub…';
      saveBtn.disabled = true;
      return;
    }
    if (state.saving) {
      box.dataset.state = 'saving';
      text.textContent = 'Сохраняю…';
      saveBtn.disabled = true;
      return;
    }
    if (state.dirty) {
      box.dataset.state = 'dirty';
      text.textContent = 'Есть несохранённые правки';
      saveBtn.disabled = false;
      return;
    }
    box.dataset.state = 'on';
    const where = state.adapter.describe();
    text.textContent = state.lastSavedAt
      ? 'Всё сохранено · ' + state.lastSavedAt + ' · ' + where
      : 'Подключено: ' + where;
    saveBtn.disabled = true;
  }

  /* ── Уведомления ─────────────────────────────────────────────────────── */
  function toast(message, kind, extra) {
    const wrap = $('#toasts');
    if (!wrap) return;
    const node = el('div', { class: 'toast ' + (kind || '') }, [
      el('span', { text: message }),
      extra && extra.href ? el('a', { href: extra.href, target: '_blank', rel: 'noopener', text: extra.label || 'Открыть' }) : null,
    ]);
    wrap.appendChild(node);
    requestAnimationFrame(() => node.classList.add('is-open'));
    const life = kind === 'err' ? 8000 : 4200;
    setTimeout(() => {
      node.classList.remove('is-open');
      setTimeout(() => node.remove(), 300);
    }, life);
  }

  /* ── Диалог подтверждения ────────────────────────────────────────────── */
  let confirmResolve = null;
  function askConfirm(text, okLabel) {
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = okLabel || 'Удалить';
    $('#confirmModal').hidden = false;
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function closeConfirm(result) {
    $('#confirmModal').hidden = true;
    if (confirmResolve) { confirmResolve(result); confirmResolve = null; }
  }
  $('#confirmModal').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeConfirm(false);
  });
  $('#confirmOk').addEventListener('click', () => closeConfirm(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#confirmModal').hidden) closeConfirm(false);
  });

  /* ── Поля форм ───────────────────────────────────────────────────────── */
  /**
   * Создаёт поле ввода. onChange получает новое значение.
   * opts: {type, rows, options, hint, hintWarn, placeholder, min}
   */
  function field(label, value, onChange, opts) {
    opts = opts || {};
    const id = 'f' + Math.random().toString(36).slice(2, 9);
    let input;
    if (opts.type === 'textarea') {
      input = el('textarea', { class: 'input', id, rows: opts.rows || 4, placeholder: opts.placeholder || '' });
      input.value = value === null || value === undefined ? '' : value;
    } else if (opts.type === 'select') {
      input = el('select', { class: 'input', id });
      (opts.options || []).forEach((opt) => {
        const o = el('option', { value: opt.value, text: opt.label });
        if (String(opt.value) === String(value)) o.selected = true;
        input.appendChild(o);
      });
    } else if (opts.type === 'checkbox') {
      input = el('input', { type: 'checkbox', id });
      input.checked = Boolean(value);
    } else {
      input = el('input', { class: 'input', id, type: opts.type || 'text', placeholder: opts.placeholder || '' });
      input.value = value === null || value === undefined ? '' : value;
    }
    if (opts.type !== 'checkbox') input.classList.add('input');
    if (opts.min !== undefined) input.setAttribute('min', opts.min);

    const wrap = el('div', { class: 'field' });
    if (opts.type === 'checkbox') {
      const lab = el('label', { class: 'check', for: id }, [input, el('span', { text: label })]);
      wrap.appendChild(lab);
    } else {
      wrap.appendChild(el('label', { for: id, text: label }));
      wrap.appendChild(input);
    }
    if (opts.hint) wrap.appendChild(el('div', { class: 'hint' + (opts.hintWarn ? ' warn' : ''), text: opts.hint }));
    const error = el('div', { class: 'field-error' });
    wrap.appendChild(error);
    wrap.setError = (msg) => {
      error.textContent = msg || '';
      input.classList.toggle('has-error', Boolean(msg));
    };
    wrap.input = input;

    const handler = () => {
      let v = opts.type === 'checkbox' ? input.checked : input.value;
      if (opts.type === 'number') v = v === '' ? null : Number(v);
      wrap.setError('');
      onChange(v);
    };
    input.addEventListener('input', handler);
    if (opts.type === 'select' || opts.type === 'checkbox') input.addEventListener('change', handler);
    return wrap;
  }

  /* ── Рендер: список украшений ────────────────────────────────────────── */
  function photoUrlFor(name, size) {
    if (!name) return '';
    if (state.previews[name]) return state.previews[name];
    // адрес фото зависит от режима: на GitHub это быстрый CDN, локально — файл проекта
    const adapter = Store.active;
    if (adapter && typeof adapter.assetUrl === 'function') {
      return adapter.assetUrl(name, size || 'thumb');
    }
    return '../../assets/img/' + name + '-' + (size || 'thumb') + '.jpg';
  }

  function renderProductList() {
    const list = $('#productList');
    if (!list) return;
    const items = state.config.products || [];
    const query = state.search.trim().toLowerCase();
    const visible = items.filter((p) => !query || String(p.title || '').toLowerCase().includes(query));

    list.innerHTML = '';
    if (!visible.length) {
      list.appendChild(el('li', {}, [
        el('div', { class: 'empty-list', text: items.length ? 'Ничего не найдено по запросу' : 'Пока нет украшений. Нажмите «Добавить украшение».' }),
      ]));
      return;
    }

    visible.forEach((p) => {
      const globalIndex = items.indexOf(p);
      const cover = (p.gallery && p.gallery[0]) || '';
      const status = STATUS_OPTIONS.find((s) => s.value === p.status) || STATUS_OPTIONS[0];
      const row = el('li', {}, [
        el('button', {
          class: 'item-row' + (state.activeProduct === globalIndex ? ' is-active' : ''),
          type: 'button',
          onclick: () => selectProduct(globalIndex),
        }, [
          el('img', { class: 'item-thumb', src: photoUrlFor(cover, 'thumb'), alt: '', loading: 'lazy' }),
          el('span', { class: 'item-meta' }, [
            el('b', { text: p.title || 'Без названия' }),
            el('span', { text: status.label + (p.category ? ' · ' + categoryLabel(p.category) : '') }),
          ]),
          el('span', { class: 'item-price', text: (money(p.price) || '—') + ' ₽' }),
        ]),
      ]);
      list.appendChild(row);
    });
  }

  function categoryLabel(id) {
    const c = (state.config.categories || []).find((x) => x.id === id);
    return c ? c.label : id;
  }

  function selectProduct(index) {
    state.activeProduct = index;
    renderProductList();
    renderProductForm();
    const form = $('#productForm');
    if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Рендер: карточка украшения ──────────────────────────────────────── */
  function renderProductForm() {
    const box = $('#productForm');
    if (!box) return;
    box.innerHTML = '';
    const index = state.activeProduct;
    const product = index === null ? null : (state.config.products || [])[index];

    if (!product) {
      box.appendChild(el('div', { class: 'card' }, [
        el('p', { class: 'muted', text: 'Выберите украшение слева или добавьте новое — здесь появятся поля для правки.' }),
      ]));
      return;
    }

    const update = (patch) => {
      Object.assign(state.config.products[index], patch);
      markDirty();
      renderProductList();
    };

    /* Название и категория */
    const cardMain = el('div', { class: 'card' });
    cardMain.appendChild(el('div', { class: 'card-head' }, [
      el('h3', { text: 'Основное' }),
      el('div', { class: 'card-actions' }, [
        el('span', {
          class: 'badge-status ' + (product.status === 'rent' ? 'rent' : product.status === 'made-to-order' ? 'order' : 'stock'),
          text: (STATUS_OPTIONS.find((s) => s.value === product.status) || STATUS_OPTIONS[0]).label,
        }),
      ]),
    ]));
    cardMain.appendChild(field('Название украшения', product.title, (v) => update({ title: v }), {
      placeholder: 'Например: Колье «Олива»',
    }));
    cardMain.appendChild(el('div', { class: 'grid-2' }, [
      field('Категория', product.category, (v) => update({ category: v }), {
        type: 'select',
        options: (state.config.categories || []).filter((c) => c.id !== 'all').map((c) => ({ value: c.id, label: c.label })),
      }),
      field('Наличие', product.status, (v) => update({ status: v }), { type: 'select', options: STATUS_OPTIONS }),
    ]));
    cardMain.appendChild(el('div', { class: 'grid-2' }, [
      field('Цена, ₽', product.price, (v) => update({ price: v }), { type: 'number', min: 0 }),
      field('Плашка на фото (необязательно)', product.badge, (v) => update({ badge: v || null }), {
        placeholder: 'Новинка, Хит, В аренду…',
        hint: 'Короткая надпись в углу фотографии. Оставьте пустым — плашки не будет.',
      }),
    ]));
    box.appendChild(cardMain);

    /* Фотографии */
    box.appendChild(renderPhotosCard(index, product));

    /* Описания */
    const cardText = el('div', { class: 'card' }, [el('h3', { text: 'Описания' })]);
    cardText.appendChild(field('Подзаголовок (вторая строка в карточке)', product.subtitle, (v) => update({ subtitle: v }), {
      placeholder: 'Например: Жемчуг Майорка и крест из натурального жемчуга',
    }));
    cardText.appendChild(field('Короткая фраза для витрины', product.tagline, (v) => update({ tagline: v }), {
      placeholder: 'Роскошество в оливковом жемчуге — яркий акцент на шее.',
    }));
    cardText.appendChild(field('Полное описание (в карточке украшения)', product.description, (v) => update({ description: v }), {
      type: 'textarea', rows: 6,
      hint: 'Здесь уместно всё, что вы обычно пишете в посте: материалы, настроение, с чем носить.',
    }));
    box.appendChild(cardText);

    /* Состав */
    const cardSpec = el('div', { class: 'card' }, [
      el('h3', { text: 'Состав и детали' }),
      el('p', { class: 'muted', text: 'Пишите каждый пункт с новой строки.' }),
    ]);
    cardSpec.appendChild(field('Материалы', toLines(product.materials), (v) => update({ materials: linesToArray(v) }), {
      type: 'textarea', rows: 4, placeholder: 'Жемчуг Майорка\nНатуральный жемчуг\nПозолота',
    }));
    cardSpec.appendChild(field('Детали', toLines(product.details), (v) => update({ details: linesToArray(v) }), {
      type: 'textarea', rows: 4, placeholder: 'Длина регулируется\nПодарочная упаковка',
    }));
    cardSpec.appendChild(field('Описание фотографии (для поиска и незрячих)', product.alt, (v) => update({ alt: v }), {
      hint: 'Например: Колье из оливкового жемчуга с крестом. Помогает сайту находиться в поиске.',
    }));
    box.appendChild(cardSpec);

    /* Действия */
    const actions = el('div', { class: 'card' }, [el('h3', { text: 'Действия' })]);
    const moveWrap = el('div', { class: 'card-actions' });
    const up = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '↑ Выше в каталоге' });
    up.disabled = index === 0;
    up.addEventListener('click', () => {
      const arr = state.config.products;
      [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
      state.activeProduct = index - 1;
      markDirty();
      renderProductList();
      renderProductForm();
    });
    const down = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '↓ Ниже в каталоге' });
    down.disabled = index === (state.config.products || []).length - 1;
    down.addEventListener('click', () => {
      const arr = state.config.products;
      [arr[index + 1], arr[index]] = [arr[index], arr[index + 1]];
      state.activeProduct = index + 1;
      markDirty();
      renderProductList();
      renderProductForm();
    });
    moveWrap.appendChild(up);
    moveWrap.appendChild(down);
    actions.appendChild(moveWrap);

    const dup = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Сделать копию' });
    dup.addEventListener('click', () => {
      const copy = clone(state.config.products[index]);
      copy.id = copy.id + '-copy-' + Math.random().toString(36).slice(2, 5);
      copy.title = (copy.title || 'Украшение') + ' (копия)';
      state.config.products.splice(index + 1, 0, copy);
      state.activeProduct = index + 1;
      markDirty();
      renderProductList();
      renderProductForm();
      toast('Копия создана — не забудьте поменять название и фото', 'warn');
    });
    actions.appendChild(dup);

    const del = el('button', { class: 'btn btn-danger-ghost btn-sm', type: 'button', text: 'Удалить украшение' });
    del.addEventListener('click', async () => {
      const ok = await askConfirm('Удалить «' + (product.title || 'без названия') + '»? Действие нельзя отменить.', 'Удалить');
      if (!ok) return;
      state.config.products.splice(index, 1);
      state.activeProduct = state.config.products.length ? Math.max(0, index - 1) : null;
      markDirty();
      renderAll();
      toast('Украшение удалено. Не забудьте сохранить.', 'warn');
    });
    actions.appendChild(del);
    box.appendChild(actions);
  }

  /* ── Фотографии украшения ────────────────────────────────────────────── */
  function renderPhotosCard(index, product) {
    const card = el('div', { class: 'card' }, [
      el('h3', { text: 'Фотографии' }),
      el('p', { class: 'muted', text: 'Первое фото — главное, оно показывается в каталоге. Остальные появятся в карточке украшения. Можно перетащить файлы прямо сюда.' }),
    ]);

    const gallery = Array.isArray(product.gallery) ? product.gallery : (product.gallery = []);
    const grid = el('div', { class: 'photos' });

    gallery.forEach((name, i) => {
      const tools = el('div', { class: 'photo-tools' });
      if (i > 0) {
        const makeMain = el('button', { type: 'button', title: 'Сделать главной', text: '★', 'aria-label': 'Сделать главной' });
        makeMain.addEventListener('click', () => {
          gallery.splice(i, 1);
          gallery.unshift(name);
          markDirty();
          renderProductForm();
          renderProductList();
        });
        tools.appendChild(makeMain);
      }
      const remove = el('button', { class: 'danger', type: 'button', title: 'Удалить фото из карточки', text: '✕', 'aria-label': 'Удалить фото' });
      remove.addEventListener('click', async () => {
        const ok = await askConfirm('Убрать это фото из украшения?', 'Убрать');
        if (!ok) return;
        gallery.splice(i, 1);
        markDirty();
        renderProductForm();
        renderProductList();
      });
      tools.appendChild(remove);

      grid.appendChild(el('div', { class: 'photo' }, [
        el('img', { src: photoUrlFor(name, 'thumb'), alt: '', loading: 'lazy' }),
        i === 0 ? el('span', { class: 'photo-main', text: 'Главное' }) : null,
        tools,
      ]));
    });

    const addBtn = el('button', { class: 'photo-add', type: 'button' }, [
      el('b', { text: '+' }),
      el('span', { text: 'Добавить фото' }),
    ]);
    const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple', style: 'display:none' });
    addBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      if (fileInput.files && fileInput.files.length) {
        await handlePhotoFiles(index, Array.from(fileInput.files));
      }
      fileInput.value = '';
    });

    // перетаскивание файлов
    ['dragenter', 'dragover'].forEach((evt) => addBtn.addEventListener(evt, (e) => {
      e.preventDefault();
      addBtn.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach((evt) => addBtn.addEventListener(evt, () => addBtn.classList.remove('is-over')));
    addBtn.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type));
      if (files.length) await handlePhotoFiles(index, files);
    });

    grid.appendChild(addBtn);
    card.appendChild(grid);
    card.appendChild(fileInput);

    const queue = el('div', { class: 'photo-queue' });
    queue.id = 'photoQueue';
    card.appendChild(queue);

    if (state.pendingPhotos.length) renderQueue();
    return card;
  }

  function renderQueue() {
    const queue = $('#photoQueue');
    if (!queue) return;
    queue.innerHTML = '';
    state.pendingPhotos.forEach((p) => {
      queue.appendChild(el('div', { class: 'photo-queue-row', dataset: { name: p.name } }, [
        el('span', { text: '📷 ' + p.files.length + ' файлов: ' + p.name }),
        el('span', { class: 'muted', text: p.width + '×' + p.height }),
      ]));
    });
  }

  async function handlePhotoFiles(index, files) {
    const product = state.config.products[index];
    const baseName = Photos.slugify(product.id || product.title || 'photo', 'photo');
    const queue = $('#photoQueue');

    for (const file of files) {
      const row = el('div', { class: 'photo-queue-row' }, [
        el('span', { text: 'Обрабатываю ' + file.name + '…' }),
        el('span', { class: 'bar' }, [el('i')]),
      ]);
      if (queue) queue.appendChild(row);

      try {
        const stamp = state.pendingPhotos.length ? '-' + (state.pendingPhotos.length + 1) : '';
        const result = await Photos.prepare(file, { name: baseName + stamp, aspect: '4:5' });
        state.pendingPhotos.push(result);
        state.previews[result.name] = result.previewUrl;
        const gallery = state.config.products[index].gallery || (state.config.products[index].gallery = []);
        if (!gallery.includes(result.name)) gallery.push(result.name);
        row.classList.add('is-done');
        row.firstChild.textContent = '✓ ' + result.name + ' — ' + result.files.length + ' файлов готово';
        const bar = row.querySelector('.bar i');
        if (bar) bar.style.width = '100%';
      } catch (err) {
        row.classList.add('is-error');
        row.firstChild.textContent = '✕ ' + file.name + ': ' + err.message;
      }
    }

    markDirty();
    renderProductForm();
    renderProductList();
    toast('Фото готовы. Нажмите «Сохранить изменения», чтобы записать их в папку проекта.', 'ok');
  }

  /* ── Рендер: категории ───────────────────────────────────────────────── */
  function renderCategories() {
    const box = $('#categoryEditor');
    if (!box) return;
    box.innerHTML = '';
    const cats = state.config.categories || [];

    const rows = el('div', { class: 'rows' });
    cats.forEach((cat, i) => {
      const isSystem = cat.id === 'all';
      const card = el('div', { class: 'row-card' }, [
        el('div', { class: 'row-handle' }, [el('span', { class: 'row-num', text: String(i + 1) })]),
        el('div', { class: 'row-fields' }, [
          field('Название фильтра', cat.label, (v) => {
            cat.label = v;
            markDirty();
            renderProductList();
          }, { placeholder: 'Например: Колье' }),
          isSystem ? el('div', { class: 'muted', text: 'Это фильтр «Все украшения» — он нужен всегда.' }) : null,
        ]),
        el('div', { class: 'row-tools' }, [
          isSystem ? null : (() => {
            const used = (state.config.products || []).filter((p) => p.category === cat.id).length;
            const del = el('button', { class: 'btn btn-danger-ghost btn-sm', type: 'button', text: 'Удалить' });
            del.addEventListener('click', async () => {
              if (used) {
                toast('В этой категории ' + used + ' украшений. Сначала перенесите их в другую категорию.', 'err');
                return;
              }
              const ok = await askConfirm('Удалить категорию «' + cat.label + '»?', 'Удалить');
              if (!ok) return;
              cats.splice(i, 1);
              markDirty();
              renderCategories();
            });
            return del;
          })(),
        ]),
      ]);
      rows.appendChild(card);
    });
    box.appendChild(rows);
  }

  /* ── Рендер: контакты ────────────────────────────────────────────────── */
  function renderContacts() {
    const box = $('#contactEditor');
    if (!box) return;
    box.innerHTML = '';
    const contacts = state.config.contacts || [];

    const hint = el('div', { class: 'card' }, [
      el('h4', { text: 'Как заполнять ссылку' }),
      el('div', { class: 'kv' }, [
        el('b', { text: 'Telegram' }), el('span', { html: '<code>https://t.me/ваш_ник</code>' }),
        el('b', { text: 'WhatsApp' }), el('span', { html: '<code>https://wa.me/79001234567</code> — только цифры, без «+» и пробелов' }),
        el('b', { text: 'ВКонтакте' }), el('span', { html: '<code>https://vk.com/id77003201</code>' }),
        el('b', { text: 'Instagram' }), el('span', { html: '<code>https://instagram.com/ваш_ник</code>' }),
        el('b', { text: 'Телефон' }), el('span', { html: '<code>tel:+79001234567</code>' }),
      ]),
    ]);
    box.appendChild(hint);

    const rows = el('div', { class: 'rows' });
    contacts.forEach((contact, i) => {
      const fields = el('div', { class: 'row-fields' });
      fields.appendChild(el('div', { class: 'grid-2' }, [
        field('Название кнопки', contact.label, (v) => { contact.label = v; markDirty(); }, { placeholder: 'Telegram' }),
        field('Что видит покупатель', contact.value, (v) => { contact.value = v; markDirty(); }, { placeholder: '@jewelry_by_ak' }),
      ]));
      fields.appendChild(field('Ссылка', contact.href, (v) => { contact.href = v; markDirty(); }, {
        placeholder: 'https://t.me/…',
        hint: 'Проверьте, что ссылка открывается в браузере.',
      }));
      fields.appendChild(el('div', { class: 'grid-2' }, [
        field('Подпись справа', contact.note, (v) => { contact.note = v; markDirty(); }, { placeholder: 'Самый быстрый ответ' }),
        (() => {
          const wrap = el('div', { class: 'field' }, [
            el('label', { text: 'Иконка' }),
            (() => {
              const picker = el('div', { class: 'icon-picker' });
              ICON_OPTIONS.forEach((opt) => {
                const b = el('button', {
                  class: contact.icon === opt.value ? 'is-active' : '',
                  type: 'button',
                  text: opt.label,
                });
                b.addEventListener('click', () => {
                  contact.icon = opt.value;
                  markDirty();
                  renderContacts();
                });
                picker.appendChild(b);
              });
              return picker;
            })(),
          ]);
          return wrap;
        })(),
      ]));

      const primary = el('label', { class: 'check' });
      const cb = el('input', { type: 'checkbox' });
      cb.checked = Boolean(contact.primary);
      cb.addEventListener('change', () => {
        if (cb.checked) contacts.forEach((c) => { c.primary = false; });
        contact.primary = cb.checked;
        markDirty();
        renderContacts();
      });
      primary.appendChild(cb);
      primary.appendChild(el('span', { text: 'Основной (кнопка «Написать» на сайте)' }));
      fields.appendChild(primary);

      const tools = el('div', { class: 'row-tools' });
      const move = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '↑', 'aria-label': 'Выше' });
      move.disabled = i === 0;
      move.addEventListener('click', () => {
        [contacts[i - 1], contacts[i]] = [contacts[i], contacts[i - 1]];
        markDirty();
        renderContacts();
      });
      const remove = el('button', { class: 'btn btn-danger-ghost btn-sm', type: 'button', text: 'Удалить' });
      remove.addEventListener('click', async () => {
        const ok = await askConfirm('Удалить контакт «' + contact.label + '»?', 'Удалить');
        if (!ok) return;
        contacts.splice(i, 1);
        if (contact.primary && contacts.length) contacts[0].primary = true;
        markDirty();
        renderContacts();
      });
      tools.appendChild(move);
      tools.appendChild(remove);

      rows.appendChild(el('div', { class: 'row-card' }, [
        el('div', { class: 'row-handle' }, [el('span', { class: 'row-num', text: String(i + 1) })]),
        fields,
        tools,
      ]));
    });
    box.appendChild(rows);
  }

  /* ── Рендер: бренд ───────────────────────────────────────────────────── */
  function renderBrand() {
    const box = $('#brandEditor');
    if (!box) return;
    box.innerHTML = '';
    const b = state.config.brand;
    const set = (key) => (v) => { b[key] = v; markDirty(); };

    const card = el('div', { class: 'card' }, [el('h3', { text: 'Бренд' })]);
    card.appendChild(field('Название бренда', b.name, set('name'), { placeholder: 'Jewelry by AK' }));
    card.appendChild(field('Ваше имя', b.owner, set('owner'), { placeholder: 'Анжела' }));
    card.appendChild(field('Подпись под логотипом', b.tagline, set('tagline'), { placeholder: 'украшения ручной работы' }));
    card.appendChild(el('div', { class: 'grid-2' }, [
      field('Валюта', b.currency, set('currency'), { placeholder: '₽' }),
      field('Город или страна', b.city, set('city'), { placeholder: 'Россия' }),
    ]));
    box.appendChild(card);

    const delivery = el('div', { class: 'card' }, [
      el('h3', { text: 'Доставка и связь' }),
      el('p', { class: 'muted', text: 'Эти строки видны в карточке украшения и в разделе контактов.' }),
    ]);
    delivery.appendChild(field('Как вы отправляете', b.deliveryNote, set('deliveryNote'), {
      placeholder: 'Отправка по России и самовывоз',
    }));
    delivery.appendChild(field('Когда вы отвечаете', b.workHours, set('workHours'), {
      placeholder: 'ежедневно с 10:00 до 21:00',
    }));
    box.appendChild(delivery);

    const copyCard = el('div', { class: 'card' }, [
      el('h3', { text: 'Подписи кнопок' }),
      el('p', { class: 'muted', text: 'Можно менять формулировки на свои.' }),
    ]);
    copyCard.appendChild(field('Заголовок панели избранного', state.config.copy.savedTitle, (v) => { state.config.copy.savedTitle = v; markDirty(); }));
    copyCard.appendChild(el('div', { class: 'grid-2' }, [
      field('Кнопка покупки', state.config.copy.orderCta, (v) => { state.config.copy.orderCta = v; markDirty(); }),
      field('Кнопка аренды', state.config.copy.rentCta, (v) => { state.config.copy.rentCta = v; markDirty(); }),
    ]));
    box.appendChild(copyCard);
  }

  /* ── Рендер: аренда ──────────────────────────────────────────────────── */
  function renderRental() {
    const box = $('#rentalEditor');
    if (!box) return;
    box.innerHTML = '';
    const r = state.config.rental;
    const card = el('div', { class: 'card' }, [
      el('h3', { text: 'Условия аренды' }),
      el('p', { class: 'muted', text: 'Сумму можно не указывать — тогда на сайте будет «стоимость уточняйте в сообщении».' }),
    ]);
    card.appendChild(el('div', { class: 'grid-2' }, [
      field('Аренда от, ₽', r.priceFrom, (v) => { r.priceFrom = v; markDirty(); }, {
        type: 'number', min: 0, placeholder: 'не указывать',
      }),
      field('Срок аренды', r.duration, (v) => { r.duration = v; markDirty(); }, { placeholder: '1–3 дня' }),
    ]));
    card.appendChild(field('Условия залога', r.deposit, (v) => { r.deposit = v; markDirty(); }, {
      placeholder: 'залог обсуждается индивидуально',
    }));
    box.appendChild(card);

    const rentProducts = (state.config.products || []).filter((p) => p.status === 'rent');
    const info = el('div', { class: 'card' }, [
      el('h4', { text: 'Украшения для аренды: ' + rentProducts.length }),
      el('p', { class: 'muted', text: rentProducts.length
        ? rentProducts.map((p) => p.title).join(', ')
        : 'Пока ни одно украшение не отмечено как «В аренду». Откройте украшение и выберите наличие «В аренду».' }),
    ]);
    box.appendChild(info);
  }

  /* ── Рендер: главный экран ───────────────────────────────────────────── */
  function renderHero() {
    const box = $('#heroEditor');
    if (!box) return;
    box.innerHTML = '';

    const factsCard = el('div', { class: 'card' }, [
      el('h3', { text: 'Цифры под кнопками' }),
      el('p', { class: 'muted', text: 'Три коротких блока: крупное значение и подпись под ним.' }),
    ]);
    const factsWrap = el('div', { class: 'rows' });
    state.hero.facts.forEach((fact, i) => {
      const rows = el('div', { class: 'row-card' }, [
        el('div', { class: 'row-handle' }, [el('span', { class: 'row-num', text: String(i + 1) })]),
        el('div', { class: 'row-fields' }, [
          el('div', { class: 'grid-2' }, [
            field('Значение', fact.value, (v) => { fact.value = v; markDirty(); }, { placeholder: '100%' }),
            field('Подпись', fact.label, (v) => { fact.label = v; markDirty(); }, { placeholder: 'ручная сборка' }),
          ]),
        ]),
        el('div', { class: 'row-tools' }, [
          (() => {
            const rm = el('button', { class: 'btn btn-danger-ghost btn-sm', type: 'button', text: 'Удалить' });
            rm.addEventListener('click', () => {
              state.hero.facts.splice(i, 1);
              markDirty();
              renderHero();
            });
            return rm;
          })(),
        ]),
      ]);
      factsWrap.appendChild(rows);
    });
    factsCard.appendChild(factsWrap);
    const addFact = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '+ Добавить блок' });
    addFact.addEventListener('click', () => {
      state.hero.facts.push({ value: '', label: '' });
      markDirty();
      renderHero();
    });
    factsCard.appendChild(addFact);
    box.appendChild(factsCard);

    const hotCard = el('div', { class: 'card' }, [
      el('h3', { text: 'Плашка «Хит сезона» на фотографии' }),
      el('p', { class: 'muted', text: 'Выберите украшение — его название и цена появятся на главном фото.' }),
    ]);
    hotCard.appendChild(field('Украшение на плашке', state.hero.hotId, (v) => {
      state.hero.hotId = v;
      markDirty();
      renderHero();
    }, {
      type: 'select',
      options: [{ value: '', label: '— не показывать —' }].concat(
        (state.config.products || []).map((p) => ({ value: p.id, label: p.title + ' · ' + money(p.price) + ' ₽' }))
      ),
    }));
    box.appendChild(hotCard);

    const check = el('div', { class: 'card' }, [
      el('h4', { text: 'Что ещё есть на главном экране' }),
      el('ul', { class: 'help-list' }, [
        el('li', { text: 'Заголовок «Украшения, в которых живёт душа» — меняется в файле index.html, строка <h1 id="heroTitle">.' }),
        el('li', { text: 'Приветственный текст — там же, абзац с классом hero-lead.' }),
        el('li', { text: 'Большое фото справа — это assets/img/portrait-*.jpg, заменить можно через «Украшения», добавив фото и указав его в нужном украшении.' }),
      ]),
    ]);
    box.appendChild(check);
  }

  /* ── Рендер: резервные копии и режим сохранения ─────────────────────── */
  function renderBackup() {
    const box = $('#backupEditor');
    if (!box) return;
    box.innerHTML = '';

    const github = modeIsGithub();
    const modeName = !state.adapter ? 'не настроено' : (github ? 'GitHub (репозиторий)' : 'Папка на компьютере');

    const rows = [
      el('b', { text: 'Способ сохранения' }), el('span', { text: modeName }),
      el('b', { text: 'Куда сохраняется' }), el('span', { text: state.adapter ? state.adapter.describe() : '—' }),
      el('b', { text: 'Украшений' }), el('span', { text: String((state.config.products || []).length) }),
      el('b', { text: 'Контактов' }), el('span', { text: String((state.config.contacts || []).length) }),
      el('b', { text: 'Последнее сохранение' }), el('span', { text: state.lastSavedAt || 'ещё не сохраняли' }),
    ];
    if (github && state.conn && state.conn.fullName) {
      rows.splice(2, 0, el('b', { text: 'Репозиторий' }), el('span', { text: state.conn.fullName + (state.conn.branch ? ' · ' + state.conn.branch : '') }));
      rows.splice(4, 0, el('b', { text: 'Доступ на запись' }), el('span', { text: state.conn.canPush ? 'есть' : 'нет' }));
    }
    box.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'Состояние' }),
      el('div', { class: 'kv' }, rows),
      state.commitUrl ? el('p', { class: 'muted', html: 'Последний коммит: <a href="' + state.commitUrl + '" target="_blank" rel="noopener">открыть на GitHub</a>' }) : null,
    ]));

    // смена режима
    const modeCard = el('div', { class: 'card' }, [
      el('h3', { text: 'Способ сохранения' }),
      el('p', { class: 'muted', text: github
        ? 'Правки уходят коммитом в репозиторий GitHub. Хостинг пересобирает сайт — обычно это занимает 30–60 секунд.'
        : 'Правки записываются прямо в файлы на этом компьютере. Так удобно, пока сайт не опубликован.' }),
    ]);
    const modeActions = el('div', { class: 'card-actions' });
    const switchBtn = el('button', { class: 'btn btn-ghost btn-block', type: 'button', text: github ? 'Переключить на папку на компьютере' : 'Переключить на GitHub' });
    switchBtn.id = 'switchMode2';
    switchBtn.addEventListener('click', () => openConnect({ mode: github ? 'folder' : 'github' }));
    modeActions.appendChild(switchBtn);
    modeCard.appendChild(modeActions);
    box.appendChild(modeCard);

    // резервные копии
    const actions = el('div', { class: 'card' }, [
      el('h3', { text: 'Резервные копии' }),
      el('p', { class: 'muted', text: github
        ? 'Все версии хранит GitHub: любую правку можно отменить. Кнопка ниже выгрузит текущие настройки файлом.'
        : 'При каждом сохранении копия предыдущей версии кладётся в admin/backups/.' }),
    ]);

    const download = el('button', { class: 'btn btn-ghost btn-block', type: 'button', text: 'Выгрузить настройки файлом' });
    download.addEventListener('click', () => {
      const text = Store.serializeConfig(configSnapshot());
      const blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'shop.config.js' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast('Файл сохранён в «Загрузки». Его можно заменить в папке js/', 'ok');
    });
    actions.appendChild(download);

    const restoreInput = el('input', { type: 'file', accept: '.js,.json,application/json', style: 'display:none' });
    const restoreBtn = el('button', { class: 'btn btn-ghost btn-block', type: 'button', text: 'Загрузить настройки из файла' });
    restoreBtn.addEventListener('click', () => restoreInput.click());
    restoreInput.addEventListener('change', async () => {
      const file = restoreInput.files && restoreInput.files[0];
      restoreInput.value = '';
      if (!file) return;
      try {
        const parsed = Store.parseConfigText(await file.text());
        if (!parsed) throw new Error('В файле не найдены настройки');
        const ok = await askConfirm('Заменить все текущие настройки данными из файла?', 'Заменить');
        if (!ok) return;
        applyLoadedConfig(parsed, null);
        markDirty();
        renderAll();
        toast('Настройки загружены. Нажмите «Сохранить изменения».', 'warn');
      } catch (err) {
        toast('Не получилось прочитать файл: ' + err.message, 'err');
      }
    });
    actions.appendChild(restoreBtn);
    actions.appendChild(restoreInput);

    const refresh = el('button', { class: 'btn btn-ghost btn-block', type: 'button', text: github ? 'Перечитать настройки с сайта' : 'Перечитать настройки из папки' });
    refresh.addEventListener('click', async () => {
      if (!state.adapter) { toast('Сначала настройте сохранение', 'err'); return; }
      const ok = await askConfirm('Забыть несохранённые правки и прочитать данные заново?', 'Перечитать');
      if (!ok) return;
      await loadFromAdapter();
      renderAll();
      toast('Настройки перечитаны', 'ok');
    });
    actions.appendChild(refresh);

    const off = el('button', { class: 'btn btn-danger-ghost btn-block', type: 'button', text: github ? 'Выйти из GitHub' : 'Отключить папку проекта' });
    off.addEventListener('click', () => $('#disconnect').click());
    actions.appendChild(off);
    box.appendChild(actions);
  }

  /* ── Рендер: справка ─────────────────────────────────────────────────── */
  function renderHelp() {
    const box = $('#helpEditor');
    if (!box) return;
    box.innerHTML = '';

    box.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'С чего начать' }),
      el('ol', { class: 'help-steps' }, [
        el('li', { html: '<b>Настройте сохранение.</b> Кнопка «Сменить способ сохранения» в разделе «Резервные копии». Если сайт уже в интернете — выбирайте <b>GitHub</b>: панель попросит токен один раз.' }),
        el('li', { html: '<b>Правьте содержимое.</b> Украшения, цены, контакты, тексты — всё в разделах слева. Поля подписаны простыми словами.' }),
        el('li', { html: '<b>Нажмите «Сохранить изменения».</b> В режиме GitHub правки уходят коммитом в репозиторий — сайт пересоберётся за 30–60 секунд. В режиме папки файлы обновляются сразу.' }),
        el('li', { html: '<b>Обновите страницу сайта</b> (F5) — и увидите результат.' }),
      ]),
    ]));

    box.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'Два способа сохранения' }),
      el('h4', { text: 'GitHub — если сайт опубликован' }),
      el('p', { class: 'muted', html: 'Правки уходят <b>коммитом в репозиторий</b>, а GitHub Pages или Vercel пересобирает сайт. Нужен токен GitHub — он создаётся один раз на странице <code>github.com/settings/tokens</code>. Токен хранится только в вашем браузере.' }),
      el('h4', { text: 'Папка на компьютере — если сайт ещё не выложен' }),
      el('p', { class: 'muted', html: 'Панель пишет файлы прямо в папку проекта. Нужны Chrome или Edge. Перед сохранением делается копия прежних настроек в <code>admin/backups/</code>.' }),
    ]));

    box.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'Про фотографии' }),
      el('ul', { class: 'help-list' }, [
        el('li', { text: 'В карточке украшения нажмите «Добавить фото» или просто перетащите файлы в эту рамку.' }),
        el('li', { text: 'Панель сама уменьшит фото до нужных размеров — готовить их заранее не нужно. Подойдут даже снятые на телефон.' }),
        el('li', { text: 'Первое фото в списке становится главным — оно показывается в каталоге. Кнопка ★ делает фото главным.' }),
        el('li', { text: 'Фото аккуратно обрезается до вертикального формата 4:5 — так карточки выглядят ровно.' }),
        el('li', { text: 'Пока вы не нажали «Сохранить изменения», фото живут только в браузере.' }),
      ]),
    ]));

    box.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'Частые вопросы' }),
      el('h4', { text: 'Как добавить новое украшение' }),
      el('p', { class: 'muted', text: 'Раздел «Украшения» → «+ Добавить украшение» → заполнить название и цену → добавить фото → «Сохранить изменения».' }),
      el('h4', { text: 'Как убрать украшение с сайта' }),
      el('p', { class: 'muted', text: 'Откройте украшение и нажмите «Удалить украшение». Кнопка не вернёт его обратно, поэтому перед удалением лучше сделать резервную копию.' }),
      el('h4', { text: 'Панель снова просит токен' }),
      el('p', { class: 'muted', text: 'Так бывает, если браузер закрыли полностью или очистили историю. Вставьте токен снова — это займёт несколько секунд. Можно сохранить токен в менеджере паролей.' }),
      el('h4', { text: 'Правки не появились на сайте' }),
      el('p', { class: 'muted', text: 'Хостингу нужно 30–60 секунд на пересборку. Панель сама сообщит, когда сайт обновился. Если прошло больше двух минут — откройте коммит по ссылке в уведомлении и проверьте, нет ли ошибки сборки.' }),
      el('h4', { text: 'Как отменить правку' }),
      el('p', { class: 'muted', text: 'В режиме GitHub все версии хранит репозиторий: на странице коммитов можно вернуть прежний файл. В режиме папки предыдущие версии лежат в admin/backups/.' }),
      el('h4', { text: 'Что делать, если что-то сломалось' }),
      el('p', { class: 'muted', html: 'Раздел «Резервные копии» → «Выгрузить настройки файлом». Он пришлёт текущее состояние, и его можно будет вернуть обратно.' }),
    ]));

    box.appendChild(el('div', { class: 'card' }, [
      el('h3', { text: 'Что панель не меняет' }),
      el('p', { class: 'muted', text: 'Оформление (цвета, шрифты), порядок разделов на сайте и тексты разделов «О бренде», «Как заказать», «Уход». Для этого нужен файл index.html — это уже задача для того, кто делал сайт.' }),
    ]));
  }

  function renderAll() {
    state.counts.products = (state.config.products || []).length;
    state.counts.categories = (state.config.categories || []).length;
    state.counts.contacts = (state.config.contacts || []).length;
    $('#countProducts').textContent = String(state.counts.products);
    $('#countCategories').textContent = String(state.counts.categories);
    $('#countContacts').textContent = String(state.counts.contacts);
    renderProductList();
    renderProductForm();
    renderCategories();
    renderContacts();
    renderBrand();
    renderRental();
    renderHero();
    renderBackup();
    renderHelp();
    updateStatus();
  }

  /* ── Вкладки ─────────────────────────────────────────────────────────── */
  function switchTab(name) {
    state.activeTab = name;
    $$('#tabs .tab').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === name));
    $$('.panel').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === name));
  }

  /* ── Чтение настроек ─────────────────────────────────────────────────── */
  const HERO_CARD_RE = /(<figcaption class="hero-card">)([\s\S]*?)(<\/figcaption>)/;

  function readHeroFromHtml(html) {
    const out = { facts: [], hotId: '', hotTitle: '', hotPrice: '' };
    if (!html) return out;

    const factsMatch = html.match(/<ul class="hero-facts"[^>]*>([\s\S]*?)<\/ul>/);
    if (factsMatch) {
      const items = factsMatch[1].match(/<li>[\s\S]*?<\/li>/g) || [];
      items.forEach((li) => {
        const b = li.match(/<b>([\s\S]*?)<\/b>/);
        const span = li.match(/<span>([\s\S]*?)<\/span>/);
        out.facts.push({ value: b ? b[1].trim() : '', label: span ? span[1].trim() : '' });
      });
    }

    const card = html.match(HERO_CARD_RE);
    if (card) {
      const title = card[2].match(/hero-card-title">([\s\S]*?)<\/span>/);
      const price = card[2].match(/hero-card-price">([\s\S]*?)<\/span>/);
      out.hotTitle = title ? title[1].trim() : '';
      out.hotPrice = price ? price[1].trim() : '';
    }
    return out;
  }

  /** Применяет прочитанные настройки. htmlFacts — цифры, взятые со страницы. */
  function applyLoadedConfig(parsed, htmlInfo) {
    const merged = Store.defaults();
    const c = parsed || {};
    merged.brand = Object.assign(merged.brand, c.brand || {});
    merged.contacts = Array.isArray(c.contacts) ? clone(c.contacts) : merged.contacts;
    merged.categories = Array.isArray(c.categories) && c.categories.length ? clone(c.categories) : merged.categories;
    merged.products = Array.isArray(c.products) ? clone(c.products) : merged.products;
    merged.rental = Object.assign(merged.rental, c.rental || {});
    merged.copy = Object.assign(merged.copy, c.copy || {});
    state.config = merged;

    state.hero = Object.assign({ facts: [], hotId: '' }, c.hero || {});
    // цифры живут в index.html — он главнее, иначе правки «не прилипают»
    if (htmlInfo && htmlInfo.facts && htmlInfo.facts.length) {
      state.hero.facts = htmlInfo.facts;
    }
    if (htmlInfo && htmlInfo.hotTitle && !state.hero.hotId) {
      const hot = (merged.products || []).find((p) => p.title === htmlInfo.hotTitle);
      if (hot) state.hero.hotId = hot.id;
    }
    if (!state.hero.hotId && state.config.products.length) {
      const featured = state.config.products.find((p) => p.featured);
      state.hero.hotId = featured ? featured.id : '';
    }
    if (!state.hero.facts.length) {
      state.hero.facts = [
        { value: '100%', label: 'ручная сборка' },
        { value: '1 из 1', label: 'каждое изделие' },
      ];
    }
    state.activeProduct = (merged.products || []).length ? 0 : null;
    state.dirty = false;
  }

  async function loadFromAdapter() {
    if (!state.adapter) return false;
    const text = await state.adapter.loadConfigText();
    const parsed = Store.parseConfigText(text);

    state.indexHtml = null;
    let htmlInfo = null;
    try {
      // держим копию главной страницы, чтобы правки «Хита сезона» и цифр
      // не терялись, если чтение в момент сохранения не удалось
      const html = await state.adapter.loadIndexHtml();
      state.indexHtml = html || null;
      htmlInfo = readHeroFromHtml(html);
    } catch (_) {}

    applyLoadedConfig(parsed, htmlInfo);
    if (htmlInfo) {
      if (htmlInfo.hotTitle) state.hero.hotTitle = htmlInfo.hotTitle;
      if (htmlInfo.hotPrice) state.hero.hotPrice = htmlInfo.hotPrice;
    }
    return Boolean(parsed);
  }

  /* ── Сохранение ──────────────────────────────────────────────────────── */
  function validate() {
    const problems = [];
    const products = state.config.products || [];
    const seenIds = new Set();
    const seenTitles = new Set();

    products.forEach((p, i) => {
      const where = 'Украшение №' + (i + 1) + (p.title ? ' («' + p.title + '»)' : '');
      if (!p.title || !String(p.title).trim()) problems.push(where + ': не заполнено название');
      if (p.price === null || p.price === undefined || p.price === '' || isNaN(Number(p.price))) {
        problems.push(where + ': не указана цена');
      }
      if (!p.gallery || !p.gallery.length) problems.push(where + ': нет ни одной фотографии');
      if (!p.category) problems.push(where + ': не выбрана категория');
      if (!p.id) p.id = Photos.slugify(p.title, 'product') + '-' + (i + 1);
      if (seenIds.has(p.id)) problems.push(where + ': повторяется внутренний код (id) — сделайте копию заново');
      seenIds.add(p.id);
      const title = String(p.title || '').trim().toLowerCase();
      if (title && seenTitles.has(title)) problems.push(where + ': такое название уже есть в каталоге');
      seenTitles.add(title);
    });

    const catIds = new Set((state.config.categories || []).map((c) => c.id));
    products.forEach((p, i) => {
      if (p.category && !catIds.has(p.category)) {
        problems.push('Украшение №' + (i + 1) + ': категория «' + p.category + '» больше не существует');
      }
    });

    (state.config.contacts || []).forEach((c, i) => {
      const where = 'Контакт №' + (i + 1) + (c.label ? ' (' + c.label + ')' : '');
      if (!c.label || !String(c.label).trim()) problems.push(where + ': не заполнено название кнопки');
      if (!c.href || !String(c.href).trim()) problems.push(where + ': не заполнена ссылка');
      else if (!/^(https?:\/\/|tel:|mailto:)/i.test(String(c.href).trim())) {
        problems.push(where + ': ссылка должна начинаться с https:// или tel:');
      }
    });

    return problems;
  }

  /** Собирает разметку блока цифр для главного экрана. */
  function heroFactsHtml() {
    const facts = (state.hero.facts || []).filter((f) => String(f.value).trim() || String(f.label).trim());
    if (!facts.length) return '';
    return '\n        <ul class="hero-facts" aria-label="Ключевые особенности">\n' +
      facts.map((f) => '          <li><b>' + escapeHtml(f.value) + '</b><span>' + escapeHtml(f.label) + '</span></li>').join('\n') +
      '\n        </ul>';
  }

  function applyHeroToHtml(html) {
    let out = html;
    const facts = heroFactsHtml();
    const factsRe = /[ \t]*<ul class="hero-facts"[\s\S]*?<\/ul>/;
    if (facts) {
      if (factsRe.test(out)) out = out.replace(factsRe, facts);
      else out = out.replace(/(<div class="hero-cta">[\s\S]*?<\/div>)/, '$1' + facts);
    }

    const hot = (state.config.products || []).find((p) => p.id === state.hero.hotId);
    if (hot) {
      out = out.replace(HERO_CARD_RE, (match, open, body, close) => {
        let inner = body
          .replace(/(hero-card-title">)[\s\S]*?(<\/span>)/, '$1' + escapeHtml(hot.title) + '$2')
          .replace(/(hero-card-price">)[\s\S]*?(<\/span>)/, '$1' + money(hot.price) + ' ₽$2');
        return open + inner + close;
      });
    }
    return out;
  }

  /** Собирает список файлов для сохранения: настройки, фото, index.html. */
  async function collectChanges(snapshot) {
    const files = [];
    const report = { photos: 0, indexChanged: false, indexError: null };

    const configText = Store.serializeConfig(snapshot);
    files.push({ path: 'js/shop.config.js', text: configText });

    for (const photo of state.pendingPhotos) {
      for (const file of photo.files) {
        files.push({ path: 'assets/img/' + file.name, bytes: file.bytes });
        report.photos += 1;
      }
    }

    // index.html берём из кэша (прочитан при подключении) либо пробуем прочитать ещё раз
    let html = state.indexHtml;
    if (!html) {
      try { html = await state.adapter.loadIndexHtml(); } catch (err) { report.indexError = err; }
    }
    if (html) {
      state.indexHtml = html;
      const updated = applyHeroToHtml(html);
      if (updated !== html) {
        files.push({ path: 'index.html', text: updated });
        report.indexChanged = true;
        state.indexHtml = updated;
      }
    } else {
      report.indexError = report.indexError || new Error('index.html не найден');
    }

    return { files, report, configText };
  }

  function commitMessage(report, snapshot) {
    const bits = [];
    if (report.photos) bits.push('фото: ' + report.photos);
    const titles = (snapshot.products || []).length;
    bits.push('украшений: ' + titles);
    return 'Панель управления: обновление сайта (' + bits.join(', ') + ')';
  }

  async function save() {
    if (!state.adapter) {
      toast('Сначала настройте сохранение', 'err');
      openConnect();
      return { ok: false, reason: 'no-adapter' };
    }
    if (state.saving || state.publishing) {
      // защита от двойного нажатия: сообщаем, что сохранение уже идёт
      return { ok: false, reason: 'busy' };
    }

    const problems = validate();
    if (problems.length) {
      toast('Не сохранил: ' + problems.length + ' ' + (problems.length === 1 ? 'замечание' : 'замечания') + '. ' + problems[0], 'err');
      problems.slice(0, 6).forEach((p) => toast(p, 'err'));
      return { ok: false, reason: 'validation', problems };
    }

    state.saving = true;
    updateStatus();
    try {
      const snapshot = configSnapshot();
      const { files, report } = await collectChanges(snapshot);

      if (modeIsGithub()) {
        state.publishing = true;
        updateStatus();
        const result = await state.adapter.save(files, commitMessage(report, snapshot));
        state.commitUrl = result.commitUrl;

        // ждём, пока хостинг пересоберёт сайт
        state.dirty = false;
        state.lastSavedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        state.pendingPhotos.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
        state.pendingPhotos = [];
        state.previews = {};

        toast('Сохранено в GitHub: ' + files.length + ' файлов. Сайт обновится через 30–60 секунд.', 'ok',
          { href: result.commitUrl, label: 'Коммит' });
        return { ok: true, mode: 'github', count: files.length, commitUrl: result.commitUrl };
      }

      // локальная папка
      const result = await state.adapter.save(files, commitMessage(report, snapshot));
      state.pendingPhotos.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      state.pendingPhotos = [];
      state.previews = {};
      state.dirty = false;
      state.lastSavedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

      const bits = ['Настройки записаны в папку проекта'];
      if (report.photos) bits.push(report.photos + ' файлов фото');
      if (result.published) bits.push('обновлена папка publish');
      toast(bits.join(' · ') + '. Обновите страницу сайта (F5).', 'ok', { href: '../../index.html', label: 'Открыть сайт' });
      return { ok: true, mode: 'folder', count: files.length, published: result.published };
    } catch (err) {
      const kind = err.kind || '';
      if (kind === 'token') {
        toast('Токен GitHub не подошёл. Проверьте, что он скопирован целиком и не истёк.', 'err');
        openConnect({ mode: 'github' });
      } else if (kind === 'forbidden') {
        toast('У токена нет права записи. Нужен доступ «Contents: Read and write».', 'err');
      } else if (kind === 'conflict') {
        toast('Файл успели изменить в другом месте. Обновите страницу панели и повторите.', 'err');
      } else if (kind === 'network') {
        toast('Нет связи с GitHub. Проверьте интернет и повторите.', 'err');
      } else {
        toast('Не удалось сохранить: ' + err.message, 'err');
      }
      return { ok: false, reason: 'error', error: err.message, kind };
    } finally {
      state.saving = false;
      state.publishing = false;
      updateStatus();
      renderProductList();
      renderBackup();
    }
  }

  /** Ждёт, пока хостинг пересоберёт сайт (только для режима GitHub). */
  async function waitForSiteUpdate() {
    if (!state.adapter || !modeIsGithub() || !state.adapter.waitForDeploy) return;
    state.publishing = true;
    updateStatus();
    try {
      const ok = await state.adapter.waitForDeploy('Файл сохранён:', { timeout: 120000 });
      state.lastSavedAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      if (ok) {
        toast('Сайт обновился — правки уже видны посетителям.', 'ok', { href: '../index.html', label: 'Открыть сайт' });
      } else {
        toast('Коммит прошёл, но сайт ещё пересобирается. Через минуту обновите страницу.', 'warn');
      }
    } finally {
      state.publishing = false;
      updateStatus();
    }
  }

  /* ── Подключение режима сохранения ───────────────────────────────────── */

  /** Запущена ли панель на локальном компьютере (а не на хостинге). */
  function isLocal() {
    return /^(localhost|127\.|\[::1\])/i.test(location.hostname) || location.protocol === 'file:';
  }

  /** Показывает кнопки, подходящие выбранному режиму. */
  function syncConnectButtons(mode) {
    const isGithub = (mode || currentConnectMode()) === 'github';
    const gh = $('#connectGithub');
    const folder = $('#connectFolder');
    if (gh) gh.hidden = !isGithub;
    if (folder) folder.hidden = isGithub;
  }

  /** Какой режим сейчас открыт в диалоге. */
  function currentConnectMode() {
    const pane = $('.connect-pane:not([hidden])');
    return pane ? pane.dataset.mode : 'github';
  }

  /** Показывает диалог подключения. opts.mode — какой режим открыть. */
  function openConnect(opts) {
    opts = opts || {};
    const modal = $('#connectModal');
    const ghReady = window.AKGitHub ? window.AKGitHub.repo.ready() : false;
    // на хостинге предлагаем GitHub (локальная папка там недоступна),
    // на своём компьютере — папку
    const fallback = isLocal() ? (ghReady ? 'github' : 'folder') : 'github';
    const mode = opts.mode || (modeIsGithub() ? 'github' : fallback);

    $$('.connect-step', modal).forEach((step) => { step.hidden = step.dataset.step !== 'pick'; });
    $$('.connect-pane', modal).forEach((pane) => { pane.hidden = pane.dataset.mode !== mode; });
    $$('.connect-tab', modal).forEach((tab) => tab.classList.toggle('is-active', tab.dataset.mode === mode));
    syncConnectButtons(mode);

    const meta = window.AKGitHub ? window.AKGitHub.getRepoMeta() : null;
    const urlBox = $('#repoUrlBox', modal);
    if (urlBox) urlBox.value = meta && meta.owner ? meta.owner + '/' + meta.repo : '';
    const tokenBox = $('#tokenBox', modal);
    if (tokenBox) tokenBox.value = window.AKGitHub ? window.AKGitHub.getToken() : '';
    const branchBox = $('#branchBox', modal);
    if (branchBox) branchBox.value = meta && meta.branch ? meta.branch : '';
    const err = $('#githubError', modal);
    if (err) err.textContent = '';
    modal.hidden = false;
  }
  function closeConnect() {
    $('#connectModal').hidden = true;
  }

  /** Подключает выбранный режим. interactive — можно спрашивать пользователя. */
  async function connect(adapter, opts) {
    opts = opts || {};
    if (!adapter) return false;

    if (adapter.kind === 'folder') {
      const res = await adapter.connect({ interactive: opts.interactive });
      state.adapter = adapter;
      Store.setActive(adapter);
      state.conn = res;
      await loadFromAdapter();
      renderAll();          // рисуем уже после чтения, иначе плашка героя покажет старое
      if (res && res.looksLikeProject === false) {
        toast('В выбранной папке нет index.html — возможно, это не папка сайта.', 'warn');
      } else {
        toast('Папка проекта подключена. Правки сохраняются в файлы.', 'ok');
      }
      return true;
    }

    // GitHub
    const info = await adapter.connect({
      owner: opts.owner, repo: opts.repo, branch: opts.branch,
    });
    state.adapter = adapter;
    Store.setActive(adapter);
    state.conn = info;
    await loadFromAdapter();
    renderAll();
    toast('Подключено к ' + info.fullName + '. Правки будут сохраняться в репозиторий.', 'ok');
    return true;
  }

  /** Первый запуск: пробуем подключиться сами, иначе показываем настройку. */
  async function bootConnect() {
    const preferred = Store.preferred();
    if (!preferred) {
      updateStatus();
      $('#unsupportedModal').hidden = false;
      return false;
    }
    try {
      if (preferred.kind === 'github' && preferred.isReady()) {
        await connect(preferred, { interactive: false });
        return true;
      }
      if (preferred.kind === 'folder' && (await Store.Folder.restore())) {
        await connect(preferred, { interactive: false });
        return true;
      }
    } catch (err) {
      updateStatus();
      if (err.kind === 'token' || err.kind === 'forbidden' || err.kind === 'notoken') {
        openConnect({ mode: 'github' });
        return false;
      }
    }
    updateStatus();
    openConnect({ mode: preferred.kind });
    return false;
  }

  /* ── Запуск ──────────────────────────────────────────────────────────── */
  function bindGlobal() {
    $('#tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) switchTab(tab.dataset.tab);
    });

    $('#productSearch').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderProductList();
    });

    $('#addProduct').addEventListener('click', () => {
      const cat = (state.config.categories || []).find((c) => c.id !== 'all');
      const product = {
        id: 'novoe-ukrashenie-' + ((state.config.products || []).length + 1),
        title: '',
        category: cat ? cat.id : 'all',
        subtitle: '',
        price: null,
        status: 'in-stock',
        badge: 'Новинка',
        tagline: '',
        description: '',
        materials: [],
        details: [],
        featured: false,
        gallery: [],
        alt: '',
      };
      state.config.products.push(product);
      state.activeProduct = state.config.products.length - 1;
      state.search = '';
      $('#productSearch').value = '';
      markDirty();
      renderAll();
      toast('Заполните название, цену и добавьте фото — потом нажмите «Сохранить изменения».', 'warn');
    });

    $('#addCategory').addEventListener('click', () => {
      state.config.categories.push({ id: 'cat-' + Date.now().toString(36), label: '' });
      markDirty();
      renderCategories();
      renderAll();
    });

    $('#addContact').addEventListener('click', () => {
      state.config.contacts.push({ id: 'c-' + Date.now().toString(36), label: '', value: '', href: '', note: '', icon: 'telegram', primary: false });
      markDirty();
      renderContacts();
      renderAll();
    });

    $('#saveAll').addEventListener('click', async () => {
      const res = await save();
      // в режиме GitHub после коммита дожидаемся пересборки сайта
      if (res && res.ok && res.mode === 'github') await waitForSiteUpdate();
    });

    document.addEventListener('keydown', async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const res = await save();
        if (res && res.ok && res.mode === 'github') await waitForSiteUpdate();
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    /* ── Диалог подключения ────────────────────────────────────────────── */
    const modal = $('#connectModal');
    $$('.connect-tab', modal).forEach((tab) => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        $$('.connect-pane', modal).forEach((pane) => { pane.hidden = pane.dataset.mode !== mode; });
        $$('.connect-tab', modal).forEach((t) => t.classList.toggle('is-active', t === tab));
        syncConnectButtons(mode);
      });
    });
    $('#connectLater').addEventListener('click', closeConnect);
    modal.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) closeConnect();
    });

    $('#toggleToken').addEventListener('click', () => {
      const box = $('#tokenBox');
      box.type = box.type === 'password' ? 'text' : 'password';
      $('#toggleToken').textContent = box.type === 'password' ? 'Показать' : 'Скрыть';
    });

    $('#createToken').addEventListener('click', () => {
      window.open('https://github.com/settings/tokens/new?description=Jewelry%20by%20AK%20—%20панель%20управления&scopes=public_repo', '_blank', 'noopener');
    });

    $('#connectGithub').addEventListener('click', async () => {
      const errBox = $('#githubError');
      errBox.textContent = '';
      const rawUrl = $('#repoUrlBox').value.trim();
      const token = $('#tokenBox').value.trim();
      const branch = $('#branchBox') ? $('#branchBox').value.trim() : '';

      if (!rawUrl) { errBox.textContent = 'Укажите репозиторий, например: логин/jewelry-by-ak'; return; }
      if (!token) { errBox.textContent = 'Вставьте токен GitHub'; return; }

      const cleaned = rawUrl.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
      const parts = cleaned.split('/').filter(Boolean);
      if (parts.length < 2) { errBox.textContent = 'Адрес должен быть вида: логин/название-репозитория'; return; }

      const btn = $('#connectGithub');
      btn.disabled = true;
      btn.textContent = 'Проверяю…';
      try {
        window.AKGitHub.setToken(token);
        await connect(Store.GitHub, { interactive: true, owner: parts[0], repo: parts[1], branch });
        closeConnect();
      } catch (err) {
        window.AKGitHub.setToken('');
        errBox.textContent = err.message || 'Не получилось подключиться';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Подключить';
      }
    });

    $('#connectFolder').addEventListener('click', async () => {
      try {
        await connect(Store.Folder, { interactive: true });
        closeConnect();
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        if (err && err.kind === 'noapi') { $('#unsupportedModal').hidden = false; return; }
        toast('Не удалось подключить папку: ' + (err.message || err.name), 'err');
      }
    });

    /* ── Смена режима и выход ──────────────────────────────────────────── */
    $('#switchMode').addEventListener('click', () => openConnect({ mode: modeIsGithub() ? 'folder' : 'github' }));

    $('#disconnect').addEventListener('click', async () => {
      if (!state.adapter) return;
      const isGh = modeIsGithub();
      const ok = await askConfirm(
        isGh
          ? 'Выйти из GitHub? Токен будет удалён из браузера, сохранённые правки на сайте останутся.'
          : 'Отключить папку проекта? Правки останутся в файлах, но панель перестанет их сохранять.',
        'Отключить'
      );
      if (!ok) return;
      try { await state.adapter.disconnect(); } catch (_) {}
      state.adapter = null;
      state.conn = null;
      state.dirty = false;
      updateStatus();
      renderBackup();
      openConnect();
    });

    $('#unsupportedModal').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target.classList.contains('modal-backdrop')) {
        $('#unsupportedModal').hidden = true;
      }
    });
    $('#downloadInstead').addEventListener('click', () => {
      $('#unsupportedModal').hidden = true;
      switchTab('backup');
      toast('Нажмите «Выгрузить настройки файлом» — и замените файл js/shop.config.js в папке сайта', 'warn');
    });
  }

  async function init() {
    state.config = Store.defaults();
    state.activeProduct = (state.config.products || []).length ? 0 : null;
    bindGlobal();
    renderAll();
    await bootConnect();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // для автотестов и служебных скриптов
  window.AKAdmin = {
    state,
    save,
    validate,
    connect,
    bootConnect,
    openConnect,
    isLocal,
    parseConfigText: Store.parseConfigText,
    serializeConfig: Store.serializeConfig,
    readHeroFromHtml,
    applyHeroToHtml,
    configSnapshot,
  };
})();

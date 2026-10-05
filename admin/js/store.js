/* ============================================================================
   Хранилище панели управления: два режима.

   1) GitHub  — сайт опубликован на GitHub Pages или Vercel. Правки уходят
                коммитом в репозиторий, хостинг пересобирает сайт.
   2) Папка   — сайт лежит на компьютере. Правки пишутся прямо в файлы
                (File System Access API, Chrome/Edge).

   Остальная панель не знает, какой режим включён: она просто просит
   «прочитай настройки» и «сохрани вот эти файлы».
   ========================================================================== */
(function () {
  'use strict';

  const DB_NAME = 'ak-admin';
  const DB_STORE = 'handles';
  const HANDLE_KEY = 'projectDir';
  const MODE_KEY = 'ak-mode';

  const Gh = window.AKGitHub;

  /* ══════════════ Сериализация настроек ══════════════════════════════════ */
  const HEADER = `/* ============================================================================
   Jewelry by AK — НАСТРОЙКИ САЙТА
   ----------------------------------------------------------------------------
   Этот файл создан панелью управления. Его можно править и вручную —
   но проще открыть панель: /admin/ → «Украшения» или «Контакты».

   Что здесь лежит:
     brand       — название, подпись, валюта, город, часы работы
     contacts    — кнопки «Написать»: Telegram, WhatsApp, ВКонтакте и т.д.
     categories  — фильтры каталога
     products    — украшения: фото, цены, описания, наличие
     rental      — условия аренды
     hero        — цифры под кнопками на главном экране
     copy        — подписи кнопок

   Файл сохранён: {{DATE}}
   ========================================================================== */

`;

  const PRIMITIVES = new Set(['string', 'number', 'boolean']);
  const isPlainObject = (v) => Object.prototype.toString.call(v) === '[object Object]';

  function serializeValue(value, indent) {
    const pad = '  '.repeat(indent);
    const padIn = '  '.repeat(indent + 1);
    if (value === null) return 'null';
    if (PRIMITIVES.has(typeof value)) return JSON.stringify(value);
    if (Array.isArray(value)) {
      if (!value.length) return '[]';
      const inline = value.length <= 4 && value.every((v) => typeof v === 'string' && v.length <= 28);
      if (inline) return '[' + value.map((v) => JSON.stringify(v)).join(', ') + ']';
      return '[\n' + value.map((v) => padIn + serializeValue(v, indent + 1)).join(',\n') + '\n' + pad + ']';
    }
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (!keys.length) return '{}';
      return '{\n' + keys.map((k) => {
        const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
        return padIn + key + ': ' + serializeValue(value[k], indent + 1);
      }).join(',\n') + '\n' + pad + '}';
    }
    return JSON.stringify(String(value));
  }

  function serializeConfig(config) {
    const date = new Date().toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    return HEADER.replace('{{DATE}}', date) + 'window.SHOP = ' + serializeValue(config, 0) + ';\n';
  }

  /** Разбирает текст shop.config.js в объект. */
  function parseConfigText(text) {
    if (!text) return null;
    const marker = text.indexOf('window.SHOP');
    if (marker === -1) return null;
    const braceStart = text.indexOf('{', marker);
    if (braceStart === -1) return null;
    let depth = 0;
    let quote = null;
    let escaped = false;
    for (let i = braceStart; i < text.length; i += 1) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (quote) {
        if (ch === '\\') { escaped = true; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            // eslint-disable-next-line no-new-func
            return new Function('return (' + text.slice(braceStart, i + 1) + ');')();
          } catch (_) { return null; }
        }
      }
    }
    return null;
  }

  /* ══════════════ Значения по умолчанию ══════════════════════════════════ */
  function defaults() {
    const fromSite = window.SHOP;
    const base = {
      brand: {
        name: 'Jewelry by AK', owner: '', tagline: 'украшения ручной работы',
        currency: '₽', city: '', deliveryNote: '', workHours: '',
      },
      contacts: [],
      categories: [{ id: 'all', label: 'Всё' }],
      products: [],
      rental: { priceFrom: null, duration: '', deposit: '' },
      hero: { facts: [], hotId: '' },
      copy: { savedTitle: 'Ваше избранное', orderCta: 'Хочу это украшение', rentCta: 'Забронировать дату' },
    };
    if (fromSite && Array.isArray(fromSite.products)) {
      base.brand = Object.assign(base.brand, fromSite.brand || {});
      base.contacts = (fromSite.contacts || []).map((c) => Object.assign({}, c));
      base.categories = (fromSite.categories || []).map((c) => Object.assign({}, c));
      base.products = (fromSite.products || []).map((p) => Object.assign({}, p));
      base.rental = Object.assign(base.rental, fromSite.rental || {});
      base.copy = Object.assign(base.copy, fromSite.copy || {});
    }
    return base;
  }

  /* ══════════════ IndexedDB: помним выбранную папку ══════════════════════ */
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDel(key) {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(true);
    });
  }

  /* ══════════════ Файловые операции (для локального режима) ══════════════ */
  async function dirHandle(root, path, create) {
    let dir = root;
    const parts = String(path).split('/').filter(Boolean);
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: Boolean(create) });
    }
    return dir;
  }
  async function fileHandle(root, path, create) {
    const parts = String(path).split('/').filter(Boolean);
    const name = parts.pop();
    const dir = await dirHandle(root, parts.join('/'), create);
    return dir.getFileHandle(name, { create: Boolean(create) });
  }
  async function fsReadText(root, path) {
    const fh = await fileHandle(root, path, false);
    const file = await fh.getFile();
    return file.text();
  }
  async function fsReadIfExists(root, path) {
    try { return await fsReadText(root, path); } catch (_) { return null; }
  }
  async function fsWriteText(root, path, text) {
    const fh = await fileHandle(root, path, true);
    const w = await fh.createWritable();
    await w.write(new Blob([text], { type: 'text/javascript;charset=utf-8' }));
    await w.close();
  }
  async function fsWriteBytes(root, path, bytes) {
    const fh = await fileHandle(root, path, true);
    const w = await fh.createWritable();
    await w.write(new Blob([bytes]));
    await w.close();
  }
  async function fsCopyText(root, from, to) {
    await fsWriteText(root, to, await fsReadText(root, from));
  }
  async function fsExists(root, path) {
    try { await fileHandle(root, path, false); return true; } catch (_) { return false; }
  }
  async function fsHasDir(root, path) {
    try { await dirHandle(root, path, false); return true; } catch (_) { return false; }
  }
  async function fsLooksLikeProject(root) {
    try { await fileHandle(root, 'index.html', false); return true; } catch (_) { return false; }
  }

  /* ══════════════ РЕЖИМ 1: GitHub ════════════════════════════════════════ */
  const GitHubAdapter = {
    kind: 'github',
    label: 'GitHub',

    supported() {
      return Boolean(Gh) && typeof fetch === 'function';
    },

    isReady() {
      return Boolean(Gh && Gh.getToken() && Gh.repo.ready());
    },

    describe() {
      if (!Gh) return 'GitHub недоступен';
      const meta = Gh.getRepoMeta();
      if (meta && meta.owner && meta.repo) {
        return `${meta.owner}/${meta.repo}${meta.branch ? ' · ' + meta.branch : ''}`;
      }
      return 'Репозиторий не определён';
    },

    /** Первичная настройка: определить репозиторий и проверить токен. */
    async connect(opts) {
      opts = opts || {};
      const meta = await Gh.detectRepo();
      if (meta) Gh.repo.set(meta.owner, meta.repo, meta.branch || '');
      if (opts.owner && opts.repo) Gh.repo.set(opts.owner, opts.repo, opts.branch || '');

      if (!Gh.repo.ready()) {
        const err = new Error('Не удалось определить репозиторий');
        err.kind = 'norepo';
        throw err;
      }
      if (!Gh.getToken()) {
        const err = new Error('Нужен токен GitHub');
        err.kind = 'notoken';
        throw err;
      }
      const info = await Gh.repo.check();
      if (!info.canPush) {
        const err = new Error('У токена нет права записи в этот репозиторий. Нужен доступ «Contents: Read and write».');
        err.kind = 'forbidden';
        throw err;
      }
      return info;
    },

    /** Настройки читаем с самого сайта: так в панели всегда то, что видят люди. */
    async loadConfigText() {
      try {
        const live = await Gh.site.fetchText('js/shop.config.js', { bust: true });
        if (live && live.includes('window.SHOP')) return live;
      } catch (_) { /* сайт мог ещё не собраться — читаем из репозитория */ }
      const fromRepo = await Gh.repo.readText('js/shop.config.js');
      return fromRepo ? fromRepo.text : null;
    },

    async loadIndexHtml() {
      try {
        const live = await Gh.site.fetchText('index.html', { bust: true });
        if (live && live.includes('<html')) return live;
      } catch (_) {}
      const fromRepo = await Gh.repo.readText('index.html');
      return fromRepo ? fromRepo.text : null;
    },

    /** Картинки: адрес с быстрого CDN, чтобы новые фото были видны сразу. */
    assetUrl(name, size) {
      const file = `assets/img/${name}-${size || 'thumb'}.jpg`;
      const meta = Gh.getRepoMeta();
      return Gh.site.cdn(file, meta);
    },

    /**
     * Сохранение: один коммит со всеми изменениями.
     * files: [{path, text} | {path, bytes}]
     */
    async save(files, message) {
      const res = await Gh.repo.writeFiles(files, message);
      return {
        count: res.count,
        commit: res.commit,
        commitUrl: `https://github.com/${Gh.repo.owner}/${Gh.repo.name}/commit/${res.commit}`,
        repoUrl: `https://github.com/${Gh.repo.owner}/${Gh.repo.name}`,
      };
    },

    async waitForDeploy(expectedFragment, opts) {
      return Gh.site.waitForDeploy('js/shop.config.js', expectedFragment, opts);
    },

    disconnect() {
      Gh.setToken('');
    },
  };

  /* ══════════════ РЕЖИМ 2: локальная папка ═══════════════════════════════ */
  const FolderAdapter = {
    kind: 'folder',
    label: 'Папка на компьютере',
    handle: null,

    supported() {
      return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
    },

    isReady() { return Boolean(this.handle); },

    describe() {
      return this.handle ? (this.handle.name || 'папка проекта') : 'папка не подключена';
    },

    async restore() {
      if (!this.supported()) return null;
      const handle = await idbGet(HANDLE_KEY);
      if (!handle) return null;
      try {
        const state = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted';
        if (state !== 'granted') return null;
      } catch (_) { return null; }
      this.handle = handle;
      return handle;
    },

    async ensurePermission(request) {
      if (!this.handle || !this.handle.queryPermission) return true;
      const opts = { mode: 'readwrite' };
      let state = await this.handle.queryPermission(opts);
      if (state === 'granted') return true;
      if (!request) return false;
      state = await this.handle.requestPermission(opts);
      return state === 'granted';
    },

    async connect(opts) {
      opts = opts || {};
      if (!this.supported()) {
        const err = new Error('Браузер не умеет сохранять файлы. Откройте панель в Chrome или Edge.');
        err.kind = 'noapi';
        throw err;
      }
      if (!this.handle) this.handle = await idbGet(HANDLE_KEY);
      if (this.handle && !(await this.ensurePermission(Boolean(opts.interactive)))) this.handle = null;
      if (!this.handle) {
        if (!opts.interactive) {
          const err = new Error('Папка проекта не подключена');
          err.kind = 'nofolder';
          throw err;
        }
        this.handle = await window.showDirectoryPicker({ id: 'ak-project', mode: 'readwrite' });
      }
      await idbSet(HANDLE_KEY, this.handle);
      return { name: this.handle.name, looksLikeProject: await fsLooksLikeProject(this.handle) };
    },

    async loadConfigText() {
      return fsReadIfExists(this.handle, 'js/shop.config.js');
    },

    async loadIndexHtml() {
      return fsReadIfExists(this.handle, 'index.html');
    },

    assetUrl(name, size) {
      // локально фото лежат в самой папке проекта
      return '../../assets/img/' + name + '-' + (size || 'thumb') + '.jpg';
    },

    /** Пишем на диск. Плюс обновляем publish/, если он есть рядом. */
    async save(files, message, onProgress) {
      let published = 0;
      const written = [];

      // 1. резервная копия текущих настроек
      const previous = await fsReadIfExists(this.handle, 'js/shop.config.js');
      if (previous) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await fsWriteText(this.handle, 'admin/backups/shop.config.' + stamp + '.js', previous);
      }

      // 2. сами файлы
      for (const f of files) {
        if (typeof f.text === 'string') await fsWriteText(this.handle, f.path, f.text);
        else await fsWriteBytes(this.handle, f.path, f.bytes);
        written.push(f.path);
        if (onProgress) onProgress(f.path);
      }

      // 3. если рядом есть publish — обновляем и его
      try {
        if (await fsHasDir(this.handle, 'publish')) {
          const mirror = ['index.html', 'css/styles.css', 'js/app.js', 'assets/logo-ak.svg', 'robots.txt', 'deploy.json'];
          for (const rel of mirror) {
            if (await fsExists(this.handle, rel)) {
              await fsCopyText(this.handle, rel, 'publish/' + rel);
              published += 1;
            }
          }
          // панель тоже должна быть в публикации: сайт может лежать на хостинге
          if (await fsExists(this.handle, 'admin/index.html')) {
            for (const rel of ['admin/index.html', 'admin/admin.css', 'admin/js/admin.js', 'admin/js/store.js', 'admin/js/photos.js', 'admin/js/github.js']) {
              if (await fsExists(this.handle, rel)) {
                await fsCopyText(this.handle, rel, 'publish/' + rel);
                published += 1;
              }
            }
          }
          const cfg = files.find((f) => f.path === 'js/shop.config.js');
          if (cfg) { await fsWriteText(this.handle, 'publish/js/shop.config.js', cfg.text); published += 1; }
          const html = files.find((f) => f.path === 'index.html');
          if (html) { await fsWriteText(this.handle, 'publish/index.html', html.text); published += 1; }

          for (const f of files) {
            if (f.path.startsWith('assets/img/')) {
              await fsWriteBytes(this.handle, 'publish/' + f.path, f.bytes);
              published += 1;
            }
          }
        }
      } catch (_) { /* publish не обязателен */ }

      return { count: written.length, published };
    },

    async disconnect() {
      await idbDel(HANDLE_KEY);
      this.handle = null;
    },
  };

  /* ══════════════ Выбор режима ═══════════════════════════════════════════ */
  function savedMode() {
    try { return localStorage.getItem(MODE_KEY) || ''; } catch (_) { return ''; }
  }
  function rememberMode(kind) {
    try { localStorage.setItem(MODE_KEY, kind); } catch (_) {}
  }

  const Store = {
    serializeConfig,
    parseConfigText,
    defaults,
    GitHub: GitHubAdapter,
    Folder: FolderAdapter,

    /** Какой режим сейчас активен. */
    active: null,

    setActive(adapter) {
      this.active = adapter;
      rememberMode(adapter.kind);
    },

    savedMode,

    /** Все доступные в этом браузере режимы. */
    available() {
      const list = [];
      if (GitHubAdapter.supported()) list.push(GitHubAdapter);
      if (FolderAdapter.supported()) list.push(FolderAdapter);
      return list;
    },

    /** Предпочтительный режим: сохранённый, иначе GitHub на хостинге, иначе папка. */
    preferred() {
      const saved = savedMode();
      if (saved === 'github' && GitHubAdapter.supported()) return GitHubAdapter;
      if (saved === 'folder' && FolderAdapter.supported()) return FolderAdapter;

      const hosted = !/^(localhost|127\.|\[::1\])/i.test(location.hostname) && location.protocol.startsWith('http');
      if (hosted && GitHubAdapter.supported()) return GitHubAdapter;
      if (FolderAdapter.supported()) return FolderAdapter;
      return GitHubAdapter.supported() ? GitHubAdapter : null;
    },
  };

  window.AKStore = Store;
  // обратная совместимость с прежним именем
  window.AKStore.fs = FolderAdapter;
})();

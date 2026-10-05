/* ============================================================================
   GitHub-адаптер панели управления.

   Зачем: сайт живёт на GitHub Pages или Vercel — у панели там нет доступа
   к файлам на диске. Поэтому правки сохраняются в сам репозиторий GitHub
   через его API: панель делает коммит, а хостинг пересобирает сайт.

   Что нужно от владельца: «токен» GitHub (fine-grained, доступ Contents: Read and write).
   Токен хранится только в браузере (localStorage), никуда больше не отправляется.

   Все запросы идут на api.github.com — он отдаёт CORS-заголовки, поэтому
   работает прямо со страницы сайта.
   ========================================================================== */
(function () {
  'use strict';

  const API = 'https://api.github.com';
  const CDN = 'https://cdn.jsdelivr.net/gh';          // быстрый доступ к файлам репозитория
  const TOKEN_KEY = 'ak-gh-token';
  const REPO_KEY = 'ak-gh-repo';

  /* ── Хранение токена и адреса репозитория ───────────────────────────── */
  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
  }
  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token.trim());
      else localStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
  }
  function getRepoMeta() {
    try { return JSON.parse(localStorage.getItem(REPO_KEY) || 'null'); } catch (_) { return null; }
  }
  function setRepoMeta(meta) {
    try {
      if (meta) localStorage.setItem(REPO_KEY, JSON.stringify(meta));
      else localStorage.removeItem(REPO_KEY);
    } catch (_) {}
  }

  /**
   * Пытается понять, какой репозиторий обслуживает этот сайт.
   * 1) адрес вида https://логин.github.io/репозиторий/
   * 2) сохранённые ранее настройки
   * 3) файл deploy.json в корне сайта (его кладут для Vercel и своего домена)
   */
  async function detectRepo() {
    const saved = getRepoMeta();
    if (saved && saved.owner && saved.repo) return Object.assign({ source: 'saved' }, saved);

    const host = location.hostname;
    const ghPages = host.match(/^([^.]+)\.github\.io$/i);
    if (ghPages) {
      const first = location.pathname.split('/').filter(Boolean)[0] || '';
      const repo = first.replace(/\.git$/, '');
      if (repo) return { owner: ghPages[1], repo, branch: '', source: 'pages' };
    }

    try {
      const res = await window.fetch('../deploy.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.owner && data.repo) {
          return { owner: data.owner, repo: data.repo, branch: data.branch || '', source: 'deploy.json' };
        }
      }
    } catch (_) {}

    return null;
  }

  /* ── Базовый запрос к API ───────────────────────────────────────────── */
  async function api(path, options) {
    options = options || {};
    const token = options.token || getToken();
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (options.body) headers['Content-Type'] = 'application/json';

    let res;
    try {
      // window.fetch вызываем в момент запроса (а не сохраняем ссылку) —
      // так панель работает и с подменённым fetch, и с полифилом
      res = await window.fetch(API + path, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: 'no-store',
      });
    } catch (err) {
      const e = new Error('Нет связи с GitHub. Проверьте интернет.');
      e.kind = 'network';
      throw e;
    }

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { message: text }; }

    if (!res.ok) {
      const e = new Error((data && data.message) || ('Ошибка GitHub ' + res.status));
      e.status = res.status;
      e.data = data;
      if (res.status === 401) { e.kind = 'token'; e.message = 'Токен не подошёл или отозван'; }
      else if (res.status === 403) {
        e.kind = 'forbidden';
        e.message = /rate limit/i.test(e.message)
          ? 'GitHub временно ограничил запросы — попробуйте через минуту'
          : 'Токену не хватает прав. Нужен доступ Contents: Read and write';
      } else if (res.status === 404) { e.kind = 'notfound'; e.message = 'Репозиторий или файл не найдены'; }
      else if (res.status === 409) { e.kind = 'conflict'; e.message = 'Файл успели изменить — обновите страницу и повторите'; }
      else if (res.status === 422) { e.kind = 'conflict'; e.message = 'GitHub отклонил коммит: возможно, изменилась ветка'; }
      throw e;
    }
    return data;
  }

  /* ── Кодирование ────────────────────────────────────────────────────── */
  function bytesToBase64(bytes) {
    let s = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function base64ToText(b64) {
    const clean = String(b64 || '').replace(/\s/g, '');
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ── Репозиторий ────────────────────────────────────────────────────── */
  const repo = {
    owner: '',
    name: '',
    branch: '',

    set(owner, name, branch) {
      this.owner = owner;
      this.name = name;
      this.branch = branch || this.branch || '';
      if (owner && name) setRepoMeta({ owner, repo: name, branch: this.branch });
    },

    path(file) { return `/repos/${this.owner}/${this.name}/contents/${file}`; },
    ready() { return Boolean(this.owner && this.name); },

    /** Узнаёт ветку по умолчанию, если её не задали. */
    async resolveBranch() {
      if (this.branch) return this.branch;
      const info = await api(`/repos/${this.owner}/${this.name}`);
      this.branch = info.default_branch || 'main';
      setRepoMeta({ owner: this.owner, repo: this.name, branch: this.branch });
      return this.branch;
    },

    /** Проверяет токен и доступ к репозиторию. Возвращает данные репозитория. */
    async check() {
      const info = await api(`/repos/${this.owner}/${this.name}`);
      this.branch = info.default_branch || this.branch || 'main';
      setRepoMeta({ owner: this.owner, repo: this.name, branch: this.branch });
      return {
        fullName: info.full_name,
        branch: this.branch,
        private: Boolean(info.private),
        canPush: Boolean(info.permissions && info.permissions.push),
        htmlUrl: info.html_url,
      };
    },

    /** Читает текстовый файл. Возвращает {text, sha} либо null, если файла нет. */
    async readText(file, opts) {
      const branch = await this.resolveBranch();
      try {
        const data = await api(`${this.path(file)}?ref=${encodeURIComponent(branch)}`, { token: opts && opts.token });
        return { text: base64ToText(data.content), sha: data.sha, encoding: data.encoding };
      } catch (err) {
        if (err.kind === 'notfound') return null;
        throw err;
      }
    },

    async exists(file) {
      const branch = await this.resolveBranch();
      try {
        await api(`${this.path(file)}?ref=${encodeURIComponent(branch)}`);
        return true;
      } catch (err) {
        if (err.kind === 'notfound') return false;
        throw err;
      }
    },

    /** Записывает один файл отдельным коммитом. */
    async writeFile(file, content, message, opts) {
      const branch = await this.resolveBranch();
      let sha = null;
      try {
        const current = await api(`${this.path(file)}?ref=${encodeURIComponent(branch)}`);
        sha = current.sha;
      } catch (err) {
        if (err.kind !== 'notfound') throw err;
      }
      const body = {
        message: message || ('Обновление ' + file + ' через панель управления'),
        content: typeof content === 'string' ? bytesToBase64(new TextEncoder().encode(content)) : bytesToBase64(content),
        branch,
      };
      if (sha) body.sha = sha;
      const out = await api(this.path(file), { method: 'PUT', body });
      return { sha: out.content && out.content.sha, commit: out.commit && out.commit.sha };
    },

    /**
     * Записывает несколько файлов ОДНИМ коммитом (Git Data API).
     * Так надёжнее: либо сохранилось всё, либо ничего.
     * files: [{path, text} | {path, bytes}]
     */
    async writeFiles(files, message) {
      if (!files.length) return { commit: null, count: 0 };
      const branch = await this.resolveBranch();

      const ref = await api(`/repos/${this.owner}/${this.name}/git/ref/heads/${encodeURIComponent(branch)}`);
      const parentSha = ref.object.sha;
      const parent = await api(`/repos/${this.owner}/${this.name}/git/commits/${parentSha}`);

      // текстовые файлы можно положить прямо в дерево, двоичные — только через blob
      const binaries = files.filter((f) => typeof f.text !== 'string');
      const blobs = {};
      for (const f of binaries) {
        const blob = await api(`/repos/${this.owner}/${this.name}/git/blobs`, {
          method: 'POST',
          body: { content: bytesToBase64(f.bytes), encoding: 'base64' },
        });
        blobs[f.path] = blob.sha;
      }

      const tree = files.map((f) => (blobs[f.path]
        ? { path: f.path, mode: '100644', type: 'blob', sha: blobs[f.path] }
        : { path: f.path, mode: '100644', type: 'blob', content: f.text }));

      const newTree = await api(`/repos/${this.owner}/${this.name}/git/trees`, {
        method: 'POST',
        body: { base_tree: parent.tree.sha, tree },
      });
      const commit = await api(`/repos/${this.owner}/${this.name}/git/commits`, {
        method: 'POST',
        body: { message: message || 'Обновление через панель управления', tree: newTree.sha, parents: [parentSha] },
      });
      await api(`/repos/${this.owner}/${this.name}/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: 'PATCH',
        body: { sha: commit.sha, force: false },
      });
      return { commit: commit.sha, count: files.length };
    },
  };

  /* ── Публичные адреса файлов сайта ──────────────────────────────────── */
  const site = {
    /** Адрес файла на самом сайте (для чтения настроек и фото) */
    url(file, bust) {
      const u = new URL(file, location.href);
      if (bust) u.searchParams.set('t', String(Date.now()));
      return u.toString();
    },

    /** Быстрый адрес файла из репозитория (jsDelivr) — фото видны сразу после коммита */
    cdn(file, meta) {
      const m = meta || getRepoMeta();
      if (!m || !m.owner || !m.repo) return site.url(file, true);
      const branch = m.branch || 'main';
      return `${CDN}/${m.owner}/${m.repo}@${branch}/${file}`;
    },

    async fetchText(file, opts) {
      const res = await window.fetch(site.url(file, opts && opts.bust), { cache: 'no-store' });
      if (!res.ok) {
        const e = new Error('Не удалось прочитать ' + file + ' (' + res.status + ')');
        e.status = res.status;
        throw e;
      }
      return res.text();
    },

    /** Ждёт, пока хостинг пересоберёт сайт и файл станет новым. */
    async waitForDeploy(file, expectedFragment, opts) {
      const timeout = (opts && opts.timeout) || 120000;
      const started = Date.now();
      while (Date.now() - started < timeout) {
        try {
          const text = await site.fetchText(file, { bust: true });
          if (!expectedFragment || text.includes(expectedFragment)) return true;
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 4000));
      }
      return false;
    },
  };

  window.AKGitHub = {
    api,
    repo,
    site,
    detectRepo,
    getToken,
    setToken,
    getRepoMeta,
    setRepoMeta,
    bytesToBase64,
    base64ToText,
    TOKEN_KEY,
    REPO_KEY,
  };
})();

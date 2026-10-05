/* ============================================================================
   Обработка фотографий для панели управления.
   Делает из одного выбранного фото те же 6 файлов, что и сборщик сайта:
     <имя>-lg.webp / .jpg   — 1400 px по длинной стороне
     <имя>-sm.webp / .jpg   —  800 px
     <имя>-thumb.webp / .jpg —  640 px
   Всё считает сам браузер, программы устанавливать не нужно.
   ========================================================================== */
(function () {
  'use strict';

  // Должно совпадать с tools/build-images.py и с разметкой сайта
  const VARIANTS = [
    { label: 'lg', max: 1400 },
    { label: 'sm', max: 800 },
    { label: 'thumb', max: 640 },
  ];
  const JPEG_Q = 0.84;
  const WEBP_Q = 0.8;
  const MAX_UPLOAD_PIXELS = 40 * 1000 * 1000;   // защита от гигантских файлов

  /** Разбирает строку вида "4:5" в {w,h}. Возвращает null, если не формат. */
  function parseAspect(text) {
    if (!text) return null;
    const m = String(text).match(/^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!w || !h) return null;
    return { w, h };
  }

  /** Приводит имя файла к безопасному виду: латиница, цифры, дефис. */
  function slugify(text, fallback) {
    const map = {
      а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
      к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
      х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
    };
    const base = String(text || '').toLowerCase()
      .split('').map((ch) => (map[ch] !== undefined ? map[ch] : ch)).join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return base || fallback || 'photo';
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Не удалось открыть изображение'));
      img.src = src;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Браузер не смог сжать фото'))), type, quality);
    });
  }

  /**
   * Обрезает картинку по формату (например 4:5), центр-верх — как в сборщике.
   */
  function cropToAspect(img, aspect) {
    if (!aspect) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
    const target = aspect.w / aspect.h;
    const cur = img.width / img.height;
    if (Math.abs(cur - target) < 0.01) return { sx: 0, sy: 0, sw: img.width, sh: img.height };
    if (cur > target) {
      const sw = Math.round(img.height * target);
      return { sx: Math.round((img.width - sw) / 2), sy: 0, sw, sh: img.height };
    }
    const sh = Math.round(img.width / target);
    return { sx: 0, sy: Math.round((img.height - sh) * 0.25), sw: img.width, sh };
  }

  /**
   * Готовит из файла набор вариантов.
   * @param {File} file
   * @param {object} opts { name, aspect }
   * @returns {Promise<{name:string, files:{name:string,mime:string,bytes:Uint8Array}[], width:number, height:number, previewUrl:string}>}
   */
  async function prepare(file, opts) {
    opts = opts || {};
    if (!file || !/^image\//.test(file.type)) throw new Error('Это не изображение');
    if (file.size > 30 * 1024 * 1024) throw new Error('Файл больше 30 МБ — выберите фото поменьше');

    const srcUrl = URL.createObjectURL(file);
    let img;
    try {
      img = await loadImage(srcUrl);
    } catch (err) {
      URL.revokeObjectURL(srcUrl);
      throw err;
    }

    if (img.width * img.height > MAX_UPLOAD_PIXELS) {
      URL.revokeObjectURL(srcUrl);
      throw new Error('Фото слишком большое по размеру (больше 40 Мп)');
    }

    const aspect = parseAspect(opts.aspect);
    const box = cropToAspect(img, aspect);
    const name = slugify(opts.name || file.name.replace(/\.[^.]+$/, ''), 'photo');

    // рабочая картинка с обрезкой
    const work = document.createElement('canvas');
    work.width = box.sw;
    work.height = box.sh;
    work.getContext('2d').drawImage(img, box.sx, box.sy, box.sw, box.sh, 0, 0, box.sw, box.sh);
    URL.revokeObjectURL(srcUrl);

    const out = [];
    for (const v of VARIANTS) {
      const scale = Math.min(1, v.max / Math.max(work.width, work.height));
      const w = Math.max(1, Math.round(work.width * scale));
      const h = Math.max(1, Math.round(work.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(work, 0, 0, w, h);

      const webp = await canvasToBlob(canvas, 'image/webp', WEBP_Q);
      const jpg = await canvasToBlob(canvas, 'image/jpeg', JPEG_Q);
      out.push({ name: `${name}-${v.label}.webp`, mime: 'image/webp', bytes: new Uint8Array(await webp.arrayBuffer()) });
      out.push({ name: `${name}-${v.label}.jpg`, mime: 'image/jpeg', bytes: new Uint8Array(await jpg.arrayBuffer()) });
    }

    // превью для списка — маленький webp в памяти
    const previewCanvas = document.createElement('canvas');
    const ps = Math.min(1, 240 / Math.max(work.width, work.height));
    previewCanvas.width = Math.max(1, Math.round(work.width * ps));
    previewCanvas.height = Math.max(1, Math.round(work.height * ps));
    previewCanvas.getContext('2d').drawImage(work, 0, 0, previewCanvas.width, previewCanvas.height);
    const previewBlob = await canvasToBlob(previewCanvas, 'image/webp', 0.7);

    return {
      name,
      files: out,
      width: work.width,
      height: work.height,
      previewUrl: URL.createObjectURL(previewBlob),
    };
  }

  /** Пути картинок на сайте по имени файла (без расширения). */
  function pathsFor(name) {
    return VARIANTS.map((v) => `assets/img/${name}-${v.label}.webp`)
      .concat(VARIANTS.map((v) => `assets/img/${name}-${v.label}.jpg`));
  }

  window.AKPhotos = { prepare, slugify, parseAspect, pathsFor, VARIANTS };
})();

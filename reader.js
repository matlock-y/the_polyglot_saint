/**
 * reader.js — The Polyglot Saint Parallel Reader Controller
 *
 * Responsibilities:
 * 1. Initialization: read active languages from localStorage and the
 *    requested chapter/talk from window.location.search.
 * 2. Data Loading: fetch the single chapter/talk JSON from data/ (small & fast),
 *    falling back to master_data.json if the per-chapter file is missing.
 * 3. Rendering: clear the dummy rows and build one aligned row per verse /
 *    paragraph, with one cell per active language. Pre-baked HTML in the JSON
 *    (<ruby>, <rt>, <small>, <em>, …) is injected as real HTML.
 * 4. Language toggles: checkboxes in the collapsible top row show/hide a
 *    language column instantly via CSS (display: none). Dragging a pill
 *    left/right (or Alt + ←/→) re-orders the columns and saves the order.
 * 5. Chapter navigation: the ‹ / › arrows jump to the previous / next chapter
 *    (or talk) using the library order in data/manifest.
 *
 * URL formats:
 *   reader.html?type=scripture&volume=bom&book=1-ne&chapter=1
 *   reader.html?type=scripture&book=1-ne&chapter=1        (volume auto-detected)
 *   reader.html?type=gc&session=2026-10&talk=12gong
 */

(function () {
  'use strict';

  const { ALL_LANGUAGES, DEFAULT_LANGUAGES, STORAGE_KEY_LANGS, VOLUME_NAMES, BOOK_NAMES } = window.POLYGLOT;

  const STORAGE_KEY_HIDDEN = 'polyglot_reader_hidden_columns';
  const RTL_LANGUAGES = ['ara'];
  const HTML_LANG = { eng: 'en', jpn: 'ja', spa: 'es', zhs: 'zh-Hans', zht: 'zh-Hant', ara: 'ar' };

  // Ruby toggle buttons (in header order) -> the language each one controls
  const RUBY_TOGGLE_LANGS = ['jpn', 'zhs', 'zht'];

  const FRONT_MATTER_NAMES = {
    title_page: 'Title Page',
    introduction: 'Introduction',
    three_witnesses: 'Testimony of Three Witnesses',
    eight_witnesses: 'Testimony of Eight Witnesses',
    testimony_joseph_smith: 'Testimony of the Prophet Joseph Smith',
    brief_explanation: 'A Brief Explanation about the Book of Mormon'
  };

  // State
  let activeLanguages = loadActiveLanguages();
  let currentAuthSession = null;
  let currentChapterData = null;
  let hiddenLanguages = loadHiddenLanguages();
  let manifest = null;
  let request = null;

  // =========================================================================
  // 1. Initialization: localStorage + URL parameters
  // =========================================================================

  function loadActiveLanguages() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_LANGS));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (e) { /* fall through to defaults */ }
    return [...DEFAULT_LANGUAGES];
  }

  function loadHiddenLanguages() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY_HIDDEN));
      if (Array.isArray(parsed)) return parsed;
    } catch (e) { /* ignore */ }
    return [];
  }

  function saveHiddenLanguages() {
    try {
      localStorage.setItem(STORAGE_KEY_HIDDEN, JSON.stringify(hiddenLanguages));
    } catch (e) { /* ignore */ }
  }

  function parseRequest() {
    const p = new URLSearchParams(window.location.search);
    const type = (p.get('type') || 'scripture').toLowerCase();

    if (type === 'gc' || type === 'conference') {
      return { type: 'gc', session: p.get('session'), talk: p.get('talk') };
    }

    const req = {
      type: 'scripture',
      volume: p.get('volume'),
      book: p.get('book') || '1-ne',
      chapter: p.get('chapter') || '1'
    };
    resolveVolume(req);
    return req;
  }

  // =========================================================================
  // 2. Data Loading
  // =========================================================================

  async function loadManifest() {
    if (window.POLYGLOT_MANIFEST) return window.POLYGLOT_MANIFEST;
    try {
      const res = await fetch('data/manifest.json');
      if (res.ok) return await res.json();
    } catch (e) { /* navigation will simply be disabled */ }
    return null;
  }

  // If the URL omits the volume (e.g. ?book=1-ne&chapter=1), find it via BOOK_TO_VOLUME or manifest.
  function resolveVolume(req) {
    if (!req || req.type !== 'scripture' || req.volume) return;
    const poly = window.POLYGLOT || {};
    if (poly.BOOK_TO_VOLUME && poly.BOOK_TO_VOLUME[req.book]) {
      req.volume = poly.BOOK_TO_VOLUME[req.book];
      return;
    }
    const scriptures = manifest?.volumes || manifest?.scriptures || {};
    req.volume = Object.keys(scriptures).find(vol => {
      const b = scriptures[vol]?.books || scriptures[vol];
      return b && b[req.book];
    }) || 'bom';
  }

  function chapterFilePaths(req) {
    const enc = encodeURIComponent;
    if (req.type === 'gc') {
      return [`data/gc/${enc(req.session)}/${enc(req.talk)}.json`];
    }
    return [
      `data/${enc(req.volume)}/${enc(req.book)}/${enc(req.chapter)}.json`,
      `data/scriptures/${enc(req.volume)}/${enc(req.book)}/${enc(req.chapter)}.json`
    ];
  }

  function normalizeChapterData(data) {
    if (!data) return null;
    // Support new compile_corpus format: { meta: { headings, intros }, verses: { "1": { ... } } }
    if (data.verses && typeof data.verses === 'object') {
      const normalized = { ...data.verses };
      if (data.meta) {
        if (data.meta.headings) normalized.chapter_heading = data.meta.headings;
        if (data.meta.intros) normalized.book_intro = data.meta.intros;
      }
      return normalized;
    }
    return data;
  }

  async function fetchChapter(req) {
    // 1. The individual chapter/talk file (a few KB — the fast path)
    const paths = chapterFilePaths(req);
    for (const p of paths) {
      try {
        const res = await fetch(p);
        if (res.ok) {
          const raw = await res.json();
          return normalizeChapterData(raw);
        }
      } catch (e) { /* try next path */ }
    }

    // 2. master_data.json (100+ MB; only used if the split files are missing)
    const res = await fetch('master_data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const master = await res.json();
    const data = req.type === 'gc'
      ? master.general_conference?.[req.session]?.[req.talk]
      : master.scriptures?.[req.volume]?.[req.book]?.[req.chapter];
    if (!data) throw new Error('Chapter not found in master_data.json');
    return normalizeChapterData(data);
  }

  function getChapterTag() {
    if (!request) return 'general';
    if (request.type === 'gc') {
      return `gc-${request.session}-${request.talk}`;
    }
    const vol = request.volume || 'scriptures';
    return `${vol}-${request.book}-${request.chapter}`;
  }

  // =========================================================================
  // 3. Rendering
  // =========================================================================

  // Inject trusted, pre-baked HTML from the corpus while dropping elements that
  // don't belong in reading text (iframes/scripts left over from scraping).
  function setCellHTML(cell, html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    tpl.content.querySelectorAll('script, iframe, style, link, meta, .iconPointer-OKie_, .verse-number, button, svg').forEach(el => el.remove());
    tpl.content.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
      });
    });
    if (tpl.content.firstChild && tpl.content.firstChild.nodeType === 3) {
      tpl.content.firstChild.textContent = tpl.content.firstChild.textContent.replace(/^(\d+[\s\u00A0]*)/, '');
    }
    cell.appendChild(tpl.content);
  }

  function stripTags(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    tpl.content.querySelectorAll('rt, rp').forEach(el => el.remove());
    return tpl.content.textContent.replace(/\s+/g, ' ').trim();
  }

  function makeCell(lang, html, verseNum) {
    const cell = document.createElement('div');
    cell.className = `verse-cell lang-${lang}`;
    cell.dataset.lang = lang;
    cell.lang = HTML_LANG[lang] || lang;
    if (RTL_LANGUAGES.includes(lang)) cell.dir = 'rtl';

    if (!html) {
      cell.classList.add('verse-missing');
      return cell;
    }

    if (verseNum) {
      const num = document.createElement('span');
      num.className = 'verse-num';
      num.textContent = verseNum;
      cell.appendChild(num);
    }
    setCellHTML(cell, html);
    return cell;
  }

  // One aligned row: a cell for every active language (hidden ones included,
  // so toggling a checkbox back on is instant and needs no re-render).
  function makeRow(tag, label, textsByLang, verseNum, refId) {
    const row = document.createElement(tag);
    row.className = 'parallel-row';
    if (label) row.setAttribute('aria-label', label);
    if (refId) row.dataset.refId = refId;
    if (verseNum) row.dataset.verseNum = verseNum;
    row._textsByLang = textsByLang || {};
    activeLanguages.forEach(lang => {
      row.appendChild(makeCell(lang, textsByLang?.[lang], verseNum));
    });
    return row;
  }

  function sortedVerseKeys(obj) {
    return Object.keys(obj)
      .filter(k => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
  }

  function renderChapter(data) {
    const main = document.querySelector('.reader-main');
    main.innerHTML = ''; // clear the dummy banner + rows

    const banner = document.createElement('section');
    banner.className = 'reader-study-banner-group';
    banner.setAttribute('aria-label', 'Introduction');

    const rows = document.createElement('div');
    rows.className = 'parallel-rows-container';

    const addBanner = (texts, label, extraClass, bannerKey) => {
      if (!texts || !Object.keys(texts).length) return;
      const refId = `${getChapterTag()}:${bannerKey || 'intro'}`;
      const row = makeRow('section', label, texts, null, refId);
      row.classList.add('reader-study-banner');
      if (extraClass) row.classList.add(extraClass);
      banner.appendChild(row);
    };

    const chapterTag = getChapterTag();

    if (request.type === 'gc') {
      addBanner(data.title, 'Talk title', 'banner-title', 'title');
      addBanner(data.speaker, 'Speaker', 'banner-speaker', 'speaker');
      addBanner(data.kicker, 'Summary', 'banner-kicker', 'kicker');

      const paragraphs = data.paragraphs || {};
      sortedVerseKeys(paragraphs).forEach(n => {
        const refId = `${chapterTag}:${n}`;
        rows.appendChild(makeRow('article', `Paragraph ${n}`, paragraphs[n], null, refId));
      });
    } else {
      addBanner(data.book_intro, 'Book introduction', 'banner-intro', 'intro');
      addBanner(data.chapter_heading, 'Chapter summary', 'banner-heading', 'heading');

      // Front matter pages (title page, witnesses…) are numbered blocks, not verses
      const showNumbers = request.book !== '_front_matter';
      sortedVerseKeys(data).forEach(n => {
        const refId = `${chapterTag}:${n}`;
        rows.appendChild(makeRow('article', `Verse ${n}`, data[n], showNumbers ? n : null, refId));
      });
    }

    if (banner.children.length) main.appendChild(banner);
    if (rows.children.length) {
      main.appendChild(rows);
    } else if (!banner.children.length) {
      showMessage('This chapter has no text yet.');
    }

    applyColumnVisibility();
  }

  function showMessage(html, isError) {
    const main = document.querySelector('.reader-main');
    main.innerHTML = `<div class="reader-message${isError ? ' reader-message-error' : ''}">${html}</div>`;
  }

  function showLoadError(err) {
    console.error('Reader failed to load chapter:', err);
    const isFile = window.location.protocol === 'file:';
    showMessage(isFile
      ? `<strong>Your browser blocked the chapter data.</strong><br>
         Pages opened directly from disk (<code>file://</code>) can't load JSON files.
         Double-click <code>start_server.bat</code> in the project folder, then open
         <code>http://localhost:8000</code>.`
      : `<strong>Couldn't load this chapter.</strong><br>
         Expected <code>${chapterFilePath(request)}</code>. Check that the
         <code>data/</code> folder sits next to <code>reader.html</code>.`, true);
  }

  // =========================================================================
  // 4. Chapter title
  // =========================================================================

  function chapterTitle(req, data) {
    if (req.type === 'gc') {
      const fromManifest = manifest?.general_conference?.[req.session]?.[req.talk]?.title;
      return stripTags(data?.title?.eng || fromManifest?.eng) || req.talk;
    }
    if (req.book === '_front_matter') {
      return FRONT_MATTER_NAMES[req.chapter] || req.chapter.replace(/_/g, ' ');
    }
    if (req.volume === 'dc') return `D&C ${req.chapter}`;
    const book = BOOK_NAMES[req.book] || req.book;
    const chapterCount = manifest?.scriptures?.[req.volume]?.[req.book]?.length;
    return chapterCount === 1 ? book : `${book} ${req.chapter}`;
  }

  function setTitle(text) {
    const h1 = document.querySelector('.reader-chapter-title');
    if (h1) {
      h1.textContent = text;
      h1.title = text;
    }
    document.title = `${text} — The Polyglot Saint Reader`;
  }

  // =========================================================================
  // 5. Language header toggles (show/hide columns)
  // =========================================================================

  function renderLanguagePills() {
    const inner = document.querySelector('.reader-top-inner');
    if (!inner) return;
    inner.innerHTML = '';

    activeLanguages.forEach(lang => {
      const label = document.createElement('label');
      label.className = 'lang-col-pill';
      label.title = ALL_LANGUAGES.find(l => l.code === lang)?.name || lang;
      label.dataset.lang = lang;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'lang-col-checkbox';
      cb.checked = !hiddenLanguages.includes(lang);
      cb.addEventListener('change', () => {
        // Never allow every column to be hidden
        const visibleCount = activeLanguages.filter(l => !hiddenLanguages.includes(l)).length;
        if (!cb.checked && visibleCount <= 1) {
          cb.checked = true;
          return;
        }
        hiddenLanguages = cb.checked
          ? hiddenLanguages.filter(l => l !== lang)
          : [...new Set([...hiddenLanguages, lang])];
        saveHiddenLanguages();
        applyColumnVisibility();
      });

      const code = document.createElement('span');
      code.className = 'lang-col-code';
      code.textContent = lang;

      const handle = document.createElement('span');
      handle.className = 'drag-handle-lines';
      handle.setAttribute('aria-hidden', 'true');
      handle.innerHTML = '<span></span><span></span>';

      label.append(cb, code, handle);

      if (activeLanguages.length > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'lang-pill-remove';
        removeBtn.title = `Remove ${lang} from active columns`;
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          activeLanguages = activeLanguages.filter(l => l !== lang);
          hiddenLanguages = hiddenLanguages.filter(l => l !== lang);
          try {
            localStorage.setItem(STORAGE_KEY_LANGS, JSON.stringify(activeLanguages));
            saveHiddenLanguages();
          } catch (err) {}
          renderLanguagePills();
          applyColumnVisibility();
          if (currentChapterData) {
            renderChapter(currentChapterData);
          }
        });
        label.appendChild(removeBtn);
      }

      inner.appendChild(label);
    });

    // Add Language button
    const inactiveLangs = ALL_LANGUAGES.filter(l => !activeLanguages.includes(l.code));
    if (inactiveLangs.length > 0) {
      const addContainer = document.createElement('div');
      addContainer.className = 'lang-add-container';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn-add-reader-lang';
      addBtn.title = 'Add another language column';
      addBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Add</span>
      `;

      const menu = document.createElement('div');
      menu.className = 'lang-add-menu';
      menu.hidden = true;

      inactiveLangs.forEach(lang => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'lang-add-item';
        item.innerHTML = `<strong>${lang.code.toUpperCase()}</strong> <span>${lang.name}</span>`;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.hidden = true;
          activeLanguages.push(lang.code);
          try {
            localStorage.setItem(STORAGE_KEY_LANGS, JSON.stringify(activeLanguages));
          } catch (err) {}
          renderLanguagePills();
          applyColumnVisibility();
          if (currentChapterData) {
            renderChapter(currentChapterData);
          }
        });
        menu.appendChild(item);
      });

      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      });

      document.addEventListener('click', (e) => {
        if (!addContainer.contains(e.target)) {
          menu.hidden = true;
        }
      });

      addContainer.append(addBtn, menu);
      inner.appendChild(addContainer);
    }
  }

  // Hiding is pure CSS: one generated rule per hidden language
  // (e.g. `.reader-main .lang-spa { display: none; }`), plus a CSS variable
  // so the grid re-divides the width evenly among the visible columns.
  function applyColumnVisibility() {
    let styleEl = document.getElementById('reader-column-visibility');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'reader-column-visibility';
      document.head.appendChild(styleEl);
    }

    const hidden = activeLanguages.filter(l => hiddenLanguages.includes(l));
    styleEl.textContent = hidden
      .map(l => `.reader-main .lang-${l} { display: none; }`)
      .join('\n');

    const visibleCount = Math.max(1, activeLanguages.length - hidden.length);
    document.documentElement.style.setProperty('--reader-cols', visibleCount);

    document.querySelectorAll('.lang-col-pill').forEach(pill => {
      pill.classList.toggle('inactive', hidden.includes(pill.dataset.lang));
    });

    // Only show ruby toggles for languages that are actually on screen
    document.querySelectorAll('.btn-ruby-toggle').forEach((btn, i) => {
      const lang = RUBY_TOGGLE_LANGS[i];
      btn.hidden = !activeLanguages.includes(lang) || hidden.includes(lang);
    });
  }

  // =========================================================================
  // 5b. Drag-to-reorder language pills (= column order)
  // =========================================================================
  //
  // Pointer events (not the HTML5 drag API) so it works with mouse, pen and
  // touch. The pill follows the pointer; as its centre crosses a neighbour's
  // centre the two swap places in the DOM and the text columns are re-ordered
  // live. The final order is saved as the active-language order in
  // localStorage, so the dashboard header and future chapters use it too.

  function initPillReorder() {
    const inner = document.querySelector('.reader-top-inner');
    if (!inner) return;

    let drag = null;
    let suppressClick = false;

    const pillsNow = () => [...inner.querySelectorAll('.lang-col-pill')];

    // Animate a sibling from its old spot to its new one (FLIP)
    function slide(el, fromLeft) {
      const shift = fromLeft - el.offsetLeft;
      if (!shift) return;
      el.style.transition = 'none';
      el.style.transform = `translateX(${shift}px)`;
      void el.offsetWidth; // force reflow
      el.style.transition = '';
      el.style.transform = '';
    }

    function moveDraggedPast(sibling, after, clientX) {
      const pill = drag.pill;
      const pillOld = pill.offsetLeft;
      const sibOld = sibling.offsetLeft;

      after ? sibling.after(pill) : sibling.before(pill);

      // Keep the dragged pill visually under the pointer after its layout jump
      drag.startX += pill.offsetLeft - pillOld;
      pill.style.transform = `translateX(${clientX - drag.startX}px)`;
      slide(sibling, sibOld);

      commitOrder(false);
    }

    inner.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const pill = e.target.closest('.lang-col-pill');
      if (!pill || e.target.closest('input')) return; // checkbox still toggles normally
      drag = { pill, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false };
    });

    document.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { pill } = drag;
      const dx = e.clientX - drag.startX;

      if (!drag.active) {
        if (Math.abs(dx) < 5 && Math.abs(e.clientY - drag.startY) < 5) return;
        drag.active = true;
        pill.classList.add('dragging');
        inner.classList.add('is-dragging');
        try { pill.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }

      e.preventDefault();
      pill.style.transform = `translateX(${dx}px)`;

      const pills = pillsNow();
      const i = pills.indexOf(pill);
      const r = pill.getBoundingClientRect();
      const centre = r.left + r.width / 2;
      const next = pills[i + 1];
      const prev = pills[i - 1];

      if (next) {
        const nr = next.getBoundingClientRect();
        if (centre > nr.left + nr.width / 2) return moveDraggedPast(next, true, e.clientX);
      }
      if (prev) {
        const pr = prev.getBoundingClientRect();
        if (centre < pr.left + pr.width / 2) return moveDraggedPast(prev, false, e.clientX);
      }
    });

    function endDrag(e) {
      if (!drag || (e && e.pointerId !== drag.pointerId)) return;
      const { pill, active } = drag;
      drag = null;
      if (!active) return;

      pill.classList.remove('dragging');
      pill.style.transform = '';
      inner.classList.remove('is-dragging');
      commitOrder(true);

      // The pill is a <label>: swallow the click that follows a drag so it
      // doesn't toggle the checkbox.
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }

    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);

    inner.addEventListener('click', (e) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    // Keyboard: focus a pill's checkbox and press Alt + ← / → to move it
    inner.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const pill = e.target.closest('.lang-col-pill');
      if (!pill) return;
      e.preventDefault();
      const sibling = e.key === 'ArrowLeft' ? pill.previousElementSibling : pill.nextElementSibling;
      if (!sibling) return;
      e.key === 'ArrowLeft' ? sibling.before(pill) : sibling.after(pill);
      e.target.focus();
      commitOrder(true);
    });

    // Read the pill order back into state and re-order the columns
    function commitOrder(persist) {
      const order = pillsNow().map(p => p.dataset.lang);
      if (order.join() !== activeLanguages.join()) {
        activeLanguages = order;
        reorderColumns();
      }
      if (persist) {
        try {
          localStorage.setItem(STORAGE_KEY_LANGS, JSON.stringify(activeLanguages));
        } catch (err) { /* ignore */ }
      }
    }
  }

  // Move each row's cells into activeLanguages order (no re-render/re-fetch)
  function reorderColumns() {
    document.querySelectorAll('.reader-main .parallel-row').forEach(row => {
      activeLanguages.forEach(lang => {
        const cell = row.querySelector(`:scope > .lang-${lang}`);
        if (cell) row.appendChild(cell);
      });
    });
  }

  // =========================================================================
  // 6. Chapter navigation (‹ / ›)
  // =========================================================================

  // Flatten the library into one ordered list of reader URLs.
  function buildSequence() {
    if (!manifest) return [];

    if (request.type === 'gc') {
      const talks = manifest.general_conference?.[request.session] || {};
      // Slugs look like "12gong" / "210rasband": first digit = session, rest = talk order
      const order = slug => {
        const m = slug.match(/^(\d)(\d+)/);
        return m ? [Number(m[1]), Number(m[2])] : [99, 99];
      };
      return Object.keys(talks)
        .sort((a, b) => {
          const [sa, ta] = order(a);
          const [sb, tb] = order(b);
          return sa - sb || ta - tb;
        })
        .map(talk => ({ type: 'gc', session: request.session, talk }));
    }

    const seq = [];
    Object.entries(manifest.scriptures || {}).forEach(([volume, books]) => {
      Object.entries(books).forEach(([book, chapters]) => {
        chapters.forEach(chapter => seq.push({ type: 'scripture', volume, book, chapter }));
      });
    });
    return seq;
  }

  function sameLocation(a, b) {
    return a.type === 'gc'
      ? a.session === b.session && a.talk === b.talk
      : a.volume === b.volume && a.book === b.book && String(a.chapter) === String(b.chapter);
  }

  function readerUrl(target) {
    const params = new URLSearchParams(target);
    return `reader.html?${params.toString()}`;
  }

  function initNavigation() {
    const [prevBtn, nextBtn] = document.querySelectorAll('.reader-chapter-stepper .btn-step-arrow');
    const seq = buildSequence();
    const idx = seq.findIndex(item => sameLocation(item, request));

    const wire = (btn, target, labelPrefix) => {
      if (!btn) return;
      if (!target) {
        btn.classList.add('disabled');
        btn.setAttribute('aria-disabled', 'true');
        btn.removeAttribute('href');
        return;
      }
      const url = readerUrl(target);
      btn.href = url; // real link: middle-click / open-in-new-tab also work
      btn.title = `${labelPrefix}: ${chapterTitle(target)}`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = url;
      });
    };

    wire(prevBtn, idx > 0 ? seq[idx - 1] : null, 'Previous');
    wire(nextBtn, idx >= 0 && idx < seq.length - 1 ? seq[idx + 1] : null, 'Next');

    // Keyboard shortcuts: ← / → (ignored while selecting text in inputs)
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' && idx > 0) window.location.href = readerUrl(seq[idx - 1]);
      if (e.key === 'ArrowRight' && idx >= 0 && idx < seq.length - 1) window.location.href = readerUrl(seq[idx + 1]);
    });
  }

  // =========================================================================
  // 7. Header UI toggles (Display collapse + ruby visibility)
  //    Kept global because reader.html uses inline onclick handlers.
  // =========================================================================

  window.toggleTopLanguageBar = function () {
    const topRow = document.getElementById('reader-top-row');
    const btn = document.getElementById('btn-display-toggle');
    const isCollapsed = topRow.classList.toggle('collapsed');
    btn.classList.toggle('collapsed', isCollapsed);
    btn.setAttribute('aria-expanded', String(!isCollapsed));
  };

  window.toggleRubyClass = function (btn, bodyClass) {
    const isNowActive = btn.classList.toggle('active');
    btn.setAttribute('aria-pressed', String(isNowActive));
    document.body.classList.toggle(bodyClass, !isNowActive);
  };

  // =========================================================================
  // 8. Supabase Authentication
  // =========================================================================

  function initAuth() {
    const authBtn = document.querySelector('.btn-google-auth');
    if (!authBtn) return;

    const btnText = authBtn.querySelector('.auth-btn-text') || authBtn.querySelector('span');

    if (typeof supabase === 'undefined') {
      currentAuthSession = null;
      updateCardsBadgeCount();
      authBtn.addEventListener('click', () => {
        alert('Supabase authentication client is loading or blocked. Please check your connection.');
      });
      return;
    }

    const updateUI = (session) => {
      currentAuthSession = session;
      if (session) {
        if (btnText) btnText.textContent = 'Sign Out';
        authBtn.title = 'Sign Out';
        if (session.user && session.user.id) {
          console.log('Logged in user ID:', session.user.id);
        }
      } else {
        if (btnText) btnText.textContent = 'Continue with Google';
        authBtn.title = 'Continue with Google';
      }
      updateCardsBadgeCount();
    };

    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      updateUI(session);
    }).catch(err => {
      console.warn('Error fetching Supabase session:', err);
    });

    // Listen for auth state changes
    supabase.auth.onAuthStateChange((event, session) => {
      updateUI(session);
    });

    // Handle button click
    authBtn.addEventListener('click', async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await supabase.auth.signOut();
          window.location.reload();
        } else {
          await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
              redirectTo: window.location.origin + window.location.pathname
            }
          });
        }
      } catch (err) {
        console.error('Authentication error:', err);
      }
    });
  }

  // =========================================================================
  // 9. Toast Notifications & Flashcard Saving
  // =========================================================================

  function showToast(message, isError = false) {
    let toast = document.getElementById('polyglot-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'polyglot-toast';
      toast.className = 'polyglot-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.toggle('toast-error', isError);
    toast.classList.add('show');

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }

  // =========================================================================
  // 8. Flashcards Sync & Word Translation
  // =========================================================================

  // Map 3-letter codes to standard 2-letter codes for translation endpoints
  const TRANSLATE_LANG_MAP = {
    eng: 'en',
    jpn: 'ja',
    spa: 'es',
    zhs: 'zh-CN',
    zht: 'zh-TW',
    ara: 'ar',
    deu: 'de',
    fra: 'fr',
    ita: 'it',
    por: 'pt',
    rus: 'ru',
    kor: 'ko',
    vie: 'vi',
    tgl: 'tl'
  };

  /**
   * Translates a term/phrase asynchronously.
   * Uses Google's client endpoint with fallback to MyMemory.
   */
  async function translateWord(text, fromLang, toLang) {
    if (!text || !text.trim()) return '';
    const clean = text.trim();
    const sl = TRANSLATE_LANG_MAP[fromLang] || fromLang || 'auto';
    const tl = TRANSLATE_LANG_MAP[toLang] || toLang || 'en';

    if (sl === tl) return clean;

    // 1. Try Google client endpoint
    try {
      const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(clean)}`;
      const res = await fetch(gUrl);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && Array.isArray(data[0])) {
          const translated = data[0].map(item => item[0]).filter(Boolean).join('');
          if (translated) return translated.trim();
        }
      }
    } catch (e) {
      console.warn('Google translation failed, trying MyMemory fallback...', e);
    }

    // 2. Fallback to MyMemory endpoint
    try {
      const mmSl = sl.split('-')[0]; // MyMemory prefers 'zh' rather than 'zh-CN'
      const mmTl = tl.split('-')[0];
      const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=${encodeURIComponent(mmSl)}|${encodeURIComponent(mmTl)}`;
      const res = await fetch(mmUrl);
      if (res.ok) {
        const data = await res.json();
        const translated = data?.responseData?.translatedText;
        if (translated && !translated.startsWith('MYMEMORY WARNING')) {
          return translated.trim();
        }
      }
    } catch (e) {
      console.warn('MyMemory translation fallback failed:', e);
    }

    return '';
  }

  // Strip ruby tags (<rt>, <rp>) for clean base text comparison
  function stripRuby(html) {
    if (!html) return '';
    return html
      .replace(/<rt[\s\S]*?<\/rt>/gi, '')
      .replace(/<rp[\s\S]*?<\/rp>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  // Extract ruby snippet matching selected plain text from verse HTML
  function extractRubySnippet(verseHtml, selectedText) {
    if (!verseHtml || !selectedText) return selectedText || '';

    const cleanSelected = stripRuby(selectedText);
    if (!cleanSelected) return selectedText;

    // Tokenize verseHtml into tags, <rt>...</rt> blocks, and base characters
    const tokens = [];
    for (let i = 0; i < verseHtml.length; i++) {
      const char = verseHtml[i];
      if (char === '<') {
        const rest = verseHtml.slice(i);
        const closeIdx = rest.indexOf('>');
        if (closeIdx !== -1) {
          const fullTag = rest.slice(0, closeIdx + 1);
          if (/^<rt\b/i.test(fullTag)) {
            const endRt = rest.indexOf('</rt>');
            if (endRt !== -1) {
              tokens.push({ type: 'rt', raw: rest.slice(0, endRt + 5) });
              i += endRt + 4;
              continue;
            }
          }
          tokens.push({ type: 'tag', raw: fullTag });
          i += closeIdx;
          continue;
        }
      }
      tokens.push({ type: 'char', char: char, raw: char });
    }

    let baseText = '';
    const charTokenIndices = [];
    tokens.forEach((tok, idx) => {
      if (tok.type === 'char') {
        baseText += tok.char;
        charTokenIndices.push(idx);
      }
    });

    const matchIndex = baseText.indexOf(cleanSelected);
    if (matchIndex === -1) {
      return selectedText;
    }

    const startTokenIdx = charTokenIndices[matchIndex];
    const endCharIdx = matchIndex + cleanSelected.length - 1;
    const endTokenIdx = charTokenIndices[endCharIdx];

    let actualStart = startTokenIdx;
    if (actualStart > 0 && tokens[actualStart - 1].raw.toLowerCase().startsWith('<ruby')) {
      actualStart = actualStart - 1;
    }

    let actualEnd = endTokenIdx;
    let j = actualEnd + 1;
    while (j < tokens.length) {
      if (tokens[j].type === 'rt') {
        actualEnd = j;
        j++;
      } else if (tokens[j].type === 'tag' && tokens[j].raw.toLowerCase() === '</ruby>') {
        actualEnd = j;
        j++;
        break;
      } else {
        break;
      }
    }

    return tokens.slice(actualStart, actualEnd + 1).map(t => t.raw).join('');
  }

  // Annotate text with ruby markup using phrase, chunk, and character-level lookup from verseHtml
  function annotateWithRuby(verseHtml, text) {
    if (!verseHtml || !text) return text;
    if (text.includes('<rt>')) return text;

    // 1. Try full exact match
    const full = extractRubySnippet(verseHtml, text);
    if (full && full.includes('<rt>')) return full;

    // 2. Try phrase / chunk matching (split by delimiters)
    const chunks = text.split(/([,\s;/()（）]+)/);
    let anyMatched = false;
    const processedChunks = chunks.map(chunk => {
      if (!chunk.trim() || /^[,\s;/()（）]+$/.test(chunk)) return chunk;
      const res = extractRubySnippet(verseHtml, chunk);
      if (res && res.includes('<rt>')) {
        anyMatched = true;
        return res;
      }
      return chunk;
    });

    if (anyMatched) {
      return processedChunks.join('');
    }

    // 3. Fallback: Character-by-character mapping from the rich verse
    const rubyRegex = /<ruby>([\s\S]*?)<rt>([\s\S]*?)<\/rt><\/ruby>/gi;
    const charMap = {};
    let m;
    while ((m = rubyRegex.exec(verseHtml)) !== null) {
      const baseChar = m[1].replace(/<[^>]+>/g, '').trim();
      const rt = m[2].trim();
      if (baseChar.length === 1 && !charMap[baseChar]) {
        charMap[baseChar] = `<ruby>${baseChar}<rt>${rt}</rt></ruby>`;
      }
    }

    let charReplaced = false;
    let out = '';
    for (const ch of text) {
      if (charMap[ch]) {
        out += charMap[ch];
        charReplaced = true;
      } else {
        out += ch;
      }
    }

    return charReplaced ? out : text;
  }

  function initFlashcardSaving() {
    let popup = null;
    let modal = null;

    function removePopup() {
      if (popup) {
        popup.remove();
        popup = null;
      }
    }

    function removeModal() {
      if (modal) {
        modal.remove();
        modal = null;
      }
    }

    document.addEventListener('selectionchange', () => {
      // Delay slightly to let selection finish settling
      setTimeout(handleSelection, 20);
    });

    function handleSelection() {
      if (modal) return; // Keep modal open if user is currently interacting with it

      // Disallow flashcard creation for unauthenticated users
      if (!currentAuthSession) {
        removePopup();
        return;
      }

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        removePopup();
        return;
      }

      const text = sel.toString().trim();
      if (!text || text.length < 1) {
        removePopup();
        return;
      }

      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const cell = container.nodeType === Node.ELEMENT_NODE
        ? container.closest('.verse-cell')
        : container.parentElement?.closest('.verse-cell');

      if (!cell) {
        removePopup();
        return;
      }

      const row = cell.closest('.parallel-row');
      if (!row) {
        removePopup();
        return;
      }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        removePopup();
        return;
      }

      if (!popup) {
        popup = document.createElement('button');
        popup.type = 'button';
        popup.className = 'selection-action-btn';
        popup.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          <span>Add Flashcard</span>
        `;
        document.body.appendChild(popup);
      }

      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      popup.style.left = `${rect.left + rect.width / 2 + scrollX}px`;
      popup.style.top = `${rect.top + scrollY}px`;

      popup.onmousedown = (e) => {
        e.preventDefault(); // prevent selection clearing on click
        e.stopPropagation();
      };

      popup.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const selectedText = sel.toString().trim();
        const verseHtml = row._textsByLang?.[cell.dataset.lang] || cell.innerHTML || '';
        const rubySnippet = extractRubySnippet(verseHtml, selectedText);
        removePopup();
        sel.removeAllRanges();
        openFlashcardModal(selectedText, rubySnippet, cell, row);
      };
    }

    // Dismiss popup on outside mousedown
    document.addEventListener('mousedown', (e) => {
      if (popup && !popup.contains(e.target)) {
        removePopup();
      }
    });

    /**
     * Opens an editable card creation modal with pre-filled translation and ruby preview.
     */
    async function openFlashcardModal(selectedWord, rubySnippet, cell, row) {
      removeModal();

      if (typeof supabase === 'undefined') {
        alert('Supabase client not loaded. Please sign in to sync cards.');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Please sign in with Google to sync flashcards.');
        return;
      }

      const sourceLang = cell.dataset.lang || 'eng';
      
      const poly = window.POLYGLOT || {};
      const vol = poly.normalizeVolume ? poly.normalizeVolume(request?.volume || (request?.type === 'gc' ? 'gc' : 'bom')) : (request?.volume || 'bom');
      const book = request?.book || (request?.type === 'gc' ? request.session : '1-ne');
      const ch = request?.chapter || (request?.type === 'gc' ? request.talk : '1');
      let verseNum = row.dataset.verseNum;
      if (!verseNum && row.dataset.refId) {
        const parts = row.dataset.refId.split(':');
        verseNum = parts[parts.length - 1];
      }
      if (!verseNum) verseNum = '1';

      const canonicalRefId = `${vol}/${book}/${ch}/${verseNum}`;
      const bookDisplay = (poly.BOOK_NAMES && poly.BOOK_NAMES[book]) || (typeof BOOK_NAMES !== 'undefined' ? BOOK_NAMES[book] : book) || book;
      const subtitleDisplay = request?.type === 'gc' ? `GC ${book} ¶${verseNum}` : `${bookDisplay} ${ch}:${verseNum}`;

      // Gather context verse information for modal preview & ruby annotations
      const textsByLang = row._textsByLang || {};
      const contextSentence = textsByLang[sourceLang] || row.querySelector(`.verse-cell[data-lang="${sourceLang}"]`)?.innerHTML || '';
      const fullContextParallel = {};
      ALL_LANGUAGES.forEach(l => {
        if (textsByLang[l.code]) {
          fullContextParallel[l.code] = textsByLang[l.code];
        }
      });

      // Target languages to provide translations for (other active or default languages)
      const targetLangs = activeLanguages.filter(l => l !== sourceLang);
      if (targetLangs.length === 0) {
        targetLangs.push(sourceLang === 'eng' ? 'spa' : 'eng');
      }

      const hasRubyPreview = rubySnippet && rubySnippet.includes('<rt>');

      // Clean raw chapter HTML (remove LDS.org button pointers, verse number spans)
      function cleanReaderVerseHtml(rawHtml) {
        if (!rawHtml) return '';
        const div = document.createElement('div');
        div.innerHTML = rawHtml;
        div.querySelectorAll('.iconPointer-OKie_, .verse-number, .verse-num, button, svg').forEach(el => el.remove());
        return div.innerHTML.replace(/^(\d+[\s\u00A0]*)/, '').trim();
      }

      function highlightWordInHtml(html, word, rubySnip) {
        if (!html || !word) return html;
        if (rubySnip && rubySnip.includes('<rt>') && html.includes(rubySnip)) {
          return html.replace(rubySnip, `<mark class="flashcard-verse-mark">${rubySnip}</mark>`);
        }
        const cleanWord = stripRuby(word);
        if (!cleanWord) return html;
        const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?![^<]*>)(${escaped})`, 'i');
        return html.replace(regex, `<mark class="flashcard-verse-mark">$1</mark>`);
      }

      // Order: source language first, followed by all remaining active languages
      const orderedLangs = [sourceLang, ...activeLanguages.filter(l => l !== sourceLang)];

      let parallelCardsHtml = '';
      orderedLangs.forEach(lang => {
        const isSource = lang === sourceLang;
        const rawHtml = textsByLang[lang] || row.querySelector(`.verse-cell[data-lang="${lang}"]`)?.innerHTML || '';
        let cleaned = cleanReaderVerseHtml(rawHtml);
        if (isSource) {
          cleaned = highlightWordInHtml(cleaned, selectedWord, rubySnippet);
        }
        const langMeta = ALL_LANGUAGES.find(l => l.code === lang);
        const langName = langMeta ? langMeta.name : lang.toUpperCase();

        parallelCardsHtml += `
          <div class="flashcard-parallel-card ${isSource ? 'is-source-card' : ''}" data-lang="${lang}">
            <div class="flashcard-parallel-card-header">
              <div class="flashcard-parallel-card-lang">
                <span class="flashcard-trans-badge lang-${lang}">${lang.toUpperCase()}</span>
                <span class="flashcard-parallel-lang-name">${langName}</span>
                ${isSource ? '<span class="flashcard-source-pill">Source</span>' : ''}
              </div>
              ${!isSource ? `
                <button type="button" class="btn-use-selection" data-lang="${lang}" title="Insert highlighted text into ${lang.toUpperCase()} definition input">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                  <span>Use selection</span>
                </button>
              ` : ''}
            </div>
            <div class="flashcard-parallel-card-text lang-${lang}" ${RTL_LANGUAGES.includes(lang) ? 'dir="rtl"' : ''}>
              ${cleaned || '<span style="color:var(--text-muted); font-style:italic;">Verse text unavailable</span>'}
            </div>
          </div>
        `;
      });

      // Build Modal DOM with side-by-side layout, source term on left, and zero header bloat
      modal = document.createElement('div');
      modal.className = 'flashcard-modal-backdrop';
      modal.innerHTML = `
        <div class="flashcard-modal flashcard-creator-modal" role="dialog" aria-modal="true">
          <button type="button" class="flashcard-modal-close flashcard-creator-close" aria-label="Close">&times;</button>

          <div class="flashcard-modal-body flashcard-creator-body">
            <div class="flashcard-creator-columns">
              <!-- Left Column: Source Term at Top + Definitions directly beneath -->
              <div class="flashcard-creator-col-left">
                <div class="flashcard-form-group flashcard-source-term-group">
                  <label class="flashcard-form-label">Selected Term (${sourceLang.toUpperCase()})</label>
                  ${hasRubyPreview ? `<div class="flashcard-ruby-preview">${rubySnippet}</div>` : ''}
                  <input type="text" class="flashcard-input flashcard-source-input" value="${selectedWord.replace(/"/g, '&quot;')}" />
                </div>

                <div class="flashcard-definitions-container">
                  <!-- Inputs generated dynamically for target languages -->
                </div>
                <span class="flashcard-translation-status" style="display:none;"></span>
              </div>

              <!-- Right Column: Parallel Verses in All Active Languages -->
              <div class="flashcard-creator-col-parallel">
                <div class="flashcard-parallel-verses-list">
                  ${parallelCardsHtml}
                </div>
              </div>
            </div>
          </div>

          <div class="flashcard-modal-footer">
            <button type="button" class="btn-card-cancel">Cancel</button>
            <button type="button" class="btn-card-save">Save Flashcard</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const defsContainer = modal.querySelector('.flashcard-definitions-container');
      const statusLabel = modal.querySelector('.flashcard-translation-status');
      const closeBtn = modal.querySelector('.flashcard-modal-close');
      const cancelBtn = modal.querySelector('.btn-card-cancel');
      const saveBtn = modal.querySelector('.btn-card-save');
      const sourceInput = modal.querySelector('.flashcard-source-input');

      // Create translation input rows (using textareas to wrap text without horizontal scrolling)
      const transInputs = {};
      targetLangs.forEach(lang => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'flashcard-trans-input-row';
        rowDiv.innerHTML = `
          <span class="flashcard-trans-badge lang-${lang}">${lang.toUpperCase()}</span>
          <textarea class="flashcard-input flashcard-def-input" data-lang="${lang}" rows="2" placeholder="Translating…"></textarea>
        `;
        defsContainer.appendChild(rowDiv);
        transInputs[lang] = rowDiv.querySelector('textarea');
      });

      // Wire "Use selection" buttons on parallel cards
      modal.querySelectorAll('.btn-use-selection').forEach(btn => {
        btn.onclick = () => {
          const lang = btn.dataset.lang;
          const cardEl = btn.closest('.flashcard-parallel-card');
          const sel = window.getSelection();
          let text = sel ? sel.toString().trim() : '';

          if (text && transInputs[lang]) {
            if (['jpn', 'zhs', 'zht'].includes(lang) && cardEl) {
              const fullCardHtml = cardEl.querySelector('.flashcard-parallel-card-text')?.innerHTML || '';
              if (fullCardHtml.includes('<rt>')) {
                const rubyText = annotateWithRuby(fullCardHtml, text);
                if (rubyText && rubyText.includes('<rt>')) {
                  text = rubyText;
                }
              }
            }
            transInputs[lang].value = text;
            transInputs[lang].focus();
            transInputs[lang].classList.add('flashcard-input-updated');
            setTimeout(() => transInputs[lang].classList.remove('flashcard-input-updated'), 600);
          }
        };
      });

      closeBtn.onclick = removeModal;
      cancelBtn.onclick = removeModal;
      modal.onclick = (e) => {
        if (e.target === modal) removeModal();
      };

      // Asynchronously translate the word for each target language
      (async () => {
        try {
          await Promise.all(
            targetLangs.map(async (tl) => {
              const res = await translateWord(selectedWord, sourceLang, tl);
              if (transInputs[tl]) {
                let defVal = res || '';
                // If target language is jpn, zhs, or zht, enrich with ruby if found in parallel verse
                if (['jpn', 'zhs', 'zht'].includes(tl) && textsByLang[tl]) {
                  const rubyDef = annotateWithRuby(textsByLang[tl], defVal);
                  if (rubyDef && rubyDef.includes('<rt>')) {
                    defVal = rubyDef;
                  }
                }
                transInputs[tl].value = defVal;
                transInputs[tl].placeholder = 'Enter definition / translation';
              }
            })
          );
          if (statusLabel) statusLabel.textContent = 'Auto-translated';
        } catch (err) {
          if (statusLabel) statusLabel.textContent = 'Translation unavailable';
        }
      })();

      // Save handler
      saveBtn.onclick = async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        const finalSourceText = sourceInput.value.trim() || selectedWord;
        let finalSourceHtml = finalSourceText;

        // Preserve ruby markup if base characters match, or re-extract from context verse
        if (rubySnippet && rubySnippet.includes('<rt>')) {
          if (stripRuby(rubySnippet) === finalSourceText) {
            finalSourceHtml = rubySnippet;
          } else if (contextSentence) {
            const reExtracted = annotateWithRuby(contextSentence, finalSourceText);
            if (reExtracted && reExtracted.includes('<rt>')) {
              finalSourceHtml = reExtracted;
            }
          }
        } else if (contextSentence) {
          const reExtracted = annotateWithRuby(contextSentence, finalSourceText);
          if (reExtracted && reExtracted.includes('<rt>')) {
            finalSourceHtml = reExtracted;
          }
        }

        const cleanSelectedWord = stripRuby(sourceInput.value.trim() || selectedWord);
        const rubyHtmlString = (finalSourceHtml && finalSourceHtml.includes('<rt>')) ? finalSourceHtml : '';

        const translationsMap = {};
        targetLangs.forEach(lang => {
          let val = transInputs[lang]?.value.trim();
          if (val) {
            // If definition is Japanese or Chinese and plain, check if it matches in parallel verse to restore ruby
            if (['jpn', 'zhs', 'zht'].includes(lang) && fullContextParallel[lang] && !val.includes('<rt>')) {
              const rubyVal = annotateWithRuby(fullContextParallel[lang], val);
              if (rubyVal && rubyVal.includes('<rt>')) {
                val = rubyVal;
              }
            }
            translationsMap[lang] = val;
          }
        });

        // Store ONLY essential fields: lightweight address pointer without full verse text strings in DB
        const payload = {
          user_id: session.user.id,
          source_lang: sourceLang,
          source_text: cleanSelectedWord,
          target_translations: {
            definitions: translationsMap,
            reading: rubyHtmlString
          },
          reference_id: canonicalRefId,
          tags: [`${vol}/${book}/${ch}`, getChapterTag(), book]
        };

        try {
          const { error } = await supabase
            .from('flashcards')
            .insert([payload]);

          if (error) {
            console.error('Error saving flashcard to Supabase:', error);
            showToast(`Failed: ${error.message || 'Could not save flashcard'}`, true);
          } else {
            showToast(`Saved to flashcards: ${cleanSelectedWord.slice(0, 24)}`);
            updateCardsBadgeCount();
            removeModal();
          }
        } catch (err) {
          console.error('Error saving flashcard:', err);
          showToast(`Error: ${err.message || 'Could not save flashcard'}`, true);
        } finally {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Flashcard';
          }
        }
      };
    }

    // Wire Persistent Cards Button in Header
    const cardsBtn = document.querySelector('.btn-chapter-cards');
    if (cardsBtn) {
      cardsBtn.addEventListener('click', () => {
        if (!currentAuthSession) {
          alert('Please sign in with Google to view and study your saved flashcards.');
          return;
        }
        const poly = window.POLYGLOT || {};
        const vol = poly.normalizeVolume ? poly.normalizeVolume(request?.volume || (request?.type === 'gc' ? 'gc' : 'bom')) : (request?.volume || 'bom');
        const book = request?.book || (request?.type === 'gc' ? request.session : '1-ne');
        const ch = request?.chapter || (request?.type === 'gc' ? request.talk : '1');
        const deckKey = `${vol}/${book}/${ch}`;
        window.location.href = `index.html?deck=${encodeURIComponent(deckKey)}`;
      });
      updateCardsBadgeCount();
    }
  }

  async function updateCardsBadgeCount() {
    const badge = document.querySelector('.cards-count-badge');
    if (!badge) return;

    const poly = window.POLYGLOT || {};
    const vol = poly.normalizeVolume ? poly.normalizeVolume(request?.volume || (request?.type === 'gc' ? 'gc' : 'bom')) : (request?.volume || 'bom');
    const book = request?.book || (request?.type === 'gc' ? request.session : '1-ne');
    const ch = request?.chapter || (request?.type === 'gc' ? request.talk : '1');

    const matchesThisChapter = poly.cardMatchesChapter
      ? (card) => poly.cardMatchesChapter(card, vol, book, ch)
      : (card) => {
          if (card.reference_id && card.reference_id.startsWith(`${vol}/${book}/${ch}/`)) return true;
          return false;
        };

    try {
      if (typeof supabase === 'undefined' || !currentAuthSession) {
        badge.textContent = '0';
        return;
      }
      const session = currentAuthSession;

      const { data, error } = await supabase
        .from('flashcards')
        .select('id, reference_id, tags');

      if (!error && data) {
        badge.textContent = data.filter(matchesThisChapter).length;
      } else {
        badge.textContent = '0';
      }
    } catch (e) {
      badge.textContent = '0';
    }
  }

  // =========================================================================
  // 9. Boot
  // =========================================================================

  document.addEventListener('DOMContentLoaded', async () => {
    request = parseRequest();
    initAuth();
    manifest = await loadManifest();
    resolveVolume(request);

    renderLanguagePills();
    initPillReorder();
    applyColumnVisibility();
    initFlashcardSaving();
    setTitle(chapterTitle(request));
    initNavigation();

    if (request.type === 'gc' && (!request.session || !request.talk)) {
      showMessage('No talk selected. <a href="index.html">Return to the library</a>.', true);
      return;
    }

    showMessage('Loading…');
    try {
      const data = await fetchChapter(request);
      currentChapterData = data;
      setTitle(chapterTitle(request, data));
      renderChapter(data);
      window.scrollTo(0, 0);
    } catch (err) {
      showLoadError(err);
    }
  });

})();

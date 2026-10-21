/**
 * dashboard.js — The Polyglot Saint Home Dashboard Controller
 *
 * Responsibilities:
 * 1. State Management: Persist active languages to localStorage.
 * 2. Data Loading: Read the library index from data/manifest.js (file://-safe)
 *    or fetch data/manifest.json (when served over http).
 * 3. Dynamic Cascading Lists:
 *    - Scriptures: Volume -> Book -> Chapter
 *    - General Conference: Session -> Speaker -> Title
 * 4. Navigation: Redirect to reader.html?type=... with clean URL parameters.
 */

(function () {
  'use strict';

  function stripTags(html) {
    if (!html) return '';
    return String(html).replace(/<[^>]+>/g, '').trim();
  }

  function stripRuby(html) {
    if (!html) return '';
    return String(html)
      .replace(/<rt[\s\S]*?<\/rt>/gi, '')
      .replace(/<rp[\s\S]*?<\/rp>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();
  }

  // Extract ruby snippet matching plain text from verse HTML
  function extractRubySnippet(verseHtml, selectedText) {
    if (!verseHtml || !selectedText) return selectedText || '';

    const cleanSelected = stripRuby(selectedText);
    if (!cleanSelected) return selectedText;

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

  // Shared constants (defined in names.js)
  const { ALL_LANGUAGES, DEFAULT_LANGUAGES, STORAGE_KEY_LANGS, VOLUME_NAMES, BOOK_NAMES } = window.POLYGLOT;

  // State
  let activeLanguages = loadActiveLanguages();
  let corpusData = {
    scriptures: {},
    general_conference: {}
  };

  let selectedScripture = {
    volume: null,
    book: null
  };

  let selectedGC = {
    mode: 'session',
    session: null,
    speaker: null
  };

  // =========================================================================
  // 1. State Management (Active Languages & LocalStorage)
  // =========================================================================

  function loadActiveLanguages() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_LANGS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Could not read languages from localStorage:', e);
    }
    return [...DEFAULT_LANGUAGES];
  }

  const STORAGE_KEY_REVIEW_LANGS = 'polyglot_flashcard_review_langs';
  const STORAGE_KEY_ANSWER_LANGS = 'polyglot_flashcard_answer_langs';

  function loadReviewLanguages() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_REVIEW_LANGS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter(code => activeLanguages.includes(code));
          if (valid.length > 0) return valid;
        }
      }
    } catch (e) {
      console.warn('Could not read review languages from localStorage:', e);
    }
    return [...activeLanguages];
  }

  function saveReviewLanguages(langs) {
    reviewLanguages = langs;
    try {
      localStorage.setItem(STORAGE_KEY_REVIEW_LANGS, JSON.stringify(langs));
    } catch (e) {
      console.warn('Could not save review languages to localStorage:', e);
    }
    renderFlashcardLangSelectors();
  }

  function loadAnswerLanguages() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_ANSWER_LANGS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter(code => activeLanguages.includes(code));
          if (valid.length > 0) return valid;
        }
      }
    } catch (e) {
      console.warn('Could not read answer languages from localStorage:', e);
    }
    return [...activeLanguages];
  }

  function saveAnswerLanguages(langs) {
    answerLanguages = langs;
    try {
      localStorage.setItem(STORAGE_KEY_ANSWER_LANGS, JSON.stringify(langs));
    } catch (e) {
      console.warn('Could not save answer languages to localStorage:', e);
    }
    renderFlashcardLangSelectors();
  }

  let reviewLanguages = loadReviewLanguages();
  let answerLanguages = loadAnswerLanguages();

  function renderFlashcardLangSelectors() {
    const reviewList = document.querySelector('.lang-config-review .lang-abbr-list');
    if (reviewList) {
      reviewList.textContent = reviewLanguages.length > 0 ? reviewLanguages.join(', ') : 'None';
    }
    const answerList = document.querySelector('.lang-config-answer .lang-abbr-list');
    if (answerList) {
      answerList.textContent = answerLanguages.length > 0 ? answerLanguages.join(', ') : 'None';
    }
  }

  function saveActiveLanguages(langs) {
    activeLanguages = langs;
    try {
      localStorage.setItem(STORAGE_KEY_LANGS, JSON.stringify(langs));
    } catch (e) {
      console.warn('Could not save languages to localStorage:', e);
    }
    renderHeaderLanguages();

    // Synchronize review and answer languages so they only offer active languages
    let nextReview = reviewLanguages.filter(code => activeLanguages.includes(code));
    if (nextReview.length === 0) nextReview = [...activeLanguages];
    saveReviewLanguages(nextReview);

    let nextAnswer = answerLanguages.filter(code => activeLanguages.includes(code));
    if (nextAnswer.length === 0) nextAnswer = [...activeLanguages];
    saveAnswerLanguages(nextAnswer);

    // Refresh review queue & flashcard if initialized
    if (typeof buildReviewQueue === 'function') {
      buildReviewQueue();
      currentCardIndex = 0;
      isCardFlipped = false;
      isVerseSelected = false;
      renderCurrentFlashcard();
    }
  }

  function renderHeaderLanguages() {
    const box = document.querySelector('.active-lang-box');
    if (!box) return;

    box.innerHTML = '';
    activeLanguages.forEach(code => {
      const badge = document.createElement('span');
      badge.className = 'lang-code-badge';
      badge.setAttribute('role', 'listitem');
      badge.textContent = code;
      box.appendChild(badge);
    });
  }

  // Language picker: a small dropdown anchored directly under the "Select"
  // button in the header. Checking/unchecking a language saves immediately.
  function initLanguagePicker() {
    const selectBtn = document.querySelector('.btn-select-langs');
    const trigger = document.querySelector('.active-lang-trigger');
    if (!selectBtn || !trigger) return;

    // Remove any stale modal left over from earlier versions
    const oldModal = document.getElementById('lang-modal-overlay');
    if (oldModal) oldModal.remove();

    let popover = document.getElementById('lang-popover');
    if (!popover) {
      popover = document.createElement('div');
      popover.id = 'lang-popover';
      popover.className = 'lang-popover';
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', 'Choose active languages');
      popover.hidden = true;
      trigger.appendChild(popover);
    }

    selectBtn.setAttribute('aria-haspopup', 'true');
    selectBtn.setAttribute('aria-expanded', 'false');

    function renderOptions() {
      popover.innerHTML = '<div class="lang-popover-title">Active Languages</div>';
      const list = document.createElement('div');
      list.className = 'lang-popover-list';

      ALL_LANGUAGES.forEach(lang => {
        const label = document.createElement('label');
        label.className = 'lang-popover-option';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = lang.code;
        cb.checked = activeLanguages.includes(lang.code);
        cb.addEventListener('change', () => {
          // Keep the user's existing order; append newly-added languages at the end
          let next = activeLanguages.filter(c => c !== lang.code);
          if (cb.checked) next.push(lang.code);
          if (next.length === 0) {
            cb.checked = true; // must keep at least one language active
            return;
          }
          saveActiveLanguages(next);
        });

        const code = document.createElement('span');
        code.className = 'lang-popover-code';
        code.textContent = lang.code;

        const name = document.createElement('span');
        name.className = 'lang-popover-name';
        name.textContent = lang.name;

        label.append(cb, code, name);
        list.appendChild(label);
      });

      popover.appendChild(list);
    }

    function openPicker() {
      renderOptions();
      popover.hidden = false;
      selectBtn.setAttribute('aria-expanded', 'true');
    }

    function closePicker() {
      popover.hidden = true;
      selectBtn.setAttribute('aria-expanded', 'false');
    }

    selectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.hidden ? openPicker() : closePicker();
    });

    popover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closePicker);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePicker();
    });
  }

  // =========================================================================
  // 2. Data Loading (data/manifest.js -> data/manifest.json)
  // =========================================================================
  //
  // The dashboard only needs the library *index* (volumes, books, chapters,
  // sessions, talks) — not the 100+ MB master_data.json. That index lives in
  // data/manifest.json, produced by compile_corpus.py.
  //
  // 1. data/manifest.js (loaded by a <script> tag in index.html) sets
  //    window.POLYGLOT_MANIFEST. This works even when index.html is opened
  //    straight from disk (file://), where browsers block fetch().
  // 2. Otherwise we fetch('data/manifest.json') (requires a local web server).

  async function fetchCorpusData() {
    showLoadingState();

    if (window.POLYGLOT_MANIFEST) {
      normalizeManifestData(window.POLYGLOT_MANIFEST);
      renderAllCascadingLists();
      populateDecksList();
      buildSearchIndex();
      renderSearchResults('');
      return;
    }

    try {
      const res = await fetch('data/manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = await res.json();
      normalizeManifestData(manifest);
      renderAllCascadingLists();
      populateDecksList();
      buildSearchIndex();
      renderSearchResults('');
    } catch (err) {
      console.error('Failed to load data/manifest.json:', err);
      showErrorState(err);
    }
  }

  function normalizeManifestData(manifest) {
    // scriptures: { vol: { book: [chapterIds] } }  ->  { vol: { book: { ch: true } } }
    corpusData.scriptures = {};
    const vols = manifest.volumes || manifest.scriptures || {};
    Object.entries(vols).forEach(([vol, volInfo]) => {
      corpusData.scriptures[vol] = {};
      const books = (volInfo && typeof volInfo === 'object' && volInfo.books) ? volInfo.books : volInfo;
      Object.entries(books || {}).forEach(([book, chData]) => {
        corpusData.scriptures[vol][book] = {};
        if (typeof chData === 'number') {
          for (let i = 1; i <= chData; i++) {
            corpusData.scriptures[vol][book][String(i)] = true;
          }
        } else {
          const list = Array.isArray(chData) ? chData : Object.keys(chData);
          list.forEach(ch => {
            corpusData.scriptures[vol][book][ch] = true;
          });
        }
      });
    });

    // general_conference: { session: { slug: { title, speaker, paragraph_count } } }
    corpusData.general_conference = manifest.general_conference || (window.POLYGLOT_MANIFEST?.general_conference) || {};
  }

  function allPrimaryLists() {
    return Array.from(document.querySelectorAll('.cascading-browser'))
      .map(b => b.querySelector('.cascade-list'))
      .filter(Boolean);
  }

  function showLoadingState() {
    allPrimaryLists().forEach(list => {
      list.innerHTML = '<li class="cascade-status">Loading library…</li>';
    });
  }

  function showErrorState(err) {
    const isFile = window.location.protocol === 'file:';
    const hint = isFile
      ? 'Could not find data/manifest.js. Run <code>python build_manifest_js.py</code> (or re-run compile_corpus.py).'
      : 'Could not load data/manifest.json. Make sure the data/ folder sits next to index.html.';
    allPrimaryLists().forEach(list => {
      list.innerHTML = `<li class="cascade-status cascade-status-error">${hint}</li>`;
    });
  }

  // =========================================================================
  // 3. Navigation (URL Redirection to reader.html)
  // =========================================================================

  function navigateToReader(params) {
    const urlParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        urlParams.set(k, v);
      }
    });
    window.location.href = `reader.html?${urlParams.toString()}`;
  }

  // =========================================================================
  // 4. Cascading Lists: Scriptures (Volume -> Book -> Chapter)
  // =========================================================================

  function renderScripturesBrowser() {
    const scriptureSection = document.querySelectorAll('.library-section')[0];
    if (!scriptureSection) return;

    const browser = scriptureSection.querySelector('.cascading-browser');
    if (!browser) return;

    const panes = browser.querySelectorAll('.cascade-pane');
    if (panes.length < 3) return;

    const [volPane, bookPane, chPane] = panes;
    const volList = volPane.querySelector('.cascade-list');
    const bookList = bookPane.querySelector('.cascade-list');
    const chHeader = chPane.querySelector('.cascade-pane-header');
    let chGrid = chPane.querySelector('.chapter-grid');

    if (!chGrid) {
      chGrid = document.createElement('div');
      chGrid.className = 'chapter-grid';
      chPane.appendChild(chGrid);
    }

    const volumes = Object.keys(corpusData.scriptures);
    if (volumes.length === 0) return;

    // Pick default volume (bom / bofm preferred)
    if (!selectedScripture.volume || !corpusData.scriptures[selectedScripture.volume]) {
      selectedScripture.volume = volumes.includes('bom') ? 'bom' : volumes[0];
    }

    // 1. Render Volumes Column
    volList.innerHTML = '';
    volumes.forEach(volKey => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cascade-item ${volKey === selectedScripture.volume ? 'active' : ''}`;
      btn.innerHTML = `
        <span>${VOLUME_NAMES[volKey] || volKey.toUpperCase()}</span>
        <span class="cascade-chevron">&rsaquo;</span>
      `;
      btn.addEventListener('click', () => {
        selectedScripture.volume = volKey;
        selectedScripture.book = null;
        renderScripturesBrowser();
      });
      li.appendChild(btn);
      volList.appendChild(li);
    });

    // 2. Render Books Column
    const books = Object.keys(corpusData.scriptures[selectedScripture.volume] || {});
    if (!selectedScripture.book || !corpusData.scriptures[selectedScripture.volume][selectedScripture.book]) {
      // Prefer 1-ne if available, otherwise first non-intro book
      if (books.includes('1-ne')) {
        selectedScripture.book = '1-ne';
      } else {
        selectedScripture.book = books.find(b => b !== '_front_matter') || books[0];
      }
    }

    bookList.innerHTML = '';
    books.forEach(bookKey => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cascade-item ${bookKey === selectedScripture.book ? 'active' : ''}`;
      const displayName = BOOK_NAMES[bookKey] || bookKey;
      btn.innerHTML = `
        <span>${displayName}</span>
        <span class="cascade-chevron">&rsaquo;</span>
      `;
      btn.addEventListener('click', () => {
        selectedScripture.book = bookKey;
        renderScripturesBrowser();
      });
      li.appendChild(btn);
      bookList.appendChild(li);
    });

    // 3. Render Chapters Column
    const bookTitle = BOOK_NAMES[selectedScripture.book] || selectedScripture.book;
    if (chHeader) chHeader.textContent = `Chapter (${bookTitle})`;

    chGrid.innerHTML = '';
    const chaptersObj = corpusData.scriptures[selectedScripture.volume]?.[selectedScripture.book] || {};
    const chapters = Object.keys(chaptersObj).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      return !isNaN(numA) && !isNaN(numB) ? numA - numB : a.localeCompare(b);
    });

    chapters.forEach(ch => {
      const chip = document.createElement('a');
      chip.className = 'chapter-chip';
      chip.textContent = ch.replace(/_/g, ' ');
      chip.href = '#';
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        navigateToReader({
          type: 'scripture',
          volume: selectedScripture.volume,
          book: selectedScripture.book,
          chapter: ch
        });
      });
      chGrid.appendChild(chip);
    });
  }

  // =========================================================================
  // 5. Cascading Lists: General Conference (Browse by Session or Speaker)
  // =========================================================================

  function cleanSpeakerName(rawSpeaker) {
    if (!rawSpeaker) return 'Unknown Speaker';
    return String(rawSpeaker)
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ')
      .split('\n')[0]
      .replace(/^Presented by\s+/i, '')
      .replace(/^By\s+/i, '')
      .replace(/^(Elder|President|Bishop|Sister|Brother)\s+/i, '')
      .trim();
  }

  function formatSessionName(sessionKey) {
    if (!sessionKey) return '';
    const parts = sessionKey.split('-');
    if (parts.length === 2) {
      const year = parts[0];
      const monthName = parts[1] === '04' ? 'April' : parts[1] === '10' ? 'October' : parts[1];
      return `${monthName} ${year}`;
    }
    return sessionKey;
  }

  function renderGeneralConferenceBrowser() {
    const gcSections = document.querySelectorAll('.library-section');
    if (gcSections.length < 2) return;

    const browser = gcSections[1].querySelector('.cascading-browser');
    if (!browser) return;

    const panes = browser.querySelectorAll('.cascade-pane');
    if (panes.length < 3) return;

    const [modePane, middlePane, rightPane] = panes;
    const modeHeader = modePane.querySelector('.cascade-pane-header');
    const middleHeader = middlePane.querySelector('.cascade-pane-header');
    const rightHeader = rightPane.querySelector('.cascade-pane-header');

    const modeList = modePane.querySelector('.cascade-list');
    const middleList = middlePane.querySelector('.cascade-list');
    const rightList = rightPane.querySelector('.cascade-list');

    if (modeHeader) modeHeader.textContent = 'Browse By';
    if (!selectedGC.mode) selectedGC.mode = 'session';

    // 1. Column 1: Mode selector (Session / Speaker)
    modeList.innerHTML = '';
    const modes = [
      { id: 'session', label: 'Session' },
      { id: 'speaker', label: 'Speaker' }
    ];

    modes.forEach(({ id, label }) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cascade-item ${id === selectedGC.mode ? 'active' : ''}`;
      btn.innerHTML = `
        <span>${label}</span>
        <span class="cascade-chevron">&rsaquo;</span>
      `;
      btn.addEventListener('click', () => {
        if (selectedGC.mode !== id) {
          selectedGC.mode = id;
          renderGeneralConferenceBrowser();
        }
      });
      li.appendChild(btn);
      modeList.appendChild(li);
    });

    const sessions = Object.keys(corpusData.general_conference).sort().reverse();
    if (sessions.length === 0) {
      middleList.innerHTML = '<li class="cascade-status">No sessions available</li>';
      rightList.innerHTML = '';
      return;
    }

    if (selectedGC.mode === 'session') {
      // =====================================================================
      // MODE: SESSION -> SESSIONS LIST -> TALKS LIST (WITH SPEAKER ATTACHED)
      // =====================================================================
      if (middleHeader) middleHeader.textContent = 'Session';

      if (!selectedGC.session || !corpusData.general_conference[selectedGC.session]) {
        selectedGC.session = sessions[0];
      }

      // Column 2: Sessions List
      middleList.innerHTML = '';
      sessions.forEach(sessKey => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `cascade-item ${sessKey === selectedGC.session ? 'active' : ''}`;
        btn.innerHTML = `
          <span>${formatSessionName(sessKey)}</span>
          <span class="cascade-chevron">&rsaquo;</span>
        `;
        btn.addEventListener('click', () => {
          selectedGC.session = sessKey;
          renderGeneralConferenceBrowser();
        });
        li.appendChild(btn);
        middleList.appendChild(li);
      });

      // Column 3: Talks List (with speaker attached)
      const sessLabel = formatSessionName(selectedGC.session);
      if (rightHeader) rightHeader.textContent = `${sessLabel} Talks`;

      rightList.innerHTML = '';
      const talksObj = corpusData.general_conference[selectedGC.session] || {};
      const talkEntries = Object.entries(talksObj);

      if (talkEntries.length === 0) {
        rightList.innerHTML = '<div class="cascade-status">No talks found</div>';
        return;
      }

      talkEntries.forEach(([slug, talk]) => {
        const rawTitle = talk?.title?.eng || (talk?.title && Object.values(talk.title)[0]) || slug;
        const cleanTitle = stripRuby(stripTags(String(rawTitle))).trim();
        const rawSpeaker = talk?.speaker?.eng || (talk?.speaker && Object.values(talk.speaker)[0]) || '';
        const speaker = cleanSpeakerName(rawSpeaker);
        const pCount = talk.paragraph_count || Object.keys(talk.paragraphs || {}).length;

        const card = document.createElement('a');
        card.className = 'talk-card-item';
        card.href = '#';
        card.innerHTML = `
          <span class="talk-card-title">${cleanTitle}</span>
          <span class="talk-card-meta">${speaker}${pCount > 0 ? ' &bull; ' + pCount + ' paragraphs' : ''}</span>
        `;
        card.addEventListener('click', (e) => {
          e.preventDefault();
          navigateToReader({
            type: 'gc',
            session: selectedGC.session,
            talk: slug
          });
        });
        rightList.appendChild(card);
      });

    } else {
      // =====================================================================
      // MODE: SPEAKER -> SPEAKERS LIST -> TALKS LIST (WITH SESSION ATTACHED)
      // =====================================================================
      if (middleHeader) middleHeader.textContent = 'Speaker';

      // Gather all speakers across all sessions
      const speakerAllTalks = {};
      sessions.forEach(sessKey => {
        const talksObj = corpusData.general_conference[sessKey] || {};
        Object.entries(talksObj).forEach(([slug, talk]) => {
          const rawSpeaker = talk?.speaker?.eng || (talk?.speaker && Object.values(talk.speaker)[0]) || '';
          const spk = cleanSpeakerName(rawSpeaker);
          if (!speakerAllTalks[spk]) {
            speakerAllTalks[spk] = [];
          }
          speakerAllTalks[spk].push({
            slug,
            session: sessKey,
            sessName: formatSessionName(sessKey),
            talk
          });
        });
      });

      const speakers = Object.keys(speakerAllTalks).sort((a, b) => a.localeCompare(b));
      if (speakers.length === 0) {
        middleList.innerHTML = '<li class="cascade-status">No speakers found</li>';
        rightList.innerHTML = '';
        return;
      }

      if (!selectedGC.speaker || !speakerAllTalks[selectedGC.speaker]) {
        selectedGC.speaker = speakers[0];
      }

      // Column 2: Speakers List
      middleList.innerHTML = '';
      speakers.forEach(spk => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `cascade-item ${spk === selectedGC.speaker ? 'active' : ''}`;
        btn.innerHTML = `
          <span>${spk}</span>
          <span class="cascade-chevron">&rsaquo;</span>
        `;
        btn.addEventListener('click', () => {
          selectedGC.speaker = spk;
          renderGeneralConferenceBrowser();
        });
        li.appendChild(btn);
        middleList.appendChild(li);
      });

      // Column 3: Talks by this speaker (with session attached)
      if (rightHeader) rightHeader.textContent = `${selectedGC.speaker}’s Talks`;

      rightList.innerHTML = '';
      const talks = speakerAllTalks[selectedGC.speaker] || [];

      if (talks.length === 0) {
        rightList.innerHTML = '<div class="cascade-status">No talks found</div>';
        return;
      }

      talks.forEach(({ slug, session, sessName, talk }) => {
        const rawTitle = talk?.title?.eng || (talk?.title && Object.values(talk.title)[0]) || slug;
        const cleanTitle = stripRuby(stripTags(String(rawTitle))).trim();
        const pCount = talk.paragraph_count || Object.keys(talk.paragraphs || {}).length;

        const card = document.createElement('a');
        card.className = 'talk-card-item';
        card.href = '#';
        card.innerHTML = `
          <span class="talk-card-title">${cleanTitle}</span>
          <span class="talk-card-meta">${sessName}${pCount > 0 ? ' &bull; ' + pCount + ' paragraphs' : ''}</span>
        `;
        card.addEventListener('click', (e) => {
          e.preventDefault();
          navigateToReader({
            type: 'gc',
            session,
            talk: slug
          });
        });
        rightList.appendChild(card);
      });
    }
  }

  function renderAllCascadingLists() {
    renderScripturesBrowser();
    renderGeneralConferenceBrowser();
  }

  // =========================================================================
  // 6. Supabase Authentication
  // =========================================================================

  function initAuth() {
    const authBtn = document.querySelector('.btn-google-auth');
    if (!authBtn || typeof supabase === 'undefined') return;

    const btnText = authBtn.querySelector('.auth-btn-text') || authBtn.querySelector('span');

    const updateUI = (session) => {
      if (session) {
        if (btnText) btnText.textContent = 'Sign Out';
        authBtn.title = 'Sign Out';
        if (session.user && session.user.id) {
          console.log('Logged in user ID:', session.user.id);
        }
        loadUserFlashcards();
      } else {
        if (btnText) btnText.textContent = 'Continue with Google';
        authBtn.title = 'Continue with Google';
        populateDecksList();
        buildReviewQueue();
        renderCurrentFlashcard();
      }
    };

    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      updateUI(session);
    }).catch(err => {
      console.warn('Error fetching Supabase session:', err);
      updateUI(null);
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
  // 7. Flashcards & Spaced Repetition (SRS)
  // =========================================================================

  let userFlashcards = [];
  let reviewQueue = [];
  let currentCardIndex = 0;
  let isCardFlipped = false;
  let isVerseSelected = false;
  let selectedDeckTags = new Set(['all']); // 'all' or specific chapter deck keys

  function checkUrlDeckParam() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlDeck = urlParams.get('deck');
    if (urlDeck) {
      const poly = window.POLYGLOT || {};
      const norm = poly.normalizeDeckKey ? poly.normalizeDeckKey(urlDeck) : urlDeck;
      selectedDeckTags.clear();
      selectedDeckTags.add(norm);
      return norm;
    }
    return null;
  }
  checkUrlDeckParam();

  const CANONICAL_VOL_ORDER = ['bom', 'bofm', 'dc', 'pgp', 'nt', 'ot', 'gc'];
  const BOOK_ORDER_LIST = [
    // BOM
    '1-ne', '2-ne', 'jacob', 'enos', 'jarom', 'omni', 'w-of-m', 'mosiah', 'alma', 'hel', '3-ne', '4-ne', 'morm', 'ether', 'moro',
    // D&C
    'dc',
    // PGP
    'moses', 'abr', 'js-m', 'js-h', 'a-of-f',
    // NT
    'matt', 'mark', 'luke', 'john', 'acts', 'rom', '1-cor', '2-cor', 'gal', 'eph', 'philip', 'col', '1-thes', '2-thes', '1-tim', '2-tim', 'titus', 'philem', 'heb', 'james', '1-pet', '2-pet', '1-jn', '2-jn', '3-jn', 'jude', 'rev',
    // OT
    'gen', 'ex', 'lev', 'num', 'deut', 'josh', 'judg', 'ruth', '1-sam', '2-sam', '1-kgs', '2-kgs', '1-chr', '2-chr', 'ezra', 'neh', 'esth', 'job', 'ps', 'prov', 'eccl', 'song', 'isa', 'jer', 'lam', 'ezek', 'dan', 'hos', 'hosea', 'joel', 'amos', 'obad', 'jonah', 'micah', 'nahum', 'hab', 'zeph', 'hag', 'zech', 'mal'
  ];

  function parseDeckKey(deckKey) {
    if (window.POLYGLOT?.parseDeckKey) return window.POLYGLOT.parseDeckKey(deckKey);
    if (!deckKey) return { vol: 'bom', book: 'general', ch: '1', deckKey: 'general' };
    const parts = deckKey.split('/');
    if (parts.length >= 3) {
      return { vol: parts[0], book: parts[1], ch: parts[2], deckKey: `${parts[0]}/${parts[1]}/${parts[2]}` };
    }
    return { vol: 'bom', book: deckKey, ch: '1', deckKey };
  }

  function getCardChapterInfo(card) {
    if (window.POLYGLOT?.getCardChapterInfo) return window.POLYGLOT.getCardChapterInfo(card);
    return { vol: 'bom', book: 'general', ch: '1', deckKey: 'general' };
  }

  function formatDeckName(info) {
    if (window.POLYGLOT?.formatDeckName) return window.POLYGLOT.formatDeckName(info, corpusData);
    const { vol, book, ch } = info;
    if (vol === 'dc' || book === 'dc') return `Doctrine and Covenants ${ch}`;
    const bookNames = window.POLYGLOT?.BOOK_NAMES || (typeof BOOK_NAMES !== 'undefined' ? BOOK_NAMES : {});
    const bookName = bookNames[book] || book;
    return `${bookName} ${ch}`;
  }

  function cardMatchesDeck(card, deckKey) {
    if (window.POLYGLOT?.cardMatchesDeck) return window.POLYGLOT.cardMatchesDeck(card, deckKey);
    const info = getCardChapterInfo(card);
    return info.deckKey === deckKey;
  }

  async function loadUserFlashcards() {
    if (typeof supabase === 'undefined') {
      buildReviewQueue();
      renderCurrentFlashcard();
      return;
    }

    try {
      const { data: cards, error } = await supabase
        .from('flashcards')
        .select('*')
        .order('next_review_date', { ascending: true });

      if (error) {
        console.error('Error loading flashcards from Supabase:', error);
        buildReviewQueue();
        renderCurrentFlashcard();
        return;
      }

      userFlashcards = cards || [];
      populateDecksList();
      buildReviewQueue();
      currentCardIndex = 0;
      isCardFlipped = false;
      renderCurrentFlashcard();
    } catch (err) {
      console.error('Failed to load flashcards:', err);
      buildReviewQueue();
      renderCurrentFlashcard();
    }
  }

  function renderEmptyFlashcardsState() {
    const stage = document.querySelector('.flashcard-stage');
    if (!stage) return;

    const sourceRef = stage.querySelector('.flashcard-source-ref');
    const counter = stage.querySelector('.flashcard-counter');
    const promptWord = stage.querySelector('.flashcard-prompt-word');
    const subprompt = stage.querySelector('.flashcard-subprompt');
    const footerHint = stage.querySelector('.flashcard-footer-hint');

    if (sourceRef) sourceRef.textContent = 'Polyglot Flashcards';
    if (counter) counter.textContent = '0 / 0';
    if (promptWord) promptWord.textContent = 'Sign In to Sync';
    if (subprompt) subprompt.textContent = 'Log in with Google to review your saved flashcards';
    if (footerHint) footerHint.innerHTML = '<span>Highlight any word or verse in the parallel reader to save cards</span>';

    // Clear ratings and translations if present
    const existingRatings = stage.querySelector('.flashcard-ratings-row');
    if (existingRatings) existingRatings.remove();
    const existingTrans = stage.querySelector('.flashcard-translations-box');
    if (existingTrans) existingTrans.remove();

    // Populate placeholder decks
    const decksList = document.querySelector('.decks-list');
    if (decksList) {
      decksList.innerHTML = `
        <li class="deck-item selected" style="cursor: default;">
          <div class="deck-item-left">
            <span class="deck-name">All Cards</span>
          </div>
          <span class="deck-count">0</span>
        </li>
      `;
    }
  }

  function populateDecksList() {
    const decksList = document.querySelector('.decks-list');
    if (!decksList) return;

    decksList.innerHTML = '';

    const cards = (userFlashcards && userFlashcards.length > 0) ? userFlashcards : DEMO_FLASHCARDS;

    // Group cards by chapter deck
    const deckMap = {};
    const now = new Date();
    let dueTodayCount = 0;

    cards.forEach(card => {
      const isDue = !card.next_review_date || new Date(card.next_review_date) <= now;
      if (isDue) dueTodayCount++;

      const info = getCardChapterInfo(card);
      if (!info || !info.ch) return;
      const key = info.deckKey;
      if (!deckMap[key]) {
        deckMap[key] = {
          deckKey: key,
          info: info,
          count: 0
        };
      }
      deckMap[key].count++;
    });

    // If initial deck from URL parameter exists, ensure it is in the list even if 0 cards
    const urlParams = new URLSearchParams(window.location.search);
    const urlDeck = urlParams.get('deck');
    const poly = window.POLYGLOT || {};
    const normalizedUrlDeck = urlDeck ? (poly.normalizeDeckKey ? poly.normalizeDeckKey(urlDeck) : urlDeck) : null;
    if (normalizedUrlDeck && !deckMap[normalizedUrlDeck]) {
      deckMap[normalizedUrlDeck] = {
        deckKey: normalizedUrlDeck,
        info: parseDeckKey(normalizedUrlDeck),
        count: 0
      };
    }

    // 1. Due Today Deck
    const allLi = document.createElement('li');
    allLi.className = `deck-item ${isDueTodaySelected() ? 'selected' : ''}`;
    allLi.innerHTML = `
      <div class="deck-item-left">
        <input type="checkbox" class="deck-checkbox" ${isDueTodaySelected() ? 'checked' : ''} />
        <span class="deck-name">Due Today</span>
      </div>
      <span class="deck-count">${dueTodayCount}</span>
    `;

    const allCb = allLi.querySelector('.deck-checkbox');
    allLi.addEventListener('click', (e) => {
      if (allCb && e.target !== allCb) allCb.checked = !allCb.checked;
      handleDeckSelectionChange('all', allCb ? allCb.checked : true, allLi);
    });
    if (allCb) {
      allCb.addEventListener('click', (e) => e.stopPropagation());
      allCb.addEventListener('change', () => handleDeckSelectionChange('all', allCb.checked, allLi));
    }
    decksList.appendChild(allLi);

    // 2. Specific Chapter Decks (sorted canonically)
    const sortedDecks = Object.values(deckMap).sort((a, b) => {
      const infoA = a.info;
      const infoB = b.info;

      const volIdxA = CANONICAL_VOL_ORDER.indexOf(infoA.vol);
      const volIdxB = CANONICAL_VOL_ORDER.indexOf(infoB.vol);
      const vA = volIdxA === -1 ? 99 : volIdxA;
      const vB = volIdxB === -1 ? 99 : volIdxB;
      if (vA !== vB) return vA - vB;

      // GC sorting
      if (infoA.vol === 'gc' && infoB.vol === 'gc') {
        const titleA = formatDeckName(infoA);
        const titleB = formatDeckName(infoB);
        return titleA.localeCompare(titleB);
      }

      // Scripture book sorting
      const bookIdxA = BOOK_ORDER_LIST.indexOf(infoA.book);
      const bookIdxB = BOOK_ORDER_LIST.indexOf(infoB.book);
      const bA = bookIdxA === -1 ? 999 : bookIdxA;
      const bB = bookIdxB === -1 ? 999 : bookIdxB;
      if (bA !== bB) return bA - bB;

      // Numerical chapter sorting
      const chA = parseInt(infoA.ch, 10) || 0;
      const chB = parseInt(infoB.ch, 10) || 0;
      return chA - chB;
    });

    sortedDecks.forEach(deck => {
      const isSelected = selectedDeckTags.has(deck.deckKey);
      const displayTagName = formatDeckName(deck.info);

      const li = document.createElement('li');
      li.className = `deck-item ${isSelected ? 'selected' : ''}`;
      li.innerHTML = `
        <div class="deck-item-left">
          <input type="checkbox" class="deck-checkbox" ${isSelected ? 'checked' : ''} />
          <span class="deck-name" title="${displayTagName}">${displayTagName}</span>
        </div>
        <span class="deck-count">${deck.count}</span>
      `;

      const cb = li.querySelector('.deck-checkbox');
      li.addEventListener('click', (e) => {
        if (cb && e.target !== cb) cb.checked = !cb.checked;
        handleDeckSelectionChange(deck.deckKey, cb ? cb.checked : true, li);
      });
      if (cb) {
        cb.addEventListener('click', (e) => e.stopPropagation());
        cb.addEventListener('change', () => handleDeckSelectionChange(deck.deckKey, cb.checked, li));
      }
      decksList.appendChild(li);
    });

    updateFlashcardSectionHeader();

    // Wire Run / View List actions
    const [runBtn, viewListBtn] = document.querySelectorAll('.decks-actions-bar .btn-deck-action');
    if (runBtn) {
      runBtn.onclick = () => {
        buildReviewQueue();
        currentCardIndex = 0;
        isCardFlipped = false;
        renderCurrentFlashcard();
      };
    }
    if (viewListBtn) {
      viewListBtn.onclick = () => {
        openFlashcardListModal();
      };
    }
  }

  function updateFlashcardSectionHeader() {
    const titleEl = document.querySelector('.flashcard-section-title') || document.querySelector('.flashcard-topbar .section-title');
    if (titleEl) {
      if (isDueTodaySelected()) {
        titleEl.textContent = "Today's Flashcards";
      } else {
        const activeDecks = Array.from(selectedDeckTags);
        if (activeDecks.length === 1) {
          const info = parseDeckKey(activeDecks[0]);
          const name = formatDeckName(info);
          titleEl.textContent = `${name} Flashcards`;
        } else if (activeDecks.length > 1) {
          titleEl.textContent = `${activeDecks.length} Decks Selected`;
        } else {
          titleEl.textContent = "Today's Flashcards";
        }
      }
    }

    const [runBtn] = document.querySelectorAll('.decks-actions-bar .btn-deck-action');
    if (runBtn) {
      runBtn.textContent = reviewQueue.length > 0 ? `Run (${reviewQueue.length})` : 'Run';
    }
  }

  function isDueTodaySelected() {
    return selectedDeckTags.has('all') || selectedDeckTags.has('due_today');
  }

  function handleDeckSelectionChange(tag, isChecked, li) {
    if (tag === 'all') {
      if (isChecked) {
        selectedDeckTags.clear();
        selectedDeckTags.add('all');
        document.querySelectorAll('.decks-list .deck-item').forEach(el => {
          const cb = el.querySelector('.deck-checkbox');
          if (el === li) {
            el.classList.add('selected');
            if (cb) cb.checked = true;
          } else {
            el.classList.remove('selected');
            if (cb) cb.checked = false;
          }
        });
      } else {
        selectedDeckTags.delete('all');
        li.classList.remove('selected');
      }
    } else {
      // Specific deck
      if (isChecked) {
        // Uncheck 'all' / Due Today when selecting a specific deck
        selectedDeckTags.delete('all');
        selectedDeckTags.delete('due_today');
        const allLi = document.querySelector('.decks-list .deck-item');
        if (allLi) {
          allLi.classList.remove('selected');
          const cb = allLi.querySelector('.deck-checkbox');
          if (cb) cb.checked = false;
        }
        selectedDeckTags.add(tag);
        li.classList.add('selected');
      } else {
        selectedDeckTags.delete(tag);
        li.classList.remove('selected');
      }
    }

    if (selectedDeckTags.size === 0) {
      selectedDeckTags.add('all');
      const allLi = document.querySelector('.decks-list .deck-item');
      if (allLi) {
        allLi.classList.add('selected');
        const cb = allLi.querySelector('.deck-checkbox');
        if (cb) cb.checked = true;
      }
    }

    buildReviewQueue();
    currentCardIndex = 0;
    isCardFlipped = false;
    isVerseSelected = false;
    renderCurrentFlashcard();
  }

  // In-memory cache for loaded scripture chapters to prevent duplicate network fetches
  const chapterCache = new Map();

  function formatRefDisplay(refId) {
    if (!refId) return 'Scriptures';
    const parts = refId.split('/');
    if (parts.length === 4) {
      const [vol, book, ch, verse] = parts;
      const bookNames = window.POLYGLOT?.BOOK_NAMES || {};
      const bookName = bookNames[book] || book;
      if (vol === 'gc') {
        return `GC ${book} ¶${verse}`;
      }
      return `${bookName} ${ch}:${verse}`;
    }
    return refId;
  }

  function cleanVerseHtml(rawHtml) {
    if (!rawHtml) return '';
    if (typeof rawHtml !== 'string') return String(rawHtml);
    return rawHtml
      .replace(/<span class="iconPointer[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
      .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
      .replace(/<span class="verse-number"[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/^(\d+[\s\u00A0]*)/, '')
      .trim();
  }

  async function fetchVerseText(lang, vol, book, ch, verse) {
    const normalizedVol = (vol === 'bofm') ? 'bom' : vol;
    const cacheKey = `${lang}/${normalizedVol}/${book}/${ch}`;

    let chapterData = chapterCache.get(cacheKey);
    if (!chapterData) {
      try {
        let res = await fetch(`raw_cache/${lang}/${normalizedVol}/${book}/${ch}.json`);
        if (!res.ok) {
          res = await fetch(`data/scriptures/${normalizedVol}/${book}/${ch}.json`);
        }
        if (res.ok) {
          chapterData = await res.json();
          chapterCache.set(cacheKey, chapterData);
        }
      } catch (e) {
        console.warn('Error fetching chapter JSON:', e);
      }
    }

    if (chapterData) {
      const rawVerse = chapterData[verse] || chapterData[String(verse)];
      if (rawVerse) {
        return cleanVerseHtml(rawVerse);
      }
    }
    return 'Verse text unavailable.';
  }

  // Demo cards to display when offline, unauthenticated, or before user saves cards
  const DEMO_FLASHCARDS = window.POLYGLOT?.DEMO_FLASHCARDS || window.DEMO_FLASHCARDS || [];

  function getSelectedDeckCards() {
    const isUserSet = userFlashcards && userFlashcards.length > 0;
    const baseCards = isUserSet ? userFlashcards : DEMO_FLASHCARDS;

    if (isDueTodaySelected()) {
      const now = new Date();
      if (isUserSet) {
        return baseCards.filter(card => !card.next_review_date || new Date(card.next_review_date) <= now);
      }
      return [...baseCards];
    }

    return baseCards.filter(card => {
      return Array.from(selectedDeckTags).some(deckKey => cardMatchesDeck(card, deckKey));
    });
  }

  function openFlashcardListModal() {
    let modal = document.querySelector('.flashcard-list-modal-backdrop');
    if (modal) modal.remove();

    const cards = getSelectedDeckCards();

    let listTitle = 'Flashcards List';
    if (isDueTodaySelected()) {
      listTitle = "Due Today Flashcards";
    } else {
      const activeDecks = Array.from(selectedDeckTags);
      if (activeDecks.length === 1) {
        const info = parseDeckKey(activeDecks[0]);
        listTitle = `${formatDeckName(info)} Flashcards`;
      } else if (activeDecks.length > 1) {
        listTitle = `${activeDecks.length} Decks Selected`;
      }
    }

    modal = document.createElement('div');
    modal.className = 'flashcard-modal-backdrop flashcard-list-modal-backdrop';
    modal.innerHTML = `
      <div class="flashcard-list-modal" role="dialog" aria-modal="true" aria-labelledby="modal-list-title">
        <div class="flashcard-list-header">
          <div class="flashcard-list-title-group">
            <h2 class="flashcard-list-title" id="modal-list-title">${listTitle}</h2>
            <span class="flashcard-list-subtitle">${cards.length} card${cards.length === 1 ? '' : 's'}</span>
          </div>
          <div class="flashcard-list-search-box">
            <input type="text" class="flashcard-list-search" placeholder="Search words, definitions, references…" />
          </div>
          <button type="button" class="flashcard-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="flashcard-list-body"></div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('.flashcard-modal-close');
    const searchInput = modal.querySelector('.flashcard-list-search');
    const listBody = modal.querySelector('.flashcard-list-body');
    const subtitle = modal.querySelector('.flashcard-list-subtitle');

    const closeModal = () => modal.remove();
    if (closeBtn) closeBtn.onclick = closeModal;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    function renderListItems(filterQuery = '') {
      listBody.innerHTML = '';
      const q = filterQuery.toLowerCase().trim();

      const activeList = getSelectedDeckCards();
      const filtered = activeList.filter(card => {
        if (!q) return true;
        const term = stripRuby(card.source_text || '').toLowerCase();
        const ref = (card.reference_id || '').toLowerCase();
        const formattedRef = formatRefDisplay(card.reference_id).toLowerCase();
        const defs = card.target_translations?.definitions || card.target_translations?.definition || {};
        const defMatch = Object.values(defs).some(v => String(v).toLowerCase().includes(q));
        return term.includes(q) || ref.includes(q) || formattedRef.includes(q) || defMatch;
      });

      if (subtitle) {
        subtitle.textContent = `${filtered.length} card${filtered.length === 1 ? '' : 's'}${q ? ' (filtered)' : ''}`;
      }

      if (filtered.length === 0) {
        listBody.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px 0; font-size: 0.95rem;">${q ? 'No flashcards match your search.' : 'No flashcards in selected deck(s).'}</div>`;
        return;
      }

      filtered.forEach(card => {
        const item = document.createElement('div');
        item.className = 'flashcard-list-item';
        item.dataset.id = card.id;

        const defs = card.target_translations?.definitions || card.target_translations?.definition || {};
        const fullParallel = card.target_translations?.full_row_parallel 
          || card.target_translations?.context_sentence?.full_parallel 
          || (card.target_translations && !card.target_translations.definitions && !card.target_translations.definition ? card.target_translations : {});
        const contextSentence = card.target_translations?.context_sentence?.source_sentence || '';

        let defRowsHtml = '';
        if (defs && Object.keys(defs).length > 0) {
          Object.entries(defs).forEach(([lang, val]) => {
            if (!val) return;
            let richVal = val;
            const parallelVerse = fullParallel?.[lang] || (card.source_lang === lang ? contextSentence : '');
            if (['jpn', 'zhs', 'zht'].includes(lang) && !richVal.includes('<rt>') && parallelVerse && parallelVerse.includes('<rt>')) {
              const enriched = annotateWithRuby(parallelVerse, richVal);
              if (enriched && enriched.includes('<rt>')) richVal = enriched;
            }
            defRowsHtml += `
              <div class="flashcard-item-def-row">
                <span class="flashcard-trans-badge">${lang.toUpperCase()}</span>
                <span class="flashcard-item-def-val">${richVal}</span>
              </div>
            `;
          });
        } else if (fullParallel && Object.keys(fullParallel).length > 0) {
          Object.entries(fullParallel).slice(0, 4).forEach(([lang, val]) => {
            if (lang === card.source_lang) return;
            defRowsHtml += `
              <div class="flashcard-item-def-row">
                <span class="flashcard-trans-badge">${lang.toUpperCase()}</span>
                <span class="flashcard-item-def-val">${stripTags(val)}</span>
              </div>
            `;
          });
        }

        const displayTerm = card.target_translations?.reading || card.source_text || '';

        item.innerHTML = `
          <div class="flashcard-item-main">
            <div class="flashcard-item-word">
              <span class="flashcard-item-term">${displayTerm}</span>
              <span class="flashcard-item-lang">${(card.source_lang || 'eng').toUpperCase()}</span>
              <span class="flashcard-item-ref">&lt;${formatRefDisplay(card.reference_id)}&gt;</span>
            </div>
            <div class="flashcard-item-defs">
              ${defRowsHtml || '<span style="color:var(--text-muted); font-size:0.85rem;">No definitions recorded</span>'}
            </div>
            ${contextSentence ? `
              <div class="flashcard-item-context">
                <em>“${stripTags(contextSentence)}”</em>
              </div>
            ` : ''}
          </div>
          <div class="flashcard-item-actions">
            <button type="button" class="btn-card-item-action btn-edit-card" title="Edit flashcard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <span>Edit</span>
            </button>
            <button type="button" class="btn-card-item-action btn-delete-card" title="Delete flashcard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
              <span>Delete</span>
            </button>
          </div>
        `;

        const editBtn = item.querySelector('.btn-edit-card');
        const deleteBtn = item.querySelector('.btn-delete-card');

        editBtn.onclick = () => openEditFlashcardModal(card, () => renderListItems(searchInput.value));
        deleteBtn.onclick = async () => {
          const cleanName = stripRuby(card.source_text || '') || 'this flashcard';
          if (!confirm(`Are you sure you want to delete "${cleanName}"?`)) return;

          if (typeof supabase !== 'undefined' && card.id && !card.id.startsWith('demo-')) {
            try {
              const { error } = await supabase.from('flashcards').delete().eq('id', card.id);
              if (error) {
                alert('Could not delete card: ' + error.message);
                return;
              }
            } catch (err) {
              console.error('Delete error:', err);
              alert('Delete failed.');
              return;
            }
          }

          userFlashcards = userFlashcards.filter(c => c.id !== card.id);
          reviewQueue = reviewQueue.filter(c => c.id !== card.id);
          populateDecksList();
          renderListItems(searchInput.value);
          renderCurrentFlashcard();
        };

        listBody.appendChild(item);
      });
    }

    searchInput.addEventListener('input', () => renderListItems(searchInput.value));
    renderListItems();
  }

  function openEditFlashcardModal(card, onSavedCallback) {
    let editModal = document.querySelector('.flashcard-edit-modal-backdrop');
    if (editModal) editModal.remove();

    editModal = document.createElement('div');
    editModal.className = 'flashcard-modal-backdrop flashcard-edit-modal-backdrop';

    const defs = card.target_translations?.definitions || card.target_translations?.definition || {};
    const rubyReading = card.target_translations?.reading || '';
    const hasRuby = rubyReading.includes('<rt>') || (card.source_text || '').includes('<rt>');
    const displayRuby = rubyReading.includes('<rt>') ? rubyReading : card.source_text;

    let defInputsHtml = '';
    const defKeys = Object.keys(defs).length > 0 ? Object.keys(defs) : ['eng', 'spa'];
    defKeys.forEach(l => {
      defInputsHtml += `
        <div class="flashcard-trans-input-row">
          <span class="flashcard-trans-badge">${l.toUpperCase()}</span>
          <input type="text" class="flashcard-input edit-def-input" data-lang="${l}" value="${(defs[l] || '').replace(/"/g, '&quot;')}" />
        </div>
      `;
    });

    editModal.innerHTML = `
      <div class="flashcard-modal" role="dialog" aria-modal="true" aria-labelledby="modal-edit-card-title">
        <div class="flashcard-modal-header">
          <div class="flashcard-modal-title" id="modal-edit-card-title">Edit Flashcard</div>
          <div class="flashcard-modal-subtitle">${formatRefDisplay(card.reference_id)} &bull; ${(card.source_lang || 'eng').toUpperCase()}</div>
          <button type="button" class="flashcard-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="flashcard-modal-body">
          <div class="flashcard-form-group">
            <label class="flashcard-form-label">Source Term</label>
            ${hasRuby ? `<div class="flashcard-ruby-preview">${displayRuby}</div>` : ''}
            <input type="text" class="flashcard-input edit-source-input" value="${(card.source_text || '').replace(/"/g, '&quot;')}" />
          </div>
          <div class="flashcard-form-group">
            <label class="flashcard-form-label">Definitions</label>
            <div class="flashcard-definitions-container edit-defs-container">
              ${defInputsHtml}
            </div>
          </div>
          <div class="flashcard-form-group">
            <label class="flashcard-form-label">Reference ID</label>
            <input type="text" class="flashcard-input edit-ref-input" value="${(card.reference_id || '').replace(/"/g, '&quot;')}" />
          </div>
        </div>
        <div class="flashcard-modal-footer">
          <button type="button" class="btn-card-cancel">Cancel</button>
          <button type="button" class="btn-card-save">Save Changes</button>
        </div>
      </div>
    `;

    document.body.appendChild(editModal);

    const closeBtn = editModal.querySelector('.flashcard-modal-close');
    const cancelBtn = editModal.querySelector('.btn-card-cancel');
    const saveBtn = editModal.querySelector('.btn-card-save');
    const sourceInput = editModal.querySelector('.edit-source-input');
    const refInput = editModal.querySelector('.edit-ref-input');

    const closeModal = () => editModal.remove();
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    editModal.onclick = (e) => {
      if (e.target === editModal) closeModal();
    };

    if (saveBtn) {
      saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      const newSource = sourceInput.value.trim() || card.source_text;
      const newRef = refInput.value.trim() || card.reference_id;

      const updatedDefs = {};
      editModal.querySelectorAll('.edit-def-input').forEach(inp => {
        const l = inp.dataset.lang;
        const val = inp.value.trim();
        if (val) updatedDefs[l] = val;
      });

      const updatedTranslations = {
        ...(card.target_translations || {}),
        definitions: updatedDefs,
        definition: updatedDefs
      };

      if (typeof supabase !== 'undefined' && card.id && !card.id.startsWith('demo-')) {
        try {
          const { error } = await supabase
            .from('flashcards')
            .update({
              source_text: newSource,
              reference_id: newRef,
              target_translations: updatedTranslations
            })
            .eq('id', card.id);

          if (error) {
            alert('Failed to update flashcard: ' + error.message);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
            return;
          }
        } catch (err) {
          console.error('Update error:', err);
          alert('Update failed.');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Changes';
          return;
        }
      }

      card.source_text = newSource;
      card.reference_id = newRef;
      card.target_translations = updatedTranslations;

      closeModal();
      if (onSavedCallback) onSavedCallback();
      renderCurrentFlashcard();
    };
    }
  }

  function buildReviewQueue() {
    const isUserSet = userFlashcards && userFlashcards.length > 0;
    const baseCards = isUserSet ? userFlashcards : DEMO_FLASHCARDS;

    const now = new Date();
    let filtered;
    if (isDueTodaySelected()) {
      // Due Today mode: ONLY cards currently due (for user cards)
      if (isUserSet) {
        filtered = baseCards.filter(card => !card.next_review_date || new Date(card.next_review_date) <= now);
      } else {
        filtered = [...baseCards];
      }
    } else {
      // Running specific chapter deck(s)
      filtered = baseCards.filter(card => {
        return Array.from(selectedDeckTags).some(deckKey => cardMatchesDeck(card, deckKey));
      });
    }

    // Filter by Review Languages (Front Language: card.source_lang)
    const allowedReview = (reviewLanguages && reviewLanguages.length > 0)
      ? reviewLanguages
      : activeLanguages;

    filtered = filtered.filter(card => {
      const lang = (card.source_lang || 'eng').toLowerCase();
      return allowedReview.includes(lang);
    });

    // Sort: due cards first, then by next_review_date ascending
    filtered.sort((a, b) => {
      const aDue = !a.next_review_date || new Date(a.next_review_date) <= now;
      const bDue = !b.next_review_date || new Date(b.next_review_date) <= now;
      if (aDue && !bDue) return -1;
      if (!aDue && bDue) return 1;
      const aDate = a.next_review_date ? new Date(a.next_review_date).getTime() : 0;
      const bDate = b.next_review_date ? new Date(b.next_review_date).getTime() : 0;
      return aDate - bDate;
    });

    reviewQueue = filtered;
    updateFlashcardSectionHeader();
  }

  function getActiveCards() {
    return reviewQueue;
  }

  function goToNextCard() {
    const cards = getActiveCards();
    if (cards.length > 0) {
      currentCardIndex = (currentCardIndex + 1) % cards.length;
      isCardFlipped = false;
      isVerseSelected = false;
      renderCurrentFlashcard();
    }
  }

  function goToPrevCard() {
    const cards = getActiveCards();
    if (cards.length > 0) {
      currentCardIndex = (currentCardIndex - 1 + cards.length) % cards.length;
      isCardFlipped = false;
      isVerseSelected = false;
      renderCurrentFlashcard();
    }
  }

  function renderCurrentFlashcard() {
    const stage = document.querySelector('.flashcard-stage');
    if (!stage) return;

    const cards = getActiveCards();
    if (!cards || cards.length === 0) {
      renderCompletedQueueState();
      return;
    }

    if (currentCardIndex >= cards.length) {
      currentCardIndex = 0;
    }

    const card = cards[currentCardIndex];
    const totalCards = cards.length;
    const currentIndex = currentCardIndex;

    const sourceRef = stage.querySelector('.flashcard-source-ref');
    const counter = stage.querySelector('.flashcard-counter');
    const layout = stage.querySelector('.flashcard-body-layout');
    const promptWord = stage.querySelector('.flashcard-prompt-word');
    const subprompt = stage.querySelector('.flashcard-subprompt');
    const rightCol = stage.querySelector('.flashcard-right-col');
    const ratingsRow = stage.querySelector('.flashcard-ratings-row');
    const footerHint = stage.querySelector('.flashcard-footer-hint');
    const prevBtn = stage.querySelector('.btn-prev-card');
    const nextBtn = stage.querySelector('.btn-next-card');

    // Header Reference: only 3-letter language code
    const refText = formatRefDisplay(card.reference_id);
    const langCode = card.source_lang || 'jpn';
    if (sourceRef) {
      sourceRef.textContent = langCode;
    }

    // Counter: strictly # / # with navigation arrows
    if (counter) {
      counter.textContent = `${currentIndex + 1} / ${totalCards}`;
    }

    if (prevBtn) prevBtn.disabled = totalCards <= 1;
    if (nextBtn) nextBtn.disabled = totalCards <= 1;

    // Definitions data
    const defTranslations = card.target_translations?.definitions || card.target_translations?.definition || null;
    const fullRowTranslations = card.target_translations?.full_row_parallel 
      || card.target_translations?.context_sentence?.full_parallel 
      || card.target_translations?.context_sentence?.full_context_parallel 
      || (card.target_translations && !card.target_translations.definitions && !card.target_translations.definition ? card.target_translations : null);

    // Context sentence data (fallback for legacy cards)
    let contextText = '';
    const ctxMeta = card.target_translations?.context_sentence;
    if (ctxMeta) {
      contextText = typeof ctxMeta === 'string' ? ctxMeta : (ctxMeta.source_sentence || ctxMeta.text || '');
    } else if (card.context_sentence) {
      try {
        const ctxObj = typeof card.context_sentence === 'string' ? JSON.parse(card.context_sentence) : card.context_sentence;
        contextText = ctxObj.source_sentence || ctxObj.text || '';
      } catch (e) {
        contextText = card.context_sentence;
      }
    } else if (fullRowTranslations?.[card.source_lang]) {
      contextText = fullRowTranslations[card.source_lang];
    }

    if (!isCardFlipped) {
      // =====================================================================
      // CARD FRONT: JUST the target word (centered, no furigana/pinyin, no definitions)
      // =====================================================================
      if (stage) {
        stage.classList.remove('is-revealed');
      }

      if (layout) {
        layout.classList.add('is-front');
      }

      if (promptWord) {
        // Strip any ruby/furigana/pinyin markup so front displays ONLY the target word
        promptWord.textContent = stripRuby(card.source_text || '') || stripTags(card.source_text || '');
      }

      if (subprompt) {
        subprompt.textContent = '';
      }

      if (rightCol) {
        rightCol.innerHTML = '';
      }

      // Hide ratings row on front
      if (ratingsRow) {
        ratingsRow.style.display = 'none';
        ratingsRow.innerHTML = '';
      }

      if (footerHint) {
        footerHint.innerHTML = '';
      }

    } else {
      // =====================================================================
      // CARD BACK: Target word WITH furigana/pinyin on left + Definitions or Target Verse on right
      // =====================================================================
      if (stage) {
        stage.classList.add('is-revealed');
      }

      if (layout) {
        layout.classList.remove('is-front');
      }

      if (promptWord) {
        let displaySource = card.target_translations?.reading || card.source_text || '';
        // If displaySource has no ruby, check if card.source_text has ruby
        if (!displaySource.includes('<rt>') && card.source_text && card.source_text.includes('<rt>')) {
          displaySource = card.source_text;
        } else if (!displaySource.includes('<rt>') && contextText && contextText.includes('<rt>')) {
          const restored = annotateWithRuby(contextText, displaySource);
          if (restored && restored.includes('<rt>')) {
            displaySource = restored;
          }
        }
        promptWord.innerHTML = displaySource;
      }

      if (subprompt) {
        subprompt.textContent = '';
      }

      if (rightCol) {
        rightCol.innerHTML = '';

        if (!isVerseSelected) {
          // --- 1. Definitions View ---
          const defList = document.createElement('div');
          defList.className = 'flashcard-definitions-list';

          // Allowed answer languages
          const allowedAnswer = (answerLanguages && answerLanguages.length > 0)
            ? answerLanguages
            : activeLanguages;

          if (defTranslations && Object.keys(defTranslations).length > 0) {
            const matchingLangs = Object.keys(defTranslations).filter(l => allowedAnswer.includes(l));
            if (matchingLangs.length > 0) {
              matchingLangs.forEach(l => {
                const defText = defTranslations[l];
                if (!defText) return;
                let richDefText = defText;
                // If definition is Japanese or Chinese and missing ruby, restore using annotateWithRuby
                const parallelVerse = fullRowTranslations?.[l] || (card.source_lang === l ? contextText : '');
                if (['jpn', 'zhs', 'zht'].includes(l) && !richDefText.includes('<rt>') && parallelVerse && parallelVerse.includes('<rt>')) {
                  const restoredDef = annotateWithRuby(parallelVerse, richDefText);
                  if (restoredDef && restoredDef.includes('<rt>')) {
                    richDefText = restoredDef;
                  }
                }
                const item = document.createElement('div');
                item.className = 'flashcard-trans-item';
                // Display definition with furigana/pinyin if applicable
                item.innerHTML = `<span class="flashcard-trans-lang">${l.toUpperCase()}:</span> <span class="flashcard-trans-text">${richDefText}</span>`;
                defList.appendChild(item);
              });
            } else {
              defList.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">No definitions match the selected answer languages.</span>';
            }
          } else if (fullRowTranslations && Object.keys(fullRowTranslations).length > 0) {
            const langsToShow = Object.keys(fullRowTranslations).filter(l => l !== card.source_lang && allowedAnswer.includes(l));
            if (langsToShow.length > 0) {
              langsToShow.forEach(l => {
                const item = document.createElement('div');
                item.className = 'flashcard-trans-item';
                item.innerHTML = `<span class="flashcard-trans-lang">${l.toUpperCase()}:</span> <span class="flashcard-trans-text">${fullRowTranslations[l]}</span>`;
                defList.appendChild(item);
              });
            } else {
              defList.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">No answers match the selected answer languages.</span>';
            }
          } else {
            defList.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">Click verse tag below to view context</span>';
          }

          rightCol.appendChild(defList);

          // Clickable Origin / Target Verse button at bottom right
          const originBtn = document.createElement('button');
          originBtn.type = 'button';
          originBtn.className = 'flashcard-btn-origin';
          originBtn.title = 'View target verse context';
          originBtn.innerHTML = `<span>&lt;${refText}&gt;</span>`;
          originBtn.onclick = (e) => {
            e.stopPropagation();
            isVerseSelected = true;
            renderCurrentFlashcard();
          };
          rightCol.appendChild(originBtn);

        } else {
          // --- 2. Target Verse View (shown on the right column in place of definitions) ---
          const backCtx = document.createElement('div');
          backCtx.className = 'flashcard-back-context';

          const backRef = document.createElement('div');
          backRef.className = 'flashcard-back-ref';
          backRef.textContent = refText;
          backCtx.appendChild(backRef);

          const backSentence = document.createElement('div');
          backSentence.className = 'flashcard-back-sentence';
          backSentence.innerHTML = '<span class="flashcard-verse-loading">Loading verse…</span>';
          backCtx.appendChild(backSentence);

          rightCol.appendChild(backCtx);

          // Return button (↺) in bottom right to return to definitions
          const returnBtn = document.createElement('button');
          returnBtn.type = 'button';
          returnBtn.className = 'flashcard-btn-flip-back';
          returnBtn.title = 'Return to definitions';
          returnBtn.setAttribute('aria-label', 'Return to definitions');
          returnBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
          `;
          returnBtn.onclick = (e) => {
            e.stopPropagation();
            isVerseSelected = false;
            renderCurrentFlashcard();
          };
          rightCol.appendChild(returnBtn);

          // Asynchronously resolve verse text from canonical address pointer or fallback
          const refParts = card.reference_id ? card.reference_id.split('/') : [];
          if (refParts.length === 4) {
            const [vol, book, ch, verse] = refParts;
            const thisCardIndex = currentCardIndex;
            fetchVerseText(card.source_lang || 'eng', vol, book, ch, verse).then(verseHtml => {
              if (currentCardIndex === thisCardIndex && isVerseSelected) {
                backSentence.innerHTML = `<em>“${verseHtml}”</em>`;
              }
            }).catch(err => {
              console.warn('Verse fetch error:', err);
              if (currentCardIndex === thisCardIndex && isVerseSelected) {
                backSentence.innerHTML = '<em>Verse text unavailable.</em>';
              }
            });
          } else if (contextText) {
            backSentence.innerHTML = `<em>“${cleanVerseHtml(contextText)}”</em>`;
          } else {
            backSentence.innerHTML = '<em>Verse text unavailable.</em>';
          }
        }
      }

      // Populate & display SRS ratings row on back ONLY if Due Today
      if (ratingsRow) {
        ratingsRow.innerHTML = '';
        if (isDueTodaySelected()) {
          ratingsRow.style.display = 'flex';

          const previews = calculateSrsPreview(card);
          const ratingOptions = [
            { label: 'Again', rating: 1, class: 'rate-again', intervalText: previews.again },
            { label: 'Hard', rating: 2, class: 'rate-hard', intervalText: previews.hard },
            { label: 'Good', rating: 3, class: 'rate-good', intervalText: previews.good },
            { label: 'Easy', rating: 4, class: 'rate-easy', intervalText: previews.easy }
          ];

          ratingOptions.forEach(opt => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `btn-rating ${opt.class}`;
            btn.innerHTML = `<span>${opt.label}</span><span class="rating-interval">${opt.intervalText}</span>`;
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              handleSrsRating(card, opt.rating);
            });
            ratingsRow.appendChild(btn);
          });
        } else {
          ratingsRow.style.display = 'none';
        }
      }

      if (footerHint) {
        footerHint.innerHTML = '';
      }
    }
  }

  function renderCompletedQueueState() {
    const stage = document.querySelector('.flashcard-stage');
    if (!stage) return;

    stage.classList.remove('is-revealed');
    const layout = stage.querySelector('.flashcard-body-layout');
    if (layout) layout.classList.add('is-front');

    const sourceRef = stage.querySelector('.flashcard-source-ref');
    const counter = stage.querySelector('.flashcard-counter');
    const promptWord = stage.querySelector('.flashcard-prompt-word');
    const subprompt = stage.querySelector('.flashcard-subprompt');
    const rightCol = stage.querySelector('.flashcard-right-col');
    const ratingsRow = stage.querySelector('.flashcard-ratings-row');
    const footerHint = stage.querySelector('.flashcard-footer-hint');
    const prevBtn = stage.querySelector('.btn-prev-card');
    const nextBtn = stage.querySelector('.btn-next-card');

    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;

    if (counter) counter.textContent = '0 / 0';
    if (rightCol) rightCol.innerHTML = '';
    if (ratingsRow) {
      ratingsRow.style.display = 'none';
      ratingsRow.innerHTML = '';
    }

    if (isDueTodaySelected()) {
      if (sourceRef) sourceRef.textContent = 'All Caught Up';
      if (promptWord) promptWord.textContent = 'Great Job!';
      if (subprompt) subprompt.textContent = 'You have reviewed all cards due today for the selected review language(s).';
      if (footerHint) footerHint.innerHTML = '<span>Select another deck or click "View List" to browse cards anytime.</span>';
    } else {
      const activeDeck = Array.from(selectedDeckTags)[0] || '';
      const parsed = parseDeckKey(activeDeck);
      const deckName = formatDeckName(parsed);

      if (sourceRef) sourceRef.textContent = 'No Cards';
      if (promptWord) promptWord.textContent = 'No Cards Found';
      if (subprompt) subprompt.textContent = `No cards saved yet for ${deckName}. Highlight words in the reader to save cards.`;
      if (footerHint) footerHint.innerHTML = '<span>Adjust your review languages or select another deck.</span>';
    }
  }

  // Calculate prospective SRS intervals for button badges
  function calculateSrsPreview(card) {
    const rep = Number(card.repetition_count) || 0;
    const interval = Number(card.interval) || 0;
    const ease = Number(card.ease_factor) || 2.50;

    if (rep === 0) {
      return {
        again: '15m',
        hard: '1d',
        good: '1d',
        easy: '4d'
      };
    }

    // Review card (rep > 0)
    let hardDays;
    let goodDays;
    let easyDays;

    if (rep === 1 && interval <= 1) {
      hardDays = 3;
      goodDays = 6;
      easyDays = 10;
    } else {
      hardDays = Math.max(1, Math.round(interval * 1.2));
      goodDays = Math.max(hardDays + 1, Math.round(interval * ease));
      easyDays = Math.max(goodDays + 1, Math.round(interval * ease * 1.3));
    }

    const formatDays = (d) => {
      if (d >= 365) return (d / 365).toFixed(1) + 'y';
      if (d >= 30) return Math.round(d / 30) + 'mo';
      return d + 'd';
    };

    return {
      again: '1d',
      hard: formatDays(hardDays),
      good: formatDays(goodDays),
      easy: formatDays(easyDays)
    };
  }

  // SM-2 SRS Algorithm updating Supabase
  async function handleSrsRating(card, rating) {
    if (!isDueTodaySelected()) return;

    let ease = Number(card.ease_factor) || 2.50;
    let rep = Number(card.repetition_count) || 0;
    let interval = Number(card.interval) || 0;

    const nextDate = new Date();

    if (rep === 0) {
      // =====================================================================
      // Initial Learning Intervals (when repetition_count === 0):
      // =====================================================================
      if (rating === 1) {
        // Again: Set next_review_date to +15 minutes (intraday review). Reset repetition_count = 0, interval = 0.
        rep = 0;
        interval = 0;
        nextDate.setMinutes(nextDate.getMinutes() + 15);
      } else if (rating === 2) {
        // Hard: Set next_review_date to +1 day. Keep repetition_count = 0, interval = 1, decrease ease_factor by 0.15 (min 1.3).
        rep = 0;
        interval = 1;
        ease = Math.max(1.30, ease - 0.15);
        nextDate.setDate(nextDate.getDate() + 1);
      } else if (rating === 3) {
        // Good: Set next_review_date to +1 day. Graduate card: set repetition_count = 1, interval = 1.
        rep = 1;
        interval = 1;
        nextDate.setDate(nextDate.getDate() + 1);
      } else if (rating === 4) {
        // Easy: Set next_review_date to +4 days. Fast-track card: set repetition_count = 1, interval = 4, increase ease_factor by 0.15.
        rep = 1;
        interval = 4;
        ease = ease + 0.15;
        nextDate.setDate(nextDate.getDate() + 4);
      }
    } else {
      // =====================================================================
      // Review Intervals (when repetition_count > 0):
      // =====================================================================
      if (rating === 1) {
        // Again: Reset interval to 1 day (or 15 min), decrease ease_factor by 0.20 (floor at 1.30), reset repetition_count = 0.
        rep = 0;
        interval = 1;
        ease = Math.max(1.30, ease - 0.20);
        nextDate.setDate(nextDate.getDate() + 1);
      } else if (rating === 2) {
        // Hard: interval = Math.round(interval * 1.2), decrease ease_factor by 0.15.
        let newInterval;
        if (rep === 1 && interval <= 1) {
          newInterval = 3;
        } else {
          newInterval = Math.max(interval + 1, Math.round(interval * 1.2));
        }
        interval = newInterval;
        ease = Math.max(1.30, ease - 0.15);
        nextDate.setDate(nextDate.getDate() + interval);
      } else if (rating === 3) {
        // Good: interval = Math.round(interval * ease_factor).
        let newInterval;
        if (rep === 1 && interval <= 1) {
          newInterval = 6;
        } else {
          newInterval = Math.max(Math.round(interval * 1.2) + 1, Math.round(interval * ease));
        }
        interval = newInterval;
        rep += 1;
        nextDate.setDate(nextDate.getDate() + interval);
      } else if (rating === 4) {
        // Easy: interval = Math.round(interval * ease_factor * 1.3), increase ease_factor by 0.15.
        let newInterval;
        if (rep === 1 && interval <= 1) {
          newInterval = 10;
        } else {
          newInterval = Math.max(Math.round(interval * ease) + 1, Math.round(interval * ease * 1.3));
        }
        interval = newInterval;
        ease = ease + 0.15;
        rep += 1;
        nextDate.setDate(nextDate.getDate() + interval);
      }
    }

    ease = Math.round(ease * 100) / 100;

    // Persist updates to Supabase
    if (typeof supabase !== 'undefined' && card.id && !card.id.startsWith('demo-')) {
      try {
        const { error } = await supabase
          .from('flashcards')
          .update({
            ease_factor: ease,
            interval: interval,
            repetition_count: rep,
            next_review_date: nextDate.toISOString()
          })
          .eq('id', card.id);

        if (error) {
          console.error('Error updating flashcard in Supabase:', error);
        } else {
          // Update in-memory card
          card.ease_factor = ease;
          card.interval = interval;
          card.repetition_count = rep;
          card.next_review_date = nextDate.toISOString();
        }
      } catch (err) {
        console.error('Failed to update flashcard:', err);
      }
    } else {
      // In-memory demo card
      card.ease_factor = ease;
      card.interval = interval;
      card.repetition_count = rep;
      card.next_review_date = nextDate.toISOString();
    }

    // Due Today: Once logged, remove from reviewQueue so it does not show again
    reviewQueue = reviewQueue.filter(c => c.id !== card.id);
    populateDecksList();

    isCardFlipped = false;
    isVerseSelected = false;

    const cards = getActiveCards();
    if (cards.length === 0) {
      renderCompletedQueueState();
      return;
    }

    if (currentCardIndex >= cards.length) {
      currentCardIndex = 0;
    }
    renderCurrentFlashcard();
  }

  function initFlashcardLangPickers() {
    const reviewGroup = document.querySelector('.lang-config-review');
    const answerGroup = document.querySelector('.lang-config-answer');
    if (!reviewGroup || !answerGroup) return;

    const reviewValues = reviewGroup.querySelector('.lang-config-values');
    const answerValues = answerGroup.querySelector('.lang-config-values');

    let reviewPopover = reviewGroup.querySelector('.flashcard-lang-popover');
    if (!reviewPopover) {
      reviewPopover = document.createElement('div');
      reviewPopover.className = 'lang-popover flashcard-lang-popover';
      reviewPopover.setAttribute('role', 'dialog');
      reviewPopover.setAttribute('aria-label', 'Choose review languages (front)');
      reviewPopover.hidden = true;
      reviewGroup.appendChild(reviewPopover);
    }

    let answerPopover = answerGroup.querySelector('.flashcard-lang-popover');
    if (!answerPopover) {
      answerPopover = document.createElement('div');
      answerPopover.className = 'lang-popover flashcard-lang-popover';
      answerPopover.setAttribute('role', 'dialog');
      answerPopover.setAttribute('aria-label', 'Choose answer languages (back)');
      answerPopover.hidden = true;
      answerGroup.appendChild(answerPopover);
    }

    function renderReviewOptions() {
      reviewPopover.innerHTML = '<div class="lang-popover-title">Review Languages (Front)</div>';
      const list = document.createElement('div');
      list.className = 'lang-popover-list';

      // Strictly only active languages selected at the top
      const activeObjList = ALL_LANGUAGES.filter(l => activeLanguages.includes(l.code));
      activeObjList.forEach(lang => {
        const label = document.createElement('label');
        label.className = 'lang-popover-option';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = lang.code;
        cb.checked = reviewLanguages.includes(lang.code);
        cb.addEventListener('change', () => {
          let next = reviewLanguages.filter(c => c !== lang.code);
          if (cb.checked) next.push(lang.code);
          if (next.length === 0) {
            cb.checked = true; // Keep at least one
            return;
          }
          saveReviewLanguages(next);
          buildReviewQueue();
          currentCardIndex = 0;
          isCardFlipped = false;
          isVerseSelected = false;
          renderCurrentFlashcard();
        });

        const code = document.createElement('span');
        code.className = 'lang-popover-code';
        code.textContent = lang.code;

        const name = document.createElement('span');
        name.className = 'lang-popover-name';
        name.textContent = lang.name;

        label.append(cb, code, name);
        list.appendChild(label);
      });

      reviewPopover.appendChild(list);
    }

    function renderAnswerOptions() {
      answerPopover.innerHTML = '<div class="lang-popover-title">Answer Languages (Back)</div>';
      const list = document.createElement('div');
      list.className = 'lang-popover-list';

      // Strictly only active languages selected at the top
      const activeObjList = ALL_LANGUAGES.filter(l => activeLanguages.includes(l.code));
      activeObjList.forEach(lang => {
        const label = document.createElement('label');
        label.className = 'lang-popover-option';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = lang.code;
        cb.checked = answerLanguages.includes(lang.code);
        cb.addEventListener('change', () => {
          let next = answerLanguages.filter(c => c !== lang.code);
          if (cb.checked) next.push(lang.code);
          if (next.length === 0) {
            cb.checked = true; // Keep at least one
            return;
          }
          saveAnswerLanguages(next);
          renderCurrentFlashcard();
        });

        const code = document.createElement('span');
        code.className = 'lang-popover-code';
        code.textContent = lang.code;

        const name = document.createElement('span');
        name.className = 'lang-popover-name';
        name.textContent = lang.name;

        label.append(cb, code, name);
        list.appendChild(label);
      });

      answerPopover.appendChild(list);
    }

    function toggleReviewPopover(open) {
      const shouldOpen = open !== undefined ? open : reviewPopover.hidden;
      if (shouldOpen) {
        toggleAnswerPopover(false);
        const headerPopover = document.getElementById('lang-popover');
        if (headerPopover) headerPopover.hidden = true;

        renderReviewOptions();
        reviewPopover.hidden = false;
        if (reviewValues) reviewValues.setAttribute('aria-expanded', 'true');
      } else {
        reviewPopover.hidden = true;
        if (reviewValues) reviewValues.setAttribute('aria-expanded', 'false');
      }
    }

    function toggleAnswerPopover(open) {
      const shouldOpen = open !== undefined ? open : answerPopover.hidden;
      if (shouldOpen) {
        toggleReviewPopover(false);
        const headerPopover = document.getElementById('lang-popover');
        if (headerPopover) headerPopover.hidden = true;

        renderAnswerOptions();
        answerPopover.hidden = false;
        if (answerValues) answerValues.setAttribute('aria-expanded', 'true');
      } else {
        answerPopover.hidden = true;
        if (answerValues) answerValues.setAttribute('aria-expanded', 'false');
      }
    }

    if (reviewValues) {
      reviewValues.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleReviewPopover();
      });
    }

    if (answerValues) {
      answerValues.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleAnswerPopover();
      });
    }

    document.addEventListener('click', (e) => {
      if (!reviewGroup.contains(e.target)) {
        toggleReviewPopover(false);
      }
      if (!answerGroup.contains(e.target)) {
        toggleAnswerPopover(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        toggleReviewPopover(false);
        toggleAnswerPopover(false);
      }
    });

    renderFlashcardLangSelectors();
  }

  function initFlashcards() {
    checkUrlDeckParam();
    initFlashcardLangPickers();
    const cardSurface = document.querySelector('.flashcard-card-surface');
    if (cardSurface) {
      cardSurface.onclick = (e) => {
        // Do not flip if clicked on an interactive button or control inside
        if (e.target.closest('button, input, select, textarea, a')) {
          return;
        }
        // One-way flip: Once flipped to back, clicking cannot flip back to front
        if (isCardFlipped) return;
        isCardFlipped = true;
        isVerseSelected = false;
        renderCurrentFlashcard();
      };
    }

    const prevBtn = document.querySelector('.btn-prev-card');
    if (prevBtn) {
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        goToPrevCard();
      };
    }

    const nextBtn = document.querySelector('.btn-next-card');
    if (nextBtn) {
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        goToNextCard();
      };
    }

    const editBtn = document.querySelector('.flashcard-btn-edit');
    if (editBtn) {
      editBtn.onclick = (e) => {
        e.stopPropagation();
        const cards = getActiveCards();
        const card = cards[currentCardIndex] || cards[0];
        if (card) {
          openEditFlashcardModal(card, () => renderCurrentFlashcard());
        }
      };
    }

    // Keyboard shortcut for flashcard review (Space to flip, Left/Right arrows to browse, V to toggle verse, 1-4 to rate)
    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, [contenteditable]')) return;

      if (e.code === 'Space') {
        e.preventDefault();
        // One-way flip: If already flipped, Space does not flip back to front
        if (!isCardFlipped) {
          isCardFlipped = true;
          isVerseSelected = false;
          renderCurrentFlashcard();
        }
      } else if (e.code === 'KeyV' && isCardFlipped) {
        e.preventDefault();
        isVerseSelected = !isVerseSelected;
        renderCurrentFlashcard();
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        goToNextCard();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        goToPrevCard();
      } else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code) && isCardFlipped) {
        if (!isDueTodaySelected()) return;
        const rating = parseInt(e.code.replace('Digit', ''), 10);
        const cards = getActiveCards();
        const card = cards[currentCardIndex];
        if (card) {
          e.preventDefault();
          handleSrsRating(card, rating);
        }
      }
    });

    populateDecksList();
    buildReviewQueue();
    renderCurrentFlashcard();
  }

  // =========================================================================
  // 8. Quick Search (Scriptures & General Conference)
  // =========================================================================

  let searchIndex = {
    scriptures: [],
    gc: []
  };

  const BOOK_SEARCH_ALIASES = {
    '1-ne': ['1 nephi', '1 ne', '1ne', 'first nephi'],
    '2-ne': ['2 nephi', '2 ne', '2ne', 'second nephi'],
    '3-ne': ['3 nephi', '3 ne', '3ne', 'third nephi'],
    '4-ne': ['4 nephi', '4 ne', '4ne', 'fourth nephi'],
    'jacob': ['jacob', 'jac'],
    'enos': ['enos', 'en'],
    'jarom': ['jarom', 'jar'],
    'omni': ['omni', 'om'],
    'w-of-m': ['words of mormon', 'w of m', 'wm'],
    'mosiah': ['mosiah', 'mos'],
    'alma': ['alma', 'al'],
    'hel': ['helaman', 'hel'],
    '3-ne': ['3 nephi', '3 ne', '3ne'],
    '4-ne': ['4 nephi', '4 ne', '4ne'],
    'morm': ['mormon', 'morm'],
    'ether': ['ether', 'eth'],
    'moro': ['moroni', 'moro'],
    'dc': ['doctrine and covenants', 'd&c', 'd and c', 'dc', 'sections', 'section'],
    'moses': ['moses'],
    'abr': ['abraham', 'abr'],
    'js-m': ['joseph smith matthew', 'js-m', 'jsm'],
    'js-h': ['joseph smith history', 'js-h', 'jsh'],
    'a-of-f': ['articles of faith', 'a-of-f', 'aof'],
    'gen': ['genesis', 'gen'],
    'ex': ['exodus', 'ex', 'exod'],
    'lev': ['leviticus', 'lev'],
    'num': ['numbers', 'num'],
    'deut': ['deuteronomy', 'deut'],
    'josh': ['joshua', 'josh'],
    'judg': ['judges', 'judg'],
    'ruth': ['ruth'],
    '1-sam': ['1 samuel', '1 sam', '1sam'],
    '2-sam': ['2 samuel', '2 sam', '2sam'],
    '1-kgs': ['1 kings', '1 kgs', '1kgs'],
    '2-kgs': ['2 kings', '2 kgs', '2kgs'],
    '1-chr': ['1 chronicles', '1 chr', '1chr'],
    '2-chr': ['2 chronicles', '2 chr', '2chr'],
    'ezra': ['ezra'],
    'neh': ['nehemiah', 'neh'],
    'esth': ['esther', 'esth'],
    'job': ['job'],
    'ps': ['psalms', 'psalm', 'ps'],
    'prov': ['proverbs', 'prov'],
    'eccl': ['ecclesiastes', 'eccl'],
    'song': ['song of solomon', 'song'],
    'isa': ['isaiah', 'isa'],
    'jer': ['jeremiah', 'jer'],
    'lam': ['lamentations', 'lam'],
    'ezek': ['ezekiel', 'ezek'],
    'dan': ['daniel', 'dan'],
    'hos': ['hosea', 'hos'],
    'joel': ['joel'],
    'amos': ['amos'],
    'obad': ['obadiah', 'obad'],
    'jonah': ['jonah', 'jon'],
    'micah': ['micah', 'mic'],
    'nahum': ['nahum', 'nah'],
    'hab': ['habakkuk', 'hab'],
    'zeph': ['zephaniah', 'zeph'],
    'hag': ['haggai', 'hag'],
    'zech': ['zechariah', 'zech'],
    'mal': ['malachi', 'mal'],
    'matt': ['matthew', 'matt'],
    'mark': ['mark'],
    'luke': ['luke'],
    'john': ['john', 'jn'],
    'acts': ['acts'],
    'rom': ['romans', 'rom'],
    '1-cor': ['1 corinthians', '1 cor', '1cor'],
    '2-cor': ['2 corinthians', '2 cor', '2cor'],
    'gal': ['galatians', 'gal'],
    'eph': ['ephesians', 'eph'],
    'philip': ['philippians', 'philip', 'phil'],
    'col': ['colossians', 'col'],
    '1-thes': ['1 thessalonians', '1 thes', '1thes'],
    '2-thes': ['2 thessalonians', '2 thes', '2thes'],
    '1-tim': ['1 timothy', '1 tim', '1tim'],
    '2-tim': ['2 timothy', '2 tim', '2tim'],
    'titus': ['titus', 'tit'],
    'philem': ['philemon', 'philem'],
    'heb': ['hebrews', 'heb'],
    'james': ['james', 'jas'],
    '1-pet': ['1 peter', '1 pet', '1pet'],
    '2-pet': ['2 peter', '2 pet', '2pet'],
    '1-jn': ['1 john', '1 jn', '1jn'],
    '2-jn': ['2 john', '2 jn', '2jn'],
    '3-jn': ['3 john', '3 jn', '3jn'],
    'jude': ['jude'],
    'rev': ['revelation', 'revelations', 'rev']
  };

  function buildSearchIndex() {
    searchIndex.scriptures = [];
    searchIndex.gc = [];

    // 1. Index Scriptures
    Object.entries(corpusData.scriptures || {}).forEach(([vol, books]) => {
      const volName = VOLUME_NAMES[vol] || vol;
      Object.entries(books).forEach(([book, chapters]) => {
        if (book === '_front_matter') return;
        const standardBookName = BOOK_NAMES[book] || book;
        const displayName = (book === 'dc' || vol === 'dc') ? 'Doctrine and Covenants' : standardBookName;
        const aliases = BOOK_SEARCH_ALIASES[book] || [book.toLowerCase(), standardBookName.toLowerCase()];
        const chList = Object.keys(chapters);

        chList.forEach(ch => {
          searchIndex.scriptures.push({
            type: 'scripture',
            vol,
            book,
            ch: String(ch),
            title: `${displayName} ${ch}`,
            snippet: `${volName} • Chapter ${ch}`,
            url: `reader.html?type=scripture&volume=${encodeURIComponent(vol)}&book=${encodeURIComponent(book)}&chapter=${encodeURIComponent(ch)}`,
            aliases,
            volName: volName.toLowerCase()
          });
        });
      });
    });

    // 2. Index General Conference Talks
    Object.entries(corpusData.general_conference || {}).forEach(([session, talks]) => {
      const parts = session.split('-');
      const moName = parts[1] === '04' ? 'April' : parts[1] === '10' ? 'October' : parts[1];
      const sessName = `${moName} ${parts[0]}`;

      Object.entries(talks).forEach(([slug, talk]) => {
        const rawTitle = talk?.title?.eng || (talk?.title && Object.values(talk.title)[0]) || slug;
        const cleanTitle = stripRuby(stripTags(String(rawTitle))).trim();
        const rawSpeaker = talk?.speaker?.eng || (talk?.speaker && Object.values(talk.speaker)[0]) || '';
        const cleanSpeaker = stripRuby(stripTags(String(rawSpeaker)))
          .replace(/\u00a0/g, ' ')
          .split('\n')[0]
          .replace(/^By\s+/i, '')
          .replace(/^Elder\s+/i, '')
          .replace(/^President\s+/i, '')
          .replace(/^Sister\s+/i, '')
          .replace(/^Brother\s+/i, '')
          .trim();

        const allTextParts = [
          cleanTitle,
          cleanSpeaker,
          sessName,
          session,
          slug,
          ...(talk?.title ? Object.values(talk.title).map(t => stripRuby(stripTags(t))) : []),
          ...(talk?.speaker ? Object.values(talk.speaker).map(s => stripRuby(stripTags(s))) : [])
        ];

        searchIndex.gc.push({
          type: 'gc',
          session,
          slug,
          title: cleanTitle,
          speaker: cleanSpeaker,
          snippet: `${cleanSpeaker ? cleanSpeaker + ' • ' : ''}${sessName} General Conference`,
          url: `reader.html?type=gc&session=${encodeURIComponent(session)}&talk=${encodeURIComponent(slug)}`,
          searchWords: allTextParts
            .join(' ')
            .toLowerCase()
            .split(/[\s,.:;/'"“”‘’«»()\[\]-]+/)
            .filter(Boolean)
        });
      });
    });
  }

  function querySearchIndex(query) {
    const rawQ = (query || '').trim();
    if (!rawQ) return [];

    const results = [];
    const cleanQ = rawQ.toLowerCase().replace(/&/g, ' and ');

    // 1. Scripture structured reference match (e.g. "1 ne 3", "alma 32", "dc 88", "gen 1")
    const m = cleanQ.match(/^([1-4]?\s*[a-z&]+(?:-[a-z]+)?)\s*(\d+)?$/);
    if (m) {
      const bookQuery = m[1].replace(/\s+/g, ' ').trim();
      const chQuery = m[2] || null;

      for (const item of searchIndex.scriptures) {
        const aliasMatch = item.aliases.some(alias => {
          if (alias === bookQuery) return 'exact';
          if (alias.startsWith(bookQuery)) return 'prefix';
          return null;
        });

        if (aliasMatch) {
          if (chQuery && item.ch !== chQuery) continue;

          let score = 500;
          if (aliasMatch === 'exact') score += 500;
          if (chQuery && item.ch === chQuery) score += 1000;
          if (!chQuery) score += Math.max(0, 100 - parseInt(item.ch, 10));

          results.push({ item, score });
        }
      }
    }

    // 2. Keyword fallback for scriptures if no structured match
    if (results.length === 0) {
      const tokens = cleanQ.split(/[\s,.:;/]+/).filter(Boolean);
      for (const item of searchIndex.scriptures) {
        const titleLower = item.title.toLowerCase();
        if (tokens.every(t => titleLower.includes(t) || item.volName.includes(t))) {
          let score = 200;
          if (titleLower.startsWith(cleanQ)) score += 300;
          results.push({ item, score });
        }
      }
    }

    // 3. General Conference matching
    const gcTokens = cleanQ.split(/[\s,.:;/]+/).filter(Boolean);
    for (const item of searchIndex.gc) {
      const allTokensMatch = gcTokens.every(tok => {
        return item.searchWords.some(w => w.startsWith(tok) || (tok.length >= 4 && w.includes(tok)));
      });

      if (allTokensMatch) {
        let score = 300;
        if (item.title.toLowerCase().startsWith(cleanQ)) score += 600;
        else if (item.title.toLowerCase().includes(cleanQ)) score += 400;
        if (item.speaker && item.speaker.toLowerCase().includes(cleanQ)) score += 350;
        results.push({ item, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 12).map(r => r.item);
  }

  function getDefaultSuggestedResults() {
    return [
      {
        title: '1 Nephi 1',
        snippet: 'Book of Mormon • Chapter 1',
        url: 'reader.html?type=scripture&volume=bom&book=1-ne&chapter=1'
      },
      {
        title: 'Alma 32',
        snippet: 'Book of Mormon • Chapter 32',
        url: 'reader.html?type=scripture&volume=bom&book=alma&chapter=32'
      },
      {
        title: 'Moses 1',
        snippet: 'Pearl of Great Price • Chapter 1',
        url: 'reader.html?type=scripture&volume=pgp&book=moses&chapter=1'
      },
      {
        title: 'Doctrine and Covenants 88',
        snippet: 'Doctrine and Covenants • Section 88',
        url: 'reader.html?type=scripture&volume=dc&book=dc&chapter=88'
      },
      {
        title: 'Gerrit W. Gong — October 2026',
        snippet: 'General Conference • Come to the Lord in His Holy House',
        url: 'reader.html?type=gc&session=2026-10&talk=12gong'
      },
      {
        title: 'D. Todd Christofferson — October 2026',
        snippet: 'General Conference • O Be Wise',
        url: 'reader.html?type=gc&session=2026-10&talk=11christofferson'
      }
    ];
  }

  function renderSearchResults(query = '') {
    const headerEl = document.querySelector('.search-results-header');
    const listEl = document.querySelector('.search-result-list');
    if (!listEl) return;

    const trimmed = (query || '').trim();

    if (!trimmed) {
      if (headerEl) headerEl.textContent = 'Quick Jump & Suggested Chapters';
      const items = getDefaultSuggestedResults();
      listEl.innerHTML = items.map(item => `
        <li>
          <a href="${item.url}" class="search-result-item">
            <span class="search-result-title">${item.title}</span>
            <span class="search-result-snippet">${item.snippet}</span>
          </a>
        </li>
      `).join('');
      return;
    }

    const results = querySearchIndex(trimmed);

    if (headerEl) {
      headerEl.textContent = `${results.length} result${results.length === 1 ? '' : 's'} for “${trimmed}”`;
    }

    if (results.length === 0) {
      listEl.innerHTML = `
        <li style="padding: 24px 10px; color: var(--text-muted); font-size: 0.88rem; text-align: center;">
          No matching chapters, talks, or speakers found.
        </li>
      `;
      return;
    }

    listEl.innerHTML = results.map(item => `
      <li>
        <a href="${item.url}" class="search-result-item">
          <span class="search-result-title">${item.title}</span>
          <span class="search-result-snippet">${item.snippet}</span>
        </a>
      </li>
    `).join('');
  }

  function initSearch() {
    const searchInput = document.querySelector('.search-input');
    if (!searchInput) return;

    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        renderSearchResults(searchInput.value);
      }, 100);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const firstLink = document.querySelector('.search-result-list .search-result-item');
        if (firstLink && firstLink.href) {
          window.location.href = firstLink.href;
        }
      }
    });

    renderSearchResults('');
  }

  // =========================================================================
  // 9. Initialization
  // =========================================================================

  // Deck list selection (called from inline onclick handlers in index.html)
  window.toggleDeck = function (item, fromCheckbox = false) {
    const checkbox = item.querySelector('.deck-checkbox');
    if (!fromCheckbox && checkbox) {
      checkbox.checked = !checkbox.checked;
    }
    item.classList.toggle('selected', checkbox ? checkbox.checked : !item.classList.contains('selected'));
  };

  document.addEventListener('DOMContentLoaded', () => {
    renderHeaderLanguages();
    initLanguagePicker();
    initFlashcards();
    initAuth();
    initSearch();
    fetchCorpusData();
  });

})();

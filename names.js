/**
 * names.js — Shared display names for The Polyglot Saint.
 * Loaded by both index.html and reader.html before their page scripts.
 */
(function () {
  'use strict';

  // Available language codes with metadata
  const ALL_LANGUAGES = [
    { code: 'eng', name: 'English' },
    { code: 'jpn', name: 'Japanese (日本語)' },
    { code: 'spa', name: 'Spanish (Español)' },
    { code: 'zhs', name: 'Simplified Chinese (简体中文)' },
    { code: 'zht', name: 'Traditional Chinese (繁體中文)' },
    { code: 'ara', name: 'Arabic (العربية)' },
    { code: 'fra', name: 'French (Français)' },
    { code: 'deu', name: 'German (Deutsch)' },
    { code: 'por', name: 'Portuguese (Português)' },
    { code: 'kor', name: 'Korean (한국어)' },
    { code: 'ita', name: 'Italian (Italiano)' }
  ];

  const DEFAULT_LANGUAGES = ['eng', 'jpn', 'zhs', 'zht', 'spa'];
  const STORAGE_KEY_LANGS = 'polyglot_active_languages';

  // Canonical Volume & Book Display Names
  const VOLUME_NAMES = {
    'bom': 'Book of Mormon',
    'bofm': 'Book of Mormon',
    'dc': 'Doctrine and Covenants',
    'pgp': 'Pearl of Great Price',
    'nt': 'New Testament',
    'ot': 'Old Testament'
  };

  const BOOK_NAMES = {
    '_front_matter': 'Introductory Materials',
    '1-ne': '1 Nephi',
    '2-ne': '2 Nephi',
    'jacob': 'Jacob',
    'enos': 'Enos',
    'jarom': 'Jarom',
    'omni': 'Omni',
    'w-of-m': 'Words of Mormon',
    'mosiah': 'Mosiah',
    'alma': 'Alma',
    'hel': 'Helaman',
    '3-ne': '3 Nephi',
    '4-ne': '4 Nephi',
    'morm': 'Mormon',
    'ether': 'Ether',
    'moro': 'Moroni',
    'dc': 'Sections',
    'moses': 'Moses',
    'abr': 'Abraham',
    'js-m': 'Joseph Smith—Matthew',
    'js-h': 'Joseph Smith—History',
    'a-of-f': 'Articles of Faith',
    'matt': 'Matthew',
    'mark': 'Mark',
    'luke': 'Luke',
    'john': 'John',
    'acts': 'Acts',
    'rom': 'Romans',
    '1-cor': '1 Corinthians',
    '2-cor': '2 Corinthians',
    'gal': 'Galatians',
    'eph': 'Ephesians',
    'philip': 'Philippians',
    'col': 'Colossians',
    '1-thes': '1 Thessalonians',
    '2-thes': '2 Thessalonians',
    '1-tim': '1 Timothy',
    '2-tim': '2 Timothy',
    'titus': 'Titus',
    'philem': 'Philemon',
    'heb': 'Hebrews',
    'james': 'James',
    '1-pet': '1 Peter',
    '2-pet': '2 Peter',
    '1-jn': '1 John',
    '2-jn': '2 John',
    '3-jn': '3 John',
    'jude': 'Jude',
    'rev': 'Revelation',
    'gen': 'Genesis',
    'ex': 'Exodus',
    'lev': 'Leviticus',
    'num': 'Numbers',
    'deut': 'Deuteronomy',
    'josh': 'Joshua',
    'judg': 'Judges',
    'ruth': 'Ruth',
    '1-sam': '1 Samuel',
    '2-sam': '2 Samuel',
    '1-kgs': '1 Kings',
    '2-kgs': '2 Kings',
    '1-chr': '1 Chronicles',
    '2-chr': '2 Chronicles',
    'ezra': 'Ezra',
    'neh': 'Nehemiah',
    'esth': 'Esther',
    'job': 'Job',
    'ps': 'Psalms',
    'prov': 'Proverbs',
    'eccl': 'Ecclesiastes',
    'song': 'Song of Solomon',
    'isa': 'Isaiah',
    'jer': 'Jeremiah',
    'lam': 'Lamentations',
    'ezek': 'Ezekiel',
    'dan': 'Daniel',
    'hos': 'Hosea',
    'joel': 'Joel',
    'amos': 'Amos',
    'obad': 'Obadiah',
    'jonah': 'Jonah',
    'micah': 'Micah',
    'nahum': 'Nahum',
    'hab': 'Habakkuk',
    'zeph': 'Zephaniah',
    'hag': 'Haggai',
    'zech': 'Zechariah',
    'mal': 'Malachi'
  };

  const BOOK_TO_VOLUME = {
    '_front_matter': 'bom',
    '1-ne': 'bom', '2-ne': 'bom', 'jacob': 'bom', 'enos': 'bom', 'jarom': 'bom', 'omni': 'bom',
    'w-of-m': 'bom', 'mosiah': 'bom', 'alma': 'bom', 'hel': 'bom', '3-ne': 'bom', '4-ne': 'bom',
    'morm': 'bom', 'ether': 'bom', 'moro': 'bom',
    'dc': 'dc',
    'moses': 'pgp', 'abr': 'pgp', 'js-m': 'pgp', 'js-h': 'pgp', 'a-of-f': 'pgp',
    'matt': 'nt', 'mark': 'nt', 'luke': 'nt', 'john': 'nt', 'acts': 'nt', 'rom': 'nt',
    '1-cor': 'nt', '2-cor': 'nt', 'gal': 'nt', 'eph': 'nt', 'philip': 'nt', 'col': 'nt',
    '1-thes': 'nt', '2-thes': 'nt', '1-tim': 'nt', '2-tim': 'nt', 'titus': 'nt', 'philem': 'nt',
    'heb': 'nt', 'james': 'nt', '1-pet': 'nt', '2-pet': 'nt', '1-jn': 'nt', '2-jn': 'nt',
    '3-jn': 'nt', 'jude': 'nt', 'rev': 'nt',
    'gen': 'ot', 'ex': 'ot', 'lev': 'ot', 'num': 'ot', 'deut': 'ot', 'josh': 'ot',
    'judg': 'ot', 'ruth': 'ot', '1-sam': 'ot', '2-sam': 'ot', '1-kgs': 'ot', '2-kgs': 'ot',
    '1-chr': 'ot', '2-chr': 'ot', 'ezra': 'ot', 'neh': 'ot', 'esth': 'ot', 'job': 'ot',
    'ps': 'ot', 'prov': 'ot', 'eccl': 'ot', 'song': 'ot', 'isa': 'ot', 'jer': 'ot',
    'lam': 'ot', 'ezek': 'ot', 'dan': 'ot', 'hos': 'ot', 'joel': 'ot', 'amos': 'ot',
    'obad': 'ot', 'jonah': 'ot', 'micah': 'ot', 'nahum': 'ot', 'hab': 'ot', 'zeph': 'ot',
    'hag': 'ot', 'zech': 'ot', 'mal': 'ot'
  };

  function normalizeVolume(vol) {
    if (!vol) return 'bom';
    const v = String(vol).toLowerCase().trim();
    if (v === 'bofm' || v === 'bom') return 'bom';
    return v;
  }

  function normalizeDeckKey(key) {
    if (!key) return '';
    const k = String(key).trim();
    if (k === 'all' || k === 'due_today') return 'all';
    const parts = k.split('/');
    if (parts.length >= 3) {
      return `${normalizeVolume(parts[0])}/${parts[1].toLowerCase()}/${parts[2]}`;
    }
    return k;
  }

  function parseDeckKey(deckKey) {
    if (!deckKey || deckKey === 'all') return { vol: 'bom', book: 'general', ch: '1', deckKey: 'all' };
    const parts = String(deckKey).split('/');
    if (parts.length >= 3) {
      const vol = normalizeVolume(parts[0]);
      const book = parts[1].toLowerCase();
      const ch = parts[2];
      return {
        vol,
        book,
        ch,
        deckKey: `${vol}/${book}/${ch}`
      };
    }
    return { vol: 'bom', book: deckKey, ch: '1', deckKey };
  }

  function parseReferenceString(ref) {
    if (!ref || typeof ref !== 'string') return null;
    const clean = ref.trim();
    if (!clean) return null;

    // Strip verse suffix if present (:verse)
    const base = clean.includes(':') ? clean.split(':')[0] : clean;

    // 1. General Conference
    if (base.startsWith('gc/') || base.startsWith('gc-')) {
      if (base.includes('/')) {
        const parts = base.split('/');
        if (parts.length >= 3) {
          return { vol: 'gc', book: parts[1], ch: parts[2], deckKey: `gc/${parts[1]}/${parts[2]}` };
        }
      }
      const gcMatch = base.match(/^gc-([0-9]{4}-[0-9]{2})-(.+)$/);
      if (gcMatch) {
        return { vol: 'gc', book: gcMatch[1], ch: gcMatch[2], deckKey: `gc/${gcMatch[1]}/${gcMatch[2]}` };
      }
    }

    // 2. D&C
    if (base.startsWith('dc/') || base.startsWith('dc-') || base === 'dc') {
      if (base.includes('/')) {
        const parts = base.split('/');
        const ch = parts[1] === 'dc' ? parts[2] : parts[1];
        if (ch && !isNaN(ch)) return { vol: 'dc', book: 'dc', ch: String(ch), deckKey: `dc/dc/${ch}` };
      } else if (base.includes('-')) {
        const parts = base.split('-');
        const ch = parts[parts.length - 1];
        if (ch && !isNaN(ch)) return { vol: 'dc', book: 'dc', ch: String(ch), deckKey: `dc/dc/${ch}` };
      }
    }

    // 3. Slash format (bom/1-ne/1/4 or 1-ne/1/4 or bom/1-ne/1)
    if (base.includes('/')) {
      const parts = base.split('/');
      if (parts.length >= 3) {
        const vol = normalizeVolume(parts[0]);
        const book = parts[1].toLowerCase();
        const ch = parts[2];
        return { vol, book, ch, deckKey: `${vol}/${book}/${ch}` };
      }
    }

    // 4. Hyphen format (bom-1-ne-1)
    if (base.includes('-')) {
      const parts = base.split('-');
      if (parts.length >= 3) {
        const vol = normalizeVolume(parts[0]);
        const book = parts.slice(1, -1).join('-').toLowerCase();
        const ch = parts[parts.length - 1];
        return { vol, book, ch, deckKey: `${vol}/${book}/${ch}` };
      }
    }

    return null;
  }

  function getCardChapterInfo(card) {
    if (!card) return { vol: 'bom', book: 'general', ch: null, deckKey: 'general' };

    // 1. Direct reference_id check
    if (card.reference_id) {
      const parsed = parseReferenceString(card.reference_id);
      if (parsed) return parsed;
    }

    // 2. Tags check (strictly matching chapter)
    const tags = Array.isArray(card.tags) ? card.tags : [];
    for (const t of tags) {
      const parsed = parseReferenceString(t);
      if (parsed) return parsed;
    }

    // 3. Fallback: If only book tag exists without a chapter, do NOT assign to Chapter 1!
    for (const t of tags) {
      if (typeof t === 'string' && BOOK_NAMES[t]) {
        const vol = BOOK_TO_VOLUME[t] || 'bom';
        return { vol, book: t, ch: null, deckKey: `${vol}/${t}` };
      }
    }

    return { vol: 'bom', book: 'general', ch: null, deckKey: 'general' };
  }

  function cardMatchesChapter(card, targetVol, targetBook, targetCh) {
    if (!card) return false;
    const info = getCardChapterInfo(card);
    if (!info || !info.ch) return false; // Strictly requires a valid chapter!
    const nTargetVol = normalizeVolume(targetVol);
    const nTargetBook = String(targetBook || '').toLowerCase();
    const nTargetCh = String(targetCh || '');
    return info.vol === nTargetVol && info.book === nTargetBook && String(info.ch) === nTargetCh;
  }

  function cardMatchesDeck(card, deckKey) {
    if (!deckKey) return false;
    const normKey = normalizeDeckKey(deckKey);
    if (normKey === 'all') return true;
    const parts = normKey.split('/');
    if (parts.length >= 3) {
      return cardMatchesChapter(card, parts[0], parts[1], parts[2]);
    }
    return false;
  }

  function formatDeckName(info, manifestOrCorpus = null) {
    if (!info) return '';
    const vol = normalizeVolume(info.vol);
    const book = info.book;
    const ch = info.ch;

    // General Conference
    if (vol === 'gc') {
      const manifest = manifestOrCorpus || (typeof corpusData !== 'undefined' ? corpusData : null) || window.POLYGLOT_MANIFEST || null;
      const talkData = manifest?.general_conference?.[book]?.[ch];
      if (talkData?.title) {
        const rawTitle = typeof talkData.title === 'string' ? talkData.title : (talkData.title.eng || Object.values(talkData.title)[0] || ch);
        const clean = String(rawTitle).replace(/<[^>]+>/g, '').trim();
        if (clean) return clean;
      }
      const titleFromSlug = ch
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      return titleFromSlug || ch;
    }

    // D&C
    if (vol === 'dc' || book === 'dc') {
      return `Doctrine and Covenants ${ch}`;
    }

    // Scriptures
    const bookName = BOOK_NAMES[book] || book;
    return `${bookName} ${ch}`;
  }

  const DEMO_FLASHCARDS = [
    {
      id: 'demo-card-1',
      source_lang: 'jpn',
      source_text: '悔い改め',
      reference_id: 'bom/1-ne/1/4',
      tags: ['bom/1-ne/1', '1-ne'],
      target_translations: {
        reading: '<ruby>悔<rt>く</rt></ruby>い<ruby>改<rt>あらた</rt></ruby>め',
        definitions: {
          eng: 'repentance, to repent',
          spa: 'arrepentirse, arrepentimiento',
          jpn: '<ruby>悔<rt>く</rt></ruby>い<ruby>改<rt>あらた</rt></ruby>め (くいあらため)',
          zhs: '<ruby>悔<rt>huǐ</rt></ruby><ruby>改<rt>gǎi</rt></ruby>',
          fra: 'se repentir, repentir'
        }
      }
    },
    {
      id: 'demo-card-2',
      source_lang: 'zhs',
      source_text: '永生',
      reference_id: 'bom/2-ne/2/25',
      tags: ['bom/2-ne/2', '2-ne'],
      target_translations: {
        reading: '<ruby>永<rt>yǒng</rt></ruby><ruby>生<rt>shēng</rt></ruby>',
        definitions: {
          eng: 'eternal life',
          spa: 'vida eterna',
          jpn: '<ruby>永<rt>えい</rt></ruby><ruby>遠<rt>えん</rt></ruby>の<ruby>命<rt>いのち</rt></ruby>',
          zhs: '<ruby>永<rt>yǒng</rt></ruby><ruby>生<rt>shēng</rt></ruby>',
          fra: 'vie éternelle'
        }
      }
    },
    {
      id: 'demo-card-3',
      source_lang: 'spa',
      source_text: 'esperanza',
      reference_id: 'bom/alma/32/21',
      tags: ['bom/alma/32', 'alma'],
      target_translations: {
        reading: '',
        definitions: {
          eng: 'hope',
          spa: 'esperanza',
          jpn: '<ruby>希<rt>き</rt></ruby><ruby>望<rt>ぼう</rt></ruby>',
          zhs: '<ruby>指<rt>zhǐ</rt></ruby><ruby>望<rt>wàng</rt></ruby>',
          fra: 'espérance'
        }
      }
    },
    {
      id: 'demo-card-4',
      source_lang: 'fra',
      source_text: 'foi',
      reference_id: 'bom/alma/32/21',
      tags: ['bom/alma/32', 'alma'],
      target_translations: {
        reading: '',
        definitions: {
          eng: 'faith',
          spa: 'fe',
          jpn: '<ruby>信<rt>しん</rt></ruby><ruby>仰<rt>こう</rt></ruby>',
          zhs: '<ruby>信<rt>xìn</rt></ruby><ruby>心<rt>xīn</rt></ruby>',
          fra: 'foi'
        }
      }
    },
    {
      id: 'demo-card-5',
      source_lang: 'eng',
      source_text: 'peacemaker',
      reference_id: 'gc/2023-10/peacemakers-needed/1',
      tags: ['gc/2023-10/peacemakers-needed', 'gc-2023-10-peacemakers-needed'],
      target_translations: {
        reading: '',
        definitions: {
          eng: 'peacemaker',
          spa: 'pacificador',
          jpn: '<ruby>平<rt>へい</rt></ruby><ruby>和<rt>わ</rt></ruby>を<ruby>作<rt>つく</rt></ruby>る<ruby>人<rt>ひと</rt></ruby>',
          zhs: '<ruby>使<rt>shǐ</rt></ruby><ruby>人<rt>rén</rt></ruby><ruby>和<rt>hé</rt></ruby><ruby>睦<rt>mù</rt></ruby><ruby>的<rt>de</rt></ruby><ruby>人<rt>rén</rt></ruby>',
          fra: 'artisan de paix'
        }
      }
    }
  ];

  window.POLYGLOT = {
    ALL_LANGUAGES,
    DEFAULT_LANGUAGES,
    STORAGE_KEY_LANGS,
    VOLUME_NAMES,
    BOOK_NAMES,
    BOOK_TO_VOLUME,
    DEMO_FLASHCARDS,
    normalizeVolume,
    normalizeDeckKey,
    parseDeckKey,
    getCardChapterInfo,
    cardMatchesChapter,
    cardMatchesDeck,
    formatDeckName
  };
  window.DEMO_FLASHCARDS = DEMO_FLASHCARDS;
})();

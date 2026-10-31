/* RTA Dubai Theory Practice — unofficial local trainer + vocab */
(function () {
  'use strict';

  const LETTERS = 'ABCDEFGH';
  const LS_KNOWN = 'rta-vocab-known-v1';
  const LS_LEARN = 'rta-vocab-learning-v1';
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  let DATA = null;
  let GLOSSARY = {}; // lowercased EN → RU
  let PHRASE_LIST = []; // longest-first phrases for matching
  let WORD_SET = new Set();
  let known = new Set();
  let learning = new Set();
  let glossCurrent = null; // {term, ru}
  let vocabTab = 'learning';
  let flashQueue = [];
  let flashIdx = 0;
  let flashRevealed = false;

  let state = {
    mode: null, // 'exam' | 'practice'
    queue: [],
    index: 0,
    answers: [],
    startedAt: 0,
    endsAt: 0,
    timerId: null,
    topicId: null,
  };

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function show(id) {
    $$('.screen').forEach((s) => s.classList.add('hidden'));
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function loadVocab() {
    try {
      known = new Set(JSON.parse(localStorage.getItem(LS_KNOWN) || '[]'));
      learning = new Set(JSON.parse(localStorage.getItem(LS_LEARN) || '[]'));
    } catch (_) {
      known = new Set();
      learning = new Set();
    }
  }

  function saveVocab() {
    try {
      localStorage.setItem(LS_KNOWN, JSON.stringify([...known]));
      localStorage.setItem(LS_LEARN, JSON.stringify([...learning]));
    } catch (_) {}
    updateVocabBadge();
  }

  function markKnown(term) {
    const t = String(term).toLowerCase();
    known.add(t);
    learning.delete(t);
    saveVocab();
  }

  function markLearning(term) {
    const t = String(term).toLowerCase();
    learning.add(t);
    known.delete(t);
    saveVocab();
  }

  function updateVocabBadge() {
    const el = $('#vocab-badge');
    if (el) el.textContent = String(learning.size + known.size);
  }

  function prepareQuestion(q, shuffleOpts) {
    const opts = q.opts.map((o, i) => ({ ...o, _orig: i }));
    const ordered = shuffleOpts ? shuffle(opts) : opts;
    const correctIdx = ordered.findIndex((o) => o.c);
    return { q, opts: ordered, correctIdx, answered: false, chosenIdx: null };
  }

  function startExam() {
    stopTimer();
    const n = DATA.meta.rules.questions;
    const mins = DATA.meta.rules.minutes;
    const picked = shuffle(DATA.questions).slice(0, n);
    state.mode = 'exam';
    state.topicId = null;
    state.queue = picked.map((q) => prepareQuestion(q, true));
    state.index = 0;
    state.answers = [];
    state.startedAt = Date.now();
    state.endsAt = state.startedAt + mins * 60 * 1000;
    show('screen-quiz');
    renderQuestion();
    state.timerId = setInterval(tickTimer, 250);
    tickTimer();
  }

  function startPractice(topicId) {
    stopTimer();
    let pool = DATA.questions;
    if (topicId && topicId !== 'all') {
      pool = pool.filter((q) => q.topic === topicId);
    }
    if (!pool.length) {
      alert('В этой теме нет вопросов.');
      return;
    }
    state.mode = 'practice';
    state.topicId = topicId || 'all';
    state.queue = shuffle(pool).map((q) => prepareQuestion(q, true));
    state.index = 0;
    state.answers = [];
    state.startedAt = Date.now();
    state.endsAt = 0;
    show('screen-quiz');
    renderQuestion();
    const timerEl = $('#quiz-timer');
    timerEl.textContent = 'Практика';
    timerEl.className = 'timer';
  }

  function tickTimer() {
    if (state.mode !== 'exam') return;
    const left = state.endsAt - Date.now();
    const timerEl = $('#quiz-timer');
    timerEl.textContent = fmtTime(left);
    timerEl.className = 'timer' + (left < 60_000 ? ' danger' : left < 5 * 60_000 ? ' warn' : '');
    if (left <= 0) {
      stopTimer();
      finishQuiz(true);
    }
  }

  function current() {
    return state.queue[state.index];
  }

  /** Find glossary hits in text; returns [{start,end,term,ru}] non-overlapping, longest-first */
  function findHits(text) {
    const lower = text.toLowerCase();
    const taken = new Array(text.length).fill(false);
    const hits = [];

    function tryMatch(term) {
      const t = term.toLowerCase();
      let from = 0;
      while (from < lower.length) {
        const i = lower.indexOf(t, from);
        if (i < 0) break;
        const end = i + t.length;
        // word boundary for single words; phrases already have spaces
        const leftOk = i === 0 || !/[A-Za-z]/.test(lower[i - 1]);
        const rightOk = end >= lower.length || !/[A-Za-z]/.test(lower[end]);
        let free = true;
        for (let k = i; k < end; k++) if (taken[k]) { free = false; break; }
        if (leftOk && rightOk && free) {
          for (let k = i; k < end; k++) taken[k] = true;
          hits.push({ start: i, end, term: t, ru: GLOSSARY[t] });
        }
        from = i + 1;
      }
    }

    for (const p of PHRASE_LIST) tryMatch(p);
    for (const w of WORD_SET) tryMatch(w);

    hits.sort((a, b) => a.start - b.start);
    return hits;
  }

  /** Key terms for a question (for post-answer chips) */
  function keyTermsFor(item) {
    const texts = [item.q.q, ...item.opts.map((o) => o.t)];
    const seen = new Map();
    texts.forEach((t) => {
      findHits(t).forEach((h) => {
        if (!seen.has(h.term)) seen.set(h.term, h.ru);
      });
    });
    // Prefer learning + unknown; limit chips
    const all = [...seen.entries()].map(([term, ru]) => ({ term, ru }));
    all.sort((a, b) => {
      const rank = (t) => (learning.has(t) ? 0 : known.has(t) ? 2 : 1);
      return rank(a.term) - rank(b.term) || b.term.length - a.term.length;
    });
    return all.slice(0, 8);
  }

  function renderTappable(text, allowTap) {
    const hits = allowTap ? findHits(text) : [];
    // Filter: known words are plain (not tappable)
    const active = hits.filter((h) => !known.has(h.term));
    if (!active.length) {
      const span = document.createElement('span');
      span.textContent = text;
      return span;
    }
    const frag = document.createDocumentFragment();
    let pos = 0;
    active.forEach((h) => {
      if (h.start > pos) {
        frag.appendChild(document.createTextNode(text.slice(pos, h.start)));
      }
      const s = document.createElement('span');
      s.className = 'tap-word';
      s.dataset.term = h.term;
      s.textContent = text.slice(h.start, h.end);
      s.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openGloss(h.term, h.ru);
      });
      frag.appendChild(s);
      pos = h.end;
    });
    if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
    return frag;
  }

  function openGloss(term, ru) {
    glossCurrent = { term, ru };
    $('#gloss-term').textContent = term;
    $('#gloss-ru').textContent = ru || '—';
    $('#gloss-pop').classList.remove('hidden');
  }

  function closeGloss() {
    $('#gloss-pop').classList.add('hidden');
    glossCurrent = null;
    // Re-render current question text so known words lose underline
    const item = current();
    if (item && !$('#screen-quiz').classList.contains('hidden')) {
      refreshTaps(item);
      if (item.answered) renderTermChips(item);
    }
  }

  function refreshTaps(item) {
    const qEl = $('#q-text');
    qEl.innerHTML = '';
    qEl.appendChild(renderTappable(item.q.q, true));

    $$('#opts .opt').forEach((btn, idx) => {
      const enText = btn.querySelector('.en-text');
      if (!enText || !item.opts[idx]) return;
      enText.innerHTML = '';
      enText.appendChild(renderTappable(item.opts[idx].t, true));
    });
  }

  function renderTermChips(item) {
    const wrap = $('#term-mark');
    const chips = $('#term-chips');
    const terms = keyTermsFor(item);
    chips.innerHTML = '';
    if (!terms.length) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    terms.forEach(({ term, ru }) => {
      const div = document.createElement('div');
      const isK = known.has(term);
      const isL = learning.has(term);
      div.className = 'term-chip' + (isK ? ' known' : isL ? ' learning' : '');
      div.innerHTML =
        `<span class="tw"></span><span class="tr"></span>` +
        `<div class="acts"><button type="button" class="y">Знаю</button>` +
        `<button type="button" class="n">Не знаю</button></div>`;
      div.querySelector('.tw').textContent = term;
      div.querySelector('.tr').textContent = ru || '';
      div.querySelector('.y').addEventListener('click', () => {
        markKnown(term);
        renderTermChips(item);
        refreshTaps(item);
      });
      div.querySelector('.n').addEventListener('click', () => {
        markLearning(term);
        renderTermChips(item);
        refreshTaps(item);
      });
      chips.appendChild(div);
    });
  }

  function renderQuestion() {
    const item = current();
    if (!item) {
      finishQuiz(false);
      return;
    }
    const total = state.queue.length;
    const num = state.index + 1;
    const pct = ((num - 1) / total) * 100;
    $('#progress-fill').style.width = pct + '%';
    $('#progress-label').textContent =
      state.mode === 'exam'
        ? `Вопрос ${num} из ${total}`
        : `Вопрос ${num} из ${total}` + (state.topicId && state.topicId !== 'all' ? ` · тема` : '');

    const q = item.q;
    $('#q-num').textContent =
      (state.mode === 'exam' ? 'Экзамен' : 'Практика') + ` · #${q.id}`;

    const qEl = $('#q-text');
    qEl.innerHTML = '';
    qEl.appendChild(renderTappable(q.q, true));

    const imgWrap = $('#q-img-wrap');
    imgWrap.innerHTML = '';
    if (q.img) {
      const srcs = Array.isArray(q.img) ? q.img : [q.img];
      srcs.forEach((src) => {
        const im = document.createElement('img');
        im.className = 'q-img';
        im.alt = 'Illustration';
        im.src = src;
        im.loading = 'lazy';
        imgWrap.appendChild(im);
      });
    }

    const optsEl = $('#opts');
    optsEl.innerHTML = '';
    item.opts.forEach((o, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt';
      btn.dataset.idx = String(idx);
      btn.innerHTML =
        `<span class="en"><span class="letter">${LETTERS[idx]}</span><span class="en-text"></span></span>` +
        `<span class="ru"></span>`;
      btn.querySelector('.en-text').appendChild(renderTappable(o.t, true));
      btn.querySelector('.ru').textContent = o.tr || '';
      if (!item.answered) {
        btn.addEventListener('click', (e) => {
          // Ignore if tap was on a gloss word
          if (e.target.closest && e.target.closest('.tap-word')) return;
          onPick(idx);
        });
      }
      optsEl.appendChild(btn);
    });

    const fb = $('#feedback');
    fb.className = 'feedback';
    fb.textContent = '';
    const ru = $('#ru-block');
    ru.className = 'ru-block';
    $('#ru-q').textContent = '';
    $('#term-mark').classList.add('hidden');
    $('#term-chips').innerHTML = '';

    const nextBtn = $('#btn-next');
    nextBtn.classList.add('hidden');
    nextBtn.textContent = num >= total ? 'Завершить' : 'Далее';

    if (item.answered) {
      reveal(item, false);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onPick(idx) {
    const item = current();
    if (!item || item.answered) return;
    item.answered = true;
    item.chosenIdx = idx;
    const ok = idx === item.correctIdx;
    state.answers.push({
      qid: item.q.id,
      chosenIdx: idx,
      correctIdx: item.correctIdx,
      ok,
      opts: item.opts,
      q: item.q,
    });
    reveal(item, true);
  }

  function reveal(item, animate) {
    const opts = $$('#opts .opt');
    opts.forEach((btn, idx) => {
      btn.classList.add('revealed');
      btn.disabled = true;
      if (idx === item.correctIdx) btn.classList.add('correct');
      if (item.chosenIdx === idx && idx !== item.correctIdx) btn.classList.add('wrong');
      if (idx !== item.correctIdx && idx !== item.chosenIdx) btn.classList.add('dim');
      if (item.chosenIdx === idx) btn.classList.add('selected');
    });

    const ok = item.chosenIdx === item.correctIdx;
    const fb = $('#feedback');
    fb.className = 'feedback show ' + (ok ? 'ok' : 'no');
    fb.textContent = ok ? '✓ Верно' : '✗ Неверно';

    const ru = $('#ru-block');
    ru.className = 'ru-block show';
    $('#ru-q').textContent = item.q.qr || '';

    renderTermChips(item);

    $('#btn-next').classList.remove('hidden');
    if (animate) {
      // slight pause feel
    }
  }

  function nextQuestion() {
    if (state.index >= state.queue.length - 1) {
      finishQuiz(false);
      return;
    }
    state.index += 1;
    renderQuestion();
  }

  function finishQuiz(timeUp) {
    stopTimer();
    const total = state.queue.length;
    while (state.answers.length < total && state.mode === 'exam' && timeUp) {
      const i = state.answers.length;
      const item = state.queue[i];
      state.answers.push({
        qid: item.q.id,
        chosenIdx: null,
        correctIdx: item.correctIdx,
        ok: false,
        opts: item.opts,
        q: item.q,
        skipped: true,
      });
    }
    const answered = state.answers;
    const correct = answered.filter((a) => a.ok).length;
    const passMark = DATA.meta.rules.pass;
    const isExam = state.mode === 'exam';
    const passed = isExam ? correct >= passMark : null;

    show('screen-result');
    const big = $('#result-big');
    big.textContent = `${correct} / ${answered.length || total}`;
    const verdict = $('#result-verdict');
    if (isExam) {
      verdict.textContent = passed ? 'СДАНО' : 'НЕ СДАНО';
      verdict.className = 'verdict ' + (passed ? 'pass' : 'fail');
      $('#result-sub').textContent =
        (timeUp ? 'Время вышло. ' : '') +
        `Нужно минимум ${passMark} из ${DATA.meta.rules.questions}. Ошибок: ${answered.length - correct}.`;
    } else {
      verdict.textContent = 'Практика завершена';
      verdict.className = 'verdict';
      $('#result-sub').textContent = `Правильных: ${correct} из ${answered.length}.`;
    }

    const wrong = answered.filter((a) => !a.ok);
    const list = $('#wrong-list');
    list.innerHTML = '';
    if (!wrong.length) {
      list.innerHTML = '<p class="note">Ошибок нет — отлично.</p>';
    } else {
      wrong.forEach((a, i) => {
        const div = document.createElement('div');
        div.className = 'wrong-item';
        const yours =
          a.chosenIdx == null
            ? '— (пропущен)'
            : a.opts[a.chosenIdx].t;
        const yoursRu =
          a.chosenIdx == null ? '' : a.opts[a.chosenIdx].tr || '';
        const right = a.opts[a.correctIdx].t;
        const rightRu = a.opts[a.correctIdx].tr || '';
        div.innerHTML =
          `<div class="wq">${i + 1}. ${escapeHtml(a.q.q)}</div>` +
          `<div class="wru">${escapeHtml(a.q.qr || '')}</div>` +
          `<div class="wa"><div class="yours">Ваш ответ: ${escapeHtml(yours)}${yoursRu ? ' · ' + escapeHtml(yoursRu) : ''}</div>` +
          `<div class="right">Верно: ${escapeHtml(right)}${rightRu ? ' · ' + escapeHtml(rightRu) : ''}</div></div>`;
        list.appendChild(div);
      });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderHome() {
    const m = DATA.meta;
    $('#home-count').textContent = `${m.count} вопросов в банке`;
    $('#rule-q').textContent = m.rules.questions;
    $('#rule-pass').textContent = m.rules.pass;
    $('#rule-min').textContent = m.rules.minutes;
    $('#rule-bank').textContent = m.count;
    updateVocabBadge();
  }

  function renderTopics() {
    const list = $('#topic-list');
    list.innerHTML = '';
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'topic-btn';
    all.innerHTML = `<span>Все темы (случайно)</span><span class="n">${DATA.meta.count}</span>`;
    all.addEventListener('click', () => startPractice('all'));
    list.appendChild(all);
    DATA.meta.topics.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'topic-btn';
      b.innerHTML = `<span>${escapeHtml(t.ru)}</span><span class="n">${t.n}</span>`;
      b.addEventListener('click', () => startPractice(t.id));
      list.appendChild(b);
    });
  }

  function renderVocabScreen() {
    const totalGloss = Object.keys(GLOSSARY).length;
    const stats = $('#vocab-stats');
    stats.innerHTML =
      `<div class="vocab-stat"><b>${known.size}</b><span>знаю</span></div>` +
      `<div class="vocab-stat"><b>${learning.size}</b><span>учу</span></div>` +
      `<div class="vocab-stat"><b>${totalGloss}</b><span>в глоссарии</span></div>`;

    $$('.vocab-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === vocabTab);
    });

    const list = $('#vocab-list');
    list.innerHTML = '';
    const terms = vocabTab === 'known' ? [...known] : [...learning];
    terms.sort();
    if (!terms.length) {
      list.innerHTML =
        '<p class="note">' +
        (vocabTab === 'known'
          ? 'Пока нет известных слов. Отмечайте «Знаю» после ответа или в карточке перевода.'
          : 'Пока пусто. Тапайте слова в вопросах и жмите «Не знаю», либо отмечайте чипы после ответа.') +
        '</p>';
      return;
    }
    terms.forEach((term) => {
      const ru = GLOSSARY[term] || '—';
      const div = document.createElement('div');
      div.className = 'vocab-item';
      div.innerHTML =
        `<div><div class="en"></div><div class="ru"></div></div>` +
        `<div class="meta"><button type="button"></button></div>`;
      div.querySelector('.en').textContent = term;
      div.querySelector('.ru').textContent = ru;
      const btn = div.querySelector('button');
      if (vocabTab === 'known') {
        btn.textContent = '→ Учу';
        btn.addEventListener('click', () => {
          markLearning(term);
          renderVocabScreen();
        });
      } else {
        btn.textContent = '✓ Знаю';
        btn.addEventListener('click', () => {
          markKnown(term);
          renderVocabScreen();
        });
      }
      list.appendChild(div);
    });
  }

  function startFlashcards() {
    flashQueue = [...learning].filter((t) => GLOSSARY[t]);
    if (!flashQueue.length) {
      // fallback: sample unknown from glossary
      const pool = Object.keys(GLOSSARY).filter((t) => !known.has(t) && t.indexOf(' ') === -1);
      flashQueue = shuffle(pool).slice(0, 30);
    } else {
      flashQueue = shuffle(flashQueue);
    }
    if (!flashQueue.length) {
      alert('Нет слов для карточек. Отметьте «Не знаю» в вопросах.');
      return;
    }
    flashIdx = 0;
    flashRevealed = false;
    show('screen-flash');
    renderFlash();
  }

  function renderFlash() {
    if (flashIdx >= flashQueue.length) {
      alert('Карточки закончились.');
      show('screen-vocab');
      renderVocabScreen();
      return;
    }
    const term = flashQueue[flashIdx];
    $('#flash-en').textContent = term;
    $('#flash-ru').textContent = GLOSSARY[term] || '—';
    $('#flash-ru').classList.toggle('hidden', !flashRevealed);
    $('#flash-hint').textContent = flashRevealed
      ? 'Отметьте: знаете или ещё учите'
      : 'Тапните карточку, чтобы увидеть перевод';
    $('#flash-progress').textContent = `${flashIdx + 1} / ${flashQueue.length}`;
  }

  function bind() {
    $('#btn-exam').addEventListener('click', startExam);
    $('#btn-practice').addEventListener('click', () => {
      renderTopics();
      show('screen-topics');
    });
    $('#btn-topics-back').addEventListener('click', () => show('screen-home'));
    $('#btn-next').addEventListener('click', nextQuestion);
    $('#btn-quit').addEventListener('click', () => {
      if (confirm('Выйти из сессии? Прогресс этой попытки не сохранится.')) {
        stopTimer();
        show('screen-home');
      }
    });
    $('#btn-again').addEventListener('click', () => {
      if (state.mode === 'exam') startExam();
      else startPractice(state.topicId || 'all');
    });
    $('#btn-home').addEventListener('click', () => show('screen-home'));

    $('#btn-vocab').addEventListener('click', () => {
      show('screen-vocab');
      renderVocabScreen();
    });
    $('#btn-vocab-back').addEventListener('click', () => show('screen-home'));
    $$('.vocab-tab').forEach((t) => {
      t.addEventListener('click', () => {
        vocabTab = t.dataset.tab;
        renderVocabScreen();
      });
    });
    $('#btn-flashcards').addEventListener('click', startFlashcards);
    $('#btn-flash-back').addEventListener('click', () => {
      show('screen-vocab');
      renderVocabScreen();
    });
    $('#flash-card').addEventListener('click', () => {
      flashRevealed = true;
      renderFlash();
    });
    $('#btn-flash-yes').addEventListener('click', () => {
      const term = flashQueue[flashIdx];
      if (term) markKnown(term);
      flashIdx += 1;
      flashRevealed = false;
      renderFlash();
    });
    $('#btn-flash-no').addEventListener('click', () => {
      const term = flashQueue[flashIdx];
      if (term) markLearning(term);
      flashIdx += 1;
      flashRevealed = false;
      renderFlash();
    });

    $('#gloss-close').addEventListener('click', closeGloss);
    $('#gloss-pop').addEventListener('click', (e) => {
      if (e.target === $('#gloss-pop')) closeGloss();
    });
    $('#gloss-yes').addEventListener('click', () => {
      if (glossCurrent) markKnown(glossCurrent.term);
      closeGloss();
    });
    $('#gloss-no').addEventListener('click', () => {
      if (glossCurrent) markLearning(glossCurrent.term);
      closeGloss();
    });
  }

  function indexGlossary(raw) {
    GLOSSARY = {};
    Object.keys(raw).forEach((k) => {
      GLOSSARY[String(k).toLowerCase()] = raw[k];
    });
    const keys = Object.keys(GLOSSARY);
    PHRASE_LIST = keys
      .filter((k) => k.indexOf(' ') >= 0 || k.indexOf('-') >= 0)
      .sort((a, b) => b.length - a.length);
    WORD_SET = new Set(keys.filter((k) => k.indexOf(' ') < 0));
  }

  async function boot() {
    loadVocab();
    try {
      const [qRes, gRes] = await Promise.all([
        fetch('questions.json', { cache: 'no-store' }),
        fetch('glossary.json', { cache: 'no-store' }),
      ]);
      if (!qRes.ok) throw new Error('HTTP ' + qRes.status);
      DATA = await qRes.json();
      if (gRes.ok) {
        indexGlossary(await gRes.json());
      } else {
        indexGlossary({});
      }
    } catch (e) {
      document.body.innerHTML =
        '<div class="app"><div class="card"><h2>Не удалось загрузить вопросы</h2><p>' +
        escapeHtml(String(e)) +
        '</p></div></div>';
      return;
    }
    bind();
    renderHome();
    show('screen-home');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  boot();
})();

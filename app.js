/* RTA Dubai Theory Practice — unofficial local trainer */
(function () {
  'use strict';

  const LETTERS = 'ABCDEFGH';
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  let DATA = null;
  let state = {
    mode: null, // 'exam' | 'practice'
    queue: [],
    index: 0,
    answers: [], // {qid, chosenIdx, correctIdx, ok, opts}
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
    $('#q-text').textContent = q.q;

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
      btn.querySelector('.en-text').textContent = o.t;
      btn.querySelector('.ru').textContent = o.tr || '';
      if (!item.answered) {
        btn.addEventListener('click', () => onPick(idx));
      }
      optsEl.appendChild(btn);
    });

    const fb = $('#feedback');
    fb.className = 'feedback';
    fb.textContent = '';
    const ru = $('#ru-block');
    ru.className = 'ru-block';
    $('#ru-q').textContent = '';

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
    // auto-mark unanswered as wrong for exam timeout
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
  }

  async function boot() {
    try {
      const res = await fetch('questions.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      DATA = await res.json();
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

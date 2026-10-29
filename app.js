'use strict';
(() => {
  const $ = sel => document.querySelector(sel);
  const G = Guzheng;
  const board = $('#board');
  const panel = $('#panel');

  // ---------- 儲存 ----------
  function load(key, def) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ? Object.assign(def, v) : def;
    } catch (e) { return def; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  const settings = load('guzheng.settings.v1', {
    key: 'D', format: 'jianpu', labels: 'jianpu', letter: false, press: false,
    scale: { range: 'all', dir: 'up', press: false, bpm: 80 },
  });
  const stats = load('guzheng.stats.v1', {});
  const saveSettings = () => save('guzheng.settings.v1', settings);
  const saveStats = () => save('guzheng.stats.v1', stats);

  let strings = G.buildStrings(settings.key);
  let mode = 'board';

  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  // ---------- 記法 ----------
  const octName = o => G.OCTAVE_NAMES[o];
  // 唱名有兩種用法：
  // - sol：簡譜用首調，1 = Do（D 調的 5 = Sol）
  // - fixedSol：和音名對照時用固定唱名，C = Do（D 調的 A = La）
  const sol = d => G.SOLFEGE[d];
  const fixedSol = d => G.solfege(settings.key, d);
  const fullName = (degree, octave) => `${octName(octave)} ${degree}（${sol(degree)}）`;

  // 文字加上高低音點（上方點 = 高八度，下方點 = 低八度）
  function markHTML(text, octave, cls) {
    const dots = n => '<span class="d">•</span>'.repeat(n);
    return `<span class="jp ${cls || ''}">${octave > 0 ? dots(octave) : ''}<span>${text}</span>${octave < 0 ? dots(-octave) : ''}</span>`;
  }

  function promptHTML(degree, octave, fmt) {
    const body = fmt === 'solfege'
      ? `<span class="sol">${sol(degree)}</span>`
      : markHTML(degree, octave, 'jp');
    return `<span class="oct">${octName(octave)}</span>${body}`;
  }

  const pickFormat = () => settings.format === 'mixed'
    ? (Math.random() < 0.5 ? 'jianpu' : 'solfege')
    : settings.format;

  // ---------- 弦圖 ----------
  function labelHTML(s, labels) {
    const parts = [];
    const press = G.PRESS[s.degree];
    if (settings.press && press) parts.push(`<span class="press">按→${press.degree}</span>`);
    if (settings.letter) parts.push(`<span class="letter">${G.letter(s.midi)}</span>`);
    if (labels === 'tune') return markHTML(s.degree, s.octave) + `<span class="nn">${G.noteName(settings.key, s.degree)}</span>`;
    if (labels === 'jianpu' || labels === 'both') parts.push(markHTML(s.degree, s.octave));
    if (labels === 'solfege') parts.push(markHTML(sol(s.degree), s.octave, 'sol'));
    if (labels === 'both') parts.push(`<span class="sol">${sol(s.degree)}</span>`);
    return parts.join('');
  }

  // 低音弦（第 21 弦）在上、高音弦（第 1 弦）在下，由下往上音越低：6 5 3 2 1
  function renderBoard(labels) {
    board.innerHTML = strings.map(s => {
      const thick = (3.2 - s.idx * 0.1).toFixed(2);
      const bridge = (14 + s.idx * 3).toFixed(1);
      return `<div class="string${s.green ? ' green' : ''}" data-idx="${s.idx}" style="--thick:${thick}px;--bridge:${bridge}%">`
        + `<span class="num">${s.num}</span><span class="wire"><i class="bridge"></i></span>`
        + `<span class="label">${labelHTML(s, labels || settings.labels)}</span></div>`;
    }).join('');
  }

  const rowEl = idx => board.querySelector(`.string[data-idx="${idx}"]`);
  function mark(idx, ...cls) { const r = rowEl(idx); if (r) r.classList.add(...cls); }
  function clearMarks() {
    board.querySelectorAll('.string').forEach(r =>
      r.classList.remove('ok', 'bad', 'answer', 'target', 'play', 'pressing', 'reveal', 'flash'));
  }
  function flash(idx) {
    const r = rowEl(idx);
    if (!r) return;
    r.classList.add('flash');
    setTimeout(() => r.classList.remove('flash'), 180);
  }

  // ---------- 成績 ----------
  function bucket(m, key, fmt) {
    const a = stats[m] || (stats[m] = {});
    const b = a[key] || (a[key] = {});
    return b[fmt] || (b[fmt] = {});
  }
  function record(m, key, fmt, item, ok, ms) {
    const b = bucket(m, key, fmt);
    const r = b[item] || (b[item] = { n: 0, ok: 0, ms: 0 });
    r.n++;
    if (ok) r.ok++;
    r.ms += Math.min(ms, 15000);
    saveStats();
  }
  // 弱點加強：錯越多、反應越慢的題目越常出現
  function pickWeighted(m, key, fmt, items, avoid) {
    const b = bucket(m, key, fmt);
    const pool = items.filter(i => i !== avoid);
    const weights = pool.map(i => {
      const r = b[i];
      if (!r || !r.n) return 3;
      return 1 + 6 * (1 - r.ok / r.n) + Math.min(2, r.ms / r.n / 3000);
    });
    let x = Math.random() * weights.reduce((a, w) => a + w, 0);
    for (let i = 0; i < pool.length; i++) {
      x -= weights[i];
      if (x <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  const session = { n: 0, ok: 0, streak: 0 };
  function resetSession() { session.n = 0; session.ok = 0; session.streak = 0; }
  function score(ok) {
    session.n++;
    if (ok) { session.ok++; session.streak++; } else session.streak = 0;
    renderStatus();
  }
  function renderStatus() {
    const el = $('#status');
    if (el) el.innerHTML = `<span>答對 <b>${session.ok}</b> / ${session.n}</span><span>連續答對 <b>${session.streak}</b></span>`;
  }
  function feedback(cls, text) {
    const el = $('#feedback');
    if (el) { el.className = 'feedback ' + cls; el.textContent = text; }
  }

  // ---------- 各模式 ----------
  const q = {};

  const modes = {
    board: {
      enter() {
        const k = G.keyInfo(settings.key);
        const tonic = strings.find(s => s.degree === 1);
        panel.innerHTML = `<div class="info">${k.name}：1（Do）= <b>${G.noteName(settings.key, 1)}</b>　點弦可以聽音<br>`
          + `3 弦按小二度得 <b>4 Fa</b>，6 弦按大二度得 <b>7 Si</b></div>`
          + `<div id="tapInfo" class="prompt"></div>`;
        renderBoard();
      },
      tap(s) {
        Sound.play(s.midi);
        flash(s.idx);
        $('#tapInfo').innerHTML = `<span class="oct">第 ${s.num} 弦 · ${octName(s.octave)}</span>`
          + markHTML(s.degree, s.octave, 'jp') + `<span class="sol">${sol(s.degree)}</span>`
          + `<span class="oct">${G.letter(s.midi)}</span>`;
      },
    },

    find: {
      enter() {
        resetSession();
        renderBoard('both');
        board.classList.add('hide-labels');
        // 提示文字和對錯回饋共用同一行，讓弦有更多空間
        panel.innerHTML = '<div id="status" class="status"></div>'
          + '<div id="prompt" class="prompt"></div><div id="feedback" class="feedback"></div>';
        renderStatus();
        q.target = null;
        this.next();
      },
      next() {
        clearMarks();
        q.fmt = pickFormat();
        q.target = pickWeighted('find', settings.key, q.fmt, strings.map(s => s.idx), q.target);
        q.start = performance.now();
        q.locked = false;
        const t = strings[q.target];
        $('#prompt').innerHTML = promptHTML(t.degree, t.octave, q.fmt);
        feedback('hint', '找出這個音在哪一條弦，按住可滑動調整，放開才算');
      },
      tap(s) {
        if (q.locked) return;
        q.locked = true;
        const t = strings[q.target];
        const ok = s.idx === t.idx;
        record('find', settings.key, q.fmt, t.idx, ok, performance.now() - q.start);
        score(ok);
        Sound.play(s.midi);
        mark(s.idx, ok ? 'ok' : 'bad', 'reveal');
        if (ok) {
          feedback('ok', `正確！第 ${t.num} 弦`);
        } else {
          mark(t.idx, 'answer', 'reveal');
          feedback('bad', `正確位置是第 ${t.num} 弦（你點的是 ${fullName(s.degree, s.octave)}）`);
          later(() => Sound.play(t.midi), 500);
        }
        later(() => this.next(), ok ? 700 : 2000);
      },
    },

    recog: {
      enter() {
        resetSession();
        renderBoard('both');
        board.classList.add('hide-labels');
        panel.innerHTML = '<div class="row"><div id="status" class="status" style="flex:1"></div>'
          + '<button class="btn ghost small" data-act="replay">🔊 再聽</button></div>'
          + '<div id="octChoices" class="choices"></div><div id="degChoices" class="choices"></div>'
          + '<div id="feedback" class="feedback"></div>';
        renderStatus();
        q.target = null;
        this.next();
      },
      next() {
        clearMarks();
        q.fmt = pickFormat();
        q.target = pickWeighted('recog', settings.key, q.fmt, strings.map(s => s.idx), q.target);
        q.sel = { oct: null, deg: null };
        q.locked = false;
        q.start = performance.now();
        mark(q.target, 'target');
        $('#octChoices').innerHTML = [-2, -1, 0, 1, 2].map(o =>
          `<button class="choice small" data-act="oct" data-val="${o}">${octName(o)}</button>`).join('');
        $('#degChoices').innerHTML = G.PENTA.map(d =>
          `<button class="choice" data-act="deg" data-val="${d}">${q.fmt === 'solfege' ? sol(d) : d}</button>`).join('');
        feedback('hint', '藍框的弦是什麼音？請選八度和音名');
        Sound.play(strings[q.target].midi);
      },
      act(name, val, btn) {
        if (name === 'replay') { Sound.play(strings[q.target].midi); return; }
        if (q.locked) return;
        q.sel[name] = +val;
        btn.parentElement.querySelectorAll('.choice').forEach(b => b.classList.toggle('sel', b === btn));
        if (q.sel.oct === null || q.sel.deg === null) return;

        q.locked = true;
        const t = strings[q.target];
        const ok = q.sel.oct === t.octave && q.sel.deg === t.degree;
        record('recog', settings.key, q.fmt, t.idx, ok, performance.now() - q.start);
        score(ok);
        [['oct', t.octave], ['deg', t.degree]].forEach(([kind, right]) => {
          panel.querySelectorAll(`[data-act="${kind}"]`).forEach(b => {
            const v = +b.dataset.val;
            b.classList.remove('sel');
            if (v === right) b.classList.add('ok');
            else if (v === q.sel[kind]) b.classList.add('bad');
          });
        });
        mark(t.idx, 'reveal');
        feedback(ok ? 'ok' : 'bad', (ok ? '正確！' : '答案是 ') + `第 ${t.num} 弦 · ${fullName(t.degree, t.octave)}`);
        later(() => this.next(), ok ? 900 : 2200);
      },
    },

    // 唱名練習：簡譜↔唱名、唱名↔音名（音名跟著目前的調，例如 D 調 Sol = A）
    card: {
      enter() {
        resetSession();
        const t = settings.cardType || 'num';
        panel.innerHTML = '<div class="seg">'
          + `<button class="seg-btn${t === 'num' ? ' sel' : ''}" data-act="type" data-val="num">簡譜 ↔ 唱名</button>`
          + `<button class="seg-btn${t === 'letter' ? ' sel' : ''}" data-act="type" data-val="letter">唱名 ↔ 音名</button>`
          + '</div><div id="status" class="status"></div>'
          + '<div class="info" id="cardHint"></div><div id="prompt" class="prompt big"></div>'
          + '<div id="cardChoices" class="choices"></div><div id="feedback" class="feedback"></div>';
        renderStatus();
        q.item = null;
        this.next();
      },
      // 成績分開記：簡譜↔唱名與調無關，唱名↔音名依調分開
      bucketKey() { return settings.cardType === 'letter' ? [settings.key, 'letter'] : ['-', 'card']; },
      next() {
        const letterMode = settings.cardType === 'letter';
        const items = [];
        G.PENTA.forEach(d => letterMode ? items.push('s2l:' + d, 'l2s:' + d) : items.push('n2s:' + d, 's2n:' + d));
        q.item = pickWeighted('card', ...this.bucketKey(), items, q.item);
        const [dir, d] = q.item.split(':');
        q.dir = dir;
        q.deg = +d;
        q.locked = false;
        q.start = performance.now();
        const k = G.keyInfo(settings.key);
        const name = n => G.noteName(settings.key, n);
        const hints = {
          n2s: '這個簡譜數字的唱名是？（1 = Do）',
          s2n: '這個唱名的簡譜數字是？（1 = Do）',
          s2l: `固定唱名（C = Do）：這個唱名的音名是？`,
          l2s: `固定唱名（C = Do）：這個音名的唱名是？`,
        };
        const promptText = { n2s: `<span class="jp">${q.deg}</span>`, s2n: `<span class="sol">${sol(q.deg)}</span>`,
          s2l: `<span class="sol">${fixedSol(q.deg)}</span>`, l2s: `<span class="jp">${name(q.deg)}</span>` };
        const choiceText = { n2s: sol, s2n: n => n, s2l: name, l2s: fixedSol };
        $('#cardHint').textContent = hints[dir];
        $('#prompt').innerHTML = promptText[dir];
        $('#cardChoices').innerHTML = G.PENTA.map(n =>
          `<button class="choice${dir === 'n2s' || dir === 'l2s' ? ' small' : ''}" data-act="ans" data-val="${n}">${choiceText[dir](n)}</button>`).join('');
        feedback('', '');
      },
      act(name, val, btn) {
        if (name === 'type') {
          settings.cardType = val;
          saveSettings();
          this.enter();
          return;
        }
        if (q.locked) return;
        q.locked = true;
        const ok = +val === q.deg;
        record('card', ...this.bucketKey(), q.item, ok, performance.now() - q.start);
        score(ok);
        btn.classList.add(ok ? 'ok' : 'bad');
        if (!ok) panel.querySelector(`[data-act="ans"][data-val="${q.deg}"]`).classList.add('ok');
        // 播放中音區的這個音
        const tonic = strings.find(s => s.degree === 1 && s.octave === 0);
        Sound.play(tonic.midi + G.SEMITONES[q.deg]);
        feedback(ok ? 'ok' : 'bad', settings.cardType === 'letter'
          ? `${fixedSol(q.deg)} = ${G.noteName(settings.key, q.deg)}（固定唱名，C = Do）`
          : `${q.deg} = ${sol(q.deg)}`);
        later(() => this.next(), ok ? 700 : 1600);
      },
    },

    scale: {
      enter() {
        const sc = settings.scale;
        const opt = (v, text, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${text}</option>`;
        panel.innerHTML = '<div class="row">'
          + `<label>範圍 <select data-in="range">${opt('all', '全部 21 弦', sc.range)}${opt(-2, '倍低音', sc.range)}${opt(-1, '低音', sc.range)}${opt(0, '中音', sc.range)}${opt(1, '高音', sc.range)}</select></label>`
          + `<label>方向 <select data-in="dir">${opt('up', '上行', sc.dir)}${opt('down', '下行', sc.dir)}${opt('updown', '上行再下行', sc.dir)}</select></label>`
          + '</div><div class="row">'
          + `<label><input type="checkbox" data-in="press"${sc.press ? ' checked' : ''}> 加入按音 4 Fa、7 Si</label>`
          + '</div><div class="row">'
          + `<label>速度</label><input type="range" min="40" max="200" step="5" value="${sc.bpm}" data-in="bpm"><span id="bpmVal">${sc.bpm}</span>`
          + '</div><div id="prompt" class="prompt big"></div><div id="scaleWhere" class="info"></div>'
          + '<div class="row" style="justify-content:center"><button class="btn" data-act="play" id="playBtn">▶ 播放</button></div>';
        renderBoard();
        q.playing = false;
      },
      input(name, el) {
        const sc = settings.scale;
        if (name === 'press') sc.press = el.checked;
        else if (name === 'bpm') { sc.bpm = +el.value; $('#bpmVal').textContent = sc.bpm; }
        else sc[name] = el.value;
        saveSettings();
      },
      build() {
        const sc = settings.scale;
        const o = +sc.range;
        const notes = strings.filter(s => sc.range === 'all' || s.octave === o || (s.octave === o + 1 && s.degree === 1));
        let seq = [];
        notes.forEach(s => {
          seq.push({ s, degree: s.degree, midi: s.midi, press: false });
          const p = G.PRESS[s.degree];
          if (sc.press && p) seq.push({ s, degree: p.degree, midi: s.midi + p.add, press: true });
        });
        if (sc.dir === 'down') seq.reverse();
        if (sc.dir === 'updown') seq = seq.concat(seq.slice(0, -1).reverse());
        return seq;
      },
      act(name) {
        if (name !== 'play') return;
        if (q.playing) { this.stop(); return; }
        q.playing = true;
        $('#playBtn').textContent = '■ 停止';
        const seq = this.build();
        const step = i => {
          clearMarks();
          if (i >= seq.length) { this.stop(); return; }
          const n = seq[i];
          mark(n.s.idx, 'play');
          if (n.press) mark(n.s.idx, 'pressing');
          Sound.play(n.midi);
          $('#prompt').innerHTML = markHTML(n.degree, n.s.octave, 'jp') + `<span class="sol">${sol(n.degree)}</span>`;
          $('#scaleWhere').textContent = `第 ${n.s.num} 弦 · ${octName(n.s.octave)}${n.press ? ' · 按音' : ''}`;
          later(() => step(i + 1), 60000 / settings.scale.bpm);
        };
        step(0);
      },
      stop() {
        clearTimers();
        clearMarks();
        q.playing = false;
        const btn = $('#playBtn');
        if (btn) btn.textContent = '▶ 播放';
      },
    },

    // 定音：知識（弦圖 + 對照表）與考試
    tune: {
      enter() {
        resetSession();
        const v = settings.tuneView || 'learn';
        const head = '<div class="seg">'
          + `<button class="seg-btn${v === 'learn' ? ' sel' : ''}" data-act="view" data-val="learn">定音知識</button>`
          + `<button class="seg-btn${v === 'quiz' ? ' sel' : ''}" data-act="view" data-val="quiz">定音考試</button></div>`;
        board.hidden = v === 'quiz';
        if (v === 'learn') {
          panel.innerHTML = head + this.learnHTML() + '<div id="tapInfo" class="info"></div>';
          renderBoard('tune');
        } else {
          panel.innerHTML = head + '<div id="status" class="status"></div>'
            + '<div class="info" id="tuneHint"></div><div id="prompt" class="prompt big"></div>'
            + '<div id="tuneChoices" class="choices"></div><div id="feedback" class="feedback"></div>';
          renderStatus();
          q.item = null;
          this.next();
        }
      },
      learnHTML() {
        const k = G.keyInfo(settings.key);
        const name = d => G.noteName(settings.key, d);
        // 一組五條弦由低到高：1 2 3 5 6
        const order = [[1, 0], [2, 0], [3, 0], [5, 0], [6, 0]];
        const cells = f => order.map(([d, o]) => `<td>${f(d, o)}</td>`).join('');
        const low = strings[0], high = strings[20];
        const green = strings.find(s => s.green);
        return `<table class="tune-table"><tr><th>簡譜</th>${cells((d, o) => markHTML(d, o))}</tr>`
          + `<tr><th>唱名<small>1=Do</small></th>${cells(d => sol(d))}</tr>`
          + `<tr><th>唱名<small>C=Do</small></th>${cells(d => fixedSol(d))}</tr>`
          + `<tr><th>音名</th>${cells(d => `<b>${name(d)}</b>`)}</tr></table>`
          + `<div class="info">${k.name} 1 = ${name(1)}，每 5 弦一組（由低到高如上表）<br>`
          + `第 21 弦 ${G.letter(low.midi)} 最低 · 第 1 弦 ${G.letter(high.midi)} 最高 · 綠弦 = ${green.degree}（${name(green.degree)}）</div>`;
      },
      tap(s) {
        if (settings.tuneView === 'quiz') return;
        Sound.play(s.midi);
        flash(s.idx);
        $('#tapInfo').innerHTML = `第 <b>${s.num}</b> 弦 · ${fullName(s.degree, s.octave)} · 音名 <b>${G.noteName(settings.key, s.degree)}</b>（${G.letter(s.midi)}）`;
      },
      next() {
        const items = [];
        G.PENTA.forEach(d => items.push('n2l:' + d, 'l2n:' + d));
        strings.forEach(s => items.push('str:' + s.idx));
        q.item = pickWeighted('tune', settings.key, 'tune', items, q.item);
        const [type, v] = q.item.split(':');
        const name = d => G.noteName(settings.key, d);
        const k = G.keyInfo(settings.key);
        q.type = type;
        q.str = type === 'str' ? strings[+v] : null;
        q.deg = q.str ? q.str.degree : +v;
        q.locked = false;
        q.start = performance.now();
        const hint = { n2l: '這個簡譜音定什麼音名？', l2n: '這個音名是簡譜幾？', str: '這條弦定什麼音名？' }[type];
        $('#tuneHint').textContent = `${k.name}（1 = ${name(1)}）：${hint}`;
        $('#prompt').innerHTML = type === 'n2l' ? `<span class="jp">${q.deg}</span>`
          : type === 'l2n' ? `<span class="jp">${name(q.deg)}</span>`
          : `<span class="oct">第</span><span class="jp">${q.str.num}</span><span class="oct">弦</span>`;
        $('#tuneChoices').innerHTML = G.PENTA.map(n =>
          `<button class="choice" data-act="ans" data-val="${n}">${type === 'l2n' ? n : name(n)}</button>`).join('');
        feedback('', '');
      },
      act(name, val, btn) {
        if (name === 'view') {
          settings.tuneView = val;
          saveSettings();
          clearTimers();
          this.enter();
          return;
        }
        if (name !== 'ans' || q.locked) return;
        q.locked = true;
        const ok = +val === q.deg;
        record('tune', settings.key, 'tune', q.item, ok, performance.now() - q.start);
        score(ok);
        btn.classList.add(ok ? 'ok' : 'bad');
        if (!ok) panel.querySelector(`[data-act="ans"][data-val="${q.deg}"]`).classList.add('ok');
        const n = G.noteName(settings.key, q.deg);
        if (q.str) {
          Sound.play(q.str.midi);
          feedback(ok ? 'ok' : 'bad', `第 ${q.str.num} 弦 = ${fullName(q.deg, q.str.octave)} = ${n}`);
        } else {
          const tonic = strings.find(s => s.degree === 1 && s.octave === 0);
          Sound.play(tonic.midi + G.SEMITONES[q.deg]);
          feedback(ok ? 'ok' : 'bad', `${q.deg}（${sol(q.deg)}）= ${n}`);
        }
        later(() => this.next(), ok ? 800 : 1800);
      },
    },

    stats: {
      enter() {
        q.confirmReset = false;
        const k = G.keyInfo(settings.key);
        const accColor = r => r && r.n ? `hsl(${Math.round(120 * r.ok / r.n)},55%,55%)` : '#ffffff14';
        const section = (m, title) => ['jianpu', 'solfege'].map(fmt => {
          const b = bucket(m, settings.key, fmt);
          const total = Object.values(b).reduce((a, r) => ({ n: a.n + r.n, ok: a.ok + r.ok }), { n: 0, ok: 0 });
          const heat = strings.map(s => `<div style="background:${accColor(b[s.idx])}">${s.num}</div>`).join('');
          const weak = strings
            .filter(s => b[s.idx] && b[s.idx].ok < b[s.idx].n)
            .sort((x, y) => b[x.idx].ok / b[x.idx].n - b[y.idx].ok / b[y.idx].n)
            .slice(0, 3)
            .map(s => {
              const r = b[s.idx];
              return `<li>第 ${s.num} 弦 · ${fullName(s.degree, s.octave)}：答對 ${r.ok}/${r.n}，平均 ${(r.ms / r.n / 1000).toFixed(1)} 秒</li>`;
            }).join('');
          return `<h3>${title} · ${fmt === 'jianpu' ? '簡譜題' : '唱名題'}（${total.n} 題，正確率 ${total.n ? Math.round(100 * total.ok / total.n) : 0}%）</h3>`
            + `<div class="heat">${heat}</div>`
            + (weak ? `<ul class="weak">${weak}</ul>` : '');
        }).join('');

        const card = bucket('card', '-', 'card');
        const cardRows = G.PENTA.map(d => {
          const a = card['n2s:' + d], b = card['s2n:' + d];
          const f = r => r && r.n ? `${r.ok}/${r.n}` : '—';
          return `<li>${d} ↔ ${sol(d)}：數字→唱名 ${f(a)}，唱名→數字 ${f(b)}</li>`;
        }).join('');

        // 唱名↔音名、定音考試（依目前的調）
        const fr = r => r && r.n ? `${r.ok}/${r.n}` : '—';
        const nn = d => G.noteName(settings.key, d);
        const lt = bucket('card', settings.key, 'letter');
        const letterRows = G.PENTA.map(d =>
          `<li>${fixedSol(d)} ↔ ${nn(d)}：唱名→音名 ${fr(lt['s2l:' + d])}，音名→唱名 ${fr(lt['l2s:' + d])}</li>`).join('');
        const tb = bucket('tune', settings.key, 'tune');
        const sum = prefix => Object.keys(tb).filter(i => i.startsWith(prefix))
          .reduce((a, i) => ({ n: a.n + tb[i].n, ok: a.ok + tb[i].ok }), { n: 0, ok: 0 });
        const tuneHeat = strings.map(s => `<div style="background:${accColor(tb['str:' + s.idx])}">${s.num}</div>`).join('');
        const tuneHTML = `<h2>定音考試</h2><ul class="weak">`
          + `<li>簡譜→音名 ${fr(sum('n2l:'))}，音名→簡譜 ${fr(sum('l2n:'))}，弦號→音名 ${fr(sum('str:'))}</li></ul>`
          + `<h3>弦號→音名（每格一條弦）</h3><div class="heat">${tuneHeat}</div>`;

        panel.innerHTML = `<h2>${k.name}</h2>`
          + '<p class="legend">每格代表一條弦，左邊是第 21 弦（最低音），右邊是第 1 弦（最高音）。綠色表示答得好，紅色表示常答錯，灰色表示還沒練過。</p>'
          + section('find', '找弦') + section('recog', '認音')
          + tuneHTML
          + `<h2>簡譜 ↔ 唱名</h2><ul class="weak">${cardRows}</ul>`
          + `<h2>唱名 ↔ 音名（${k.name}）</h2><ul class="weak">${letterRows}</ul>`
          + '<div class="row"><button class="btn danger" data-act="reset">清除全部成績</button></div>';
      },
      act(name, val, btn) {
        if (name !== 'reset') return;
        if (!q.confirmReset) {
          q.confirmReset = true;
          btn.textContent = '再按一次確認清除';
          later(() => { q.confirmReset = false; btn.textContent = '清除全部成績'; }, 3000);
          return;
        }
        q.confirmReset = false;
        Object.keys(stats).forEach(k => delete stats[k]);
        saveStats();
        this.enter();
      },
    },
  };

  // ---------- 切換模式 ----------
  function switchMode(m) {
    clearTimers();
    mode = m;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    board.hidden = m === 'card' || m === 'stats';
    board.classList.remove('hide-labels');
    panel.classList.toggle('stats', m === 'stats');
    panel.innerHTML = '';
    modes[m].enter();
  }

  // ---------- 事件 ----------
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });

  // 觸控方式：
  // - 弦圖模式：按下就發聲，手指滑過其他弦也會發聲（刮奏）
  // - 測驗模式：按下只是預選（橘框），可滑動調整，放開手指才確定答案
  const touch = { active: false, row: null };
  // 弦圖、定音知識：按下就發聲；測驗：放開才作答
  const instant = () => mode === 'board' || (mode === 'tune' && settings.tuneView !== 'quiz');
  const rowAt = e => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el && board.contains(el) ? el.closest('.string') : null;
  };
  const setHover = row => {
    if (touch.row) touch.row.classList.remove('hover');
    touch.row = row;
    if (row && !instant()) row.classList.add('hover');
  };
  const tapRow = row => {
    const handler = modes[mode].tap;
    if (row && handler) handler.call(modes[mode], strings[+row.dataset.idx]);
  };

  board.addEventListener('pointerdown', e => {
    if (!modes[mode].tap) return;
    e.preventDefault();
    touch.active = true;
    setHover(rowAt(e));
    if (instant()) tapRow(touch.row);
  });
  board.addEventListener('pointermove', e => {
    if (!touch.active) return;
    const row = rowAt(e);
    if (row === touch.row) return;
    setHover(row);
    if (instant()) tapRow(row);
  });
  const endTouch = commit => {
    if (!touch.active) return;
    touch.active = false;
    const row = touch.row;
    setHover(null);
    if (commit && !instant()) tapRow(row);
  };
  board.addEventListener('pointerup', () => endTouch(true));
  board.addEventListener('pointercancel', () => endTouch(false));
  board.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') endTouch(false); });

  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    const handler = modes[mode].act;
    if (b && handler) handler.call(modes[mode], b.dataset.act, b.dataset.val, b);
  });
  ['input', 'change'].forEach(type => panel.addEventListener(type, e => {
    const el = e.target.closest('[data-in]');
    const handler = modes[mode].input;
    if (el && handler) handler.call(modes[mode], el.dataset.in, el);
  }));

  document.querySelectorAll('.tabs button').forEach(b =>
    b.addEventListener('click', () => switchMode(b.dataset.mode)));

  // ---------- 設定 ----------
  const setKey = $('#setKey');
  setKey.innerHTML = G.KEYS.map(k => `<option value="${k.id}">${k.name}</option>`).join('');
  setKey.value = settings.key;
  $('#setFormat').value = settings.format;
  $('#setLabels').value = settings.labels;
  $('#setLetter').checked = settings.letter;
  $('#setPress').checked = settings.press;

  function applySettings() {
    settings.key = setKey.value;
    settings.format = $('#setFormat').value;
    settings.labels = $('#setLabels').value;
    settings.letter = $('#setLetter').checked;
    settings.press = $('#setPress').checked;
    saveSettings();
    strings = G.buildStrings(settings.key);
    $('#keyBadge').textContent = G.keyInfo(settings.key).name;
    switchMode(mode);
  }
  ['#setKey', '#setFormat', '#setLabels', '#setLetter', '#setPress'].forEach(id =>
    $(id).addEventListener('change', applySettings));

  $('#settingsBtn').addEventListener('click', () => {
    const s = $('#settings');
    s.hidden = !s.hidden;
  });

  $('#keyBadge').textContent = G.keyInfo(settings.key).name;
  // 網址加上 #find、#recog 等可直接開啟該模式
  const startMode = location.hash.slice(1);
  switchMode(modes[startMode] ? startMode : 'board');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();

'use strict';

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (typeof v === 'boolean') el[k] = v;
        else el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) {
        if (c == null || c === false) continue;
        el.append(c instanceof Node ? c : String(c));
    }
    return el;
}

// ---- Saved state (localStorage) ----

const saved = {
    get(key, fallback) {
        try {
            const v = localStorage.getItem('sopanam.' + key);
            return v == null ? fallback : JSON.parse(v);
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        localStorage.setItem('sopanam.' + key, JSON.stringify(value));
    },
};

const prefs = {
    mode: saved.get('mode', 'lessons'),
    lesson: saved.get('lesson', null),
    primary: saved.get('primary', 'te'),
    secondary: saved.get('secondary', true),
    iast: saved.get('iast', false),
    voice: saved.get('voice', 'hi'),
    scale: saved.get('scale', 1),
    study: saved.get('study', 'learn'),
    filter: saved.get('filter', 'all'),
    shuffle: saved.get('shuffle', false),
    selected: saved.get('selected', '*'),
    collapsed: saved.get('collapsed', []),
    quizCount: saved.get('quizCount', 10),
    lipiText: saved.get('lipiText', ''),
    lipiLong: saved.get('lipiLong', true),
};

function setPref(key, value) {
    prefs[key] = value;
    saved.set(key, value);
}

/** Review intervals in days for boxes 1–5. A missed card drops to box 0 and is due tomorrow. */
const INTERVALS = [1, 3, 7, 16, 35];

function today() {
    const d = new Date();
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}

const progress = {
    done: new Set(saved.get('done', [])),
    srs: saved.get('srs', {}),
    quizBest: saved.get('quizBest', {}),
    save() {
        saved.set('done', [...this.done]);
        saved.set('srs', this.srs);
        saved.set('quizBest', this.quizBest);
    },
    grade(id, ok) {
        const cur = this.srs[id] || { b: 0, d: today() };
        const b = ok ? Math.min(cur.b + 1, INTERVALS.length) : 0;
        this.srs[id] = { b, d: today() + (ok ? INTERVALS[b - 1] : 1) };
        this.save();
    },
    /** Learn mode "Known": jump to box 3 (due in a week), or undo it. */
    know(id) {
        const cur = this.srs[id];
        if (cur && cur.b >= 3) delete this.srs[id];
        else this.srs[id] = { b: 3, d: today() + INTERVALS[2] };
        this.save();
    },
    review(id) {
        const cur = this.srs[id];
        if (cur && cur.b === 0) delete this.srs[id];
        else this.srs[id] = { b: 0, d: today() };
        this.save();
    },
    state(id) {
        const s = this.srs[id];
        if (!s) return 'new';
        if (s.b >= 3) return 'known';
        if (s.b === 0) return 'review';
        return 'learning';
    },
    isDue(id) {
        const s = this.srs[id];
        return !!s && s.d <= today();
    },
};

let course = null;
let loadError = null;
let lessons = [];
const lessonById = new Map();
const unitOfLesson = new Map();
const cardsByLesson = new Map();

const cs = { order: [], pos: 0, flipped: false, answers: {}, finished: false };
const qs = { active: false, items: [], pos: 0, chosen: null, results: [], scope: null, finished: false };

// ---- Script rendering ----

/** Text in the reader's chosen script. [[…]] marks text that stays as written. */
function st(text, lit = false) {
    if (!text) return '';
    if (lit) return text.replace(/\[\[|\]\]/g, '');
    return text.split(/(\[\[.*?\]\])/).map((seg) => {
        if (seg.startsWith('[[') && seg.endsWith(']]')) return seg.slice(2, -2);
        return prefs.primary === 'te' ? Lipi.devaToTelugu(seg) : seg;
    }).join('');
}

/** The script the reader did not choose, for the secondary line. */
function otherScript(text) {
    const plain = text.replace(/\[\[|\]\]/g, '');
    return prefs.primary === 'te' ? plain : Lipi.devaToTelugu(plain);
}

/** **bold**, *italic* and `code` to DOM nodes. */
function inline(text) {
    const out = [];
    const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const tok = m[0];
        if (tok.startsWith('**')) out.push(h('strong', {}, tok.slice(2, -2)));
        else if (tok.startsWith('`')) out.push(h('code', {}, tok.slice(1, -1)));
        else out.push(h('em', {}, tok.slice(1, -1)));
        last = m.index + tok.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

const plain = (text) => text.replace(/\*\*|`/g, '').replace(/\*([^*]+)\*/g, '$1');

/** True when most letters are Devanagari, so a second-script line helps rather than repeats. */
function mostlySanskrit(text) {
    let deva = 0, other = 0;
    for (const ch of text) {
        if (/[\u0900-\u097F]/.test(ch)) deva++;
        else if (/[\u0C00-\u0C7Fa-zA-Z]/.test(ch)) other++;
    }
    return deva > 0 && deva >= 2 * other;
}

function cellContent(text, iast, lit) {
    const nodes = [h('div', {}, inline(st(text, lit)))];
    if (!lit && mostlySanskrit(text)) {
        if (prefs.secondary) nodes.push(h('div', { class: 'sec' }, inline(otherScript(text))));
        if (prefs.iast) nodes.push(h('div', { class: 'sec iast' }, iast || Lipi.devaToIast(text)));
    }
    return nodes;
}

// ---- Speech ----

function canSpeak() {
    return 'speechSynthesis' in window && prefs.voice !== 'off';
}

function speak(devaLines) {
    if (!canSpeak()) return;
    speechSynthesis.cancel();
    const lang = prefs.voice === 'te' ? 'te-IN' : 'hi-IN';
    const text = devaLines.join(' । ').replace(/[।॥|]+/g, ', ').replace(/ऽ/g, '');
    const u = new SpeechSynthesisUtterance(prefs.voice === 'te' ? Lipi.devaToTelugu(text) : text);
    u.lang = lang;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').startsWith(lang));
    if (voice) u.voice = voice;
    u.rate = 0.8;
    speechSynthesis.speak(u);
}

// ---- Course index ----

function indexCourse(data) {
    course = data;
    lessons = [];
    for (const unit of course.units) {
        for (const lesson of unit.lessons) {
            lessons.push(lesson);
            lessonById.set(lesson.id, lesson);
            unitOfLesson.set(lesson.id, unit);
            cardsByLesson.set(lesson.id, []);
        }
    }
    for (const card of course.cards) cardsByLesson.get(card.lesson)?.push(card);
    if (prefs.lesson && !lessonById.has(prefs.lesson)) setPref('lesson', null);
}

function selectedLessons() {
    return new Set(prefs.selected === '*' ? lessons.map((l) => l.id) : prefs.selected.filter((id) => lessonById.has(id)));
}

function setSelected(set) {
    setPref('selected', lessons.every((l) => set.has(l.id)) ? '*' : [...set]);
}

function shuffled(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---- Rendering ----

function render() {
    document.documentElement.style.setProperty('--scale', prefs.scale);
    for (const b of $('#mode-switch').querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === prefs.mode);
    const stage = $('#stage');
    const sub = $('#subbar');
    const actions = $('#actions');
    const keepScroll = stage.dataset.view === viewKey() ? stage.scrollTop : 0;
    stage.replaceChildren();
    sub.replaceChildren();
    actions.replaceChildren();
    stage.className = '';
    if (loadError) {
        stage.append(h('div', { class: 'empty' }, h('h2', {}, 'Could not load the course'), h('p', {}, loadError)));
        return;
    }
    if (!course) {
        stage.append(h('div', { class: 'empty' }, 'Loading…'));
        return;
    }
    if (prefs.mode === 'lessons') renderLessons(stage, sub, actions);
    else if (prefs.mode === 'cards') renderCards(stage, sub, actions);
    else if (prefs.mode === 'quiz') renderQuiz(stage, sub, actions);
    else renderLipi(stage);
    stage.dataset.view = viewKey();
    stage.scrollTop = keepScroll;
    if ($('#drawer').classList.contains('open')) renderDrawer();
}

function viewKey() {
    if (prefs.mode === 'lessons') return 'lesson:' + (prefs.lesson || '');
    if (prefs.mode === 'quiz') return `quiz:${qs.active}:${qs.pos}`;
    return prefs.mode;
}

// ---- Lessons ----

function renderLessons(stage, sub, actions) {
    stage.className = 'scroll';
    const lesson = prefs.lesson && lessonById.get(prefs.lesson);
    if (!lesson) {
        stage.append(lessonIndex());
        return;
    }
    const unit = unitOfLesson.get(lesson.id);
    const i = lessons.indexOf(lesson);
    sub.append(h('div', { class: 'status' },
        h('button', { class: 'text-btn copy', onclick: () => openLesson(null) }, '‹ All lessons'),
        h('span', {}, `${i + 1} / ${lessons.length}`)));
    stage.append(lessonReader(lesson, unit));
    const done = progress.done.has(lesson.id);
    actions.append(
        h('button', { class: 'btn nav', disabled: i === 0, onclick: () => openLesson(lessons[i - 1].id), 'aria-label': 'Previous lesson' }, '‹'),
        h('button', {
            class: 'btn' + (done ? ' on-known' : ''),
            onclick: () => { done ? progress.done.delete(lesson.id) : progress.done.add(lesson.id); progress.save(); render(); },
        }, done ? '✓ Completed' : 'Mark complete'),
        h('button', { class: 'btn nav', disabled: i === lessons.length - 1, onclick: () => openLesson(lessons[i + 1].id), 'aria-label': 'Next lesson' }, '›'));
}

function lessonIndex() {
    const total = lessons.length;
    const done = lessons.filter((l) => progress.done.has(l.id)).length;
    return h('div', { class: 'index' },
        h('div', { class: 'course-title' }, st(course.title)),
        h('p', { class: 'course-summary' }, st(course.summary)),
        h('div', { class: 'overall' }, `${done} of ${total} lessons completed`),
        course.units.map((u) => unitBox(u, (id) => openLesson(id))));
}

function unitBox(unit, onPick) {
    const collapsed = prefs.collapsed.includes(unit.id);
    const done = unit.lessons.filter((l) => progress.done.has(l.id)).length;
    return h('div', { class: 'unit-box' },
        h('button', {
            class: 'unit-head' + (collapsed ? ' collapsed' : ''),
            onclick: () => {
                const set = new Set(prefs.collapsed);
                collapsed ? set.delete(unit.id) : set.add(unit.id);
                setPref('collapsed', [...set]);
                render();
            },
        },
            h('span', { class: 'num' }, unit.num),
            h('span', { class: 'titles' }, h('div', { class: 't' }, st(unit.title)), !collapsed && h('div', { class: 's' }, st(unit.summary))),
            h('span', { class: 'count' }, `${done}/${unit.lessons.length}`),
            h('span', { class: 'chev' }, '▾')),
        !collapsed && unit.lessons.map((l) => {
            const best = progress.quizBest[l.id];
            return h('button', { class: 'lesson-row' + (prefs.lesson === l.id ? ' current' : ''), onclick: () => onPick(l.id) },
                h('span', { class: 'n' }, l.num),
                h('span', { class: 't' }, inline(st(l.title))),
                best != null && h('span', { class: 'best' }, `${best}%`),
                progress.done.has(l.id) && h('span', { class: 'done' }, '✓'));
        }));
}

function openLesson(id, push = true) {
    if (prefs.mode !== 'lessons') setPref('mode', 'lessons');
    setPref('lesson', id);
    if (push) history.pushState({ lesson: id }, '', id ? '#' + id : location.pathname);
    closeDrawer();
    render();
    $('#stage').scrollTop = 0;
}

function lessonReader(lesson, unit) {
    const cards = cardsByLesson.get(lesson.id) || [];
    return h('article', { class: 'reader' },
        h('div', { class: 'crumb' }, `${lesson.num} · ${plain(st(unit.title))}`),
        h('h1', {}, inline(st(lesson.title))),
        lesson.summary && h('p', { class: 'lede' }, inline(st(lesson.summary))),
        lesson.blocks.map(blockNode),
        h('div', { class: 'lesson-foot' },
            cards.length > 0 && h('button', { class: 'btn', onclick: () => practiseLesson(lesson.id) }, `🗂 Practise ${cards.length} cards`),
            lesson.quiz.length > 0 && h('button', { class: 'btn primary', onclick: () => startQuiz(lesson.id) }, `✎ Quiz (${lesson.quiz.length})`)));
}

function blockNode(b) {
    switch (b.t) {
        case 'h2': return h('h2', {}, inline(st(b.text)));
        case 'h3': return h('h3', {}, inline(st(b.text)));
        case 'p': return h('p', {}, inline(st(b.text, b.lit)));
        case 'ul': return h('ul', {}, b.items.map((t) => h('li', {}, inline(st(t, b.lit)))));
        case 'ol': return h('ol', {}, b.items.map((t) => h('li', {}, inline(st(t, b.lit)))));
        case 'table': return tableNode(b);
        case 'tip': return tipNode(b);
        case 'ex': return exampleNode(b);
        default: return null;
    }
}

function tableNode(b) {
    return h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, b.head.map((c) => h('th', {}, inline(st(c, b.lit)))))),
        h('tbody', {}, b.rows.map((row, r) => h('tr', {}, row.map((c, k) =>
            h('td', {}, cellContent(c, b.iast?.[r]?.[k], b.lit))))))));
}

const TIP_LABEL = {
    memory: '🧠 జ్ఞాపకం', telugu: 'అ తెలుగులో', compare: '⇄ పోలిక', sutra: '📜 సూత్రం', warning: '⚠ జాగ్రత్త', note: 'ℹ︎ గమనిక',
};

function tipNode(b) {
    return h('div', { class: 'tip ' + b.kind },
        h('div', { class: 'tip-head' }, h('span', { class: 'tip-kind' }, TIP_LABEL[b.kind] || b.kind),
            b.title && h('span', {}, inline(st(b.title, b.lit)))),
        b.text.map((p) => h('p', {}, inline(st(p, b.lit)))));
}

function saLines(lines, iast) {
    const primaryClass = prefs.primary === 'te' ? 'sa te' : 'sa deva';
    return [
        h('div', { class: primaryClass }, lines.map((l) => h('div', {}, st(l)))),
        prefs.secondary && h('div', { class: 'lines-sec' }, lines.map((l) => h('div', {}, otherScript(l)))),
        prefs.iast && h('div', { class: 'lines-iast' }, (iast || lines.map((l) => Lipi.devaToIast(l))).map((l) => h('div', {}, l))),
    ];
}

function exampleNode(b) {
    const part = (title, ...content) => h('div', { class: 'ex-part' }, h('h4', {}, title), content);
    return h('div', { class: 'ex' },
        h('div', { class: 'ex-head' },
            h('span', { class: 'ex-src' }, b.src ? inline(st(b.src)) : (b.title ? inline(st(b.title)) : 'ఉదాహరణ · Example')),
            b.meter && h('span', { class: 'ex-meter' }, st(b.meter)),
            canSpeak() && h('button', { class: 'speak', onclick: () => speak(b.sa), 'aria-label': 'Read aloud' }, '🔊')),
        b.speaker && h('div', { class: 'speaker' }, st(b.speaker)),
        saLines(b.sa, b.iast),
        b.split && part('పదచ్ఛేదం · word split', h('p', {}, cellContent(b.split, b.split_iast))),
        b.anvaya && part('అన్వయం · prose order', h('p', {}, cellContent(b.anvaya, b.anvaya_iast))),
        b.words.length > 0 && part('ప్రతిపదార్థం · word by word', h('div', { class: 'ex-words' }, b.words.flatMap(([t, m, iast]) => [
            h('div', { class: 'term' }, st(t), prefs.iast && iast && h('span', { class: 'iast' }, iast)),
            h('div', {}, inline(st(m)))]))),
        b.te && part('తాత్పర్యం · Telugu', h('p', { class: 'te-font' }, inline(st(b.te)))),
        b.en && part('English', h('p', {}, inline(st(b.en)))),
        b.notes.length > 0 && part('వ్యాకరణం · grammar', h('ul', { class: 'ex-notes' }, b.notes.map((n) => h('li', {}, inline(st(n)))))));
}

// ---- Cards ----

function practiseLesson(id) {
    setSelected(new Set([id]));
    setPref('mode', 'cards');
    rebuildCards();
}

function cardPool() {
    const sel = selectedLessons();
    let pool = course.cards.filter((c) => sel.has(c.lesson));
    if (prefs.filter === 'new') pool = pool.filter((c) => progress.state(c.id) === 'new');
    if (prefs.filter === 'due') pool = pool.filter((c) => progress.isDue(c.id));
    if (prefs.filter === 'review') pool = pool.filter((c) => progress.state(c.id) === 'review');
    return pool;
}

function rebuildCards() {
    const pool = cardPool();
    Object.assign(cs, { order: prefs.shuffle ? shuffled(pool) : pool, pos: 0, flipped: false, answers: {}, finished: false });
    render();
}

const FILTERS = [['all', 'All cards'], ['new', 'New'], ['due', 'Due today'], ['review', 'Marked for review']];

function renderCards(stage, sub, actions) {
    sub.append(h('div', { class: 'segmented', id: 'study-switch' },
        [['learn', 'Learn'], ['test', 'Test']].map(([v, t]) => h('button', {
            class: prefs.study === v ? 'on' : '',
            onclick: () => { if (prefs.study !== v) { setPref('study', v); rebuildCards(); } },
        }, t))));
    const n = cs.order.length;
    if (cs.finished) {
        stage.append(cardSummary());
        return;
    }
    const card = cs.order[cs.pos];
    if (!card) {
        stage.append(h('div', { class: 'empty' },
            h('div', { class: 'big', style: 'font-size:3rem' }, '🗂'),
            h('h2', {}, 'No cards to practise'),
            h('p', {}, prefs.filter === 'due' ? 'Nothing is due today. Well done! Practise new cards, or come back tomorrow.'
                : prefs.filter === 'review' ? 'No cards are marked for review in the chosen lessons.'
                    : prefs.filter === 'new' ? 'You have seen every card in the chosen lessons.'
                        : 'Choose some lessons in the ☰ menu.'),
            h('button', { class: 'btn primary auto', onclick: openDrawer }, 'Choose lessons')));
        return;
    }
    const status = h('div', { class: 'status' }, h('span', {}, h('strong', {}, `Card ${cs.pos + 1}`), ` of ${n}`));
    if (prefs.study === 'test') {
        const answered = Object.keys(cs.answers).length;
        const correct = Object.values(cs.answers).filter(Boolean).length;
        status.append(h('span', {}, `Score ${correct} of ${answered} · ${n - answered} to go`));
    } else {
        const due = cs.order.filter((c) => progress.isDue(c.id)).length;
        status.append(h('span', {}, `${FILTERS.find(([v]) => v === prefs.filter)[1]} · ${due} due`));
    }
    sub.append(status);
    const flipped = prefs.study === 'learn' || cs.flipped;
    const el = cardNode(card, flipped);
    el.addEventListener('click', (e) => { if (!e.target.closest('button, a')) revealCard(); });
    addSwipe(el, (dir) => moveCard(dir));
    stage.append(el);

    const prev = h('button', { class: 'btn nav', onclick: () => moveCard(-1), 'aria-label': 'Previous card' }, '‹');
    const next = h('button', { class: 'btn nav', onclick: () => moveCard(1), 'aria-label': 'Next card' }, '›');
    const state = progress.state(card.id);
    if (prefs.study === 'learn') {
        actions.append(prev,
            h('button', { class: 'btn' + (state === 'known' ? ' on-known' : ''), onclick: () => { progress.know(card.id); render(); } },
                state === 'known' ? '✓ Known' : 'Known'),
            h('button', { class: 'btn' + (state === 'review' ? ' on-review' : ''), onclick: () => { progress.review(card.id); render(); } },
                state === 'review' ? '⚑ Review' : 'Review'),
            next);
    } else if (!cs.flipped) {
        actions.append(prev, h('button', { class: 'btn primary', onclick: revealCard }, 'Show answer'), next);
    } else {
        actions.append(prev,
            h('button', { class: 'btn bad', onclick: () => answerCard(false) }, '✗ Missed'),
            h('button', { class: 'btn good', onclick: () => answerCard(true) }, '✓ Got it'),
            next);
    }
}

function cardNode(card, flipped) {
    const lesson = lessonById.get(card.lesson);
    const state = progress.state(card.id);
    const lines = card.kind === 'example' ? card.prompt.text.split(' / ') : [card.prompt.text];
    const long = card.prompt.text.length > 40;
    const promptBody = card.kind === 'example'
        ? saLines(lines, card.prompt.iast ? card.prompt.iast.split(' / ') : null)
        : cellContent(card.prompt.text, card.prompt.iast, card.lit);
    return h('article', { class: 'card' + (flipped ? ' flipped' : '') },
        h('div', { class: 'badges' },
            h('span', { class: 'label' }, `${lesson.num} · ${plain(st(lesson.title))}`),
            state === 'new' && h('span', { class: 'badge new' }, 'New'),
            state === 'known' && h('span', { class: 'badge known' }, 'Known'),
            state === 'review' && h('span', { class: 'badge review' }, 'Review')),
        card.context && h('div', { class: 'context' }, inline(st(card.context))),
        h('div', { class: 'prompt' + (long ? ' long' : '') },
            card.prompt.head && h('div', { class: 'head' }, inline(st(card.prompt.head, card.lit))),
            h('div', { class: 'text' }, promptBody)),
        flipped
            ? h('div', { class: 'answers' }, card.answer.map((a) => h('div', { class: 'answer' },
                a.head && h('h3', {}, inline(st(a.head, card.lit))),
                h('div', { class: 'text' }, cellContent(a.text, a.iast, card.lit)))))
            : h('div', { class: 'hint' }, 'Recall the answer, then tap the card'));
}

function revealCard() {
    if (prefs.study !== 'test' || cs.flipped) return;
    cs.flipped = true;
    render();
}

function moveCard(delta) {
    const n = cs.order.length;
    if (!n) return;
    cs.pos = (cs.pos + delta + n) % n;
    cs.flipped = false;
    render();
    $('#stage').scrollTop = 0;
}

function answerCard(ok) {
    const card = cs.order[cs.pos];
    if (!card || !cs.flipped) return;
    cs.answers[card.id] = ok;
    progress.grade(card.id, ok);
    const n = cs.order.length;
    for (let step = 1; step <= n; step++) {
        const p = (cs.pos + step) % n;
        if (!(cs.order[p].id in cs.answers)) {
            cs.pos = p;
            cs.flipped = false;
            render();
            return;
        }
    }
    cs.finished = true;
    render();
}

function cardSummary() {
    const correct = Object.values(cs.answers).filter(Boolean).length;
    const missed = cs.order.filter((c) => cs.answers[c.id] === false);
    const total = cs.order.length;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    return h('div', { class: 'summary' },
        h('div', { class: 'big' }, missed.length ? '✅' : '⭐'),
        h('h2', {}, 'Test complete'),
        h('div', { class: 'score' }, `${correct} of ${total} correct (${percent}%)`),
        h('p', {}, missed.length
            ? `Cards you got come back after longer gaps; the ${missed.length} you missed come back tomorrow.`
            : 'Every card moves up a box and comes back after a longer gap.'),
        h('div', { class: 'buttons' },
            missed.length > 0 && h('button', {
                class: 'btn primary',
                onclick: () => { Object.assign(cs, { order: shuffled(missed), pos: 0, flipped: false, answers: {}, finished: false }); render(); },
            }, `Retest the ${missed.length} missed`),
            h('button', { class: 'btn', onclick: rebuildCards }, 'Start again'),
            h('button', { class: 'btn', onclick: () => { setPref('study', 'learn'); rebuildCards(); } }, 'Switch to Learn')));
}

function addSwipe(el, onSwipe) {
    let x0 = null, y0 = null;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        const dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe(dx < 0 ? 1 : -1);
    });
}

// ---- Quiz ----

function quizPool(scope) {
    const ids = scope ? [scope] : [...selectedLessons()];
    return ids.flatMap((id) => (lessonById.get(id)?.quiz || []).map((q, qi) => ({ lesson: id, qi, q })));
}

function startQuiz(scope = null, pool = null) {
    let items = pool || quizPool(scope);
    items = shuffled(items);
    if (!scope && !pool) items = items.slice(0, prefs.quizCount);
    items = items.map((it) => ({ ...it, perm: shuffled(it.q.options.map((_, i) => i)) }));
    Object.assign(qs, { active: true, items, pos: 0, chosen: null, results: [], scope, finished: false });
    setPref('mode', 'quiz');
    closeDrawer();
    render();
}

function renderQuiz(stage, sub, actions) {
    stage.className = 'scroll';
    if (!qs.active) {
        const pool = quizPool(null);
        const sel = selectedLessons();
        stage.append(h('div', { class: 'quiz-start' },
            h('h2', {}, 'Quiz'),
            h('p', {}, `${pool.length} questions in the ${sel.size} lesson${sel.size === 1 ? '' : 's'} ticked in the ☰ menu. Each lesson also has its own quiz at the end of the lesson.`),
            h('div', { class: 'panel' },
                h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Questions per quiz'),
                    h('select', { onchange: (e) => setPref('quizCount', Number(e.target.value)) },
                        [5, 10, 20, 40].map((n) => h('option', { value: n, selected: prefs.quizCount === n }, n))))),
            h('div', { class: 'lesson-foot' },
                h('button', { class: 'btn', onclick: openDrawer }, 'Choose lessons'),
                h('button', { class: 'btn primary', disabled: pool.length === 0, onclick: () => startQuiz() }, 'Start quiz'))));
        return;
    }
    if (qs.finished) {
        stage.append(quizSummary());
        return;
    }
    const it = qs.items[qs.pos];
    const lesson = lessonById.get(it.lesson);
    const answered = qs.chosen != null;
    const correctSoFar = qs.results.filter(Boolean).length;
    sub.append(h('div', { class: 'status' },
        h('span', {}, h('strong', {}, `Question ${qs.pos + 1}`), ` of ${qs.items.length}`),
        h('span', {}, `Score ${correctSoFar} of ${qs.results.length}`)));
    stage.append(h('div', { class: 'quiz' },
        h('div', { class: 'q-meta' }, `${lesson.num} · ${plain(st(lesson.title))}`),
        h('div', { class: 'q' }, inline(st(it.q.q))),
        it.perm.map((oi, k) => {
            let cls = 'opt';
            if (answered && oi === it.q.answer) cls += ' right';
            else if (answered && oi === qs.chosen) cls += ' wrong';
            return h('button', { class: cls, disabled: answered, onclick: () => chooseOption(oi) },
                h('strong', {}, `${k + 1}. `), inline(st(it.q.options[oi])));
        }),
        answered && h('div', { class: 'why' },
            h('strong', {}, qs.chosen === it.q.answer ? '✓ Correct. ' : '✗ Not quite. '),
            inline(st(it.q.why || '')))));
    actions.append(
        h('button', { class: 'btn auto', onclick: () => { qs.active = false; render(); } }, 'End'),
        h('button', { class: 'btn primary', disabled: !answered, onclick: nextQuestion },
            qs.pos === qs.items.length - 1 ? 'Finish' : 'Next ›'));
}

function chooseOption(oi) {
    if (qs.chosen != null) return;
    qs.chosen = oi;
    qs.results.push(oi === qs.items[qs.pos].q.answer);
    render();
}

function nextQuestion() {
    if (qs.chosen == null) return;
    if (qs.pos === qs.items.length - 1) {
        qs.finished = true;
        if (qs.scope) {
            const pct = Math.round((qs.results.filter(Boolean).length / qs.items.length) * 100);
            progress.quizBest[qs.scope] = Math.max(progress.quizBest[qs.scope] ?? 0, pct);
            progress.save();
        }
    } else {
        qs.pos++;
        qs.chosen = null;
    }
    render();
    $('#stage').scrollTop = 0;
}

function quizSummary() {
    const correct = qs.results.filter(Boolean).length;
    const total = qs.items.length;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const missed = qs.items.filter((_, i) => !qs.results[i]);
    return h('div', { class: 'summary' },
        h('div', { class: 'big' }, pct >= 80 ? '⭐' : '📘'),
        h('h2', {}, 'Quiz complete'),
        h('div', { class: 'score' }, `${correct} of ${total} correct (${pct}%)`),
        h('p', {}, pct >= 80 ? 'Excellent. Move on to the next lesson.' : 'Reread the lesson sections behind the missed questions, then try again.'),
        h('div', { class: 'buttons' },
            missed.length > 0 && h('button', { class: 'btn primary', onclick: () => startQuiz(qs.scope, missed) }, `Retry the ${missed.length} missed`),
            h('button', { class: 'btn', onclick: () => startQuiz(qs.scope) }, 'New quiz'),
            qs.scope && h('button', { class: 'btn', onclick: () => openLesson(qs.scope) }, 'Back to the lesson')));
}

// ---- Lipi ----

const CHART = {
    vowels: 'अ आ इ ई उ ऊ ऋ ॠ ऌ ॡ ए ऐ ओ औ अं अः'.split(' '),
    consonants: 'क ख ग घ ङ च छ ज झ ञ ट ठ ड ढ ण त थ द ध न प फ ब भ म य र ल व श ष स ह ळ क्ष त्र ज्ञ श्र ॐ'.split(' '),
};

function renderLipi(stage) {
    stage.className = 'scroll';
    const input = h('textarea', {
        placeholder: 'Type or paste Sanskrit in తెలుగు, देवनागरी or IAST…', spellcheck: 'false',
    }, prefs.lipiText);
    const detected = h('div', { class: 'detected' });
    const outs = {};
    const box = (key, title) => {
        const v = h('div', { class: 'v ' + key });
        outs[key] = v;
        return h('div', { class: 'out' },
            h('h4', {}, title, h('button', {
                class: 'copy',
                onclick: () => navigator.clipboard?.writeText(v.textContent),
            }, 'Copy')), v);
    };
    const update = () => {
        const text = input.value;
        setPref('lipiText', text);
        const from = Lipi.detect(text);
        detected.textContent = from ? `Reading this as ${{ te: 'Telugu script', deva: 'Devanagari', iast: 'IAST' }[from]}.` : 'Type something to convert.';
        const deva = from ? Lipi.toDeva(text, from, !prefs.lipiLong) : '';
        outs.te.textContent = Lipi.devaToTelugu(deva);
        outs.deva.textContent = deva;
        outs.iast.textContent = Lipi.devaToIast(deva);
    };
    input.addEventListener('input', update);
    const insert = (deva) => {
        const add = prefs.primary === 'te' ? Lipi.devaToTelugu(deva) : deva;
        const s = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, s) + add + input.value.slice(input.selectionEnd ?? s);
        input.selectionStart = input.selectionEnd = s + add.length;
        update();
    };
    const chart = (letters, cls) => h('div', { class: 'chart ' + cls }, letters.map((d) => h('button', { onclick: () => insert(d) },
        h('span', { class: 'c-te' }, Lipi.devaToTelugu(d)), h('span', { class: 'c-deva' }, d), h('span', { class: 'c-iast' }, Lipi.devaToIast(d)))));
    stage.append(h('div', { class: 'lipi' },
        h('h2', { style: 'margin:4px 2px 8px' }, 'లిపి · Script converter'),
        input, detected,
        h('div', { class: 'panel' }, h('div', { class: 'row' },
            h('input', {
                type: 'checkbox', id: 'lipi-long', checked: prefs.lipiLong,
                onchange: (e) => { setPref('lipiLong', e.target.checked); update(); },
            }),
            h('label', { for: 'lipi-long' }, 'Read Telugu ఎ ఒ (and ె ొ) as Sanskrit ए ओ — Sanskrit has no short e or o'))),
        h('div', { style: 'height:12px' }),
        box('te', 'తెలుగు లిపి'), box('deva', 'देवनागरी'), box('iast', 'IAST'),
        h('h3', {}, 'అక్షరమాల · tap a letter to type it'),
        h('div', { class: 'row-label' }, 'స్వరాః · vowels'), chart(CHART.vowels, 'vowels'),
        h('div', { class: 'row-label' }, 'వ్యంజనాని · consonants'), chart(CHART.consonants, '')));
    update();
}

// ---- Drawer ----

function openDrawer() {
    renderDrawer();
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#backdrop').hidden = false;
}

function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#backdrop').hidden = true;
}

function checkRow(label, checked, onchange) {
    const id = 'c' + Math.random().toString(36).slice(2);
    return h('div', { class: 'row' },
        h('input', { type: 'checkbox', id, checked, onchange: (e) => onchange(e.target.checked) }),
        h('label', { for: id }, label));
}

function renderDrawer() {
    const body = $('#drawer-body');
    const scroll = body.scrollTop;
    body.replaceChildren();
    $('#drawer-foot').textContent = '';
    if (!course) return;
    if (prefs.mode === 'cards' || prefs.mode === 'quiz') {
        if (prefs.mode === 'cards') {
            const filter = h('select', { onchange: (e) => { setPref('filter', e.target.value); rebuildCards(); } },
                FILTERS.map(([v, t]) => h('option', { value: v, selected: prefs.filter === v }, t)));
            body.append(h('h4', {}, 'Practice'), h('div', { class: 'panel' },
                h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Cards'), filter),
                checkRow('Shuffle', prefs.shuffle, (on) => { setPref('shuffle', on); rebuildCards(); }),
                h('button', { class: 'menu-btn', onclick: () => { rebuildCards(); closeDrawer(); } }, '↺ Restart from the first card')));
        }
        const sel = selectedLessons();
        const apply = (ids, on) => {
            for (const id of ids) on ? sel.add(id) : sel.delete(id);
            setSelected(sel);
            if (prefs.mode === 'cards') rebuildCards(); else render();
        };
        body.append(h('h4', {}, 'Practise these lessons'), h('div', { class: 'panel', style: 'margin-bottom:10px' },
            h('div', { class: 'links', style: 'padding-top:10px' },
                h('button', { onclick: () => apply(lessons.map((l) => l.id), true) }, 'Select all'),
                h('button', { onclick: () => apply(lessons.map((l) => l.id), false) }, 'Clear all'),
                h('button', { onclick: () => apply(lessons.filter((l) => progress.done.has(l.id)).map((l) => l.id), true) }, '+ Completed'))));
        for (const unit of course.units) {
            const ids = unit.lessons.map((l) => l.id);
            const collapsed = prefs.collapsed.includes('sel:' + unit.id);
            const count = ids.filter((id) => sel.has(id)).length;
            body.append(h('div', { class: 'panel', style: 'margin-bottom:10px' },
                h('button', {
                    class: 'source-head' + (collapsed ? ' collapsed' : ''),
                    onclick: () => {
                        const set = new Set(prefs.collapsed);
                        collapsed ? set.delete('sel:' + unit.id) : set.add('sel:' + unit.id);
                        setPref('collapsed', [...set]);
                        renderDrawer();
                    },
                }, h('span', { class: 'chev' }, '▾'), `${unit.num}. ${plain(st(unit.title))}`, h('span', { class: 'count' }, `${count}/${ids.length}`)),
                !collapsed && h('div', { class: 'links' },
                    h('button', { onclick: () => apply(ids, true) }, 'Select all'),
                    h('button', { onclick: () => apply(ids, false) }, 'Clear')),
                !collapsed && unit.lessons.map((l) => checkRow(`${l.num} ${plain(st(l.title))}`, sel.has(l.id), (on) => apply([l.id], on)))));
        }
        const n = prefs.mode === 'cards' ? cardPool().length : quizPool(null).length;
        $('#drawer-foot').textContent = `${n} ${prefs.mode === 'cards' ? 'cards' : 'questions'} selected`;
    } else {
        body.append(h('h4', {}, 'పాఠాలు · Lessons'), course.units.map((u) => unitBox(u, (id) => openLesson(id))));
    }
    body.append(h('h4', {}, 'More'), h('div', { class: 'panel' },
        h('button', { class: 'menu-btn', onclick: () => { closeDrawer(); openSettings(); } }, '⚙︎ Settings: script, voice, text size'),
        h('button', { class: 'menu-btn', onclick: exportProgress }, '⤓ Export progress'),
        h('button', { class: 'menu-btn', onclick: importProgress }, '⤒ Import progress'),
        h('button', {
            class: 'menu-btn danger',
            onclick: () => {
                if (!confirm('Clear all card reviews, quiz scores and completed lessons?')) return;
                progress.done.clear();
                progress.srs = {};
                progress.quizBest = {};
                progress.save();
                rebuildCards();
            },
        }, 'Reset all progress')));
    body.scrollTop = scroll;
}

function exportProgress() {
    const data = { done: [...progress.done], srs: progress.srs, quizBest: progress.quizBest };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'sopanam_progress.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importProgress() {
    const input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', async () => {
        try {
            const data = JSON.parse(await input.files[0].text());
            for (const id of data.done || []) progress.done.add(id);
            for (const [id, s] of Object.entries(data.srs || {})) {
                const cur = progress.srs[id];
                if (!cur || s.d > cur.d) progress.srs[id] = s;
            }
            for (const [id, p] of Object.entries(data.quizBest || {})) progress.quizBest[id] = Math.max(progress.quizBest[id] ?? 0, p);
            progress.save();
            render();
            alert('Progress imported.');
        } catch (err) {
            alert('Could not read that file: ' + err.message);
        }
    });
    input.click();
}

// ---- Settings ----

function openSettings() {
    const dialog = $('#settings-dialog');
    const radio = (name, value, label, current, onPick) => {
        const id = `${name}-${value}`;
        return h('div', { class: 'row' },
            h('input', { type: 'radio', name, id, checked: current === value, onchange: () => onPick(value) }),
            h('label', { for: id }, label));
    };
    const set = (key) => (value) => { setPref(key, value); render(); };
    dialog.replaceChildren(
        h('div', { class: 'dialog-body' },
            h('h2', {}, 'Settings'),
            h('h4', {}, 'Show Sanskrit in'),
            h('div', { class: 'panel' },
                radio('primary', 'te', 'తెలుగు లిపి (Telugu script)', prefs.primary, set('primary')),
                radio('primary', 'deva', 'देवनागरी (Devanagari)', prefs.primary, set('primary'))),
            h('h4', {}, 'Under each Sanskrit line'),
            h('div', { class: 'panel' },
                checkRow('Also show the other script', prefs.secondary, set('secondary')),
                checkRow('Also show IAST (roman)', prefs.iast, set('iast'))),
            h('h4', {}, 'Read aloud (🔊)'),
            h('div', { class: 'panel' },
                radio('voice', 'hi', 'Hindi voice reading Devanagari', prefs.voice, set('voice')),
                radio('voice', 'te', 'Telugu voice reading Telugu script', prefs.voice, set('voice')),
                radio('voice', 'off', 'Off', prefs.voice, set('voice'))),
            h('h4', {}, 'Text size'),
            h('div', { class: 'panel' },
                [[0.9, 'Small'], [1, 'Normal'], [1.12, 'Large'], [1.25, 'Extra large']].map(([v, t]) =>
                    radio('scale', String(v), t, String(prefs.scale), (val) => set('scale')(Number(val)))))),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary', onclick: () => dialog.close() }, 'Done')));
    dialog.showModal();
}

// ---- Wiring ----

$('#mode-switch').addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (!value || value === prefs.mode || !course) return;
    setPref('mode', value);
    if (value === 'cards' && !cs.order.length) rebuildCards();
    else render();
});

$('#open-drawer').addEventListener('click', openDrawer);
$('#close-drawer').addEventListener('click', closeDrawer);
$('#backdrop').addEventListener('click', closeDrawer);
$('#open-settings').addEventListener('click', openSettings);

window.addEventListener('popstate', () => {
    const id = location.hash.slice(1);
    setPref('mode', 'lessons');
    setPref('lesson', lessonById.has(id) ? id : null);
    render();
});

document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (document.querySelector('dialog[open]') || e.target.matches('input, textarea, select') || !course) return;
    let run = null;
    if (prefs.mode === 'cards' && !cs.finished && cs.order.length) {
        const card = cs.order[cs.pos];
        const test = prefs.study === 'test';
        run = {
            ArrowLeft: () => moveCard(-1),
            ArrowRight: () => moveCard(1),
            ' ': revealCard,
            g: () => test && answerCard(true),
            m: () => test && answerCard(false),
            k: () => { if (!test) { progress.know(card.id); render(); } },
            r: () => { if (!test) { progress.review(card.id); render(); } },
        }[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    } else if (prefs.mode === 'lessons' && prefs.lesson) {
        const i = lessons.findIndex((l) => l.id === prefs.lesson);
        run = {
            ArrowLeft: () => i > 0 && openLesson(lessons[i - 1].id),
            ArrowRight: () => i < lessons.length - 1 && openLesson(lessons[i + 1].id),
        }[e.key];
    } else if (prefs.mode === 'quiz' && qs.active && !qs.finished) {
        const it = qs.items[qs.pos];
        if (/^[1-9]$/.test(e.key) && Number(e.key) <= it.perm.length) run = () => chooseOption(it.perm[Number(e.key) - 1]);
        else if (e.key === 'Enter' || e.key === 'ArrowRight') run = nextQuestion;
    }
    if (run) {
        e.preventDefault();
        run();
    }
});

render();

fetch('course.json')
    .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    })
    .then((data) => {
        indexCourse(data);
        const hash = location.hash.slice(1);
        if (lessonById.has(hash)) { setPref('mode', 'lessons'); setPref('lesson', hash); }
        history.replaceState({ lesson: prefs.lesson }, '', prefs.mode === 'lessons' && prefs.lesson ? '#' + prefs.lesson : location.pathname);
        const pool = cardPool();
        cs.order = prefs.shuffle ? shuffled(pool) : pool;
        render();
    })
    .catch((err) => {
        loadError = `Open this page once while online so the course can be saved for offline use. (${err.message})`;
        render();
    });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}

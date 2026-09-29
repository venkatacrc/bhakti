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
    for (const c of children.flat()) {
        if (c == null || c === false) continue;
        el.append(c instanceof Node ? c : String(c));
    }
    return el;
}

// ---- Saved state (localStorage) ----

const saved = {
    get(key, fallback) {
        try {
            const v = localStorage.getItem('slokaWords.' + key);
            return v == null ? fallback : JSON.parse(v);
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        localStorage.setItem('slokaWords.' + key, JSON.stringify(value));
    },
};

const prefs = {
    selected: saved.get('selected', '*'),
    excludedLangs: saved.get('excludedLangs', []),
    kind: saved.get('kind', 'words'),
    study: saved.get('study', 'learn'),
    practice: saved.get('practice', 'all'),
    shuffle: saved.get('shuffle', false),
    collapsed: saved.get('collapsed', []),
    print: saved.get('print', {
        te: true, deva: true, iast: true, teMeaning: true, enMeaning: true, words: false, reviewOnly: false,
    }),
};

function setPref(key, value) {
    prefs[key] = value;
    saved.set(key, value);
}

const progress = {
    known: new Set(saved.get('known', [])),
    review: new Set(saved.get('review', [])),
    save() {
        saved.set('known', [...this.known]);
        saved.set('review', [...this.review]);
    },
    markKnown(id) { this.known.add(id); this.review.delete(id); this.save(); },
    markReview(id) { this.review.add(id); this.known.delete(id); this.save(); },
    toggleKnown(id) { this.known.has(id) ? this.known.delete(id) : this.markKnown(id); this.save(); },
    toggleReview(id) { this.review.has(id) ? this.review.delete(id) : this.markReview(id); this.save(); },
};

/** Chanting-style verse edits in the same shape as the repo's verse_edits.json. */
let edits = saved.get('verseEdits', {});

let deck = null;
let loadError = null;

/** `kind` is the card kind `order` was built for; it only changes in rebuild(). */
const session = { kind: 'words', order: [], position: 0, flipped: false, answers: {}, finished: false };

// ---- Deck helpers ----

const groupKey = (src, group) => `${src}|${group}`;
const splitLines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

function allGroupKeys() {
    return deck.sources.flatMap((s) => s.groups.map((g) => groupKey(s.id, g.id)));
}

function selectedSet() {
    return new Set(prefs.selected === '*' ? allGroupKeys() : prefs.selected);
}

function setSelected(set) {
    const all = allGroupKeys();
    setPref('selected', all.every((k) => set.has(k)) ? '*' : [...set].sort());
}

function includedTest() {
    const selected = selectedSet();
    const excluded = new Set(prefs.excludedLangs);
    const langs = Object.fromEntries(deck.sources.map((s) => [s.id, s.lang]));
    return (src, group) => selected.has(groupKey(src, group)) && !excluded.has(langs[src]);
}

function verseAt(index) {
    const v = deck.verses[index];
    const e = edits[v.id];
    return e ? { ...v, te: splitLines(e.te), deva: splitLines(e.deva), iast: splitLines(e.iast), edited: true } : v;
}

function cardId(index) {
    return session.kind === 'words' ? deck.words[index].id : deck.verses[index].id;
}

function currentIndex() {
    const count = session.kind === 'words' ? deck.words.length : deck.verses.length;
    const i = session.order[session.position];
    return i != null && i < count ? i : null;
}

function selectedVerses() {
    const included = includedTest();
    return deck.verses.map((_, i) => verseAt(i)).filter((v) => included(v.src, v.group));
}

function shuffled(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---- Session ----

function rebuild() {
    session.kind = prefs.kind;
    const included = includedTest();
    let picked = [];
    if (session.kind === 'words') {
        deck.words.forEach((w, i) => { if (w.refs.some((r) => included(r.src, r.group))) picked.push(i); });
    } else {
        deck.verses.forEach((v, i) => { if (included(v.src, v.group)) picked.push(i); });
    }
    if (prefs.practice === 'notKnown') picked = picked.filter((i) => !progress.known.has(cardId(i)));
    if (prefs.practice === 'review') picked = picked.filter((i) => progress.review.has(cardId(i)));
    startSession(prefs.shuffle ? shuffled(picked) : picked);
}

function startSession(order) {
    Object.assign(session, { order, position: 0, flipped: false, answers: {}, finished: false });
    render();
}

function move(delta) {
    const n = session.order.length;
    if (!n) return;
    session.position = (session.position + delta + n) % n;
    session.flipped = false;
    render();
}

function reveal() {
    if (prefs.study !== 'test' || session.flipped) return;
    session.flipped = true;
    render();
}

function answer(correct) {
    const index = currentIndex();
    if (index == null || !session.flipped) return;
    const id = cardId(index);
    session.answers[id] = correct;
    correct ? progress.markKnown(id) : progress.markReview(id);
    const n = session.order.length;
    for (let step = 1; step <= n; step++) {
        const p = (session.position + step) % n;
        if (!(cardId(session.order[p]) in session.answers)) {
            session.position = p;
            session.flipped = false;
            render();
            return;
        }
    }
    session.finished = true;
    render();
}

// ---- Rendering ----

function render() {
    renderSwitches();
    renderStatus();
    renderStage();
    renderActions();
    if ($('#drawer').classList.contains('open')) renderDrawer();
}

function renderSwitches() {
    for (const [id, value] of [['#kind-switch', prefs.kind], ['#study-switch', prefs.study]]) {
        for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.value === value);
    }
}

function renderStatus() {
    const el = $('#status');
    el.replaceChildren();
    if (!deck || !session.order.length || (prefs.study === 'test' && session.finished)) return;
    const n = session.order.length;
    el.append(h('span', {}, h('strong', {}, `Card ${session.position + 1}`), ` of ${n}`));
    if (prefs.study === 'test') {
        const answered = Object.keys(session.answers).length;
        const correct = Object.values(session.answers).filter(Boolean).length;
        el.append(h('span', {}, `Score ${correct} of ${answered} · ${n - answered} to go`));
    } else {
        let known = 0, review = 0;
        for (const i of session.order) {
            const id = cardId(i);
            if (progress.known.has(id)) known++;
            if (progress.review.has(id)) review++;
        }
        el.append(h('span', {}, `Known ${known} · Review ${review}`));
    }
}

function renderStage() {
    const stage = $('#stage');
    stage.replaceChildren();
    if (loadError) {
        stage.append(h('div', { class: 'empty' }, h('h2', {}, 'Could not load the cards'), h('p', {}, loadError)));
        return;
    }
    if (!deck) {
        stage.append(h('div', { class: 'empty' }, 'Loading cards…'));
        return;
    }
    if (prefs.study === 'test' && session.finished) {
        stage.append(testSummary());
        return;
    }
    const index = currentIndex();
    if (index == null) {
        stage.append(h('div', { class: 'empty' },
            h('div', { class: 'big' }, '🗂'),
            h('h2', {}, 'No cards to practice'),
            h('p', {}, emptyHint()),
            h('button', { class: 'btn primary', onclick: openDrawer }, 'Choose chapters')));
        return;
    }
    const flipped = prefs.study === 'learn' || session.flipped;
    const card = session.kind === 'words'
        ? wordCard(deck.words[index], flipped)
        : verseCard(verseAt(index), index, flipped);
    card.addEventListener('click', (e) => { if (!e.target.closest('button')) reveal(); });
    addSwipe(card);
    stage.append(card);
}

function emptyHint() {
    if (prefs.practice === 'review') return 'No cards are marked for review in the selected chapters.';
    if (prefs.practice === 'notKnown') return 'Every card in the selected chapters is marked known.';
    return 'Tick at least one chapter or section.';
}

function badges(id, label, extra = []) {
    return h('div', { class: 'badges' },
        label ? h('span', { class: 'label' }, label) : h('span', { class: 'label' }),
        extra,
        progress.known.has(id) && h('span', { class: 'badge known' }, 'Known'),
        progress.review.has(id) && h('span', { class: 'badge review' }, 'Review'));
}

function script(label, cls, lines) {
    return h('div', { class: 'script' },
        h('div', { class: 'script-label' }, label),
        lines.map((l) => h('div', { class: cls }, l)));
}

function meaning(title, ...content) {
    return h('div', { class: 'meaning' }, h('h3', {}, title), content);
}

function wordCard(w, flipped) {
    const refs = w.refs.map((r) => r.label);
    const found = refs.slice(0, 6).join(', ') + (refs.length > 6 ? ` and ${refs.length - 6} more` : '');
    return h('article', { class: 'card word' + (flipped ? ' flipped' : '') },
        badges(w.id),
        script('తెలుగు', 'te', [w.te]),
        script('हिन्दी', 'deva', [w.deva]),
        script('IAST', 'iast', [w.iast]),
        flipped
            ? h('div', { class: 'meanings' },
                meaning('తెలుగు భావం', w.te_meaning
                    ? h('p', { class: 'te-text' }, w.te_meaning)
                    : h('p', { class: 'missing' }, 'Telugu meaning not added yet')),
                meaning('English meaning', w.en.length > 1
                    ? h('ul', {}, w.en.map((m) => h('li', {}, m)))
                    : h('p', {}, w.en[0] ?? '')),
                meaning('Found in', h('p', { class: 'muted' }, found)))
            : h('div', { class: 'hint' }, 'Recall the meaning, then tap the card'));
}

function verseCard(v, index, flipped) {
    const take = (lines) => (flipped ? lines : lines.slice(0, 1));
    const editBtn = h('button', { class: 'btn small', onclick: () => openEditor(index) }, '✎ Edit');
    editBtn.style.minHeight = '30px';
    editBtn.style.padding = '2px 10px';
    return h('article', { class: 'card verse' + (flipped ? ' flipped' : '') },
        badges(v.id, v.label, [v.edited && h('span', { class: 'badge edited' }, 'Edited'), editBtn]),
        script('తెలుగు', 'te', take(v.te)),
        script('हिन्दी', 'deva', take(v.deva)),
        script('IAST', 'iast', take(v.iast)),
        flipped
            ? h('div', { class: 'meanings' },
                v.te_meaning && meaning('తెలుగు భావం', h('p', { class: 'te-text' }, v.te_meaning)),
                v.en_meaning && meaning('English meaning', h('p', {}, v.en_meaning)),
                v.words && meaning('Word by word', h('p', { class: 'muted' }, v.words)))
            : h('div', { class: 'hint' }, v.te.length > 1
                ? 'Recite the rest of the verse, then tap the card to check'
                : 'Recall the meaning, then tap the card'));
}

function testSummary() {
    const correct = Object.values(session.answers).filter(Boolean).length;
    const missed = session.order.filter((i) => session.answers[cardId(i)] === false);
    const total = session.order.length;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    return h('div', { class: 'summary' },
        h('div', { class: 'big' }, missed.length ? '✅' : '⭐'),
        h('h2', {}, 'Test complete'),
        h('div', { class: 'score' }, `${correct} of ${total} correct (${percent}%)`),
        h('p', {}, missed.length
            ? `Cards you got are marked known; the ${missed.length} you missed are marked for review.`
            : 'Every card is now marked known.'),
        h('div', { class: 'buttons' },
            missed.length > 0 && h('button', {
                class: 'btn primary',
                onclick: () => startSession(prefs.shuffle ? shuffled(missed) : missed),
            }, `Retest the ${missed.length} missed`),
            h('button', { class: 'btn', onclick: rebuild }, 'Start a new test'),
            h('button', { class: 'btn', onclick: () => { setPref('study', 'learn'); rebuild(); } }, 'Switch to Learn')));
}

function renderActions() {
    const bar = $('#actions');
    bar.replaceChildren();
    const index = deck ? currentIndex() : null;
    if (index == null || (prefs.study === 'test' && session.finished)) return;
    const id = cardId(index);
    const prev = h('button', { class: 'btn small', onclick: () => move(-1), 'aria-label': 'Previous card' }, '‹');
    const next = h('button', { class: 'btn small', onclick: () => move(1), 'aria-label': 'Next card' }, '›');
    if (prefs.study === 'learn') {
        bar.append(prev,
            h('button', {
                class: 'btn' + (progress.known.has(id) ? ' on-known' : ''),
                onclick: () => { progress.toggleKnown(id); render(); },
            }, progress.known.has(id) ? '✓ Known' : 'Known'),
            h('button', {
                class: 'btn' + (progress.review.has(id) ? ' on-review' : ''),
                onclick: () => { progress.toggleReview(id); render(); },
            }, progress.review.has(id) ? '⚑ Review' : 'Review'),
            next);
    } else if (!session.flipped) {
        bar.append(prev,
            h('button', { class: 'btn primary', onclick: reveal }, session.kind === 'words' ? 'Show answer' : 'Show verse'),
            h('button', { class: 'btn small', onclick: () => move(1) }, 'Skip ›'));
    } else {
        bar.append(prev,
            h('button', { class: 'btn bad', onclick: () => answer(false) }, '✗ Missed it'),
            h('button', { class: 'btn good', onclick: () => answer(true) }, '✓ Got it'),
            h('button', { class: 'btn small', onclick: () => move(1), 'aria-label': 'Skip' }, '›'));
    }
}

function addSwipe(el) {
    let x0 = null, y0 = null;
    el.addEventListener('touchstart', (e) => {
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        const dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
    });
}

// ---- Drawer: chapters and options ----

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

function checkRow(label, checked, onchange, disabled = false) {
    const id = 'c' + Math.random().toString(36).slice(2);
    return h('div', { class: 'row' },
        h('input', { type: 'checkbox', id, checked, disabled, onchange: (e) => onchange(e.target.checked) }),
        h('label', { for: id }, label));
}

function renderDrawer() {
    const body = $('#drawer-body');
    const scroll = body.scrollTop;
    body.replaceChildren();
    if (!deck) return;

    const practice = h('select', { onchange: (e) => { setPref('practice', e.target.value); rebuild(); } },
        [['all', 'All cards'], ['notKnown', 'Not yet known'], ['review', 'Review only']]
            .map(([v, t]) => h('option', { value: v, selected: prefs.practice === v }, t)));
    body.append(h('h4', {}, 'Practice'), h('div', { class: 'panel' },
        h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Cards'), practice),
        checkRow('Shuffle', prefs.shuffle, (on) => { setPref('shuffle', on); rebuild(); }),
        h('button', { class: 'menu-btn', onclick: () => { rebuild(); closeDrawer(); } }, '↺ Restart from the first card')));

    const langs = [...new Set(deck.sources.map((s) => s.lang))].sort();
    if (langs.length > 1) {
        body.append(h('h4', {}, 'Language'), h('div', { class: 'panel' }, langs.map((lang) =>
            checkRow(lang[0].toUpperCase() + lang.slice(1), !prefs.excludedLangs.includes(lang), (on) => {
                const set = new Set(prefs.excludedLangs);
                on ? set.delete(lang) : set.add(lang);
                setPref('excludedLangs', [...set].sort());
                rebuild();
            }))));
    }

    const selected = selectedSet();
    const toggle = (keys, on) => {
        for (const k of keys) on ? selected.add(k) : selected.delete(k);
        setSelected(selected);
        rebuild();
    };
    body.append(h('h4', {}, 'Practice these'));
    for (const source of deck.sources) {
        const keys = source.groups.map((g) => groupKey(source.id, g.id));
        const collapsed = prefs.collapsed.includes(source.id);
        const disabled = prefs.excludedLangs.includes(source.lang);
        const count = keys.filter((k) => selected.has(k)).length;
        body.append(h('div', { class: 'panel', style: 'margin-bottom:10px' },
            h('button', {
                class: 'source-head' + (collapsed ? ' collapsed' : ''),
                onclick: () => {
                    const set = new Set(prefs.collapsed);
                    collapsed ? set.delete(source.id) : set.add(source.id);
                    setPref('collapsed', [...set]);
                    renderDrawer();
                },
            }, h('span', { class: 'chev' }, '▾'), source.title, h('span', { class: 'count' }, `${count}/${keys.length}`)),
            !collapsed && h('div', { class: 'links' },
                h('button', { onclick: () => toggle(keys, true), disabled }, 'Select all'),
                h('button', { onclick: () => toggle(keys, false), disabled }, 'Clear')),
            !collapsed && source.groups.map((g, i) =>
                checkRow(g.label, selected.has(keys[i]), (on) => toggle([keys[i]], on), disabled))));
    }

    const editCount = Object.keys(edits).length;
    body.append(h('h4', {}, 'More'), h('div', { class: 'panel' },
        h('button', { class: 'menu-btn', onclick: () => { closeDrawer(); openPrint(); } }, '🖨 Print / Save as PDF'),
        h('button', { class: 'menu-btn', onclick: exportEdits, disabled: editCount === 0 },
            `⤓ Export verse edits (${editCount})`),
        h('button', {
            class: 'menu-btn danger',
            onclick: () => {
                if (!confirm('Clear every Known and Review mark?')) return;
                progress.known.clear();
                progress.review.clear();
                progress.save();
                rebuild();
            },
        }, 'Reset progress'),
        h('a', { class: 'menu-btn', href: '../', style: 'color:inherit;text-decoration:none' }, '📖 Read the full texts')));

    const noun = session.kind === 'words' ? 'word cards' : 'verse cards';
    $('#drawer-foot').textContent = `${session.order.length} ${noun} selected`;
    body.scrollTop = scroll;
}

// ---- Verse editor ----

function openEditor(index) {
    const original = deck.verses[index];
    const current = verseAt(index);
    const dialog = $('#edit-dialog');
    const area = (cls, lines) => h('textarea', { class: cls, spellcheck: 'false' }, lines.join('\n'));
    const te = area('te', current.te);
    const deva = area('deva', current.deva);
    const iast = area('iast', current.iast);
    const close = () => { dialog.close(); render(); };
    dialog.replaceChildren(
        h('div', { class: 'dialog-body' },
            h('h2', {}, `Edit ${original.label}`),
            h('p', {}, 'Match your chanting style: one line per line of the verse. Edits stay on this device; export them from the menu to add them to the repo.'),
            h('label', { class: 'field' }, 'తెలుగు'), te,
            h('label', { class: 'field' }, 'हिन्दी'), deva,
            h('label', { class: 'field' }, 'IAST'), iast),
        h('div', { class: 'dialog-actions' },
            edits[original.id] && h('button', {
                class: 'btn bad',
                onclick: () => { delete edits[original.id]; saved.set('verseEdits', edits); close(); },
            }, 'Revert'),
            h('button', { class: 'btn', onclick: () => dialog.close() }, 'Cancel'),
            h('button', {
                class: 'btn primary',
                onclick: () => {
                    const edit = { deva: deva.value, iast: iast.value, te: te.value };
                    const same = ['te', 'deva', 'iast'].every((k) => splitLines(edit[k]).join('\n') === original[k].join('\n'));
                    if (same) delete edits[original.id]; else edits[original.id] = edit;
                    saved.set('verseEdits', edits);
                    close();
                },
            }, 'Save')));
    dialog.showModal();
}

function exportEdits() {
    const sorted = Object.fromEntries(Object.keys(edits).sort().map((k) => [k, edits[k]]));
    const blob = new Blob([JSON.stringify(sorted, null, 2) + '\n'], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'verse_edits.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- Print / PDF ----

function openPrint() {
    if (!deck) return;
    const dialog = $('#print-dialog');
    const opts = { ...prefs.print };
    const countLine = h('p', {});
    const printBtn = h('button', { class: 'btn primary', onclick: () => { dialog.close(); printVerses(opts); } },
        'Print / Save as PDF');
    const update = () => {
        saved.set('print', opts);
        prefs.print = { ...opts };
        const n = versesToPrint(opts).length;
        countLine.textContent = n
            ? `${n} verse${n === 1 ? '' : 's'} from the chapters ticked in the menu. In the print screen, choose “Save as PDF” to make a PDF.`
            : 'No verses to print. Tick some chapters in the menu, or turn off “Only verses marked for review”.';
        printBtn.disabled = n === 0;
    };
    const opt = (key, label) => checkRow(label, opts[key], (on) => { opts[key] = on; update(); });
    dialog.replaceChildren(
        h('div', { class: 'dialog-body' },
            h('h2', {}, 'Print verses'),
            countLine,
            h('h4', { style: 'margin:12px 0 6px' }, 'Scripts'),
            h('div', { class: 'panel' }, opt('te', 'తెలుగు'), opt('deva', 'हिन्दी (Devanagari)'), opt('iast', 'IAST')),
            h('h4', { style: 'margin:12px 0 6px' }, 'Meanings'),
            h('div', { class: 'panel' },
                opt('teMeaning', 'తెలుగు భావం'), opt('enMeaning', 'English meaning'), opt('words', 'Word by word')),
            h('h4', { style: 'margin:12px 0 6px' }, 'Which verses'),
            h('div', { class: 'panel' }, opt('reviewOnly', 'Only verses marked for review'))),
        h('div', { class: 'dialog-actions' },
            h('button', { class: 'btn', onclick: () => dialog.close() }, 'Cancel'),
            printBtn));
    update();
    dialog.showModal();
}

function versesToPrint(opts) {
    const verses = selectedVerses();
    return opts.reviewOnly ? verses.filter((v) => progress.review.has(v.id)) : verses;
}

function printVerses(opts) {
    const verses = versesToPrint(opts);
    const sources = Object.fromEntries(deck.sources.map((s) => [s.id, s]));
    const heading = (v) => {
        const s = sources[v.src];
        if (!s) return v.src;
        const g = s.groups.find((x) => x.id === v.group);
        return s.groups.length > 1 ? `${s.title} — ${g ? g.label : v.group}` : s.title;
    };
    const title = [...new Set(verses.map((v) => v.src))].map((id) => sources[id]?.title ?? id).join(', ') || 'Sloka Words';

    const area = $('#print-area');
    area.replaceChildren(
        h('h1', {}, title),
        h('div', { class: 'count' }, `${verses.length} verse${verses.length === 1 ? '' : 's'}`));
    let last = null;
    for (const v of verses) {
        const head = heading(v);
        if (head !== last) {
            area.append(h('h2', {}, head));
            last = head;
        }
        const lines = (cls, list) => h('div', { class: 'pv-lines ' + cls }, list.flatMap((l, i) => (i ? [h('br'), l] : [l])));
        area.append(h('div', { class: 'pv' },
            h('div', { class: 'pv-label' }, v.label),
            opts.te && lines('te', v.te),
            opts.deva && lines('deva', v.deva),
            opts.iast && lines('iast', v.iast),
            opts.teMeaning && v.te_meaning && h('p', { class: 'pv-meaning te' }, h('b', {}, 'తెలుగు భావం  '), v.te_meaning),
            opts.enMeaning && v.en_meaning && h('p', { class: 'pv-meaning' }, h('b', {}, 'MEANING  '), v.en_meaning),
            opts.words && v.words && h('p', { class: 'pv-meaning words' }, h('b', {}, 'WORD BY WORD  '), v.words)));
    }

    const oldTitle = document.title;
    document.title = title;
    window.addEventListener('afterprint', () => { document.title = oldTitle; }, { once: true });
    window.print();
}

// ---- Wiring ----

for (const [id, key] of [['#kind-switch', 'kind'], ['#study-switch', 'study']]) {
    $(id).addEventListener('click', (e) => {
        const value = e.target.closest('button')?.dataset.value;
        if (!value || value === prefs[key] || !deck) return;
        setPref(key, value);
        rebuild();
    });
}

$('#open-drawer').addEventListener('click', openDrawer);
$('#close-drawer').addEventListener('click', closeDrawer);
$('#backdrop').addEventListener('click', closeDrawer);
$('#open-print').addEventListener('click', openPrint);

document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'p' && deck) {
            e.preventDefault();
            openPrint();
        }
        return;
    }
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (document.querySelector('dialog[open]') || e.target.matches('input, textarea, select')) return;
    if (!deck || currentIndex() == null || session.finished) return;
    const test = prefs.study === 'test';
    const id = cardId(currentIndex());
    const actions = {
        ArrowLeft: () => move(-1),
        ArrowRight: () => move(1),
        ' ': () => reveal(),
        g: () => test && answer(true),
        m: () => test && answer(false),
        k: () => { if (!test) { progress.toggleKnown(id); render(); } },
        r: () => { if (!test) { progress.toggleReview(id); render(); } },
        e: () => { if (session.kind === 'verses') openEditor(currentIndex()); },
    };
    const run = actions[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (run) {
        e.preventDefault();
        run();
    }
});

render();

fetch('words.json')
    .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    })
    .then((data) => {
        deck = { sources: data.sources, words: data.words, verses: data.verses ?? [] };
        rebuild();
    })
    .catch((err) => {
        loadError = `Open this page once while online so the cards can be saved for offline use. (${err.message})`;
        render();
    });

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}

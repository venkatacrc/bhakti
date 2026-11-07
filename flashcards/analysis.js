'use strict';
// Samsaadhanii's Gītā analysis: word split, anvaya, word analysis and kāraka graph.
// gita_analysis.json says where each verse's file is; the file itself is downloaded from
// Samsaadhanii's GitHub the first time the verse is opened, then kept in the Cache API.
// Mirrors app/Sources/SlokaWords/GitaAnalysis.swift.

const GitaAnalysis = (() => {
    let index = null;
    const parsed = new Map();

    // ---- Script ----

    const ANUSVARA_RULES = [
        [/ఙ్(-?)(?=[కఖగఘ])/g, 'ం$1'], [/ఞ్(-?)(?=[చఛజఝ])/g, 'ం$1'], [/ణ్(-?)(?=[టఠడఢ])/g, 'ం$1'],
        [/న్(-?)(?=[తథదధ])/g, 'ం$1'], [/మ్(-?)(?=[పఫబభ])/g, 'ం$1'],
    ];

    /** Same conversion the deck builder uses for its Telugu lines. */
    function devaToTelugu(text) {
        let out = '';
        for (const ch of text) {
            const c = ch.codePointAt(0);
            if (ch === 'ॐ') out += 'ఓం';
            else if (ch === '\u093C') continue;
            else if (c >= 0x0901 && c <= 0x0963 && ch !== '।' && ch !== '॥') out += String.fromCodePoint(c + 0x300);
            else out += ch;
        }
        for (const [re, rep] of ANUSVARA_RULES) out = out.replace(re, rep);
        return out;
    }

    const inScript = (deva, script) => (script === 'te' ? devaToTelugu(deva) : deva);

    // ---- Index and download ----

    async function load() {
        if (index) return index;
        const r = await fetch('gita_analysis.json');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        index = await r.json();
        return index;
    }

    const loaded = () => !!index;

    function verseKey(verse) {
        if (!verse || verse.src !== 'gita') return null;
        const m = /^gita:(\d+):(\d+)$/.exec(verse.id);
        return m ? `${m[1]}:${m[2]}` : null;
    }

    function filesFor(verse) {
        const key = verseKey(verse);
        return (index && key && index.verses[key]) || [];
    }

    const has = (verse) => filesFor(verse).length > 0;

    /** Verse numbers ("1.4") a file covers, for files that analyse several verses together. */
    function versesInFile(stem) {
        return Object.entries(index.verses).filter(([, files]) => files.includes(stem)).map(([k]) => k.replace(':', '.'));
    }

    const cacheName = () => 'samsaadhanii-gita-' + index.source.commit.slice(0, 7);
    const fileUrl = (stem) => index.source.url + encodeURIComponent(stem) + '.tsv';
    const allFiles = () => [...new Set(Object.values(index.verses).flat())];

    async function fetchText(stem) {
        const url = fileUrl(stem);
        const cache = 'caches' in self ? await caches.open(cacheName()) : null;
        const hit = cache && (await cache.match(url));
        if (hit) return hit.text();
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (cache) await cache.put(url, r.clone());
        return r.text();
    }

    async function analysis(stem) {
        if (!parsed.has(stem)) parsed.set(stem, fetchText(stem).then(build));
        try {
            return await parsed.get(stem);
        } catch (err) {
            parsed.delete(stem);
            throw err;
        }
    }

    async function savedCount() {
        if (!('caches' in self)) return 0;
        const cache = await caches.open(cacheName());
        return (await cache.keys()).length;
    }

    async function downloadAll(onProgress) {
        const files = allFiles();
        const cache = await caches.open(cacheName());
        const have = new Set((await cache.keys()).map((r) => r.url));
        const todo = files.filter((stem) => !have.has(fileUrl(stem)));
        let done = files.length - todo.length;
        let failed = 0;
        onProgress(done, files.length, failed);
        const worker = async () => {
            while (todo.length) {
                const stem = todo.shift();
                try {
                    const r = await fetch(fileUrl(stem));
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    await cache.put(fileUrl(stem), r);
                    done++;
                } catch {
                    failed++;
                }
                onProgress(done, files.length, failed);
            }
        };
        await Promise.all(Array.from({ length: 6 }, worker));
        return { done, total: files.length, failed };
    }

    // ---- Parsing ----

    function relationKey(name) {
        return name.replace(/[\u200b\u200c\u200d\u00a0]/g, '').replace(/[\s_.\-\d]/g, '').replace(/ः$/u, '');
    }

    function relationInfo(name) {
        if (!name || !index) return null;
        let key = relationKey(name);
        if (!key) return null;
        key = index.aliases[key] || key;
        return index.relations[key] || { sa: name.replace(/_/g, ' '), kind: 'other', te: '', en: '' };
    }

    /** "कर्ता,10.1" → { name, target }; also "अभिहित_कर्ता.15.3.1" with a dot for the comma. */
    function parseRelation(raw) {
        const first = (raw || '').split(';')[0].trim();
        let name = first, target = '';
        const comma = first.indexOf(',');
        if (comma >= 0) {
            name = first.slice(0, comma).trim();
            target = first.slice(comma + 1).trim();
        } else {
            const m = /^(.*?[^\d.])\.(\d+(?:\.\d+)*)$/u.exec(first);
            if (m) { name = m[1]; target = m[2]; }
        }
        return { name, target: target.replace(/[^\d.]/g, ''), info: relationInfo(name) };
    }

    function parseTsv(text) {
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
        const head = lines[0].split('\t').map((h) => h.trim().toLowerCase());
        const col = (name) => head.findIndex((h) => h === name || h.startsWith(name + '.'));
        const c = {
            index: [col('index'), col('anvaya_no'), 0].find((i) => i >= 0), word: col('word'), poem: col('poem'),
            sandhi: col('sandhied_word'), morph: col('morph_in_context'), rel: col('kaaraka_sambandha'),
            en: col('english_meaning'),
        };
        const rows = [];
        for (const line of lines.slice(1)) {
            const cells = line.split('\t');
            const get = (i) => (i >= 0 && i < cells.length ? cells[i].trim() : '');
            const id = get(c.index).replace(/\.+$/, '');
            if (!/^\d+(\.\d+)*$/.test(id) || !get(c.word)) continue;
            const poem = Number.parseFloat(get(c.poem));
            rows.push({
                id,
                parts: id.split('.'),
                word: get(c.word),
                poem: Number.isFinite(poem) ? poem : null,
                sandhi: get(c.sandhi) === '-' ? '' : get(c.sandhi),
                morph: get(c.morph),
                rel: parseRelation(get(c.rel)),
                en: get(c.en).replace(/_/g, ' ').replace(/\s+/g, ' ').trim(),
            });
        }
        return rows;
    }

    /** A word: one row, the rows of a compound ("4.1", "4.2"), or an understood word ("4.1.1"). */
    const wordIdOf = (rowId) => {
        const parts = rowId.split('.');
        return parts.length >= 3 ? rowId : parts[0];
    };

    function build(text) {
        const rows = parseTsv(text);
        const words = [];
        const byId = new Map();
        for (const row of rows) {
            const wid = wordIdOf(row.id);
            let w = byId.get(wid);
            if (!w) {
                w = { id: wid, rows: [], supplied: row.parts.length >= 3, poem: null, en: '', sandhi: '' };
                byId.set(wid, w);
                words.push(w);
            }
            w.rows.push(row);
            if (w.poem == null && row.poem != null) w.poem = row.poem;
            if (!w.en && row.en) w.en = row.en;
        }
        const resolve = (target) => {
            if (!target) return null;
            const exact = byId.get(target);
            if (exact && exact.supplied) return exact;
            return byId.get(wordIdOf(target)) || byId.get(target.split('.')[0]) || null;
        };
        for (const w of words) {
            w.text = w.rows.map((r) => r.word).join('');
            w.compound = w.rows.length > 1
                ? w.rows.map((r) => ({ word: r.word, rel: resolve(r.rel.target) === w ? r.rel.info : null }))
                : null;
            const outward = [...w.rows].reverse().find((r) => {
                const t = resolve(r.rel.target);
                return t && t !== w;
            });
            const headRow = outward || w.rows[w.rows.length - 1];
            w.morph = parseMorph(headRow.morph);
            w.rel = headRow.rel.info;
            w.target = outward ? resolve(outward.rel.target) : null;
        }

        // Parents: a word hangs under the word its relation points to. The verb's own
        // "abhihita" relation only notes agreement, so it does not make an edge.
        for (const w of words) {
            w.parent = w.target && w.rel && w.rel.kind !== 'verb' ? w.target : null;
            w.children = [];
        }
        for (const w of words) {
            const seen = new Set([w]);
            for (let p = w.parent; p; p = p.parent) {
                if (seen.has(p)) { w.parent = null; break; }
                seen.add(p);
            }
        }
        for (const w of words) if (w.parent) w.parent.children.push(w);

        const anvaya = words.map((w, i) => ({ w, i }))
            .sort((a, b) => (a.w.poem ?? 1e9) - (b.w.poem ?? 1e9) || a.i - b.i)
            .map(({ w }) => w);
        const rank = new Map(anvaya.map((w, i) => [w, i]));
        for (const w of words) w.children.sort((a, b) => rank.get(a) - rank.get(b));
        const sentences = anvaya.filter((w) => !w.parent);

        const verseOrder = words.filter((w) => !w.supplied);
        const sandhi = [];
        for (const row of rows) {
            if (row.parts.length >= 3) continue;
            if (row.sandhi || !sandhi.length) sandhi.push({ joined: row.sandhi, words: [] });
            const group = sandhi[sandhi.length - 1];
            const w = byId.get(wordIdOf(row.id));
            if (!group.words.includes(w)) group.words.push(w);
        }
        const plain = (s) => s.replace(/[-\s]/g, '');
        const splits = sandhi.filter((g) => g.joined && (g.words.length > 1 || plain(g.joined) !== plain(g.words[0].text)));

        return { words, verseOrder, anvaya, sentences, splits };
    }

    /** "सञ्जनयत्{पुं;1;एक(जन्2;शतृ_लट्;जनी;:दिवादिः)}" → stem, tags, and the root it comes from. */
    function parseMorph(raw) {
        let s = (raw || '').trim();
        if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
        s = s.split('/')[0].replace(/\}\s*\{/g, ';');
        const m = /^([^{]*)\{(.*)\}\s*$/u.exec(s);
        const cleanStem = (t) => t.replace(/\d+/g, '').split('_').filter(Boolean).join(' + ');
        if (!m) return { stem: cleanStem(s), tags: [], root: '', rootTags: [], isRoot: false };
        let depth = 0, cur = '', inner = '';
        const main = [];
        for (const ch of m[2]) {
            if (ch === '(') { depth++; if (depth === 1) { if (cur.trim()) main.push(cur.trim()); cur = ''; continue; } }
            if (ch === ')') { depth--; if (depth === 0) continue; }
            if (depth > 0) inner += ch;
            else if (ch === ';') { if (cur.trim()) main.push(cur.trim()); cur = ''; }
            else cur += ch;
        }
        if (cur.trim()) main.push(cur.trim());
        const tokens = (list) => list.flatMap((t) => {
            const last = t.split(':').filter(Boolean).pop() || '';
            const pieces = last.split('_');
            return pieces.length > 1 && pieces.every((p) => index.tags[p]) ? pieces : [last];
        }).filter((t) => t && t !== 'कृत्_प्रत्ययः' && t !== 'कृत्');
        // A verb's tags end with its dhātupāṭha form ("असँ"), which repeats the root.
        const known = (list) => (list.some((t) => /ादिः$/u.test(t)) ? list.filter((t) => index.tags[t]) : list);
        const tags = known(tokens(main));
        const deriv = inner ? inner.split(';').map((t) => t.trim()).filter(Boolean) : [];
        const root = deriv.length ? cleanStem(deriv[0]) : '';
        const rootTags = tokens(deriv.slice(1)).filter((t) => index.tags[t]);
        const isRoot = !root && tags.some((t) => /^(लट्|लिट्|लुट्|लृट्|लोट्|लङ्|विधिलिङ्|आशीर्लिङ्|लुङ्|लृङ्|ल्यप्|क्त्वा|तुमुन्)$/u.test(t));
        return { stem: cleanStem(m[1]), tags, root, rootTags, isRoot };
    }

    // ---- Rendering ----

    const LABELS = {
        te: {
            split: 'పదచ్ఛేదం', anvaya: 'అన్వయం', words: 'పద పరిచయం', graph: 'కారక చిత్రం',
            stem: 'ప్రాతిపదిక', root: 'ధాతువు', from: 'మూలం', sentence: 'వాక్యం', sandhi: 'సంధి విడదీత',
            verseOrder: 'శ్లోకంలోని క్రమంలో పదాలు', proseOrder: 'గద్య క్రమం', compound: 'సమాసం',
            legend: 'సంబంధాలు', supplied: 'కుండలీకరణంలోని పదాలు శ్లోకంలో లేవు, అర్థం కోసం చేర్చినవి.',
            tap: 'పదం మీద నొక్కితే దాని అర్థం కనిపిస్తుంది.',
        },
        deva: {
            split: 'पदच्छेदः', anvaya: 'अन्वयः', words: 'पदपरिचयः', graph: 'कारकसम्बन्धः',
            stem: 'प्रातिपदिकम्', root: 'धातुः', from: 'मूलम्', sentence: 'वाक्यम्', sandhi: 'सन्धिविच्छेदः',
            verseOrder: 'श्लोके पदानि', proseOrder: 'गद्यक्रमः', compound: 'समासः',
            legend: 'सम्बन्धाः', supplied: 'Words in brackets are not in the verse; they are understood.',
            tap: 'Tap a word to see its meaning.',
        },
    };

    const TABS = ['split', 'anvaya', 'words', 'graph'];

    function tagLabel(tag, script) {
        const t = index.tags[tag];
        if (!t) return inScript(tag, script);
        return script === 'te' ? t.te : t.sa;
    }

    function relationLabel(info, script) {
        return info ? inScript(info.sa, script) : '';
    }

    function relationGloss(info) {
        if (!info) return '';
        return [info.te, info.en].filter(Boolean).join(' · ');
    }

    function meaningOf(w, meanings) {
        const te = meanings ? meanings(w) : '';
        return { te, en: w.en };
    }

    function splitView(model, script, L) {
        const text = (w) => inScript(w.text, script);
        return h('div', { class: 'ga-section' },
            h('h4', {}, L.verseOrder),
            h('p', { class: 'ga-line' }, model.verseOrder.map(text).join('  ')),
            model.splits.length > 0 && h('h4', {}, L.sandhi),
            model.splits.length > 0 && h('ul', { class: 'ga-splits' }, model.splits.map((g) =>
                h('li', {},
                    h('span', { class: 'ga-joined' }, inScript(g.joined, script)),
                    ' = ',
                    g.words.map((w, i) => [i ? ' + ' : '', h('span', { class: 'ga-part' }, text(w))])))));
    }

    function anvayaView(model, script, L, meanings) {
        return h('div', { class: 'ga-section' },
            h('h4', {}, L.proseOrder),
            h('p', { class: 'ga-line' }, model.anvaya.map((w) => inScript(w.text, script)).join('  ')),
            h('div', { class: 'ga-gloss' }, model.anvaya.map((w) => {
                const m = meaningOf(w, meanings);
                return h('div', { class: 'ga-chip' + (w.supplied ? ' supplied' : '') },
                    h('div', { class: 'ga-chip-word' }, inScript(w.text, script)),
                    m.te && h('div', { class: 'ga-chip-te' }, m.te),
                    m.en && h('div', { class: 'ga-chip-en' }, m.en));
            })),
            model.anvaya.some((w) => w.supplied) && h('p', { class: 'ga-note' }, L.supplied));
    }

    function morphLine(morph, script, L) {
        const chips = [];
        if (morph.stem) {
            chips.push(h('span', { class: 'ga-stem' },
                `${morph.isRoot ? L.root : L.stem}: `, h('b', {}, inScript(morph.stem, script))));
        }
        for (const t of morph.tags) chips.push(h('span', { class: 'ga-tag', title: index.tags[t]?.te || '' }, tagLabel(t, script)));
        if (morph.root) {
            chips.push(h('span', { class: 'ga-stem' }, `${L.from}: `, h('b', {}, inScript(morph.root, script)),
                morph.rootTags.length ? ` (${morph.rootTags.map((t) => tagLabel(t, script)).join(', ')})` : ''));
        }
        return h('div', { class: 'ga-morph' }, chips);
    }

    function wordsView(model, script, L, meanings) {
        return h('div', { class: 'ga-section' }, model.words.map((w) => {
            const m = meaningOf(w, meanings);
            return h('div', { class: 'ga-word' + (w.supplied ? ' supplied' : '') },
                h('div', { class: 'ga-word-head' },
                    h('span', { class: 'ga-word-text' }, inScript(w.text, script)),
                    h('span', { class: 'ga-word-meaning' }, [m.te, m.en].filter(Boolean).join(' · '))),
                morphLine(w.morph, script, L),
                w.compound && h('div', { class: 'ga-compound' },
                    `${L.compound}: `,
                    w.compound.map((p, i) => [
                        i ? ' ' : '',
                        h('span', { class: 'ga-part' }, inScript(p.word, script)),
                        p.rel && h('span', { class: 'ga-rel-inline', title: relationGloss(p.rel) }, ` (${relationLabel(p.rel, script)})`),
                    ])),
                w.rel && h('div', { class: 'ga-relation' },
                    h('span', { class: 'ga-rel kind-' + w.rel.kind }, relationLabel(w.rel, script)),
                    w.target && [' → ', h('span', { class: 'ga-part' }, inScript(w.target.text, script))],
                    w.rel.te && h('span', { class: 'ga-rel-gloss' }, ' · ' + w.rel.te)));
        }));
    }

    // ---- Kāraka graph ----

    let measureCtx = null;
    function textWidth(text, font) {
        measureCtx ||= document.createElement('canvas').getContext('2d');
        measureCtx.font = font;
        return measureCtx.measureText(text).width;
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    function svg(tag, attrs = {}, ...children) {
        const el = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
        for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
        return el;
    }

    /** Lays out one sentence as a tree: head word on top, each dependent below it. */
    function layoutTree(root, script) {
        const fontFamily = script === 'te'
            ? '"Noto Sans Telugu", "Kohinoor Telugu", "Telugu Sangam MN", system-ui, sans-serif'
            : '"Noto Sans Devanagari", "Kohinoor Devanagari", "Devanagari Sangam MN", system-ui, sans-serif';
        const wordFont = `600 15px ${fontFamily}`;
        const labelFont = `500 11.5px ${fontFamily}`;
        const NODE_H = 32, GAP = 12, BUS = 14, STUB = 30, PAD = 12;
        const LEVEL = NODE_H + BUS + STUB;
        const nodes = [];
        const walk = (w, depth) => {
            const label = inScript(w.text, script);
            const rel = w.parent ? relationLabel(w.rel, script) : '';
            const n = {
                w, depth, label, rel, children: [],
                boxW: Math.max(textWidth(label, wordFont) + 20, 40),
                relW: rel ? textWidth(rel, labelFont) + 10 : 0,
            };
            n.colW = Math.max(n.boxW, n.relW) + GAP;
            nodes.push(n);
            n.children = w.children.map((c) => walk(c, depth + 1));
            n.width = Math.max(n.colW, n.children.reduce((s, c) => s + c.width, 0));
            return n;
        };
        const top = walk(root, 0);
        const place = (n, left) => {
            if (n.children.length) {
                let x = left + (n.width - n.children.reduce((s, c) => s + c.width, 0)) / 2;
                for (const c of n.children) { place(c, x); x += c.width; }
                n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
            } else {
                n.x = left + n.width / 2;
            }
            n.y = PAD + n.depth * LEVEL + NODE_H / 2;
        };
        place(top, PAD);
        const depth = Math.max(...nodes.map((n) => n.depth));
        return {
            nodes, NODE_H, BUS, wordFont, labelFont,
            width: top.width + PAD * 2,
            height: PAD * 2 + depth * LEVEL + NODE_H,
        };
    }

    function treeSvg(root, script, onPick) {
        const L = layoutTree(root, script);
        const edges = [], labels = [], boxes = [];
        for (const n of L.nodes) {
            const bottom = n.y + L.NODE_H / 2;
            if (n.children.length) {
                const busY = bottom + L.BUS;
                const xs = n.children.map((c) => c.x);
                edges.push(svg('path', {
                    class: 'kg-edge',
                    d: `M${n.x},${bottom}V${busY}` + (xs.length > 1 || xs[0] !== n.x ? `M${Math.min(n.x, ...xs)},${busY}H${Math.max(n.x, ...xs)}` : ''),
                }));
                for (const c of n.children) {
                    const childTop = c.y - L.NODE_H / 2;
                    edges.push(svg('path', { class: 'kg-edge', d: `M${c.x},${busY}V${childTop}` }));
                    if (c.rel) {
                        const ly = childTop - 9;
                        labels.push(svg('g', { class: 'kg-rel kind-' + (c.w.rel?.kind || 'other') },
                            svg('rect', { x: c.x - c.relW / 2, y: ly - 9, width: c.relW, height: 16, rx: 4 }),
                            svg('text', { x: c.x, y: ly + 3.5, 'text-anchor': 'middle' }, c.rel),
                            svg('title', {}, relationGloss(c.w.rel))));
                    }
                }
            }
            const g = svg('g', { class: 'kg-node' + (n.w.supplied ? ' supplied' : '') + (n.depth === 0 ? ' root' : ''), tabindex: '0' },
                svg('rect', { x: n.x - n.boxW / 2, y: n.y - L.NODE_H / 2, width: n.boxW, height: L.NODE_H, rx: 9 }),
                svg('text', { x: n.x, y: n.y + 5, 'text-anchor': 'middle' }, n.label));
            g.addEventListener('click', (e) => { e.stopPropagation(); onPick(n.w); });
            boxes.push(g);
        }
        return svg('svg', {
            class: 'kg ' + script, width: Math.ceil(L.width), height: Math.ceil(L.height),
            viewBox: `0 0 ${Math.ceil(L.width)} ${Math.ceil(L.height)}`, role: 'img',
        }, edges, labels, boxes);
    }

    function graphView(model, script, L, meanings) {
        const info = h('div', { class: 'ga-pick' }, L.tap);
        const pick = (w) => {
            const m = meaningOf(w, meanings);
            info.replaceChildren(
                h('b', {}, inScript(w.text, script)),
                ' ', [m.te, m.en].filter(Boolean).join(' · ') || '',
                w.rel && w.parent && h('div', { class: 'ga-pick-rel' },
                    relationLabel(w.rel, script), ' → ', inScript(w.parent.text, script),
                    w.rel.te && ` · ${w.rel.te}`));
        };
        const used = new Map();
        for (const w of model.words) if (w.parent && w.rel) used.set(w.rel.sa, w.rel);
        return h('div', { class: 'ga-section' },
            info,
            model.sentences.map((root, i) => h('div', { class: 'ga-tree' },
                model.sentences.length > 1 && h('h4', {}, `${L.sentence} ${i + 1}`),
                h('div', { class: 'ga-tree-scroll' }, treeSvg(root, script, pick)))),
            used.size > 0 && h('h4', {}, L.legend),
            used.size > 0 && h('ul', { class: 'ga-legend' }, [...used.values()].map((r) =>
                h('li', {}, h('span', { class: 'ga-rel kind-' + r.kind }, relationLabel(r, script)), ' ', relationGloss(r)))));
    }

    function view(model, tab, script, meanings) {
        const L = LABELS[script];
        if (tab === 'split') return splitView(model, script, L);
        if (tab === 'anvaya') return anvayaView(model, script, L, meanings);
        if (tab === 'words') return wordsView(model, script, L, meanings);
        return graphView(model, script, L, meanings);
    }

    return {
        load, loaded, has, filesFor, versesInFile, analysis, savedCount, downloadAll, allFiles,
        view, build, parseMorph, devaToTelugu, inScript, LABELS, TABS,
        get source() { return index?.source; },
        set index(v) { index = v; },
    };
})();

if (typeof module !== 'undefined') module.exports = GitaAnalysis;

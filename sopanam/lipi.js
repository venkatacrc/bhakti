'use strict';
// Transliteration between Devanagari, Telugu script and IAST. Mirrors tools/lipi.py and
// app/Sources/Sopanam/Lipi.swift. Devanagari and Telugu share one Unicode layout, so most
// letters convert by a fixed offset; IAST needs the inherent-vowel rule.

const Lipi = (() => {
    const OFFSET = 0x0C00 - 0x0900;
    const DEVA_TO_TE = { 'ॐ': 'ఓం', '।': '।', '॥': '॥', '\u093C': '', '\u0945': '\u0C46', '\u0949': '\u0C4A' };
    const VOWELS = {
        'अ': 'a', 'आ': 'ā', 'इ': 'i', 'ई': 'ī', 'उ': 'u', 'ऊ': 'ū', 'ऋ': 'ṛ', 'ॠ': 'ṝ', 'ऌ': 'ḷ', 'ॡ': 'ḹ',
        'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऎ': 'ĕ', 'ऒ': 'ŏ',
    };
    const SIGNS = {
        'ा': 'ā', 'ि': 'i', 'ी': 'ī', 'ु': 'u', 'ू': 'ū', 'ृ': 'ṛ', 'ॄ': 'ṝ', 'ॢ': 'ḷ', 'ॣ': 'ḹ',
        'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॆ': 'ĕ', 'ॊ': 'ŏ',
    };
    const CONSONANTS = {
        'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ṅ', 'च': 'c', 'छ': 'ch', 'ज': 'j', 'झ': 'jh', 'ञ': 'ñ',
        'ट': 'ṭ', 'ठ': 'ṭh', 'ड': 'ḍ', 'ढ': 'ḍh', 'ण': 'ṇ', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
        'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
        'श': 'ś', 'ष': 'ṣ', 'स': 's', 'ह': 'h', 'ळ': 'ḻ', 'ऱ': 'ṟ', 'ऴ': 'ẓ',
    };
    const OTHER = {
        'ं': 'ṃ', 'ः': 'ḥ', 'ँ': 'm̐', 'ऽ': "'", 'ॐ': 'oṃ', '।': '|', '॥': '||', '्': '', '\u093C': '',
        '\u200c': '', '\u200d': '',
    };
    const VIRAMA = '्';
    const DEVA_RE = /[\u0900-\u097F]/;
    const TE_RE = /[\u0C00-\u0C7F]/;

    function devaToTelugu(text) {
        let out = '';
        for (const ch of text) {
            if (ch in DEVA_TO_TE) out += DEVA_TO_TE[ch];
            else {
                const c = ch.codePointAt(0);
                out += c >= 0x0900 && c <= 0x097F ? String.fromCodePoint(c + OFFSET) : ch;
            }
        }
        return out;
    }

    /** Telugu script to Devanagari. Telugu short ఎ/ఒ become Sanskrit ए/ओ unless keepShort. */
    function teluguToDeva(text, keepShort = false) {
        let out = '';
        for (const ch of text.normalize('NFC')) {
            const c = ch.codePointAt(0);
            if (!keepShort && (ch === 'ఎ' || ch === 'ఒ' || ch === 'ె' || ch === 'ొ')) {
                out += { 'ఎ': 'ए', 'ఒ': 'ओ', 'ె': 'े', 'ొ': 'ो' }[ch];
            } else if (ch === 'ై') out += 'ै';
            else if (ch === 'ౘ') out += 'च';
            else if (ch === 'ౙ') out += 'ज';
            else if (c >= 0x0C00 && c <= 0x0C7F) out += String.fromCodePoint(c - OFFSET);
            else out += ch;
        }
        return out;
    }

    function devaToIast(text) {
        const chars = [...text.replace(/\[\[|\]\]/g, '')];
        let out = '';
        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            if (ch in CONSONANTS) {
                out += CONSONANTS[ch];
                let j = i + 1;
                while (chars[j] === '\u093C') j++;
                const next = chars[j];
                if (next === VIRAMA) { i = j; continue; }
                if (next in SIGNS) { out += SIGNS[next]; i = j; continue; }
                out += 'a';
                i = j - 1;
                continue;
            }
            if (ch in VOWELS) out += VOWELS[ch];
            else if (ch in SIGNS) out += SIGNS[ch];
            else if (ch in OTHER) out += OTHER[ch];
            else {
                const c = ch.codePointAt(0);
                out += c >= 0x0966 && c <= 0x096F ? String(c - 0x0966) : ch;
            }
        }
        return out;
    }

    const IAST_VOWELS = [
        ['ai', 'ऐ', 'ै'], ['au', 'औ', 'ौ'], ['ā', 'आ', 'ा'], ['ī', 'ई', 'ी'], ['ū', 'ऊ', 'ू'],
        ['ṝ', 'ॠ', 'ॄ'], ['ṛ', 'ऋ', 'ृ'], ['ḹ', 'ॡ', 'ॣ'], ['ḷ', 'ऌ', 'ॢ'], ['ĕ', 'ऎ', 'ॆ'], ['ŏ', 'ऒ', 'ॊ'],
        ['a', 'अ', ''], ['i', 'इ', 'ि'], ['u', 'उ', 'ु'], ['e', 'ए', 'े'], ['o', 'ओ', 'ो'],
    ];
    const IAST_CONS = Object.entries(CONSONANTS).map(([d, r]) => [r, d]).sort((a, b) => b[0].length - a[0].length);
    const IAST_OTHER = [['m̐', 'ँ'], ['ṃ', 'ं'], ['ṁ', 'ं'], ['ḥ', 'ः'], ['||', '॥'], ['|', '।'], ["'", 'ऽ'], ['’', 'ऽ']];

    function iastToDeva(text) {
        const s = text.normalize('NFC').toLowerCase();
        let out = '';
        let pending = false;
        let i = 0;
        const match = (list) => list.find(([r]) => s.startsWith(r, i));
        while (i < s.length) {
            const cons = match(IAST_CONS);
            if (cons) {
                if (pending) out += VIRAMA;
                out += cons[1];
                pending = true;
                i += cons[0].length;
                continue;
            }
            const vow = match(IAST_VOWELS);
            if (vow) {
                out += pending ? vow[2] : vow[1];
                pending = false;
                i += vow[0].length;
                continue;
            }
            if (pending) out += VIRAMA;
            pending = false;
            const other = match(IAST_OTHER);
            if (other) {
                out += other[1];
                i += other[0].length;
                continue;
            }
            const ch = s[i];
            out += /[0-9]/.test(ch) ? String.fromCodePoint(0x0966 + Number(ch)) : ch;
            i++;
        }
        if (pending) out += VIRAMA;
        return out;
    }

    function detect(text) {
        let te = 0, deva = 0, latin = 0;
        for (const ch of text) {
            if (TE_RE.test(ch)) te++;
            else if (DEVA_RE.test(ch)) deva++;
            else if (/[a-zāīūṛṝḷḹṃṁḥṅñṭḍṇśṣ]/i.test(ch)) latin++;
        }
        if (!te && !deva && !latin) return null;
        return te >= deva && te >= latin ? 'te' : deva >= latin ? 'deva' : 'iast';
    }

    /** Any of the three scripts to Devanagari. */
    function toDeva(text, from = detect(text), keepShort = false) {
        if (from === 'te') return teluguToDeva(text, keepShort);
        if (from === 'iast') return iastToDeva(text);
        return text;
    }

    const hasDeva = (text) => !!text && DEVA_RE.test(text);

    return { devaToTelugu, teluguToDeva, devaToIast, iastToDeva, detect, toDeva, hasDeva };
})();

if (typeof module !== 'undefined') module.exports = Lipi;

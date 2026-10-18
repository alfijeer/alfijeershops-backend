'use strict';
// Search logic with NO database code, so it is fast to test. controllers/searchController.js fetches the data.
const { CATEGORIES, KEYWORDS, STOPWORDS, BRANDS } = require('../config/searchKeywords');

const normalize = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // user text can never become a regex pattern

// "phones" -> also "phone";  "ao7" -> also "a07" (people type the letter O for a zero)
function variants(token) {
  const v = new Set([token]);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) v.add(token.slice(0, -1));
  if (/\d/.test(token)) { v.add(token.replace(/o/g, '0')); v.add(token.replace(/0/g, 'o')); }
  return [...v];
}

function tokenize(q) {
  const seen = new Set();
  return normalize(q).split(' ').filter((t) => t && !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)))
    .filter((t) => (seen.has(t) ? false : seen.add(t))).slice(0, 6);
}

const WORD_TO_CATS = new Map();
const addWord = (w, cat) => { if (!WORD_TO_CATS.has(w)) WORD_TO_CATS.set(w, new Set()); WORD_TO_CATS.get(w).add(cat); };
Object.entries(KEYWORDS).forEach(([cat, words]) => words.split(' ').forEach((w) => addWord(w, cat)));
CATEGORIES.forEach(({ name }) => normalize(name).split(' ').filter((w) => w.length >= 5).forEach((w) => addWord(w, name)));

function categoriesFor(token) {
  const out = new Set();
  variants(token).forEach((v) => (WORD_TO_CATS.get(v) || []).forEach((c) => out.add(c)));
  return [...out];
}
function inferCategories(tokens) {
  const out = new Set();
  tokens.forEach((t) => categoriesFor(t).forEach((c) => out.add(c)));
  return [...out];
}

const isBrand = (token) => variants(token).some((v) => BRANDS.has(v));

// A word must appear in the name or description (or the category text). In a MULTI-word search, a product-TYPE word
// ("samsung PHONE", "nike SHOES") is also satisfied by the product's category. Brands never match a whole category.
function tokenClause(token, opts) {
  const o = opts || {};
  const or = [];
  variants(token).forEach((v) => { const re = new RegExp(escapeRegex(v), 'i'); or.push({ name: re }, { description: re }); if (o.categoryText) or.push({ category: re }); });
  if (o.categoryImplied) { const cats = categoriesFor(token); if (cats.length) or.push({ category: { $in: cats } }); }
  return { $or: or };
}
const strictProductFilter = (tokens) => (tokens.length
  ? { $and: tokens.map((t) => tokenClause(t, { categoryText: true, categoryImplied: tokens.length > 1 && !isBrand(t) })) } : {});
const looseProductFilter = (tokens) => ({ $or: tokens.map((t) => tokenClause(t)) }); // ANY word, name/description only

function scoreProduct(p, tokens, phrase) {
  const name = normalize(p.name), desc = normalize(p.description), cat = normalize(p.category);
  let s = 0;
  tokens.forEach((t) => {
    const vs = variants(t);
    if (vs.some((v) => name.includes(v))) s += 3;
    else if (vs.some((v) => desc.includes(v))) s += 1;
    else if (vs.some((v) => cat.includes(v))) s += 0.5;
  });
  if (phrase && name.includes(phrase)) s += 5;
  if (tokens.length && name.startsWith(tokens[0])) s += 1;
  return s;
}

// Shop numbers: "shop 12", "Shop #012", "#12", or just "12" (whole query). Returns { number, rest } or { number: null }.
// "shop 12 samsung" -> number 12, rest "samsung" (so the buyer can look inside one shop).
function extractShopNumber(q) {
  const text = String(q || '').trim();
  let m = text.match(/^(?:shop\s*)?#?\s*0*(\d{1,6})$/i);
  if (m) return { number: Number(m[1]), rest: '' };
  m = text.match(/\bshop\s*#?\s*0*(\d{1,6})\b/i);
  if (m) return { number: Number(m[1]), rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim() };
  return { number: null, rest: text };
}

// Shop matches when EVERY word appears in its name, category, city or state.
function shopMatches(shop, tokens) {
  const text = normalize([shop.businessName, shop.category, shop.city, shop.state].join(' '));
  return tokens.every((t) => variants(t).some((v) => text.includes(v)));
}

module.exports = { extractShopNumber, isBrand, normalize, escapeRegex, variants, tokenize, categoriesFor, inferCategories, strictProductFilter, looseProductFilter, scoreProduct, shopMatches, CATEGORIES };

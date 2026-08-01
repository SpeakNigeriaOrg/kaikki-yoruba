// src/lib/luaLiteral.mjs
//
// A parser for the restricted Lua subset that Wiktionary's data modules use:
// a `local export = {}` header followed by `export.<key> = <literal>`
// assignments, where every literal is a string, number, boolean, nil, or a
// table of those. No functions, no concatenation, no control flow, no
// `require` - verified against Module:dialect synonyms/yo (max table depth 6)
// and its 140 per-term data pages.
//
// Why parse rather than regex: the variety metadata is a nested tree whose
// depth carries meaning (family > group > variety > subdialect > location),
// and a term's region key matches the *leaf* name. A flat regex can read the
// `["Region"] = {...}` map but cannot recover that hierarchy.
//
// Lua tables are both array and hash, and these modules use both at once (a
// node has a `name` field *and* positional children), so a table parses to
// { array, map } rather than to a JS array or object.

function skipTrivia(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] === '-' && src[i + 1] === '-') {
      if (src[i + 2] === '[' && src[i + 3] === '[') {
        const end = src.indexOf(']]', i + 4);
        i = end < 0 ? src.length : end + 2;
      } else {
        const end = src.indexOf('\n', i);
        i = end < 0 ? src.length : end + 1;
      }
      continue;
    }
    return i;
  }
}

const STRING_ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v' };

function parseString(src, i) {
  const quote = src[i];
  i += 1;
  let out = '';
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\') {
      const esc = src[i + 1];
      if (esc >= '0' && esc <= '9') {
        // Lua decimal byte escape: up to three digits.
        let digits = '';
        i += 1;
        while (digits.length < 3 && src[i] >= '0' && src[i] <= '9') digits += src[i++];
        out += String.fromCharCode(Number(digits));
        continue;
      }
      out += Object.prototype.hasOwnProperty.call(STRING_ESCAPES, esc) ? STRING_ESCAPES[esc] : esc;
      i += 2;
      continue;
    }
    out += src[i];
    i += 1;
  }
  return [out, i + 1];
}

function parseTable(src, start) {
  let i = skipTrivia(src, start + 1); // past '{'
  const array = [];
  const map = Object.create(null);

  while (i < src.length && src[i] !== '}') {
    let key = null;

    if (src[i] === '[') {
      const afterBracket = skipTrivia(src, i + 1);
      const [k, next] = parseValue(src, afterBracket);
      key = String(k);
      i = skipTrivia(src, next);
      if (src[i] === ']') i = skipTrivia(src, i + 1);
      if (src[i] === '=') i = skipTrivia(src, i + 1);
    } else {
      // An identifier followed by a lone '=' is a field; anything else is a
      // positional entry. `==` can't occur in a literal, but guard anyway.
      const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      if (ident) {
        const after = skipTrivia(src, i + ident[0].length);
        if (src[after] === '=' && src[after + 1] !== '=') {
          key = ident[0];
          i = skipTrivia(src, after + 1);
        }
      }
    }

    const [value, next] = parseValue(src, i);
    if (key === null) array.push(value);
    else map[key] = value;

    i = skipTrivia(src, next);
    if (src[i] === ',' || src[i] === ';') i = skipTrivia(src, i + 1);
  }

  return [{ array, map }, i + 1];
}

function parseValue(src, start) {
  const i = skipTrivia(src, start);
  const ch = src[i];

  if (ch === '"' || ch === "'") return parseString(src, i);
  if (ch === '{') return parseTable(src, i);

  const word = /^(true|false|nil)\b/.exec(src.slice(i));
  if (word) return [word[1] === 'true' ? true : word[1] === 'false' ? false : null, i + word[1].length];

  const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(src.slice(i));
  if (num) return [Number(num[0]), i + num[0].length];

  // Anything else (an identifier, a call, a concatenation) is outside the
  // subset. Report the position so a changed upstream format fails loudly
  // rather than silently yielding partial data.
  throw new Error(`luaLiteral: unsupported value at offset ${i}: ${JSON.stringify(src.slice(i, i + 40))}`);
}

// Returns { [key]: value } for every top-level `export.<key> = <literal>`.
// Assignments whose value falls outside the subset are collected in
// `unsupported` instead of throwing, so one exotic field can't sink a page.
export function parseLuaModule(src) {
  const fields = Object.create(null);
  const unsupported = [];
  const assignment = /(?:^|\n)\s*export\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
  let m;

  while ((m = assignment.exec(src))) {
    try {
      const [value] = parseValue(src, m.index + m[0].length);
      fields[m[1]] = value;
    } catch (err) {
      unsupported.push({ key: m[1], message: err.message });
    }
  }

  return { fields, unsupported };
}

// [[page|shown]] -> shown, [[page]] -> page. Wiktionary display strings are
// wikitext; the JSON artifact should carry plain text.
export function stripWikiLinks(text) {
  return String(text ?? '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .trim();
}

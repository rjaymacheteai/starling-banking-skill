// Parses JSON that may contain // and /* */ comments and trailing commas, so that
// config.json can explain itself. Strings are respected, so "http://x" is left alone.

function mapOutsideStrings(text, visit) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const step = visit(text, i);
    out += step.emit;
    i = step.next;
  }
  return out;
}

export function parseJsonc(text) {
  const noComments = mapOutsideStrings(text, (t, i) => {
    if (t[i] === '/' && t[i + 1] === '/') {
      let j = i;
      while (j < t.length && t[j] !== '\n') j++;
      return { emit: '', next: j };
    }
    if (t[i] === '/' && t[i + 1] === '*') {
      const end = t.indexOf('*/', i + 2);
      return { emit: ' ', next: end === -1 ? t.length : end + 2 };
    }
    return { emit: t[i], next: i + 1 };
  });
  const noTrailingCommas = mapOutsideStrings(noComments, (t, i) => {
    if (t[i] === ',') {
      let j = i + 1;
      while (j < t.length && /\s/.test(t[j])) j++;
      if (t[j] === '}' || t[j] === ']') return { emit: '', next: i + 1 };
    }
    return { emit: t[i], next: i + 1 };
  });
  return JSON.parse(noTrailingCommas);
}

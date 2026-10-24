// Secrets must never reach stdout, logs or error messages, because agent transcripts
// are stored and sometimes shared. Known secrets are registered at load time and
// pattern matching catches anything token-shaped that slipped through.

const secrets = new Set();

export function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 8) secrets.add(value);
}

export function clearSecrets() {
  secrets.clear();
}

const PATTERNS = [
  /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_+/=-]+)*/g, // JWT-shaped tokens (Starling access tokens)
  /(Bearer\s+)[^\s;"']+/gi,
  /(signature=")[^"]+(")/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const s of secrets) out = out.split(s).join('[REDACTED]');
  out = out.replace(PATTERNS[0], '[REDACTED]');
  out = out.replace(PATTERNS[1], '$1[REDACTED]');
  out = out.replace(PATTERNS[2], '$1[REDACTED]$2');
  out = out.replace(PATTERNS[3], '[REDACTED PRIVATE KEY]');
  return out;
}

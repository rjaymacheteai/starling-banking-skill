// A CliError is something the user (or the agent acting for them) can act on:
// it carries a stable code, a plain-English message and an optional fix hint.
export class CliError extends Error {
  constructor(code, message, { hint, details, exit = 1 } = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.exit = exit;
  }
}

export function usage(message, hint) {
  return new CliError('USAGE', message, { hint, exit: 2 });
}

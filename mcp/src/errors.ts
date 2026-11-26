// The only exception whose content reaches the model. Anything else thrown by a tool is reported
// as a generic internal error, with the details kept in the server log.

export interface ToolErrorOptions {
  /** Text shown to the model; defaults to the code. */
  message?: string;
  /** Next step for the model, rendered on its own line after an arrow. */
  hint?: string;
  details?: unknown;
  /** Values for the `{name}` slots of the dictionary text `error.<code>.message` / `.hint`. */
  params?: Readonly<Record<string, string | number>>;
  cause?: unknown;
}

export class ToolError extends Error {
  override readonly name = 'ToolError';
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;
  readonly params?: Readonly<Record<string, string | number>>;

  constructor(code: string, options: ToolErrorOptions = {}) {
    super(
      options.message ?? code,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = code;
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.details !== undefined) this.details = options.details;
    if (options.params !== undefined) this.params = options.params;
  }
}

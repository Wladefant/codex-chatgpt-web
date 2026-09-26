export interface ChatGptWebAdapterErrorOptions {
  status: number;
  errorType: string;
  code: string;
  retryable: boolean;
  cause?: unknown;
}

export class ChatGptWebAdapterError extends Error {
  readonly status: number;
  readonly errorType: string;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: ChatGptWebAdapterErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ChatGptWebAdapterError";
    this.status = options.status;
    this.errorType = options.errorType;
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

// Only the compaction owner may signal this after the broker accepts its one-shot handoff.
// It cancels browser observation, while the accepted summary remains the native result.
export class ChatGptCompactionHandoffAccepted extends DOMException {
  constructor() {
    super("Structured compaction handoff accepted", "AbortError");
  }
}

export function chatGptBrowserTabClosedError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "The ChatGPT browser tab was closed, so the Codex turn was cancelled.",
    {
      status: 499,
      errorType: "client_closed_request",
      code: "client_cancelled",
      retryable: false,
    },
  );
}

export function chatGptTurnSupersededError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "A newer Codex instruction superseded this ChatGPT response.",
    { status: 499, errorType: "client_closed_request", code: "client_cancelled", retryable: false },
  );
}

export function chatGptStoppedThinkingError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "ChatGPT displayed 'Stopped thinking' and could not continue this response. "
    + "A ChatGPT Web usage limit may have been reached. Check the ChatGPT tab for the exact reason before retrying.",
    {
      status: 502,
      errorType: "server_error",
      code: "chatgpt_stopped_thinking",
      retryable: false,
    },
  );
}

export function chatGptRetainedConversationUnavailableError(): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    "The retained ChatGPT conversation is no longer available.",
    {
      status: 409,
      errorType: "invalid_request_error",
      code: "compaction_source_unavailable",
      retryable: false,
    },
  );
}

/**
 * The message was accepted but the response DOM could not be read.
 *
 * A probe that runs out of budget proves nothing about the turn, so it must never be reported as an
 * absent response: that is how a rendering page became a silent turn that streamed nothing and
 * waited for the client's idle deadline (veyyon#34). Retryable, because the page is usually
 * observable again on the next attempt.
 */
export function chatGptResponseUnobservableError(message: string, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, {
    status: 503,
    errorType: "server_error",
    code: "browser_dom_unobservable",
    retryable: true,
    cause,
  });
}

export function chatGptResponseStalledError(
  message = "ChatGPT stopped responding after the task started. Check the ChatGPT tab before continuing.",
  cause?: unknown,
): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(message, {
    status: 504,
    errorType: "server_error",
    code: "chatgpt_response_stalled",
    retryable: true,
    cause,
  });
}

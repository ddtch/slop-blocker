// Runs in the page's MAIN world at document_start (see manifest).
//
// Its only job is to look inside `ytInitialPlayerResponse` — a page JavaScript
// object the isolated content-script world cannot reach — and report a tiny
// summary of anything that looks like a synthetic-content disclosure.
//
// It deliberately does NOT post the player response itself: that object is
// hundreds of kilobytes and crossing worlds with it every navigation would be
// wasteful. It also does not decide anything; the isolated world matches the
// reported strings against the disclosure list.

(() => {
  const EVENT = 'slopblocker:yt';

  /** Keys that only exist when a synthetic-content disclosure exists. */
  const STRICT_KEY = /(synthetic|altered|aigenerated|ai_generated|aicontent)/i;
  /**
   * "disclosure" alone is too broad — YouTube also uses it for paid promotion —
   * so these hits are reported as non-strict and must match a known disclosure
   * string before the isolated world trusts them.
   */
  const LOOSE_KEY = /disclosure/i;

  const MAX_NODES = 20000;
  const MAX_DEPTH = 14;
  const MAX_HITS = 24;
  const MAX_VALUE_LENGTH = 300;

  interface Hit {
    path: string;
    value: string | boolean;
    strict: boolean;
  }

  interface Payload {
    videoId: string | null;
    hits: Hit[];
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  function scan(root: unknown): Payload {
    const hits: Hit[] = [];
    let videoId: string | null = null;
    let nodes = 0;

    const stack: Array<{ value: unknown; path: string; depth: number }> = [
      { value: root, path: '', depth: 0 },
    ];

    while (stack.length > 0 && nodes < MAX_NODES && hits.length < MAX_HITS) {
      const current = stack.pop()!;
      if (!isRecord(current.value) || current.depth > MAX_DEPTH) continue;
      nodes++;

      if (Array.isArray(current.value)) {
        for (let i = 0; i < current.value.length && i < 200; i++) {
          stack.push({ value: current.value[i], path: `${current.path}[${i}]`, depth: current.depth + 1 });
        }
        continue;
      }

      for (const [key, value] of Object.entries(current.value)) {
        const path = current.path ? `${current.path}.${key}` : key;

        if (key === 'videoId' && typeof value === 'string' && !videoId) videoId = value;

        const strict = STRICT_KEY.test(key) || STRICT_KEY.test(current.path);
        const loose = strict || LOOSE_KEY.test(key);

        if (loose) {
          // Only a `true` flag or a non-empty label is evidence; `false` is not.
          if (value === true) {
            hits.push({ path, value: true, strict });
          } else if (typeof value === 'string' && value.length > 0 && value.length <= MAX_VALUE_LENGTH) {
            hits.push({ path, value, strict });
          }
        }

        if (isRecord(value)) stack.push({ value, path, depth: current.depth + 1 });
      }
    }

    return { videoId, hits: hits.slice(0, MAX_HITS) };
  }

  let lastSerialized = '';

  function post(response: unknown): void {
    if (!isRecord(response)) return;
    try {
      const payload = scan(response);
      const serialized = JSON.stringify(payload);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      // A string detail avoids structured-clone limits between worlds.
      window.dispatchEvent(new CustomEvent(EVENT, { detail: serialized }));
    } catch {
      // Never let instrumentation break the page.
    }
  }

  function currentResponse(): unknown {
    return (window as unknown as Record<string, unknown>).ytInitialPlayerResponse;
  }

  // Capture the assignment YouTube makes during page load.
  let stored: unknown = currentResponse();
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => stored,
      set: (value: unknown) => {
        stored = value;
        post(value);
      },
    });
    if (stored) post(stored);
  } catch {
    // Property already non-configurable; the polling below covers us.
  }

  function fromNavigationEvent(event: Event): unknown {
    const detail = (event as CustomEvent).detail;
    if (!isRecord(detail)) return currentResponse();
    const response = detail.response;
    if (isRecord(response) && response.playerResponse) return response.playerResponse;
    if (detail.playerResponse) return detail.playerResponse;
    return currentResponse();
  }

  for (const name of ['yt-navigate-finish', 'yt-page-data-updated', 'yt-player-updated']) {
    window.addEventListener(name, (event) => post(fromNavigationEvent(event)), true);
  }

  // Fallback for the case where the property hook did not take: poll briefly.
  let polls = 0;
  const timer = setInterval(() => {
    if (polls++ > 20) {
      clearInterval(timer);
      return;
    }
    const response = currentResponse();
    if (response) post(response);
  }, 500);
})();

import { useEffect, useRef } from 'react';

export interface AdaptivePollOptions {
  /** Interval while things are changing. */
  baseMs: number;
  /** Longest interval once nothing has changed for a while. */
  maxMs: number;
  enabled?: boolean;
}

/**
 * Polls with back-off: each unchanged result doubles the wait up to `maxMs`, and a
 * change snaps it back to `baseMs`. Polling pauses while the tab is hidden and runs
 * immediately when it becomes visible again. Every poll is a serverless invocation,
 * so this keeps idle social screens from burning through the plan's allowance.
 *
 * `poll` returns a value that identifies the current state (for example a JSON
 * string or an updated-at timestamp); equal values count as "unchanged".
 */
export function useAdaptivePoll(poll: () => Promise<unknown>, { baseMs, maxMs, enabled = true }: AdaptivePollOptions) {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    let delay = baseMs;
    let lastSignature: string | undefined;
    let running = false;

    const schedule = () => {
      window.clearTimeout(timer);
      if (cancelled || document.hidden) return;
      timer = window.setTimeout(run, delay);
    };

    const run = async () => {
      if (cancelled || running) return;
      running = true;
      try {
        const signature = JSON.stringify(await pollRef.current() ?? null);
        delay = signature === lastSignature ? Math.min(maxMs, delay * 2) : baseMs;
        lastSignature = signature;
      } catch {
        delay = Math.min(maxMs, delay * 2);
      } finally {
        running = false;
        schedule();
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        window.clearTimeout(timer);
      } else {
        delay = baseMs;
        void run();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [baseMs, maxMs, enabled]);
}

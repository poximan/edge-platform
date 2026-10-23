export const SPLASH_MINIMUM_MS = 2_000;
export const SPLASH_MAXIMUM_MS = 5_000;

export interface SplashClock {
  now(): number;
  schedule(callback: () => void, delay: number): number;
  cancel(timer: number): void;
}

const browserClock: SplashClock = {
  now: () => performance.now(),
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: (timer) => window.clearTimeout(timer),
};

/** Readiness can shorten the wait, but never restart or extend its deadline. */
export function createSplashLifecycle(dismiss: () => void, clock = browserClock) {
  const startedAt = clock.now();
  let finished = false;
  let ready = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    dismiss();
  };
  let timer = clock.schedule(finish, SPLASH_MAXIMUM_MS);

  return {
    setReady() {
      if (finished || ready) return;
      ready = true;
      clock.cancel(timer);
      timer = clock.schedule(finish, Math.max(0, SPLASH_MINIMUM_MS - (clock.now() - startedAt)));
    },
    dispose() {
      finished = true;
      clock.cancel(timer);
    },
  };
}

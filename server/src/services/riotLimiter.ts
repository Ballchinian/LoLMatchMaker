/**
    Global outbound throttle for Riot API calls.

    One profile lookup fans out into ~14 Riot requests (account + summoner +
    league + up to RIOT_RECENT_MATCH_COUNT match-detail calls), and a "reset all
    players" run multiplies that across the whole roster. A Riot DEV key allows
    only 20 requests / 1 s AND 100 requests / 2 min, so without a server-side gate
    a bulk reset trips 429s no matter how the client paces its calls.

    Every Riot HTTP call funnels through `riotLimiter.acquire()`, which blocks
    until BOTH windows have room. Concurrent callers (e.g. the parallel
    match-detail fetches) are serialised here, so bursts can't escape the budget.

    Defaults are sized for a DEV key, kept a touch under the real ceilings for
    safety margin. With a PRODUCTION key you can raise these substantially.
*/

//Keep a margin under the real 20/s and 100/120s dev-key ceilings.
const MAX_PER_SECOND = 18;
const MAX_PER_WINDOW = 90;
const WINDOW_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SlidingWindowLimiter {
  //Start timestamps (ms) of recent calls, oldest first.
  private times: number[] = [];

  constructor(
    private readonly perSecond: number,
    private readonly perWindow: number,
    private readonly windowMs: number,
  ) {}

  //Resolve once another request is allowed under both the 1 s and window caps.
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      //Drop timestamps that have aged out of the long window.
      while (this.times.length > 0 && now - this.times[0]! >= this.windowMs) this.times.shift();

      const inSecond = this.times.filter((t) => now - t < 1000).length;
      const inWindow = this.times.length;

      if (inSecond < this.perSecond && inWindow < this.perWindow) {
        /*
            No await between this check and the push, so concurrent callers on the
            single thread can't overshoot the caps.
        */
        this.times.push(now);
        return;
      }

      //Wait for whichever constraint frees up first.
      const waits: number[] = [];
      if (inSecond >= this.perSecond) {
        const oldestInSecond = this.times.find((t) => now - t < 1000)!;
        waits.push(1000 - (now - oldestInSecond));
      }
      if (inWindow >= this.perWindow) {
        waits.push(this.windowMs - (now - this.times[0]!));
      }
      await sleep(Math.max(20, Math.min(...waits)));
    }
  }
}

export const riotLimiter = new SlidingWindowLimiter(MAX_PER_SECOND, MAX_PER_WINDOW, WINDOW_MS);

// Node --import preload for CLI subprocesses: shifts Date.now/new Date() by a fixed
// offset so the clock is shifted by ARCADIA_TEST_CLOCK_OFFSET_MS (and keeps advancing).
const offset = Number(process.env.ARCADIA_TEST_CLOCK_OFFSET_MS);
if (Number.isFinite(offset)) {
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = PinnedDate;
}

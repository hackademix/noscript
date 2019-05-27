class Timing {

  constructor(workSlot = 4, longTime = 20000, pauseTime = 20) {
    this.workSlot = workSlot;
    this.longTime = longTime;
    this.pauseTime = pauseTime;
    this.interrupted = false;
    this.fatalTimeout = false;
    this.reset();
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async pause() {
    if (this.interrupted) throw new TimingException("Interrupted");
    let now = Date.now();
    this.elapsed = now - this.timeOrigin;
    if (now - this.lastPause > this.workSlot) {
      this.tooLong = this.elapsed >= this.longTime;
      if (this.tooLong && this.fatalTimeout) {
        throw new TimingException(`Exceeded ${this.longTime}ms timeout`);
      }
      await Timing.sleep(this.pauseTime);
      this.lastPause = Date.now();
      return true;
    }
    return false;
  }

  reset() {
    this.elapsed = 0;
    this.timeOrigin = this.lastPause = Date.now();
    this.tooLong = false;
  }
}

class TimingException extends Error {};

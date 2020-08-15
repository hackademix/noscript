class Timing {

  constructor(workSlot = 10, longTime = 20000, pauseTime = 20) {
    this.workSlot = workSlot;
    this.longTime = longTime;
    this.pauseTime = pauseTime;
    this.interrupted = false;
    this.fatalTimeout = false;
    this.maxCalls = 1000;
    this.reset();
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async pause() {
    if (this.interrupted) throw new TimingException("Timing: interrupted");
    let now = Date.now();
    this.calls++;
    let sinceLastCall = now - this.lastCall;
    if (sinceLastCall > this.workSlot && this.calls > 1000) {
      // low resolution (100ms) timer? Let's cap approximating by calls number
      this.maxCalls = this.calls / sinceLastCall * this.workSlot;
    }
    this.lastCall = now;
    this.elapsed = now - this.timeOrigin;
    if (now - this.lastPause > this.workSlot || this.calls > this.maxCalls) {
      this.tooLong = this.elapsed >= this.longTime;
      if (this.tooLong && this.fatalTimeout) {
        throw new TimingException(`Timing: exceeded ${this.longTime}ms timeout`);
      }
      this.calls = 0;
      await Timing.sleep(this.pauseTime);
      this.lastPause = Date.now();
      return true;
    }
    return false;
  }

  reset() {
    this.elapsed = 0;
    this.calls = 0;
    this.timeOrigin = this.lastPause = this.lastCall = Date.now();
    this.tooLong = false;
  }
}

class TimingException extends Error {};

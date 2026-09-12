export class HourlyRateLimiter {
  private timestamps: number[] = [];
  constructor(private readonly limit: number, private readonly now = () => Date.now()) {}

  assertCanSend(): void {
    const cutoff = this.now() - 60 * 60 * 1000;
    this.timestamps = this.timestamps.filter(ts => ts >= cutoff);
    if (this.timestamps.length >= this.limit) throw new Error(`Hourly send limit of ${this.limit} reached`);
  }

  commitSend(): void {
    this.assertCanSend();
    this.timestamps.push(this.now());
  }
}

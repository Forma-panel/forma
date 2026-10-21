// Closed-form critically damped motion: elapsed seconds, not a per-frame lerp.
export function damp(value, velocity, target, seconds, frequency = 24) {
  if (seconds <= 0) return { value, velocity };
  const offset = value - target;
  const impulse = velocity + frequency * offset;
  const decay = Math.exp(-frequency * seconds);
  return {
    value: target + (offset + impulse * seconds) * decay,
    velocity: (velocity - frequency * impulse * seconds) * decay,
  };
}

export class PointerMotion {
  constructor() { this.reset(); }
  reset() {
    this.time = null;
    this.target = { x: 0, y: 0, active: false };
    this.x = this.y = this.vx = this.vy = this.strength = this.velocity = 0;
    this.needsFrame = false;
  }
  advance(seconds) {
    if (seconds <= 0) return;
    const x = damp(this.x, this.vx, this.target.x, seconds, 32);
    const y = damp(this.y, this.vy, this.target.y, seconds, 32);
    const strength = damp(this.strength, this.velocity, this.target.active ? 1 : 0, seconds, 24);
    this.x = x.value; this.vx = x.velocity;
    this.y = y.value; this.vy = y.velocity;
    this.strength = strength.value; this.velocity = strength.velocity;
  }
  update(time, pointer, enabled, reducedMotion = false) {
    const now = Number.isFinite(time) ? time : this.time ?? 0;
    if (this.time !== null && now < this.time) this.reset();
    const previous = this.time ?? now;
    const target = {
      x: Number.isFinite(pointer?.x) ? pointer.x : this.target.x,
      y: Number.isFinite(pointer?.y) ? pointer.y : this.target.y,
      active: !!enabled && !!pointer?.active && !reducedMotion,
    };
    const changed = target.active !== this.target.active || (target.active && (target.x !== this.target.x || target.y !== this.target.y));
    if (changed) {
      // Integrate the old target up to the input event, then the new one. An
      // idle canvas must not mistake idle wall time for time under a new force.
      const changedAt = Math.max(previous, Math.min(now, Number.isFinite(pointer?.time) ? pointer.time : now));
      this.advance(changedAt - previous);
      if (target.active && !this.target.active && this.strength === 0) {
        this.x = target.x; this.y = target.y; this.vx = this.vy = 0;
      }
      if (!target.active) { target.x = this.target.x; target.y = this.target.y; }
      this.target = target;
      this.advance(now - changedAt);
    } else this.advance(now - previous);
    this.time = now;

    const end = this.target.active ? 1 : 0;
    if (reducedMotion || (Math.abs(this.strength - end) < 0.0001 && Math.abs(this.velocity) < 0.001)) {
      this.strength = reducedMotion ? 0 : end; this.velocity = 0;
    }
    if (this.strength === 0 && !this.target.active) {
      this.vx = this.vy = 0;
    } else if (Math.hypot(this.x - this.target.x, this.y - this.target.y) < 0.02 && Math.hypot(this.vx, this.vy) < 0.05) {
      this.x = this.target.x; this.y = this.target.y; this.vx = this.vy = 0;
    }
    this.needsFrame = !reducedMotion && (this.strength !== end || this.velocity !== 0 || (this.target.active && (this.vx !== 0 || this.vy !== 0 || this.x !== this.target.x || this.y !== this.target.y)));
    return this;
  }
}

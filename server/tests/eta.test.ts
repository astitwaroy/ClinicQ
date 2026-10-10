import { describe, expect, it } from 'vitest';
import { estimateConsultSecs, etaSecs, formatEta } from '../src/lib/eta.js';

describe('consultation estimate (EWMA)', () => {
  it('starts from the clinic default', () => {
    expect(estimateConsultSecs([], 420)).toBe(420);
  });

  it('moves toward recent consultations', () => {
    const est = estimateConsultSecs([300, 300, 300, 300, 300, 300], 600);
    expect(est).toBeLessThan(360);
    expect(est).toBeGreaterThan(300);
  });

  it('is not thrown off by one very long visit', () => {
    const est = estimateConsultSecs([400, 400, 400, 5000], 400);
    // the 5000 s visit is clamped to an hour and only weighted by alpha
    expect(est).toBeLessThan(400 + 0.3 * 3600);
  });

  it('ignores invalid durations', () => {
    expect(estimateConsultSecs([NaN, -5, 0], 420)).toBe(420);
  });
});

describe('wait estimate', () => {
  it('counts people ahead plus the rest of the current visit', () => {
    expect(etaSecs({ ahead: 3, consultSecs: 300, servingElapsedSecs: 100 })).toBe(200 + 900);
  });
  it('never assumes an over-running visit ends instantly', () => {
    expect(etaSecs({ ahead: 0, consultSecs: 300, servingElapsedSecs: 900 })).toBe(60);
  });
  it('handles nobody being with the doctor', () => {
    expect(etaSecs({ ahead: 2, consultSecs: 300, servingElapsedSecs: null })).toBe(600);
  });
  it('formats friendly durations', () => {
    expect(formatEta(30)).toBe('about a minute');
    expect(formatEta(1500)).toBe('about 25 min');
    expect(formatEta(4800)).toBe('about 1 h 20 min');
  });
});

import { describe, expect, it } from 'vitest';
import { CHANNEL_CYCLE } from './types.ts';

describe('CHANNEL_CYCLE', () => {
  it('is the analog surfing order 02, 04, 07, 13', () => {
    expect(CHANNEL_CYCLE).toEqual([2, 4, 7, 13]);
  });

  it('has four distinct channels', () => {
    expect(new Set(CHANNEL_CYCLE).size).toBe(4);
  });
});

import { describe, expect, test } from '@jest/globals';
import { clampPercentage } from '../utils/percentage.js';

describe('clampPercentage', () => {
  test('returns value when within default bounds', () => {
    expect(clampPercentage(42.5)).toBe(42.5);
  });

  test('clamps values below 0 to 0', () => {
    expect(clampPercentage(-15)).toBe(0);
  });

  test('clamps values above 100 to 100', () => {
    expect(clampPercentage(250)).toBe(100);
  });

  test('parses numeric strings', () => {
    expect(clampPercentage('75.25')).toBeCloseTo(75.25);
  });

  test('returns lower bound for invalid inputs', () => {
    expect(clampPercentage('not-a-number')).toBe(0);
  });

  test('respects custom bounds', () => {
    expect(clampPercentage(5, { min: -10, max: 10 })).toBe(5);
    expect(clampPercentage(-20, { min: -10, max: 10 })).toBe(-10);
    expect(clampPercentage(20, { min: -10, max: 10 })).toBe(10);
  });
});

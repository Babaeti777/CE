import { calculate, handleUnitConversion } from '../calculator.js';

describe('calculate', () => {
  test('adds numbers', () => {
    expect(calculate(2, 3, '+')).toBe(5);
  });

  test('subtracts numbers', () => {
    expect(calculate(5, 2, '-')).toBe(3);
  });

  test('multiplies numbers', () => {
    expect(calculate(4, 3, '*')).toBe(12);
  });

  test('divides numbers', () => {
    expect(calculate(10, 2, '/')).toBe(5);
  });

  test('division by zero gives Infinity', () => {
    expect(calculate(5, 0, '/')).toBe(Infinity);
  });

  test('unknown operator returns second operand', () => {
    expect(calculate(1, 7, '?')).toBe(7);
  });
});

describe('handleUnitConversion', () => {
  test('feet to inches', () => {
    expect(handleUnitConversion(2, 'ft', 'in')).toBe(24);
  });

  test('inches to feet', () => {
    expect(handleUnitConversion(24, 'in', 'ft')).toBe(2);
  });

  test('sqft to sqyd', () => {
    expect(handleUnitConversion(9, 'sqft', 'sqyd')).toBe(1);
  });

  test('invalid conversion throws', () => {
    expect(() => handleUnitConversion(1, 'm', 'ft')).toThrow('Invalid unit conversion');
  });
});

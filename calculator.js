export function calculate(first, second, op) {
  if (op === '+') return first + second;
  if (op === '-') return first - second;
  if (op === '*') return first * second;
  if (op === '/') return first / second;
  return second;
}

export function handleUnitConversion(value, fromUnit, toUnit) {
  const conversions = {
    'ft-in': val => val * 12,
    'in-ft': val => val / 12,
    'sqft-sqyd': val => val / 9,
    'sqyd-sqft': val => val * 9,
  };
  const key = `${fromUnit}-${toUnit}`;
  if (!conversions[key]) {
    throw new Error('Invalid unit conversion');
  }
  return conversions[key](value);
}

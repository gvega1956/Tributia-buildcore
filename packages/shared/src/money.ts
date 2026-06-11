import Decimal from 'decimal.js';

export type Currency = 'DOP' | 'USD' | 'EUR';

export interface Money {
  amount: Decimal;
  currency: Currency;
}

export function money(amount: string | number, currency: Currency): Money {
  return { amount: new Decimal(amount), currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add ${a.currency} and ${b.currency} without exchange rate`);
  }
  return { amount: a.amount.plus(b.amount), currency: a.currency };
}

export function multiplyMoney(m: Money, factor: string | number): Money {
  return { amount: m.amount.mul(factor), currency: m.currency };
}

export function moneyToString(m: Money): string {
  return `${m.amount.toFixed(4)} ${m.currency}`;
}

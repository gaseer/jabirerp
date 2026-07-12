/** Pure quotation/bill math. Money is integer paise throughout. */

/** Line amount = qty × rate, rounded to whole paise. Rounding happens here, once. */
export function lineAmountPaise(qty: number, ratePaise: number): number {
  return Math.round(qty * ratePaise);
}

/** Document total = sum of line amounts (paise). */
export function documentTotalPaise(items: { amount_paise: number }[]): number {
  return items.reduce((sum, i) => sum + i.amount_paise, 0);
}

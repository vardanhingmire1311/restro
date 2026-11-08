export function rupees(paise: number) {
  return Math.round(paise) / 100;
}

export function inrToPaise(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("invalid amount");
  }
  return Math.round(value * 100);
}

/** Half-up integer division for a * b / d. */
export function mulDivRound(amount: number, numerator: number, denominator: number) {
  return Math.floor((amount * numerator + Math.floor(denominator / 2)) / denominator);
}

export function gstParts(taxablePaise: number, rateBps: number) {
  const tax = mulDivRound(Math.max(0, taxablePaise), rateBps, 10000);
  const cgst = Math.floor(tax / 2);
  const sgst = tax - cgst;
  return { tax, cgst, sgst };
}

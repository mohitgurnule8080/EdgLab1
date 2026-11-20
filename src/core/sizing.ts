import type { Instrument, PricingContext, Side } from './types';

/** Multiply a quote-currency amount by this to get the account-currency amount. */
export function quoteToAccountRate(inst: Instrument, price: number, ctx: PricingContext): number {
  const acc = ctx.accountCurrency;
  if (inst.quote === acc) return 1;
  if (inst.base === acc) return 1 / price;
  const quoteUsd = ctx.usdValue[inst.quote];
  const accUsd = ctx.usdValue[acc];
  if (!quoteUsd || !accUsd) return 1;
  return quoteUsd / accUsd;
}

/** Value of one pip for 1.00 lot, in account currency. */
export function pipValuePerLot(inst: Instrument, price: number, ctx: PricingContext): number {
  return inst.pipSize * inst.contractSize * quoteToAccountRate(inst, price, ctx);
}

export function direction(side: Side): 1 | -1 {
  return side === 'buy' ? 1 : -1;
}

export function pipsBetween(inst: Instrument, side: Side, entry: number, exit: number): number {
  return ((exit - entry) * direction(side)) / inst.pipSize;
}

/** Gross profit of a fill in account currency (before commission). */
export function grossPnl(inst: Instrument, side: Side, entry: number, exit: number, lots: number, ctx: PricingContext): number {
  return (exit - entry) * direction(side) * inst.contractSize * lots * quoteToAccountRate(inst, exit, ctx);
}

/** Round a lot size down to the instrument's lot step. */
export function roundLots(inst: Instrument, lots: number): number {
  if (!Number.isFinite(lots) || lots <= 0) return 0;
  const steps = Math.floor(lots / inst.lotStep + 1e-9);
  const decimals = Math.max(0, Math.ceil(-Math.log10(inst.lotStep)));
  return Number((steps * inst.lotStep).toFixed(decimals));
}

export interface RiskSizing {
  lots: number;
  /** Money at risk with the rounded lot size, including commission. */
  riskAmount: number;
  /** Money the trader wanted to risk. */
  targetRisk: number;
  slPips: number;
}

/**
 * Lot size that loses `riskPct` of the balance if the stop loss is hit.
 * Commission (round turn, per lot) is counted as part of the risk.
 */
export function lotsForRisk(params: {
  inst: Instrument;
  ctx: PricingContext;
  balance: number;
  riskPct: number;
  entry: number;
  sl: number;
  commissionPerLot?: number;
}): RiskSizing {
  const { inst, ctx, balance, riskPct, entry, sl } = params;
  const commission = params.commissionPerLot ?? 0;
  const targetRisk = (balance * riskPct) / 100;
  const distance = Math.abs(entry - sl);
  const slPips = distance / inst.pipSize;
  if (distance <= 0 || targetRisk <= 0) return { lots: 0, riskAmount: 0, targetRisk, slPips };
  const perLot = distance * inst.contractSize * quoteToAccountRate(inst, sl, ctx) + commission;
  const lots = roundLots(inst, targetRisk / perLot);
  return { lots, riskAmount: lots * perLot, targetRisk, slPips };
}

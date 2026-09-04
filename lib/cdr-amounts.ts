import type { CdrRankRecapSale } from './types';

export type CdrReferrerAmountSummary = {
  businessReferrerId: string;
  businessReferrerName: string;
  saleCount: number;
  totalAmount: number;
};

export function parseCdrAmountInput(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount <= 9_999_999_999.99 ? amount : null;
}

export function isValidCdrAmountInput(value: string): boolean {
  return value.trim() === '' || parseCdrAmountInput(value) !== null;
}

export function cdrReferrerAmountSummary(sales: CdrRankRecapSale[]): CdrReferrerAmountSummary[] {
  const grouped = new Map<string, CdrReferrerAmountSummary>();
  for (const sale of sales) {
    if (!sale.business_referrer_id || !sale.business_referrer_name) continue;
    const current = grouped.get(sale.business_referrer_id) ?? {
      businessReferrerId: sale.business_referrer_id,
      businessReferrerName: sale.business_referrer_name,
      saleCount: 0,
      totalAmount: 0,
    };
    current.saleCount += 1;
    current.totalAmount = Math.round((current.totalAmount + Number(sale.cdr_amount ?? 0)) * 100) / 100;
    grouped.set(sale.business_referrer_id, current);
  }
  return [...grouped.values()].sort((left, right) => right.totalAmount - left.totalAmount || left.businessReferrerName.localeCompare(right.businessReferrerName, 'fr'));
}

export const cdrRankTotalAmount = (rows: CdrReferrerAmountSummary[]): number => Math.round(rows.reduce((total, row) => total + row.totalAmount, 0) * 100) / 100;

export const formatCdrAmount = (amount: number): string => new Intl.NumberFormat('fr-FR', {
  style: 'decimal',
  minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  maximumFractionDigits: 2,
}).format(amount);

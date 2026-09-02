export type ReportRow = Record<string, any>;

const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{11,12}$/i;

export function humanSalesDetails(items: ReportRow[]) {
  return items.map((sale) => {
    const origin = String(sale.origin_table_number ?? '').trim();
    const final = String(sale.final_table_number ?? '').trim();
    return {
      ...sale,
      origin_table_number: origin && !uuidPattern.test(origin) ? origin : '—',
      final_table_number: final && !uuidPattern.test(final) ? final : origin && !uuidPattern.test(origin) ? origin : '—',
    };
  });
}

export function humanTopTables(items: ReportRow[], salesDetails: ReportRow[]) {
  const originLabels = new Map(
    salesDetails
      .filter((sale) => sale.origin_table_id && sale.origin_table_number && !uuidPattern.test(String(sale.origin_table_number)))
      .map((sale) => [String(sale.origin_table_id), String(sale.origin_table_number)]),
  );
  return items.map((table) => {
    const current = String(table.table_number ?? '').trim();
    const tableNumber = current && !uuidPattern.test(current) ? current : originLabels.get(String(table.table_id ?? '')) ?? '—';
    return { ...table, table_number: tableNumber };
  });
}

export function officialReferrersFromSales(salesDetails: ReportRow[]) {
  const ranked = new Map<string, { normalized_name: string; name: string; total_sales: number; people_welcomed: null }>();
  for (const sale of salesDetails) {
    if (!sale.business_referrer_id || !sale.business_referrer_name) continue;
    const key = String(sale.business_referrer_id);
    const current = ranked.get(key) ?? {
      normalized_name: String(sale.business_referrer_name).trim().toLocaleLowerCase('fr-FR'),
      name: String(sale.business_referrer_name).trim(),
      total_sales: 0,
      people_welcomed: null,
    };
    current.total_sales += 1;
    ranked.set(key, current);
  }
  return [...ranked.values()].sort((left, right) => right.total_sales - left.total_sales || left.name.localeCompare(right.name, 'fr'));
}

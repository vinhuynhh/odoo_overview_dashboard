/** @odoo-module **/

export function emptySalesDashboardData() {
    return {
        meta: {
            period_label: "",
            period: "month",
            currency_id: null,
            currency_symbol: "",
            has_sales_access: false,
            compare_previous: true,
            disclaimer: "",
        },
        kpis: {
            net_revenue: 0,
            net_revenue_delta_pct: 0,
            gross_profit: 0,
            gross_profit_delta_pct: 0,
            margin_pct: 0,
            orders_count: 0,
            orders_delta_pct: 0,
            aov: 0,
            quotations_count: 0,
            quotations_value: 0,
        },
        monthly_trend: {
            labels: [],
            revenue: [],
            gross_profit: [],
            target_revenue: [],
        },
        revenue_by_category: [],
        top_sellers: [],
        top_customers: [],
    };
}

export function normalizeSalesDashboardPayload(raw) {
    const base = emptySalesDashboardData();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return base;
    }
    const mt = { ...base.monthly_trend, ...(raw.monthly_trend || {}) };
    return {
        ...base,
        ...raw,
        meta: { ...base.meta, ...(raw.meta || {}) },
        kpis: { ...base.kpis, ...(raw.kpis || {}) },
        monthly_trend: mt,
        revenue_by_category: Array.isArray(raw.revenue_by_category)
            ? raw.revenue_by_category
            : base.revenue_by_category,
        top_sellers: Array.isArray(raw.top_sellers) ? raw.top_sellers : base.top_sellers,
        top_customers: Array.isArray(raw.top_customers) ? raw.top_customers : base.top_customers,
    };
}

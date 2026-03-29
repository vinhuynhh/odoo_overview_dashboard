/** @odoo-module **/

export function emptyPurchaseDashboardData() {
    return {
        meta: {
            period_label: "",
            period: "month",
            currency_id: null,
            currency_symbol: "",
            has_purchase_access: false,
            compare_previous: true,
            disclaimer: "",
        },
        kpis: {
            purchased_spend: 0,
            purchased_spend_delta_pct: 0,
            open_rfq_count: 0,
            open_rfq_value: 0,
            po_count: 0,
            po_delta_pct: 0,
            aov: 0,
            vendors_count: 0,
        },
        monthly_trend: {
            labels: [],
            spend: [],
            target_spend: [],
        },
        spend_by_category: [],
        top_products: [],
        top_vendors: [],
    };
}

export function normalizePurchaseDashboardPayload(raw) {
    const base = emptyPurchaseDashboardData();
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
        spend_by_category: Array.isArray(raw.spend_by_category)
            ? raw.spend_by_category
            : base.spend_by_category,
        top_products: Array.isArray(raw.top_products) ? raw.top_products : base.top_products,
        top_vendors: Array.isArray(raw.top_vendors) ? raw.top_vendors : base.top_vendors,
    };
}

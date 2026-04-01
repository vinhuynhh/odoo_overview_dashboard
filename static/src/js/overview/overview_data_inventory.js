/** @odoo-module **/

export function emptyInventoryDashboardData() {
    return {
        meta: {
            period_label: "",
            period: "month",
            has_inventory_access: false,
            compare_previous: true,
            disclaimer: "",
        },
        kpis: {
            onhand_qty: 0,
            reserved_qty: 0,
            available_qty: 0,
            onhand_value: 0,
            open_transfers: 0,
            open_transfers_delta_pct: 0,
            low_stock_rules: 0,
            dead_stock_products: 0,
            dead_stock_value: 0,
        },
        receipts: {
            total: 0,
            open: 0,
            late: 0,
            total_delta_pct: 0,
            by_state: [],
        },
        deliveries: {
            total: 0,
            open: 0,
            late: 0,
            total_delta_pct: 0,
            by_state: [],
        },
        products: {
            total: 0,
            by_type: [],
        },
        monthly_trend: {
            labels: [],
            inbound_qty: [],
            outbound_qty: [],
        },
        onhand_by_category: [],
        top_products: [],
    };
}

export function normalizeInventoryDashboardPayload(raw) {
    const base = emptyInventoryDashboardData();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return base;
    }
    const mt = { ...base.monthly_trend, ...(raw.monthly_trend || {}) };
    const receipts = { ...base.receipts, ...(raw.receipts || {}) };
    receipts.by_state = Array.isArray(raw?.receipts?.by_state) ? raw.receipts.by_state : base.receipts.by_state;
    const deliveries = { ...base.deliveries, ...(raw.deliveries || {}) };
    deliveries.by_state = Array.isArray(raw?.deliveries?.by_state)
        ? raw.deliveries.by_state
        : base.deliveries.by_state;
    const products = { ...base.products, ...(raw.products || {}) };
    products.by_type = Array.isArray(raw?.products?.by_type) ? raw.products.by_type : base.products.by_type;
    return {
        ...base,
        ...raw,
        meta: { ...base.meta, ...(raw.meta || {}) },
        kpis: { ...base.kpis, ...(raw.kpis || {}) },
        receipts,
        deliveries,
        products,
        monthly_trend: mt,
        onhand_by_category: Array.isArray(raw.onhand_by_category)
            ? raw.onhand_by_category
            : base.onhand_by_category,
        top_products: Array.isArray(raw.top_products) ? raw.top_products : base.top_products,
    };
}


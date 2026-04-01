/** @odoo-module **/

import { Component, onWillStart, onWillUnmount, useEffect, useRef, useState } from "@odoo/owl";
import { loadBundle } from "@web/core/assets";
import { rpc } from "@web/core/network/rpc";
import { browser } from "@web/core/browser/browser";
import { _t } from "@web/core/l10n/translation";
import { session } from "@web/session";
import { formatMonetary } from "@web/views/fields/formatters";

import { CHART_COLORS, DONUT_PALETTE, getOverviewPeriodOptions } from "./overview_constants";
import { emptyInventoryDashboardData, normalizeInventoryDashboardPayload } from "./overview_data_inventory";
import { deltaPillClass, formatDeltaPct } from "./overview_formatters";
import { OverviewDashboardHero } from "./overview_dashboard_hero";
import { OverviewDashboardSkeleton } from "./overview_dashboard_skeleton";
import { OverviewSectionHeader } from "./overview_section_header";
import { OverviewKpiCard } from "./overview_kpi_card";
import { OverviewPanel } from "./overview_panel";
import { OverviewRankedTable } from "./overview_ranked_table";

export class InventoryDashboardBody extends Component {
    static template = "odoo_overview_dashboard.InventoryDashboardBody";
    static components = {
        OverviewDashboardHero,
        OverviewDashboardSkeleton,
        OverviewSectionHeader,
        OverviewKpiCard,
        OverviewPanel,
        OverviewRankedTable,
    };

    setup() {
        this.flowCanvasRef = useRef("flowCanvas");
        this.donutCanvasRef = useRef("donutCanvas");
        this.productsDonutRef = useRef("productsDonutCanvas");
        this.flowChart = null;
        this.donutChart = null;
        this.productsChart = null;

        this.state = useState({
            loading: true,
            error: null,
            data: emptyInventoryDashboardData(),
            period: "month",
            customDateFrom: "",
            customDateTo: "",
        });

        onWillStart(async () => {
            await loadBundle("web.chartjs_lib");
            await this.fetchData();
        });

        useEffect(
            () => {
                if (this.state.loading || this.state.error) {
                    return () => {};
                }
                const timer = browser.setTimeout(() => this._renderCharts(), 0);
                return () => {
                    browser.clearTimeout(timer);
                    this._destroyCharts();
                };
            },
            () => [this.state.loading, this.state.error, this.state.data]
        );

        onWillUnmount(() => this._destroyCharts());
    }

    get heroProps() {
        return {
            eyebrow: _t("Stock health"),
            title: _t("Inventory overview"),
            periodLabel: this.state.data.meta.period_label,
            userName: this.sessionUserName,
            period: this.state.period,
            onPeriodChange: (v) => this.setPeriod(v),
            periodOptions: getOverviewPeriodOptions(),
            customDateFrom: this.state.customDateFrom,
            customDateTo: this.state.customDateTo,
            onCustomDateFromChange: (ev) => {
                this.state.customDateFrom = ev.target.value;
            },
            onCustomDateToChange: (ev) => {
                this.state.customDateTo = ev.target.value;
            },
            onApplyCustomRange: () => this.applyCustomRange(),
            customRangeApplyLabel: _t("Apply"),
        };
    }

    get showPeriodComparison() {
        return this.state.data?.meta?.compare_previous !== false;
    }

    get sectionKeyMetricsProps() {
        return {
            title: _t("Key metrics"),
            description: _t("Availability, risk, and workload"),
        };
    }

    get kpiHelp() {
        return {
            onhandQty: _t("Total quantity on hand across internal locations (from stock quants)."),
            reservedQty: _t("Quantity reserved for operations (allocated but not yet moved)."),
            availableQty: _t("On hand minus reserved — what is immediately available."),
            onhandValue: _t("Approximate value using product standard cost × on-hand quantity."),
            lowStockRules: _t("Reordering rules currently below their minimum quantity."),
            deadStock: _t("Products with on-hand quantity and no done stock move in the last 90 days."),
            products: _t("Total products and breakdown by product type (Stockable, Consumable, Service)."),
        };
    }

    get sectionTrendsProps() {
        return {
            title: _t("Inbound vs outbound"),
            description: _t("Stock movement completed during each bucket"),
        };
    }

    get sectionOrdersProps() {
        return {
            title: _t("Transfers"),
            description: _t("Receipts and deliveries workload"),
        };
    }

    productTypeLabel(t) {
        const key = t || "";
        return (
            {
                consu: _t("Goods"),
                service: _t("Service"),
                combo: _t("Combo"),
            }[key] || key
        );
    }

    get productTypeLegend() {
        const pt = this.state.data.products?.by_type || [];
        return pt.map((r, idx) => ({
            key: r.type,
            label: this.productTypeLabel(r.type),
            count: r.count ?? 0,
            color: DONUT_PALETTE[idx % DONUT_PALETTE.length],
        }));
    }

    get sectionTopProps() {
        return {
            title: _t("Highest value on hand"),
            description: _t("Products by on-hand value (approx.)"),
        };
    }

    get rankedProductsProps() {
        return {
            rows: this.state.data.top_products,
            rowKeyField: "product_id",
            mainField: "name",
            subField: "categ_name",
            amountField: "amount",
            formatAmount: (v) => this.formatMoney(v),
            emptyMessage: _t("No inventory data."),
        };
    }

    deltaPillClass(pct) {
        return deltaPillClass(pct);
    }

    formatDeltaPct(pct) {
        return formatDeltaPct(pct);
    }

    formatMoney(value) {
        return formatMonetary(value ?? 0, { currencyId: this.currencyId });
    }

    get currencyId() {
        const c = session.user_companies;
        if (!c) return undefined;
        return c.allowed_companies[c.current_company]?.currency_id;
    }

    get sessionUserName() {
        return session.name || session.username || "";
    }

    _fmtIsoDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    _ensureCustomDates() {
        if (!this.state.customDateFrom || !this.state.customDateTo) {
            const to = new Date();
            const from = new Date(to.getFullYear(), to.getMonth(), 1);
            this.state.customDateTo = this._fmtIsoDate(to);
            this.state.customDateFrom = this._fmtIsoDate(from);
        }
    }

    async fetchData() {
        this.state.loading = true;
        this.state.error = null;
        try {
            const params = { period: this.state.period };
            if (this.state.period === "custom") {
                params.date_from = this.state.customDateFrom;
                params.date_to = this.state.customDateTo;
            }
            const result = await rpc("/odoo_overview_dashboard/inventory/data", params);
            if (result?.error) {
                this.state.error = result.error;
            } else {
                this.state.data = normalizeInventoryDashboardPayload(result);
            }
        } catch {
            this.state.error = "Failed to load inventory overview";
        } finally {
            this.state.loading = false;
        }
    }

    async setPeriod(period) {
        if (this.state.period === period && period !== "custom") {
            return;
        }
        this.state.period = period;
        if (period === "custom") {
            this._ensureCustomDates();
        }
        await this.fetchData();
    }

    async applyCustomRange() {
        if (this.state.period !== "custom") return;
        await this.fetchData();
    }

    _axisTheme() {
        const tick = "#64748b";
        const grid = "rgba(100, 116, 139, 0.1)";
        return {
            x: { ticks: { color: tick }, grid: { color: grid } },
            y: { ticks: { color: tick }, grid: { color: grid }, beginAtZero: true },
        };
    }

    _renderCharts() {
        this._destroyCharts();
        const Chart = window.Chart;
        if (!Chart) return;

        const data = this.state.data;
        const trend = data.monthly_trend;
        if (!trend?.labels?.length) return;

        if (this.flowCanvasRef.el) {
            const axis = this._axisTheme();
            this.flowChart = new Chart(this.flowCanvasRef.el, {
                type: "line",
                data: {
                    labels: trend.labels,
                    datasets: [
                        {
                            label: _t("Inbound qty"),
                            data: trend.inbound_qty || [],
                            borderColor: CHART_COLORS.pastelBlueDeep,
                            backgroundColor: "rgba(88, 134, 220, 0.12)",
                            fill: true,
                            tension: 0.35,
                            pointRadius: 3,
                            borderWidth: 2,
                            pointBackgroundColor: CHART_COLORS.pastelBlueDeep,
                        },
                        {
                            label: _t("Outbound qty"),
                            data: trend.outbound_qty || [],
                            borderColor: CHART_COLORS.pastelRed,
                            backgroundColor: CHART_COLORS.pastelRedSoft,
                            fill: false,
                            tension: 0.35,
                            pointRadius: 3,
                            borderWidth: 2,
                            pointBackgroundColor: CHART_COLORS.pastelRed,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { intersect: false, mode: "index" },
                    scales: axis,
                    plugins: {
                        legend: { labels: { color: "#475569", usePointStyle: true } },
                    },
                },
            });
        }

        const mix = data.onhand_by_category || [];
        if (this.donutCanvasRef.el && mix.length) {
            this.donutChart = new Chart(this.donutCanvasRef.el, {
                type: "doughnut",
                data: {
                    labels: mix.map((r) => r.name),
                    datasets: [
                        {
                            data: mix.map((r) => r.amount),
                            backgroundColor: DONUT_PALETTE.slice(0, mix.length),
                            borderWidth: 0,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "74%",
                    plugins: {
                        legend: {
                            position: "right",
                            labels: { color: "#475569", boxWidth: 10, padding: 12 },
                        },
                    },
                },
            });
        }

        const pt = data.products?.by_type || [];
        if (this.productsDonutRef.el && pt.length) {
            this.productsChart = new Chart(this.productsDonutRef.el, {
                type: "doughnut",
                data: {
                    labels: pt.map((r) => this.productTypeLabel(r.type)),
                    datasets: [
                        {
                            data: pt.map((r) => r.count),
                            backgroundColor: DONUT_PALETTE.slice(0, pt.length),
                            borderWidth: 0,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "72%",
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: true },
                    },
                },
            });
        }
    }

    _destroyCharts() {
        for (const ch of [this.flowChart, this.donutChart, this.productsChart]) {
            if (ch) ch.destroy();
        }
        this.flowChart = this.donutChart = this.productsChart = null;
    }
}


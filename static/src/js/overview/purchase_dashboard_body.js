/** @odoo-module **/

import { Component, onWillStart, onWillUnmount, useState, useEffect, useRef } from "@odoo/owl";
import { loadBundle } from "@web/core/assets";
import { rpc } from "@web/core/network/rpc";
import { browser } from "@web/core/browser/browser";
import { session } from "@web/session";
import { _t } from "@web/core/l10n/translation";
import { formatMonetary } from "@web/views/fields/formatters";
import { CHART_COLORS, DONUT_PALETTE, getOverviewPeriodOptions } from "./overview_constants";
import { emptyPurchaseDashboardData, normalizePurchaseDashboardPayload } from "./overview_data_purchase";
import { deltaPillClass, formatDeltaPct } from "./overview_formatters";
import { OverviewDashboardHero } from "./overview_dashboard_hero";
import { OverviewDashboardSkeleton } from "./overview_dashboard_skeleton";
import { OverviewSectionHeader } from "./overview_section_header";
import { OverviewKpiCard } from "./overview_kpi_card";
import { OverviewPanel } from "./overview_panel";
import { OverviewRankedTable } from "./overview_ranked_table";

export class PurchaseDashboardBody extends Component {
    static template = "odoo_overview_dashboard.PurchaseDashboardBody";
    static components = {
        OverviewDashboardHero,
        OverviewDashboardSkeleton,
        OverviewSectionHeader,
        OverviewKpiCard,
        OverviewPanel,
        OverviewRankedTable,
    };

    setup() {
        this.spendCanvasRef = useRef("spendCanvas");
        this.donutCanvasRef = useRef("donutCanvas");
        this.spendChart = null;
        this.donutChart = null;

        this.state = useState({
            loading: true,
            error: null,
            data: emptyPurchaseDashboardData(),
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
            eyebrow: _t("Procurement"),
            title: _t("Purchase overview"),
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
            description: _t("Confirmed spend and open pipeline"),
        };
    }

    get kpiHelp() {
        return {
            purchasedSpend: _t(
                "Untaxed total on POs in Purchase state with an order date in this period."
            ),
            confirmedPos: _t("Purchase-state POs dated in this period—how many."),
            avgPoValue: _t("Purchased spend this period divided by that PO count."),
            activeVendors: _t(
                "Vendors with at least one line on a confirmed PO in this period."
            ),
            openRfqs: _t("RFQs in draft, sent, or to approve: count and untaxed total."),
        };
    }

    get sectionTrendsProps() {
        return {
            title: _t("Trends & mix"),
            description: _t("Spend trajectory and category share"),
        };
    }

    get sectionTopProps() {
        return {
            title: _t("Top performers"),
            description: _t("Products and vendors by spend this period"),
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
            emptyMessage: _t("No purchases this period."),
        };
    }

    get rankedVendorsProps() {
        return {
            rows: this.state.data.top_vendors,
            rowKeyField: "partner_id",
            mainField: "name",
            amountField: "amount",
            formatAmount: (v) => this.formatMoney(v),
            emptyMessage: _t("No vendors this period."),
        };
    }

    get panelSpendTrendProps() {
        return { title: _t("Purchased spend"), badge: _t("Trend"), animationOrder: 6 };
    }

    get panelMixProps() {
        return { title: _t("Mix by category"), badge: _t("This period"), animationOrder: 7 };
    }

    get panelTopProductsProps() {
        return { title: _t("Top products"), badge: _t("By spend"), animationOrder: 8 };
    }

    get panelTopVendorsProps() {
        return { title: _t("Top vendors"), badge: _t("This period"), animationOrder: 9 };
    }

    get currencyId() {
        const c = session.user_companies;
        if (!c) {
            return undefined;
        }
        return c.allowed_companies[c.current_company]?.currency_id;
    }

    get sessionUserName() {
        return session.name || session.username || "";
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
            const result = await rpc("/odoo_overview_dashboard/purchase/data", params);
            if (result?.error) {
                this.state.error = result.error;
            } else {
                this.state.data = normalizePurchaseDashboardPayload(result);
            }
        } catch {
            this.state.error = "Failed to load purchase overview";
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
        if (this.state.period !== "custom") {
            return;
        }
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
        if (!Chart) {
            return;
        }
        const data = this.state.data;
        if (!data?.monthly_trend?.labels?.length) {
            return;
        }
        const trend = data.monthly_trend;
        const axis = this._axisTheme();

        if (this.spendCanvasRef.el) {
            this.spendChart = new Chart(this.spendCanvasRef.el, {
                type: "line",
                data: {
                    labels: trend.labels,
                    datasets: [
                        {
                            label: _t("Purchased spend"),
                            data: trend.spend || [],
                            borderColor: CHART_COLORS.pastelBlueDeep,
                            backgroundColor: "rgba(88, 134, 220, 0.12)",
                            fill: true,
                            tension: 0.4,
                            pointRadius: 4,
                            pointBackgroundColor: CHART_COLORS.pastelBlueDeep,
                            borderWidth: 2,
                        },
                        {
                            label: _t("Target (avg +5%)"),
                            data: trend.target_spend || [],
                            borderColor: CHART_COLORS.greyLine,
                            backgroundColor: "transparent",
                            borderDash: [6, 4],
                            fill: false,
                            tension: 0,
                            pointRadius: 0,
                            borderWidth: 1.5,
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

        const mix = data.spend_by_category || [];
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
    }

    _destroyCharts() {
        for (const ch of [this.spendChart, this.donutChart]) {
            if (ch) {
                ch.destroy();
            }
        }
        this.spendChart = this.donutChart = null;
    }
}

/** @odoo-module **/

import { Component, onWillStart, onWillUnmount, useState, useEffect, useRef } from "@odoo/owl";
import { loadBundle } from "@web/core/assets";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { browser } from "@web/core/browser/browser";
import { session } from "@web/session";
import { _t } from "@web/core/l10n/translation";
import { formatMonetary } from "@web/views/fields/formatters";
import { useService } from "@web/core/utils/hooks";

const OVERVIEW_ROOT_MENU_XMLID = "odoo_overview_dashboard.menu_overview_root";
const SIDEBAR_COLLAPSED_KEY = "odoo_overview_dashboard.sidebar_collapsed";

const CHART_COLORS = {
    pastelBlue: "rgba(138, 180, 248, 0.95)",
    pastelBlueMid: "rgba(107, 154, 232, 0.95)",
    pastelBlueDeep: "rgba(88, 134, 220, 0.95)",
    greyLine: "rgba(100, 116, 139, 0.55)",
};

const DONUT_PALETTE = [
    CHART_COLORS.pastelBlueDeep,
    CHART_COLORS.pastelBlue,
    CHART_COLORS.pastelBlueMid,
    "rgba(165, 200, 255, 0.9)",
    "rgba(129, 178, 238, 0.9)",
    "rgba(96, 148, 215, 0.9)",
    "rgba(180, 210, 255, 0.85)",
    "rgba(70, 130, 210, 0.85)",
];

function emptyDashboardData() {
    return {
        meta: {
            month_label: "",
            currency_id: null,
            currency_symbol: "",
            has_sales_access: false,
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

function normalizeDashboardPayload(raw) {
    const base = emptyDashboardData();
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
        top_customers: Array.isArray(raw.top_customers)
            ? raw.top_customers
            : base.top_customers,
    };
}

export class SalesOverviewDashboard extends Component {
    static template = "odoo_overview_dashboard.SalesOverviewDashboard";

    setup() {
        this.menuService = useService("menu");
        this.actionService = useService("action");

        this.monthlyCanvasRef = useRef("monthlyCanvas");
        this.donutCanvasRef = useRef("donutCanvas");

        this.monthlyChart = null;
        this.donutChart = null;

        this.state = useState({
            loading: true,
            error: null,
            data: emptyDashboardData(),
            sidebarCollapsed: browser.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
        });

        onWillStart(async () => {
            await loadBundle("web.chartjs_lib");
            try {
                const result = await rpc("/odoo_overview_dashboard/sales/data", {});
                if (result?.error) {
                    this.state.error = result.error;
                } else {
                    this.state.data = normalizeDashboardPayload(result);
                }
            } catch {
                this.state.error = "Failed to load sales overview";
            } finally {
                this.state.loading = false;
            }
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

        useEffect(
            () => {
                document.body.classList.add("o_overview_sidebar_mode");
                return () => document.body.classList.remove("o_overview_sidebar_mode");
            },
            () => []
        );

        onWillUnmount(() => this._destroyCharts());
    }

    get overviewAppTitle() {
        const overview = this.menuService
            .getApps()
            .find((m) => m.xmlid === OVERVIEW_ROOT_MENU_XMLID);
        return overview?.name || "Overview";
    }

    get overviewNavItems() {
        try {
            const menuSrv = this.menuService;
            const overview = menuSrv
                .getApps()
                .find((m) => m.xmlid === OVERVIEW_ROOT_MENU_XMLID);
            if (!overview?.children?.length) {
                return [];
            }
            const items = [];
            const collect = (ids) => {
                for (const mid of ids) {
                    const m = menuSrv.getMenu(mid);
                    if (!m) {
                        continue;
                    }
                    if (m.actionID) {
                        items.push(m);
                    }
                    if (m.children?.length) {
                        collect(m.children);
                    }
                }
            };
            collect(overview.children);
            return items;
        } catch {
            return [];
        }
    }

    isOverviewNavActive(nav) {
        const action = this.actionService.currentController?.action;
        if (!action || !nav?.actionID) {
            return false;
        }
        return Number(action.id) === Number(nav.actionID);
    }

    async onOverviewNavClick(nav) {
        if (!nav?.actionID) {
            return;
        }
        await this.menuService.selectMenu(nav);
    }

    toggleSidebar() {
        this.state.sidebarCollapsed = !this.state.sidebarCollapsed;
        browser.localStorage.setItem(
            SIDEBAR_COLLAPSED_KEY,
            this.state.sidebarCollapsed ? "1" : ""
        );
    }

    get sidebarToggleLabel() {
        return this.state.sidebarCollapsed ? _t("Expand menu") : _t("Collapse menu");
    }

    navIconClass(nav) {
        const x = (nav.xmlid || "").toLowerCase();
        if (
            x.includes("sales_overview") ||
            x.includes("business") ||
            x.includes("dashboard")
        ) {
            return "fa-tachometer";
        }
        if (x.includes("purchase")) {
            return "fa-shopping-basket";
        }
        if (x.includes("stock") || x.includes("inventory")) {
            return "fa-cubes";
        }
        return "fa-folder-o";
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
        const n = pct ?? 0;
        if (n > 0) {
            return "o_so_pill o_so_pill_up";
        }
        if (n < 0) {
            return "o_so_pill o_so_pill_down";
        }
        return "o_so_pill o_so_pill_neutral";
    }

    formatMoney(value) {
        return formatMonetary(value ?? 0, { currencyId: this.currencyId });
    }

    formatDeltaPct(pct) {
        const n = pct ?? 0;
        if (n > 0) {
            return `+${n}%`;
        }
        if (n < 0) {
            return `${n}%`;
        }
        return "0%";
    }

    _axisTheme() {
        const tick = "#64748b";
        const grid = "rgba(100, 116, 139, 0.1)";
        return {
            x: {
                ticks: { color: tick },
                grid: { color: grid },
            },
            y: {
                ticks: { color: tick },
                grid: { color: grid },
                beginAtZero: true,
            },
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

        if (this.monthlyCanvasRef.el) {
            this.monthlyChart = new Chart(this.monthlyCanvasRef.el, {
                type: "line",
                data: {
                    labels: trend.labels,
                    datasets: [
                        {
                            label: _t("Net revenue"),
                            data: trend.revenue,
                            borderColor: CHART_COLORS.pastelBlueDeep,
                            backgroundColor: "rgba(88, 134, 220, 0.12)",
                            fill: true,
                            tension: 0.4,
                            pointRadius: 4,
                            pointBackgroundColor: CHART_COLORS.pastelBlueDeep,
                            borderWidth: 2,
                        },
                        {
                            label: _t("Gross profit"),
                            data: trend.gross_profit,
                            borderColor: CHART_COLORS.pastelBlueMid,
                            backgroundColor: "transparent",
                            fill: false,
                            tension: 0.4,
                            pointRadius: 3,
                            borderWidth: 2,
                        },
                        {
                            label: _t("Target (avg +5%)"),
                            data: trend.target_revenue || [],
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

        const mix = data.revenue_by_category || [];
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
        for (const ch of [this.monthlyChart, this.donutChart]) {
            if (ch) {
                ch.destroy();
            }
        }
        this.monthlyChart = this.donutChart = null;
    }
}

registry
    .category("actions")
    .add("odoo_overview_dashboard.sales_overview_action", SalesOverviewDashboard);

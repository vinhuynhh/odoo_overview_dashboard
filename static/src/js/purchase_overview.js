/** @odoo-module **/

import { Component, onMounted, onWillStart, onWillUnmount, useState, useEffect, useRef } from "@odoo/owl";
import { loadBundle } from "@web/core/assets";
import { registry } from "@web/core/registry";
import { rpc } from "@web/core/network/rpc";
import { browser } from "@web/core/browser/browser";
import { session } from "@web/session";
import { _t } from "@web/core/l10n/translation";
import { formatMonetary } from "@web/views/fields/formatters";
import { useBus, useService } from "@web/core/utils/hooks";

const OVERVIEW_ROOT_MENU_XMLID = "odoo_overview_dashboard.menu_overview_root";
const SIDEBAR_COLLAPSED_KEY = "odoo_overview_dashboard.sidebar_collapsed";
const OVERVIEW_MENU_MODULE = "odoo_overview_dashboard";

function overviewActionXmlIdFromMenuXmlId(menuXmlId) {
    if (!menuXmlId || typeof menuXmlId !== "string") {
        return null;
    }
    const dot = menuXmlId.indexOf(".");
    if (dot === -1) {
        return null;
    }
    const module = menuXmlId.slice(0, dot);
    const local = menuXmlId.slice(dot + 1);
    if (module !== OVERVIEW_MENU_MODULE || !local.startsWith("menu_")) {
        return null;
    }
    return `${module}.${local.replace(/^menu_/, "action_")}`;
}

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

function emptyPurchaseDashboardData() {
    return {
        meta: {
            period_label: "",
            period: "month",
            currency_id: null,
            currency_symbol: "",
            has_purchase_access: false,
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

function normalizePurchasePayload(raw) {
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

export class PurchaseOverviewDashboard extends Component {
    static template = "odoo_overview_dashboard.PurchaseOverviewDashboard";

    setup() {
        this.menuService = useService("menu");
        this.actionService = useService("action");

        this.spendCanvasRef = useRef("spendCanvas");
        this.donutCanvasRef = useRef("donutCanvas");

        this.spendChart = null;
        this.donutChart = null;

        this.state = useState({
            loading: true,
            error: null,
            data: emptyPurchaseDashboardData(),
            sidebarCollapsed: browser.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
            period: "month",
            /** Bumped when the action stack updates so the nav highlight (non-reactive service) re-renders. */
            navRevision: 0,
        });

        useBus(this.env.bus, "ACTION_MANAGER:UI-UPDATED", () => {
            this.state.navRevision++;
        });

        onMounted(() => {
            this.state.navRevision++;
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

        useEffect(
            () => {
                document.body.classList.add("o_overview_sidebar_mode");
                return () => document.body.classList.remove("o_overview_sidebar_mode");
            },
            () => []
        );

        onWillUnmount(() => this._destroyCharts());
    }

    async fetchData() {
        this.state.loading = true;
        this.state.error = null;
        try {
            const result = await rpc("/odoo_overview_dashboard/purchase/data", {
                period: this.state.period,
            });
            if (result?.error) {
                this.state.error = result.error;
            } else {
                this.state.data = normalizePurchasePayload(result);
            }
        } catch {
            this.state.error = "Failed to load purchase overview";
        } finally {
            this.state.loading = false;
        }
    }

    async setPeriod(period) {
        if (this.state.period === period) return;
        this.state.period = period;
        await this.fetchData();
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
        void this.state.navRevision;
        const action = this.actionService.currentController?.action;
        if (!action || !nav?.actionID) {
            return false;
        }
        return Number(action.id) === Number(nav.actionID);
    }

    async onOverviewNavClick(nav) {
        if (!nav?.actionID && !nav?.xmlid) {
            return;
        }
        const actionRequest = overviewActionXmlIdFromMenuXmlId(nav.xmlid) || nav.actionID;
        await this.actionService.doAction(actionRequest, {
            clearBreadcrumbs: true,
            onActionReady: () => this.menuService.setCurrentMenu(nav),
        });
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
        if (x.includes("sales_overview")) {
            return "fa-tachometer";
        }
        if (x.includes("purchase_overview")) {
            return "fa-shopping-basket";
        }
        if (x.includes("business") || x.includes("dashboard")) {
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

    /** For purchase spend, higher is often neutral-to-positive for ops — keep same color semantics as sales. */
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

registry
    .category("actions")
    .add("odoo_overview_dashboard.purchase_overview_action", PurchaseOverviewDashboard);

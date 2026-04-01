/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";

export const OVERVIEW_ROOT_MENU_XMLID = "odoo_overview_dashboard.menu_overview_root";
export const SIDEBAR_COLLAPSED_KEY = "odoo_overview_dashboard.sidebar_collapsed";

export const CHART_COLORS = {
    pastelBlue: "rgba(138, 180, 248, 0.95)",
    pastelBlueMid: "rgba(107, 154, 232, 0.95)",
    pastelBlueDeep: "rgba(88, 134, 220, 0.95)",
    pastelGreen: "rgba(34, 197, 94, 0.9)",
    pastelGreenSoft: "rgba(34, 197, 94, 0.14)",
    pastelAmber: "rgba(245, 158, 11, 0.9)",
    pastelAmberSoft: "rgba(245, 158, 11, 0.14)",
    pastelRed: "rgba(232, 93, 106, 0.95)",
    pastelRedSoft: "rgba(232, 93, 106, 0.12)",
    greyLine: "rgba(100, 116, 139, 0.55)",
};

export const DONUT_PALETTE = [
    CHART_COLORS.pastelBlueDeep,
    CHART_COLORS.pastelGreen,
    CHART_COLORS.pastelAmber,
    CHART_COLORS.pastelRed,
    "rgba(168, 85, 247, 0.88)",  // purple
    "rgba(20, 184, 166, 0.88)",  // teal
    "rgba(99, 102, 241, 0.88)",  // indigo
    "rgba(236, 72, 153, 0.86)",  // pink
    "rgba(132, 204, 22, 0.86)",  // lime
    "rgba(14, 165, 233, 0.86)",  // sky
    "rgba(251, 113, 133, 0.84)", // rose
    "rgba(234, 179, 8, 0.84)",   // yellow
];

/** Map Overview app menu xmlid → in-app view key (no doAction). */
export function menuXmlidToViewKey(xmlid) {
    const x = (xmlid || "").toLowerCase();
    if (x.includes("purchase_overview")) {
        return "purchase";
    }
    if (x.includes("inventory_overview")) {
        return "inventory";
    }
    return "sales";
}

export function navIconClassForXmlid(xmlid) {
    const x = (xmlid || "").toLowerCase();
    if (x.includes("purchase_overview")) {
        return "fa-shopping-basket";
    }
    if (x.includes("inventory_overview")) {
        return "fa-cubes";
    }
    if (x.includes("sales_overview") || x.includes("business") || x.includes("dashboard")) {
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

/** Period filter values (must match `overview_period.resolve_overview_period` on the server). */
export function getOverviewPeriodOptions() {
    return [
        { value: "last_7_days", label: _t("Last 7 days") },
        { value: "last_30_days", label: _t("Last 30 days") },
        { value: "week", label: _t("This week") },
        { value: "month", label: _t("This month") },
        { value: "quarter", label: _t("This quarter") },
        { value: "year", label: _t("This year") },
        { value: "last_month", label: _t("Last month") },
        { value: "last_quarter", label: _t("Last quarter") },
        { value: "last_year", label: _t("Last year") },
        { value: "custom", label: _t("Custom range") },
    ];
}

/** @odoo-module **/

import { Component } from "@odoo/owl";

export class OverviewDashboardHero extends Component {
    static template = "odoo_overview_dashboard.OverviewDashboardHero";
    static props = {
        eyebrow: String,
        title: String,
        periodLabel: String,
        userName: { type: String, optional: true },
        period: String,
        onPeriodChange: Function,
        periodOptions: { type: Array, optional: true },
        customDateFrom: { type: String, optional: true },
        customDateTo: { type: String, optional: true },
        onCustomDateFromChange: { type: Function, optional: true },
        onCustomDateToChange: { type: Function, optional: true },
        onApplyCustomRange: { type: Function, optional: true },
        customRangeApplyLabel: { type: String, optional: true },
    };
}

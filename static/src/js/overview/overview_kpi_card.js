/** @odoo-module **/

import { Component } from "@odoo/owl";

export class OverviewKpiCard extends Component {
    static template = "odoo_overview_dashboard.OverviewKpiCard";
    static props = {
        label: String,
        iconClass: String,
        animationOrder: Number,
        helpText: { type: String, optional: true },
        highlight: { type: Boolean, optional: true },
    };
}

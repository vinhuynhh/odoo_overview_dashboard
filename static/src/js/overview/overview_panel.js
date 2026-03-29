/** @odoo-module **/

import { Component } from "@odoo/owl";

export class OverviewPanel extends Component {
    static template = "odoo_overview_dashboard.OverviewPanel";
    static props = {
        title: String,
        badge: { type: String, optional: true },
        animationOrder: { type: Number, optional: true },
    };
}

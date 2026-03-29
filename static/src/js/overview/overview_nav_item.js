/** @odoo-module **/

import { Component } from "@odoo/owl";

export class OverviewNavItem extends Component {
    static template = "odoo_overview_dashboard.OverviewNavItem";
    static props = {
        label: String,
        iconClass: String,
        active: Boolean,
        title: { type: String, optional: true },
        onSelect: Function,
    };
}

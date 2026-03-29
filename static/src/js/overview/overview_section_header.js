/** @odoo-module **/

import { Component } from "@odoo/owl";

export class OverviewSectionHeader extends Component {
    static template = "odoo_overview_dashboard.OverviewSectionHeader";
    static props = {
        title: String,
        description: { type: String, optional: true },
    };
}

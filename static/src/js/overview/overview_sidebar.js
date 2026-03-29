/** @odoo-module **/

import { Component } from "@odoo/owl";
import { OverviewNavItem } from "./overview_nav_item";

export class OverviewSidebar extends Component {
    static template = "odoo_overview_dashboard.OverviewSidebar";
    static components = { OverviewNavItem };
    static props = {
        collapsed: Boolean,
        toggleLabel: String,
        navEntries: Array,
        activeViewKey: String,
        onToggleCollapsed: Function,
        onSelectView: Function,
    };

    get toggleAriaExpanded() {
        return this.props.collapsed ? "false" : "true";
    }

    navItemProps(entry) {
        return {
            label: entry.name,
            iconClass: entry.iconClass,
            active: entry.viewKey === this.props.activeViewKey,
            title: entry.name,
            onSelect: () => this.props.onSelectView(entry),
        };
    }
}

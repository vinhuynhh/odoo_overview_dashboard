/** @odoo-module **/

import { Component, onMounted, onWillUpdateProps, useEffect, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { browser } from "@web/core/browser/browser";
import { _t } from "@web/core/l10n/translation";
import { useService } from "@web/core/utils/hooks";
import {
    OVERVIEW_ROOT_MENU_XMLID,
    SIDEBAR_COLLAPSED_KEY,
    menuXmlidToViewKey,
    navIconClassForXmlid,
} from "./overview_constants";
import { OverviewSidebar } from "./overview_sidebar";
import { SalesDashboardBody } from "./sales_dashboard_body";
import { PurchaseDashboardBody } from "./purchase_dashboard_body";
import { InventoryDashboardBody } from "./inventory_dashboard_body";

export class OverviewShell extends Component {
    static template = "odoo_overview_dashboard.OverviewShell";
    static components = { OverviewSidebar, SalesDashboardBody, PurchaseDashboardBody, InventoryDashboardBody };
    static props = { "*": true };
    static displayName = _t("Overview");

    static extractProps(action) {
        const params = action.params || {};
        const view =
            params.view === "purchase" ? "purchase" : params.view === "inventory" ? "inventory" : "sales";
        return { initialView: view };
    }

    setup() {
        this.menuService = useService("menu");
        const startView =
            this.props.initialView === "purchase"
                ? "purchase"
                : this.props.initialView === "inventory"
                  ? "inventory"
                  : "sales";
        this.state = useState({
            activeView: startView,
            sidebarCollapsed: browser.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
        });

        onWillUpdateProps((nextProps) => {
            const v =
                nextProps.initialView === "purchase"
                    ? "purchase"
                    : nextProps.initialView === "inventory"
                      ? "inventory"
                      : "sales";
            if (v !== this.state.activeView) {
                this.state.activeView = v;
            }
        });

        useEffect(
            () => {
                document.body.classList.add("o_overview_sidebar_mode");
                return () => document.body.classList.remove("o_overview_sidebar_mode");
            },
            () => []
        );

        onMounted(() => {
            const entry = this.overviewNavEntries.find((e) => e.viewKey === this.state.activeView);
            if (entry?.rawMenu) {
                this.menuService.setCurrentMenu(entry.rawMenu);
            }
        });

        this.toggleSidebarCollapsed = () => {
            this.state.sidebarCollapsed = !this.state.sidebarCollapsed;
            browser.localStorage.setItem(
                SIDEBAR_COLLAPSED_KEY,
                this.state.sidebarCollapsed ? "1" : ""
            );
        };

        this.selectOverviewEntry = (entry) => {
            this.state.activeView = entry.viewKey;
            if (entry.rawMenu) {
                this.menuService.setCurrentMenu(entry.rawMenu);
            }
        };
    }

    get overviewNavEntries() {
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
                        items.push({
                            id: m.id,
                            name: m.name,
                            xmlid: m.xmlid,
                            iconClass: navIconClassForXmlid(m.xmlid),
                            viewKey: menuXmlidToViewKey(m.xmlid),
                            rawMenu: m,
                        });
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

    get sidebarToggleLabel() {
        return this.state.sidebarCollapsed ? _t("Expand menu") : _t("Collapse menu");
    }
}

registry.category("actions").add("odoo_overview_dashboard.overview_shell_action", OverviewShell);

/** @odoo-module **/

import { Component } from "@odoo/owl";

export class OverviewRankedTable extends Component {
    static template = "odoo_overview_dashboard.OverviewRankedTable";
    static props = {
        rows: Array,
        rowKeyField: String,
        mainField: String,
        subField: { type: String, optional: true },
        amountField: String,
        formatAmount: Function,
        emptyMessage: String,
    };

    itemKey(row) {
        return row[this.props.rowKeyField];
    }

    mainText(row) {
        return row[this.props.mainField];
    }

    subText(row) {
        const f = this.props.subField;
        return f ? row[f] : "";
    }

    amountText(row) {
        return this.props.formatAmount(row[this.props.amountField]);
    }
}

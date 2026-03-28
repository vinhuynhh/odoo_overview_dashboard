# Overview Dashboard (`odoo_overview_dashboard`)

Sales-focused overview for **Odoo 19** Community: an OWL client action with Chart.js, a foldable sidebar, and a pastel blue UI.

## Requirements

- Odoo **19.0**
- Modules: `base`, `web`, `sale_management`

## Install / upgrade

1. Add this folder to your addons path.
2. Update Apps list, install **Business Overview Dashboard**, or from the shell:

   ```bash
   odoo-bin -u odoo_overview_dashboard -d YOUR_DATABASE
   ```

3. After SCSS or asset changes, clear compiled assets (Developer mode → **Clear assets**) or restart the server.

## Menu

**Overview** → **Sales overview** (root app menu with optional web icon).

## Access

- JSON route: `/odoo_overview_dashboard/sales/data`
- Users need **`sales_team.group_sale_salesman`** (Sales / User). Others see an access error on load.

## What the Sales screen shows

- **Key metrics:** net revenue, gross profit (margin %), orders, average order value, open quotations (count + pipeline value untaxed), with month-over-month deltas where applicable.
- **Trends & mix:** six-month line chart (revenue, gross profit, illustrative target line) and doughnut mix by product category (current month).
- **Top performers:** top products and top customers by revenue for the current month.

Gross profit uses **product standard price** as cost on order lines; net revenue is **untaxed** confirmed order totals. See the on-screen disclaimer.

## Technical layout

| Area | Location |
|------|----------|
| Client action & OWL | `static/src/js/sales_overview.js`, `static/src/xml/sales_overview.xml` |
| Styles | `static/src/scss/sales_overview.scss` |
| Data service | `models/sales_overview.py` (`odoo.overview.sales.service`) |
| HTTP | `controllers/sales_overview_controller.py` |

## Roadmap

Purchase and Inventory overview screens are planned as separate entries under the same app shell.

## License

LGPL-3 (see manifest).

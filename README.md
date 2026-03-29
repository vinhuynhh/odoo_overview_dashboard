# Business Overview Dashboard

Native **Odoo 19** client application delivering **Sales** and **Purchase** executive overviews: KPIs, period analysis, trend and mix charts, ranked lists, and an in-app navigation shell built with **OWL** and **Chart.js**.

---

## Capabilities

- **Unified shell** — Single client action hosts a collapsible sidebar; switching between Sales and Purchase views updates the main content without reloading the whole action.
- **Sales overview** — Net revenue, gross profit (standard-price–based cost), orders, average order value, open quotations; revenue and margin trends; category mix; top products and customers.
- **Purchase overview** — Confirmed PO spend, PO count, average PO value, active vendors, open RFQs; spend trend; category mix; top products and vendors.
- **Period selection** — Preset ranges (e.g. this week, month, quarter, year, last month/quarter/year, rolling 7 / 30 days) plus **custom date range** (inclusive; max span enforced server-side). **Custom range** does not compute prior-period comparisons.
- **Accessibility & UX** — KPI tooltips, responsive layout, shared styling via SCSS.

---

## Requirements

| Item | Notes |
|------|--------|
| **Odoo** | 19.0 |
| **Python dependencies** | Uses `dateutil` (standard in Odoo) |
| **Module dependencies** | `base`, `web`, `sale_management`, `purchase` |

Optional SQL scripts under `scripts/` may assume additional modules (e.g. `sale_stock` fields such as `picking_policy`). Use only on non-production databases with a backup.

---

## Installation

1. Place this module on your Odoo addons path (e.g. `custom_modules_19/odoo_overview_dashboard`).
2. Update the app list and install **Business Overview Dashboard**, or upgrade an existing database:

   ```bash
   ./odoo-bin -u odoo_overview_dashboard -d YOUR_DATABASE
   ```

3. After changing static assets, restart Odoo or use **Developer → Regenerate Assets Bundles** (or equivalent) so `web.assets_backend` picks up JS/XML/SCSS changes.

---

## Usage

### Menus

- **Overview → Sales overview** — Visible to users in **`sales_team.group_sale_salesman`**.
- **Overview → Purchase overview** — Visible to users in **`purchase.group_purchase_user`**.

Each menu entry opens the same shell with the correct default sub-view (Sales vs Purchase). In-sidebar navigation switches the active dashboard without issuing a new window action.

### Data definitions (summary)

- **Sales KPIs** — Untaxed amounts on sale orders in **Sale** or **Done** for the selected period; gross profit uses line subtotals minus product standard cost for shipped/sold quantities; open quotations are **Draft** or **Sent** (company-wide for the quotation metrics).
- **Purchase KPIs** — Untaxed totals on purchase orders in **Purchase** state for the period; open RFQs include **Draft**, **Sent**, and **To approve** as configured in standard Purchase.

On-screen disclaimers remind administrators to align definitions with internal accounting policy.

---

## HTTP API (JSON-RPC)

Authenticated routes (same groups as above):

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/odoo_overview_dashboard/sales/data` | Sales dashboard payload |
| `POST` | `/odoo_overview_dashboard/purchase/data` | Purchase dashboard payload |

**Request parameters**

- `period` (string) — One of: `month`, `quarter`, `year`, `week`, `last_month`, `last_quarter`, `last_year`, `last_7_days`, `last_30_days`, `custom`.
- For `custom`: `date_from` and `date_to` as `YYYY-MM-DD` (inclusive range on the server). Response includes `meta.compare_previous: false` and null delta fields where comparisons are omitted.

Example:

```json
{
  "period": "quarter"
}
```

Custom range:

```json
{
  "period": "custom",
  "date_from": "2025-01-01",
  "date_to": "2025-03-31"
}
```

---

## Technical structure

| Area | Location |
|------|----------|
| Client shell & dashboards | `static/src/js/overview/`, `static/src/xml/` |
| Styling | `static/src/scss/sales_overview.scss` |
| Period logic (shared) | `models/overview_period.py` |
| Sales / Purchase services | `models/sales_overview.py`, `models/purchase_overview.py` |
| Routes | `controllers/sales_overview_controller.py`, `controllers/purchase_overview_controller.py` |
| Menus & client actions | `views/menu.xml`, `views/sales_overview_action.xml`, `views/purchase_overview_action.xml` |
| Access | `security/ir.model.access.csv` |

The registered client action tag is **`odoo_overview_dashboard.overview_shell_action`**; menu actions pass `params` to distinguish the initial view (`sales` vs `purchase`).

---

## Roadmap

- **Inventory** overview using the same application shell (planned).

---

## License and credits

- **License:** LGPL-3  
- **Author:** DLHM  

For improvements or defect reports, use your project’s standard contribution workflow.

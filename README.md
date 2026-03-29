# Odoo Overview Dashboard

OWL dashboards for **Odoo 19** — **Sales** and **Purchase** overviews with KPIs, trend & mix charts, ranking tables, collapsible sidebar, pastel UI (Chart.js + Font Awesome).

**Depends:** `base`, `web`, `sale_management`, **`purchase`**.  
**Optional SQL seeds** under `scripts/` expect **`sale_stock`** on sales orders (`picking_policy`).

## Install

```bash
./odoo-bin -u odoo_overview_dashboard -d YOUR_DB
```

Apps → update list → install **Business Overview Dashboard**. After asset edits: **Developer → Clear assets** or restart.

## Use

- **Sales:** Menu **Overview** → **Sales overview**. Access: `sales_team.group_sale_salesman`. API: `POST /odoo_overview_dashboard/sales/data`.
- **Purchase:** Menu **Overview** → **Purchase overview**. Access: `purchase.group_purchase_user`. API: `POST /odoo_overview_dashboard/purchase/data`.

Request body: `{"period": "month"}` or `"quarter"` or `"year"`.

## Metrics (short)

**Sales:** untaxed revenue & gross profit (standard price cost), top customers/products, open quotations.  
**Purchase:** untaxed **confirmed PO** spend (`state = purchase`), PO count & AOV, active vendors, **open RFQs** (`draft` / `sent` / `to approve`), top vendors/products, category mix.

Disclaimers on screen — align with your policies.

## Code map

**OWL**

- Sales: `static/src/js/sales_overview.js`, `static/src/xml/sales_overview.xml`
- Purchase: `static/src/js/purchase_overview.js`, `static/src/xml/purchase_overview.xml`

**Styles:** `static/src/scss/sales_overview.scss` (shared look).

**Data:** `models/sales_overview.py` (Sales), `models/purchase_overview.py` (Purchase).

**HTTP:** `controllers/sales_overview_controller.py` (Sales), `controllers/purchase_overview_controller.py` (Purchase).

**Actions:** `views/sales_overview_action.xml`, `views/purchase_overview_action.xml`.

**Dev seeds (Sales):** `scripts/seed_100_sale_orders.sql`, `seed_100_sale_orders_last_year.sql` — backup DB; dev only.

## Roadmap

**Inventory** overview (same app shell).

---

**License:** LGPL-3 · **Author:** DLHM · Issues & PRs welcome.

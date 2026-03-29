# Odoo Overview Dashboard

OWL **Sales** dashboard for **Odoo 19** — KPIs, trend & mix charts, top products/customers, collapsible sidebar, pastel UI (Chart.js + Font Awesome).

**Depends:** `base`, `web`, `sale_management` (no `stock` required for the module).  
**Optional SQL seeds** under `scripts/` expect **`sale_stock`** columns (e.g. `sale.order.picking_policy`).

## Install

```bash
# addons_path must include this folder (e.g. custom_addons/odoo_overview_dashboard)
./odoo-bin -u odoo_overview_dashboard -d YOUR_DB
```

Apps → update list → install **Business Overview Dashboard**. After asset edits: **Developer → Clear assets** or restart.

## Use

**Overview** → **Sales overview** → period: **month** / **quarter** / **year**.

**Access:** `sales_team.group_sale_salesman`  
**API:** `POST /odoo_overview_dashboard/sales/data` · body `{ "period": "month"|"quarter"|"year" }`

## Metrics (short)

- **Net revenue** — untaxed total, confirmed orders (`sale`, `done`), selected period.  
- **Gross profit** — revenue − cost; cost = **standard price** × qty (UoM-safe).  
- **Open quotations** — `draft`/`sent`, company-wide (not tied to period).  

Details + disclaimer appear on screen; tune for your accounting if needed.

## Code map

| Layer | Path |
|--------|------|
| OWL | `static/src/js/sales_overview.js`, `xml/sales_overview.xml`, `scss/sales_overview.scss` |
| Data | `models/sales_overview.py` → `odoo.overview.sales.service` |
| HTTP | `controllers/sales_overview_controller.py` |
| UI wiring | `views/menu.xml`, `views/sales_overview_action.xml` |

**Dev seeds:** `scripts/seed_100_sale_orders.sql`, `scripts/seed_100_sale_orders_last_year.sql` — backup DB first; dev only.

## Roadmap

Purchase & Inventory overviews (same app shell, separate actions).

---

**License:** LGPL-3 · **Author:** DLHM · Issues & PRs welcome.

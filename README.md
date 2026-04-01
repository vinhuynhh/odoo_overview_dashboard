# Business Overview Dashboard

⚡ **High‑performance OWL app** for Sales, Purchase & Inventory insights.  
🧭 **Single shell** keeps navigation instant (swap body, not page).  
🧩 **Reusable components** make new sections fast to compose.  
🗓️ **Flexible periods** (incl. custom range) with smart comparisons.

---

## Component groups (child → parent)

### 🧱 Shell

- `OverviewShell` → *(root)*

### 🧭 Navigation

- `OverviewSidebar` → `OverviewShell`
- `OverviewNavItem` → `OverviewSidebar`

### 📊 Dashboard bodies

- `SalesDashboardBody` → `OverviewShell`
- `PurchaseDashboardBody` → `OverviewShell`
- `InventoryDashboardBody` → `OverviewShell`

### 🧩 Shared UI

- `OverviewDashboardHero` → `*DashboardBody`
- `OverviewDashboardSkeleton` → `*DashboardBody`
- `OverviewSectionHeader` → `*DashboardBody`
- `OverviewPanel` → `*DashboardBody`
- `OverviewKpiCard` → `*DashboardBody`
- `OverviewRankedTable` → `*DashboardBody`

### 🛠️ Helpers

- `overview_constants.js` → *(imported by many)*
- `overview_formatters.js` → *(imported by many)*
- `overview_data_sales.js` → `SalesDashboardBody`
- `overview_data_purchase.js` → `PurchaseDashboardBody`
- `overview_data_inventory.js` → `InventoryDashboardBody`


{
    "name": "Business Overview Dashboard",
    "version": "19.0.1.0.0",
    "summary": "Overview dashboards — Sales (Purchase & Inventory planned)",
    "category": "Sales",
    "author": "DLHM",
    "license": "LGPL-3",
    "sequence": 1,
    "depends": ["base", "web", "sale_management"],
    "data": [
        "security/ir.model.access.csv",
        "views/sales_overview_action.xml",
        "views/menu.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "odoo_overview_dashboard/static/src/js/sales_overview.js",
            "odoo_overview_dashboard/static/src/xml/sales_overview.xml",
            "odoo_overview_dashboard/static/src/scss/sales_overview.scss",
        ],
    },
    "installable": True,
    "application": True,
}

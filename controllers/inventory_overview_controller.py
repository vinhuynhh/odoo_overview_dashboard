from odoo import http
from odoo.http import request


class InventoryOverviewController(http.Controller):
    @http.route("/odoo_overview_dashboard/inventory/data", type="jsonrpc", auth="user")
    def inventory_overview_data(self, **kwargs):
        if not request.env.user.has_group("stock.group_stock_user"):
            return {"error": "Access denied"}
        period = kwargs.get("period", "month")
        return request.env["odoo.overview.inventory.service"].get_inventory_overview_data(
            period=period,
            date_from=kwargs.get("date_from"),
            date_to=kwargs.get("date_to"),
        )


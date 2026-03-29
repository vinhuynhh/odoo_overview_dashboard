from odoo import http
from odoo.http import request


class PurchaseOverviewController(http.Controller):
    @http.route("/odoo_overview_dashboard/purchase/data", type="jsonrpc", auth="user")
    def purchase_overview_data(self, **kwargs):
        if not request.env.user.has_group("purchase.group_purchase_user"):
            return {"error": "Access denied"}
        period = kwargs.get("period", "month")
        return request.env["odoo.overview.purchase.service"].get_purchase_overview_data(
            period=period,
            date_from=kwargs.get("date_from"),
            date_to=kwargs.get("date_to"),
        )

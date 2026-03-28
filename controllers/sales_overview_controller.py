from odoo import http
from odoo.http import request


class SalesOverviewController(http.Controller):
    @http.route("/odoo_overview_dashboard/sales/data", type="json", auth="user")
    def sales_overview_data(self):
        if not request.env.user.has_group("sales_team.group_sale_salesman"):
            return {"error": "Access denied"}
        return request.env["odoo.overview.sales.service"].get_sales_overview_data()

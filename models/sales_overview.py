from collections import defaultdict

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models


class SalesOverviewService(models.AbstractModel):
    _name = "odoo.overview.sales.service"
    _description = "Sales Overview (SME sales metrics)"

    def _sale_line_cost(self, line):
        product = line.product_id
        if not product or not line.product_uom_id:
            return 0.0
        qty_in_std_uom = line.product_uom_id._compute_quantity(
            line.product_uom_qty,
            product.uom_id,
        )
        return qty_in_std_uom * (product.standard_price or 0.0)

    def _pct_change(self, current, previous):
        if previous in (0, 0.0, None):
            return 100.0 if current else 0.0
        return round((current - previous) / previous * 100, 1)

    def _orders_in_period(self, company, start, end):
        return self.env["sale.order"].search(
            [
                ("company_id", "=", company.id),
                ("state", "in", ["sale", "done"]),
                ("date_order", ">=", fields.Datetime.to_datetime(start)),
                ("date_order", "<", fields.Datetime.to_datetime(end)),
            ]
        )

    def _sum_untaxed(self, orders):
        return sum(orders.mapped("amount_untaxed"))

    def _gross_profit_from_orders(self, orders):
        lines = self.env["sale.order.line"].search([("order_id", "in", orders.ids)])
        total = 0.0
        for line in lines:
            total += line.price_subtotal - self._sale_line_cost(line)
        return total

    @api.model
    def get_sales_overview_data(self, period="month"):
        company = self.env.company
        today = fields.Date.context_today(self)

        if period == "year":
            current_start = today.replace(month=1, day=1)
            current_end = current_start + relativedelta(years=1)
            prev_start = current_start - relativedelta(years=1)
            prev_end = current_start
            period_label = today.strftime("%Y")
            trend_steps = 5
            trend_delta = relativedelta(years=1)
        elif period == "quarter":
            q_month = ((today.month - 1) // 3) * 3 + 1
            current_start = today.replace(month=q_month, day=1)
            current_end = current_start + relativedelta(months=3)
            prev_start = current_start - relativedelta(months=3)
            prev_end = current_start
            period_label = f"Q{(today.month - 1) // 3 + 1} {today.year}"
            trend_steps = 4
            trend_delta = relativedelta(months=3)
        else:
            current_start = today.replace(day=1)
            current_end = current_start + relativedelta(months=1)
            prev_start = current_start - relativedelta(months=1)
            prev_end = current_start
            period_label = today.strftime("%B %Y")
            trend_steps = 6
            trend_delta = relativedelta(months=1)

        user = self.env.user
        has_sales = user.has_group("sales_team.group_sale_salesman")

        currency = company.currency_id
        meta = {
            "period": period,
            "period_label": period_label,
            "currency_id": currency.id,
            "currency_symbol": currency.symbol or currency.name,
            "has_sales_access": has_sales,
            "disclaimer": (
                "Net revenue is untaxed sales total. Gross profit uses product "
                "standard price as cost — align with your accounting policy."
            ),
        }

        trend_labels = []
        trend_revenue = []
        trend_profit = []

        for i in range(trend_steps - 1, -1, -1):
            p_start = current_start - (trend_delta * i)
            p_end = p_start + trend_delta
            
            if period == "year":
                trend_labels.append(p_start.strftime("%Y"))
            elif period == "quarter":
                trend_labels.append(f"Q{(p_start.month - 1) // 3 + 1} '{p_start.strftime('%y')}")
            else:
                trend_labels.append(p_start.strftime("%b"))

            if has_sales:
                orders_p = self._orders_in_period(company, p_start, p_end)
                trend_revenue.append(self._sum_untaxed(orders_p))
                trend_profit.append(self._gross_profit_from_orders(orders_p))
            else:
                trend_revenue.append(0.0)
                trend_profit.append(0.0)

        if has_sales:
            current_orders = self._orders_in_period(company, current_start, current_end)
            prev_orders = self._orders_in_period(company, prev_start, prev_end)
        else:
            current_orders = self.env["sale.order"]
            prev_orders = self.env["sale.order"]

        revenue_m = self._sum_untaxed(current_orders) if has_sales else 0.0
        revenue_prev = self._sum_untaxed(prev_orders) if has_sales else 0.0
        profit_m = self._gross_profit_from_orders(current_orders) if has_sales else 0.0
        profit_prev = self._gross_profit_from_orders(prev_orders) if has_sales else 0.0
        
        margin_pct = round((profit_m / revenue_m * 100), 1) if revenue_m else 0.0
        orders_count = len(current_orders) if has_sales else 0
        orders_prev = len(prev_orders) if has_sales else 0

        aov = round(revenue_m / orders_count, 2) if orders_count else 0.0

        avg_rev = sum(trend_revenue) / len(trend_revenue) if trend_revenue else 0.0
        target_line = [round(avg_rev * 1.05, 2)] * trend_steps if trend_revenue else []

        # Open quotations (pipeline)
        quotations_count = 0
        quotations_value = 0.0
        if has_sales:
            quotes = self.env["sale.order"].search(
                [
                    ("company_id", "=", company.id),
                    ("state", "in", ["draft", "sent"]),
                ]
            )
            quotations_count = len(quotes)
            quotations_value = sum(quotes.mapped("amount_untaxed"))

        revenue_by_category = []
        if has_sales and current_orders:
            cat_amount = defaultdict(float)
            lines = self.env["sale.order.line"].search(
                [("order_id", "in", current_orders.ids)]
            )
            for line in lines:
                if not line.product_id or not line.product_id.categ_id:
                    continue
                cat_amount[line.product_id.categ_id] += line.price_subtotal
            total_cat = sum(cat_amount.values()) or 1.0
            sorted_cats = sorted(
                cat_amount.items(), key=lambda x: x[1], reverse=True
            )[:8]
            revenue_by_category = [
                {
                    "name": c.display_name,
                    "amount": round(amt, 2),
                    "pct": round(amt / total_cat * 100, 1),
                }
                for c, amt in sorted_cats
            ]

        top_sellers = []
        if has_sales and current_orders:
            grouped = self.env["sale.order.line"].read_group(
                domain=[("order_id", "in", current_orders.ids)],
                fields=["product_id", "price_subtotal:sum"],
                groupby=["product_id"],
                orderby="price_subtotal desc",
                limit=8,
                lazy=False,
            )
            for row in grouped:
                pid = row.get("product_id")
                if not pid:
                    continue
                product = self.env["product.product"].browse(pid[0])
                top_sellers.append(
                    {
                        "product_id": product.id,
                        "name": product.display_name,
                        "categ_name": product.categ_id.display_name
                        if product.categ_id
                        else "",
                        "amount": row.get("price_subtotal", 0.0) or 0.0,
                    }
                )

        top_customers = []
        if has_sales and current_orders:
            grouped_c = self.env["sale.order"].read_group(
                domain=[
                    ("id", "in", current_orders.ids),
                    ("partner_id", "!=", False),
                ],
                fields=["partner_id", "amount_untaxed:sum"],
                groupby=["partner_id"],
                orderby="amount_untaxed desc",
                limit=8,
                lazy=False,
            )
            for row in grouped_c:
                partner = row.get("partner_id")
                if not partner:
                    continue
                top_customers.append(
                    {
                        "partner_id": partner[0],
                        "name": partner[1],
                        "amount": row.get("amount_untaxed", 0.0) or 0.0,
                    }
                )

        kpis = {
            "net_revenue": round(revenue_m, 2),
            "net_revenue_delta_pct": self._pct_change(revenue_m, revenue_prev),
            "gross_profit": round(profit_m, 2),
            "gross_profit_delta_pct": self._pct_change(profit_m, profit_prev),
            "margin_pct": margin_pct,
            "orders_count": orders_count,
            "orders_delta_pct": self._pct_change(orders_count, orders_prev),
            "aov": aov,
            "quotations_count": quotations_count,
            "quotations_value": round(quotations_value, 2),
        }

        return {
            "meta": meta,
            "kpis": kpis,
            "monthly_trend": {
                "labels": trend_labels,
                "revenue": trend_revenue,
                "gross_profit": trend_profit,
                "target_revenue": target_line,
            },
            "revenue_by_category": revenue_by_category,
            "top_sellers": top_sellers,
            "top_customers": top_customers,
        }

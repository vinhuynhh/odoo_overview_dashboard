from collections import defaultdict

from odoo import api, fields, models

from .overview_period import resolve_custom_overview_period, resolve_overview_period


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
    def get_sales_overview_data(self, period="month", date_from=None, date_to=None):
        company = self.env.company
        today = fields.Date.context_today(self)

        period_key = (period or "month").strip().lower()
        if period_key == "custom":
            try:
                win = resolve_custom_overview_period(date_from, date_to)
            except ValueError as err:
                return {"error": str(err)}
        else:
            win = resolve_overview_period(period_key, today)
        period = win["period"]
        current_start = win["current_start"]
        current_end = win["current_end"]
        prev_start = win["prev_start"]
        prev_end = win["prev_end"]
        period_label = win["period_label"]
        trend_labels = win["trend_labels"]
        trend_segments = win["trend_segments"]
        compare_previous = win.get("compare_previous", True)

        user = self.env.user
        has_sales = user.has_group("sales_team.group_sale_salesman")

        currency = company.currency_id
        meta = {
            "period": period,
            "period_label": period_label,
            "currency_id": currency.id,
            "currency_symbol": currency.symbol or currency.name,
            "has_sales_access": has_sales,
            "compare_previous": compare_previous,
            "disclaimer": (
                "Net revenue is untaxed sales total. Gross profit uses product "
                "standard price as cost — align with your accounting policy."
            ),
        }

        trend_revenue = []
        trend_profit = []

        for p_start, p_end in trend_segments:
            if has_sales:
                orders_p = self._orders_in_period(company, p_start, p_end)
                trend_revenue.append(self._sum_untaxed(orders_p))
                trend_profit.append(self._gross_profit_from_orders(orders_p))
            else:
                trend_revenue.append(0.0)
                trend_profit.append(0.0)

        if has_sales:
            current_orders = self._orders_in_period(company, current_start, current_end)
            prev_orders = (
                self._orders_in_period(company, prev_start, prev_end)
                if compare_previous
                else self.env["sale.order"]
            )
        else:
            current_orders = self.env["sale.order"]
            prev_orders = self.env["sale.order"]

        revenue_m = self._sum_untaxed(current_orders) if has_sales else 0.0
        revenue_prev = (
            self._sum_untaxed(prev_orders)
            if (has_sales and compare_previous)
            else 0.0
        )
        profit_m = self._gross_profit_from_orders(current_orders) if has_sales else 0.0
        profit_prev = (
            self._gross_profit_from_orders(prev_orders)
            if (has_sales and compare_previous)
            else 0.0
        )
        
        margin_pct = round((profit_m / revenue_m * 100), 1) if revenue_m else 0.0
        orders_count = len(current_orders) if has_sales else 0
        orders_prev = len(prev_orders) if (has_sales and compare_previous) else 0

        aov = round(revenue_m / orders_count, 2) if orders_count else 0.0

        avg_rev = sum(trend_revenue) / len(trend_revenue) if trend_revenue else 0.0
        target_line = (
            [round(avg_rev * 1.05, 2)] * len(trend_revenue) if trend_revenue else []
        )

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
            grouped = self.env["sale.order.line"]._read_group(
                domain=[("order_id", "in", current_orders.ids)],
                groupby=["product_id"],
                aggregates=["price_subtotal:sum"],
                order="price_subtotal:sum desc",
                limit=8,
            )
            for product, price_subtotal in grouped:
                if not product:
                    continue
                top_sellers.append(
                    {
                        "product_id": product.id,
                        "name": product.display_name,
                        "categ_name": product.categ_id.display_name
                        if product.categ_id
                        else "",
                        "amount": price_subtotal or 0.0,
                    }
                )

        top_customers = []
        if has_sales and current_orders:
            grouped_c = self.env["sale.order"]._read_group(
                domain=[
                    ("id", "in", current_orders.ids),
                    ("partner_id", "!=", False),
                ],
                groupby=["partner_id"],
                aggregates=["amount_untaxed:sum"],
                order="amount_untaxed:sum desc",
                limit=8,
            )
            for partner, amount_untaxed in grouped_c:
                if not partner:
                    continue
                top_customers.append(
                    {
                        "partner_id": partner.id,
                        "name": partner.display_name,
                        "amount": amount_untaxed or 0.0,
                    }
                )

        if compare_previous:
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
        else:
            kpis = {
                "net_revenue": round(revenue_m, 2),
                "net_revenue_delta_pct": None,
                "gross_profit": round(profit_m, 2),
                "gross_profit_delta_pct": None,
                "margin_pct": margin_pct,
                "orders_count": orders_count,
                "orders_delta_pct": None,
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

from collections import defaultdict

from odoo import api, fields, models

from .overview_period import resolve_custom_overview_period, resolve_overview_period


class PurchaseOverviewService(models.AbstractModel):
    _name = "odoo.overview.purchase.service"
    _description = "Purchase Overview (procurement metrics)"

    def _pct_change(self, current, previous):
        if previous in (0, 0.0, None):
            return 100.0 if current else 0.0
        return round((current - previous) / previous * 100, 1)

    def _confirmed_pos_in_period(self, company, start, end):
        return self.env["purchase.order"].search(
            [
                ("company_id", "=", company.id),
                ("state", "=", "purchase"),
                ("date_order", ">=", fields.Datetime.to_datetime(start)),
                ("date_order", "<", fields.Datetime.to_datetime(end)),
            ]
        )

    def _sum_untaxed(self, orders):
        return sum(orders.mapped("amount_untaxed"))

    @api.model
    def get_purchase_overview_data(self, period="month", date_from=None, date_to=None):
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
        has_purchase = user.has_group("purchase.group_purchase_user")

        currency = company.currency_id
        meta = {
            "period": period,
            "period_label": period_label,
            "currency_id": currency.id,
            "currency_symbol": currency.symbol or currency.name,
            "has_purchase_access": has_purchase,
            "compare_previous": compare_previous,
            "disclaimer": (
                "Purchased spend is untaxed total on confirmed purchase orders (state Purchase "
                "Order) in the selected period. Open pipeline includes RFQs (draft, sent, to approve) "
                "company-wide."
            ),
        }

        trend_spend = []

        for p_start, p_end in trend_segments:
            if has_purchase:
                pos_p = self._confirmed_pos_in_period(company, p_start, p_end)
                trend_spend.append(self._sum_untaxed(pos_p))
            else:
                trend_spend.append(0.0)

        if has_purchase:
            current_pos = self._confirmed_pos_in_period(
                company, current_start, current_end
            )
            prev_pos = (
                self._confirmed_pos_in_period(company, prev_start, prev_end)
                if compare_previous
                else self.env["purchase.order"]
            )
        else:
            current_pos = self.env["purchase.order"]
            prev_pos = self.env["purchase.order"]

        spend_m = self._sum_untaxed(current_pos) if has_purchase else 0.0
        spend_prev = (
            self._sum_untaxed(prev_pos)
            if (has_purchase and compare_previous)
            else 0.0
        )

        po_count = len(current_pos) if has_purchase else 0
        po_prev = len(prev_pos) if (has_purchase and compare_previous) else 0

        aov = round(spend_m / po_count, 2) if po_count else 0.0

        vendors_count = 0
        if has_purchase and current_pos:
            vendors_count = len({p.id for p in current_pos.mapped("partner_id") if p})

        rfq_count = 0
        rfq_value = 0.0
        if has_purchase:
            rfqs = self.env["purchase.order"].search(
                [
                    ("company_id", "=", company.id),
                    ("state", "in", ["draft", "sent", "to approve"]),
                ]
            )
            rfq_count = len(rfqs)
            rfq_value = sum(rfqs.mapped("amount_untaxed"))

        avg_spend = sum(trend_spend) / len(trend_spend) if trend_spend else 0.0
        target_line = (
            [round(avg_spend * 1.05, 2)] * len(trend_spend) if trend_spend else []
        )

        spend_by_category = []
        if has_purchase and current_pos:
            cat_amount = defaultdict(float)
            lines = self.env["purchase.order.line"].search(
                [("order_id", "in", current_pos.ids)]
            )
            for line in lines:
                if line.display_type or line.is_downpayment:
                    continue
                if not line.product_id or not line.product_id.categ_id:
                    continue
                cat_amount[line.product_id.categ_id] += line.price_subtotal
            total_cat = sum(cat_amount.values()) or 1.0
            sorted_cats = sorted(
                cat_amount.items(), key=lambda x: x[1], reverse=True
            )[:8]
            spend_by_category = [
                {
                    "name": c.display_name,
                    "amount": round(amt, 2),
                    "pct": round(amt / total_cat * 100, 1),
                }
                for c, amt in sorted_cats
            ]

        top_products = []
        if has_purchase and current_pos:
            grouped = self.env["purchase.order.line"]._read_group(
                domain=[("order_id", "in", current_pos.ids)],
                groupby=["product_id"],
                aggregates=["price_subtotal:sum"],
                order="price_subtotal:sum desc",
                limit=8,
            )
            for product, price_subtotal in grouped:
                if not product:
                    continue
                top_products.append(
                    {
                        "product_id": product.id,
                        "name": product.display_name,
                        "categ_name": product.categ_id.display_name
                        if product.categ_id
                        else "",
                        "amount": price_subtotal or 0.0,
                    }
                )

        top_vendors = []
        if has_purchase and current_pos:
            grouped_v = self.env["purchase.order"]._read_group(
                domain=[
                    ("id", "in", current_pos.ids),
                    ("partner_id", "!=", False),
                ],
                groupby=["partner_id"],
                aggregates=["amount_untaxed:sum"],
                order="amount_untaxed:sum desc",
                limit=8,
            )
            for partner, amount_untaxed in grouped_v:
                if not partner:
                    continue
                top_vendors.append(
                    {
                        "partner_id": partner.id,
                        "name": partner.display_name,
                        "amount": amount_untaxed or 0.0,
                    }
                )

        if compare_previous:
            kpis = {
                "purchased_spend": round(spend_m, 2),
                "purchased_spend_delta_pct": self._pct_change(
                    spend_m, spend_prev
                ),
                "open_rfq_count": rfq_count,
                "open_rfq_value": round(rfq_value, 2),
                "po_count": po_count,
                "po_delta_pct": self._pct_change(po_count, po_prev),
                "aov": aov,
                "vendors_count": vendors_count,
            }
        else:
            kpis = {
                "purchased_spend": round(spend_m, 2),
                "purchased_spend_delta_pct": None,
                "open_rfq_count": rfq_count,
                "open_rfq_value": round(rfq_value, 2),
                "po_count": po_count,
                "po_delta_pct": None,
                "aov": aov,
                "vendors_count": vendors_count,
            }

        return {
            "meta": meta,
            "kpis": kpis,
            "monthly_trend": {
                "labels": trend_labels,
                "spend": trend_spend,
                "target_spend": target_line,
            },
            "spend_by_category": spend_by_category,
            "top_products": top_products,
            "top_vendors": top_vendors,
        }

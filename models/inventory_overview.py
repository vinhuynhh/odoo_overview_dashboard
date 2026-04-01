from collections import defaultdict
from datetime import timedelta

from odoo import api, fields, models

from .overview_period import resolve_custom_overview_period, resolve_overview_period


class InventoryOverviewService(models.AbstractModel):
    _name = "odoo.overview.inventory.service"
    _description = "Inventory Overview (stock health metrics)"

    def _pct_change(self, current, previous):
        if previous in (0, 0.0, None):
            return 100.0 if current else 0.0
        return round((current - previous) / previous * 100, 1)

    def _quant_groups(self, company):
        """Return per-product qty/reserved from quants for the company."""
        grouped = self.env["stock.quant"]._read_group(
            domain=[("company_id", "=", company.id)],
            groupby=["product_id"],
            aggregates=["quantity:sum", "reserved_quantity:sum"],
        )
        # _read_group returns tuples: (product, quantity_sum, reserved_quantity_sum)
        res = []
        for product, qty, reserved in grouped:
            if not product:
                continue
            res.append(
                {
                    "product_id": product.id,
                    "qty": qty or 0.0,
                    "reserved": reserved or 0.0,
                }
            )
        return res

    def _orderpoint_breaches(self, company):
        """Count products below their minimum stock rule (reordering rules)."""
        try:
            # Fields exist in stock.warehouse.orderpoint in standard Odoo.
            orderpoints = self.env["stock.warehouse.orderpoint"].search(
                [
                    ("company_id", "=", company.id),
                    ("product_id", "!=", False),
                ]
            )
        except Exception:
            return 0
        breaches = 0
        for op in orderpoints:
            # Compare against current on-hand in that location/warehouse rule scope.
            # `product_min_qty` and `product_max_qty` are per rule; `qty_on_hand` is computed.
            try:
                if (op.qty_on_hand or 0.0) < (op.product_min_qty or 0.0):
                    breaches += 1
            except Exception:
                continue
        return breaches

    def _open_pickings(self, company, start=None, end=None):
        domain = [
            ("company_id", "=", company.id),
            ("state", "in", ["draft", "waiting", "confirmed", "assigned"]),
        ]
        if start:
            domain.append(("scheduled_date", ">=", fields.Datetime.to_datetime(start)))
        if end:
            domain.append(("scheduled_date", "<", fields.Datetime.to_datetime(end)))
        return self.env["stock.picking"].search(domain)

    def _picking_stage_stats(self, company, start, end, picking_code):
        pickings = self.env["stock.picking"]
        domain = [
            ("company_id", "=", company.id),
            ("picking_type_id.code", "=", picking_code),
            ("scheduled_date", ">=", fields.Datetime.to_datetime(start)),
            ("scheduled_date", "<", fields.Datetime.to_datetime(end)),
        ]
        grouped = pickings._read_group(
            domain=domain,
            groupby=["state"],
            aggregates=["id:count"],
        )
        total = 0
        by_state = []
        for state, count in grouped:
            by_state.append({"state": state, "count": count or 0})
            total += count or 0
        by_state.sort(key=lambda r: r["count"], reverse=True)

        now = fields.Datetime.now()
        late_open = pickings.search_count(
            domain
            + [
                ("state", "not in", ["done", "cancel"]),
                ("scheduled_date", "<", now),
            ]
        )
        open_count = pickings.search_count(domain + [("state", "not in", ["done", "cancel"])])

        return {"total": total, "open": open_count, "late": late_open, "by_state": by_state}

    def _product_type_stats(self, company):
        """Count products by type using product templates.

        Odoo 19 uses `type` on product.template (consu, service, combo, ...).
        """
        templates = self.env["product.template"].with_context(active_test=True)
        domain = [("company_id", "in", [False, company.id])]
        grouped = templates._read_group(
            domain=domain,
            groupby=["type"],
            aggregates=["id:count"],
        )
        by_type = []
        total = 0
        for ptype, count in grouped:
            by_type.append({"type": ptype, "count": count or 0})
            total += count or 0
        by_type.sort(key=lambda r: r["count"], reverse=True)
        return {"total": total, "by_type": by_type}

    def _moves_qty_in_period(self, company, start, end, picking_code):
        """Sum completed quantities on move lines for incoming/outgoing pickings in window."""
        ml = self.env["stock.move.line"]
        domain = [
            ("company_id", "=", company.id),
            ("state", "=", "done"),
            ("date", ">=", fields.Datetime.to_datetime(start)),
            ("date", "<", fields.Datetime.to_datetime(end)),
            ("picking_id", "!=", False),
            ("picking_id.picking_type_id.code", "=", picking_code),
        ]
        grouped = ml._read_group(domain=domain, groupby=[], aggregates=["quantity:sum"])
        # _read_group returns [(quantity_sum,)] when no groupby, so unpack safely
        if not grouped:
            return 0.0
        total = grouped[0][0] if isinstance(grouped[0], (list, tuple)) else 0.0
        return total or 0.0

    def _dead_stock(self, company, as_of_date, days=90):
        """Dead stock = products with on-hand > 0 and no done move in last N days."""
        quant_groups = self._quant_groups(company)
        product_ids = [g["product_id"] for g in quant_groups if (g["qty"] or 0.0) > 0]
        if not product_ids:
            return {"products": 0, "qty": 0.0, "value": 0.0}

        cutoff_dt = fields.Datetime.to_datetime(as_of_date) - timedelta(days=days)
        # last move per product up to as_of_date
        grouped = self.env["stock.move.line"]._read_group(
            domain=[
                ("company_id", "=", company.id),
                ("state", "=", "done"),
                ("product_id", "in", product_ids),
                ("date", "<", fields.Datetime.to_datetime(as_of_date)),
            ],
            groupby=["product_id"],
            aggregates=["date:max"],
        )
        # tuples: (product, date_max)
        last_move_by_product = {product.id: dt for product, dt in grouped if product}

        products = self.env["product.product"].browse(product_ids).with_context(
            active_test=False
        )
        qty_by_product = {g["product_id"]: g["qty"] for g in quant_groups}
        dead_products = []
        for p in products:
            last_dt = last_move_by_product.get(p.id)
            if not last_dt or last_dt < cutoff_dt:
                dead_products.append(p)

        dead_qty = sum(qty_by_product.get(p.id, 0.0) for p in dead_products)
        dead_value = 0.0
        for p in dead_products:
            dead_value += (p.standard_price or 0.0) * (qty_by_product.get(p.id, 0.0) or 0.0)

        return {"products": len(dead_products), "qty": round(dead_qty, 2), "value": round(dead_value, 2)}

    @api.model
    def get_inventory_overview_data(self, period="month", date_from=None, date_to=None):
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
        has_stock = user.has_group("stock.group_stock_user")

        meta = {
            "period": period,
            "period_label": period_label,
            "has_inventory_access": has_stock,
            "compare_previous": compare_previous,
            "disclaimer": (
                "On-hand value is an approximation using product standard price × on-hand quantity. "
                "Inbound/outbound are summed from done stock move lines on incoming/outgoing pickings "
                "within each trend bucket."
            ),
        }

        if not has_stock:
            return {
                "meta": meta,
                "kpis": {},
                "monthly_trend": {"labels": trend_labels, "inbound_qty": [], "outbound_qty": []},
                "onhand_by_category": [],
                "top_products": [],
            }

        quant_groups = self._quant_groups(company)
        product_ids = [g["product_id"] for g in quant_groups]
        products = self.env["product.product"].browse(product_ids).with_context(active_test=False)
        prod_by_id = {p.id: p for p in products}

        onhand_qty = sum(g["qty"] for g in quant_groups)
        reserved_qty = sum(g["reserved"] for g in quant_groups)
        available_qty = onhand_qty - reserved_qty

        onhand_value = 0.0
        for g in quant_groups:
            p = prod_by_id.get(g["product_id"])
            if not p:
                continue
            onhand_value += (p.standard_price or 0.0) * (g["qty"] or 0.0)

        # Open transfers in window (scheduled date), informational only
        open_pickings = self._open_pickings(company, current_start, current_end)
        open_transfers = len(open_pickings)

        low_stock = self._orderpoint_breaches(company)

        dead = self._dead_stock(company, current_end, days=90)

        if compare_previous:
            prev_open = len(self._open_pickings(company, prev_start, prev_end))
            prev_low = self._orderpoint_breaches(company)
            # low stock uses current quants; delta on this is not meaningful without snapshot, so keep None
            open_transfers_delta = self._pct_change(open_transfers, prev_open)
        else:
            open_transfers_delta = None

        kpis = {
            "onhand_qty": round(onhand_qty, 2),
            "reserved_qty": round(reserved_qty, 2),
            "available_qty": round(available_qty, 2),
            "onhand_value": round(onhand_value, 2),
            "open_transfers": open_transfers,
            "open_transfers_delta_pct": open_transfers_delta,
            "low_stock_rules": low_stock,
            "dead_stock_products": dead["products"],
            "dead_stock_value": dead["value"],
        }

        products_stats = self._product_type_stats(company)

        receipts = self._picking_stage_stats(company, current_start, current_end, "incoming")
        deliveries = self._picking_stage_stats(company, current_start, current_end, "outgoing")

        if compare_previous:
            receipts_prev = self._picking_stage_stats(company, prev_start, prev_end, "incoming")
            deliveries_prev = self._picking_stage_stats(company, prev_start, prev_end, "outgoing")
            receipts["total_delta_pct"] = self._pct_change(receipts["total"], receipts_prev["total"])
            deliveries["total_delta_pct"] = self._pct_change(deliveries["total"], deliveries_prev["total"])
        else:
            receipts["total_delta_pct"] = None
            deliveries["total_delta_pct"] = None

        inbound_trend = []
        outbound_trend = []
        for p_start, p_end in trend_segments:
            inbound_trend.append(self._moves_qty_in_period(company, p_start, p_end, "incoming"))
            outbound_trend.append(self._moves_qty_in_period(company, p_start, p_end, "outgoing"))

        # On-hand value mix by category (top 8)
        cat_value = defaultdict(float)
        for g in quant_groups:
            p = prod_by_id.get(g["product_id"])
            if not p or not p.categ_id:
                continue
            cat_value[p.categ_id] += (p.standard_price or 0.0) * (g["qty"] or 0.0)
        total_cat = sum(cat_value.values()) or 1.0
        sorted_cats = sorted(cat_value.items(), key=lambda x: x[1], reverse=True)[:8]
        onhand_by_category = [
            {
                "name": c.display_name,
                "amount": round(val, 2),
                "pct": round(val / total_cat * 100, 1),
            }
            for c, val in sorted_cats
        ]

        # Top products by on-hand value (top 8)
        prod_value = []
        for g in quant_groups:
            p = prod_by_id.get(g["product_id"])
            if not p:
                continue
            val = (p.standard_price or 0.0) * (g["qty"] or 0.0)
            if val:
                prod_value.append((p, val))
        prod_value.sort(key=lambda x: x[1], reverse=True)
        top_products = [
            {
                "product_id": p.id,
                "name": p.display_name,
                "categ_name": p.categ_id.display_name if p.categ_id else "",
                "amount": round(val, 2),
            }
            for p, val in prod_value[:8]
        ]

        return {
            "meta": meta,
            "kpis": kpis,
            "products": products_stats,
            "receipts": receipts,
            "deliveries": deliveries,
            "monthly_trend": {
                "labels": trend_labels,
                "inbound_qty": inbound_trend,
                "outbound_qty": outbound_trend,
            },
            "onhand_by_category": onhand_by_category,
            "top_products": top_products,
        }


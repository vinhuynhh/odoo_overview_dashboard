-- =============================================================================
-- 100 demo purchase orders — multiple product categories (PostgreSQL, Odoo 19)
--
-- Like seed_100_purchase_orders.sql, but confirmed PO lines rotate across
-- DISTINCT product_template.categ_id (one representative purchasable variant per
-- category). Every 6th confirmed order gets a second line from another category
-- so spend_by_category / charts show richer splits.
--
-- Names: DASH-PO-CAT-0001 .. DASH-PO-CAT-0100
--
-- Cleanup:
--   DELETE FROM purchase_order_line WHERE order_id IN (
--     SELECT id FROM purchase_order WHERE name LIKE 'DASH-PO-CAT-%');
--   DELETE FROM purchase_order WHERE name LIKE 'DASH-PO-CAT-%';
--
-- Requires purchasable products (purchase_ok) with categ_id set — typical Odoo DBs.
-- purchase_order_line.state is not inserted (non-stored related field).
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_preferred_company_id integer := 1;
    v_company_id           integer;
    v_uid                  integer;
    v_partner_id           integer;
    v_currency_id          integer;
    v_product_id           integer;
    v_uom_id               integer;
    v_product_type         text;
    v_line_qty_recv_method text;
    v_line_name            text;
    v_price_unit           numeric;
    v_qty                  numeric;
    v_subtotal             numeric;
    v_order_id             integer;
    v_state                text;
    v_date                 timestamp without time zone;
    v_date_approve         timestamp without time zone;
    v_date_planned_line    timestamp without time zone;
    v_i                    integer;
    v_partner_ids          integer[];
    v_n_partners           integer;
    v_picking_type_id      integer;
    v_po_has_picktype      boolean;
    v_po_has_receipt       boolean;
    v_prod_ids             integer[];
    v_uom_ids              integer[];
    v_types                text[];
    v_categ_ids            integer[];
    v_n_cats               integer;
    v_slot                 integer;
    v_slot2                integer;
    v_two_lines            boolean;
    v_sub1                 numeric;
    v_sub2                 numeric;
    v_qty2                 numeric;
    v_price2               numeric;
    v_date_pl2             timestamp without time zone;
    v_type2                text;
    v_recv2                text;
    v_order_untaxed        numeric;
    v_date_pl_min          timestamp without time zone;
BEGIN
    SELECT COALESCE(
        (SELECT id FROM res_users WHERE login = '__system__' LIMIT 1),
        2
    ) INTO v_uid;

    SELECT id
    INTO v_company_id
    FROM res_company
    WHERE id = v_preferred_company_id
    LIMIT 1;

    IF v_company_id IS NULL THEN
        SELECT id
        INTO v_company_id
        FROM res_company
        ORDER BY id
        LIMIT 1;
    END IF;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'No row in res_company. Create a company in Odoo first.';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = ANY (current_schemas(TRUE))
          AND c.table_name = 'purchase_order'
          AND c.column_name = 'picking_type_id'
    ) INTO v_po_has_picktype;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = ANY (current_schemas(TRUE))
          AND c.table_name = 'purchase_order'
          AND c.column_name = 'receipt_status'
    ) INTO v_po_has_receipt;

    IF v_po_has_picktype THEN
        SELECT pt.id
        INTO v_picking_type_id
        FROM stock_picking_type pt
        INNER JOIN stock_warehouse wh ON wh.id = pt.warehouse_id
        WHERE pt.code = 'incoming'
          AND COALESCE(pt.active, TRUE)
          AND wh.company_id = v_company_id
        ORDER BY pt.id
        LIMIT 1;

        IF v_picking_type_id IS NULL THEN
            RAISE EXCEPTION
                'purchase_stock: no incoming stock_picking_type for company %. Create a warehouse / operation type.',
                v_company_id;
        END IF;
    END IF;

    SELECT ARRAY_AGG(id ORDER BY id)
    INTO v_partner_ids
    FROM res_partner
    WHERE COALESCE(active, TRUE)
      AND COALESCE(supplier_rank, 0) > 0
      AND (company_id IS NULL OR company_id = v_company_id);

    IF v_partner_ids IS NULL OR cardinality(v_partner_ids) = 0 THEN
        SELECT ARRAY_AGG(id ORDER BY id)
        INTO v_partner_ids
        FROM res_partner
        WHERE COALESCE(active, TRUE)
          AND COALESCE(supplier_rank, 0) > 0;
    END IF;

    IF v_partner_ids IS NULL OR cardinality(v_partner_ids) = 0 THEN
        SELECT ARRAY_AGG(pid ORDER BY pid)
        INTO v_partner_ids
        FROM (
            SELECT DISTINCT po.partner_id AS pid
            FROM purchase_order po
            WHERE po.partner_id IS NOT NULL
              AND po.company_id = v_company_id
            ORDER BY pid
            LIMIT 200
        ) x;
    END IF;

    IF v_partner_ids IS NULL OR cardinality(v_partner_ids) = 0 THEN
        SELECT ARRAY_AGG(id ORDER BY id)
        INTO v_partner_ids
        FROM res_partner
        WHERE COALESCE(active, TRUE)
          AND (company_id IS NULL OR company_id = v_company_id);
    END IF;

    IF v_partner_ids IS NULL OR cardinality(v_partner_ids) = 0 THEN
        SELECT ARRAY_AGG(id ORDER BY id)
        INTO v_partner_ids
        FROM (
            SELECT id
            FROM res_partner
            WHERE COALESCE(active, TRUE)
            ORDER BY id
            LIMIT 500
        ) sub;
    END IF;

    IF v_partner_ids IS NULL OR cardinality(v_partner_ids) = 0 THEN
        RAISE EXCEPTION
            'No vendors in res_partner. Mark suppliers (supplier_rank) or create contacts.';
    END IF;

    v_n_partners := cardinality(v_partner_ids);

    SELECT c.currency_id
    INTO v_currency_id
    FROM res_company c
    WHERE c.id = v_company_id;

    IF v_currency_id IS NULL THEN
        RAISE EXCEPTION 'Company id % has no currency_id on res_company.', v_company_id;
    END IF;

    /* One product variant per distinct category (company-scoped first). */
    SELECT
        COALESCE(ARRAY_AGG(sub.pid ORDER BY sub.cid), ARRAY[]::integer[]),
        COALESCE(ARRAY_AGG(sub.uom ORDER BY sub.cid), ARRAY[]::integer[]),
        COALESCE(ARRAY_AGG(sub.ptype ORDER BY sub.cid), ARRAY[]::text[]),
        COALESCE(ARRAY_AGG(sub.cid ORDER BY sub.cid), ARRAY[]::integer[])
    INTO v_prod_ids, v_uom_ids, v_types, v_categ_ids
    FROM (
        SELECT DISTINCT ON (pt.categ_id)
            pp.id AS pid,
            pt.uom_id AS uom,
            pt.type AS ptype,
            pt.categ_id AS cid
        FROM product_product pp
        INNER JOIN product_template pt ON pt.id = pp.product_tmpl_id
        WHERE COALESCE(pp.active, TRUE)
          AND COALESCE(pt.active, TRUE)
          AND COALESCE(pt.purchase_ok, FALSE)
          AND pt.categ_id IS NOT NULL
          AND (pt.company_id IS NULL OR pt.company_id = v_company_id)
        ORDER BY pt.categ_id, pp.id
    ) sub;

    IF v_prod_ids IS NULL OR cardinality(v_prod_ids) = 0 THEN
        SELECT
            COALESCE(ARRAY_AGG(sub.pid ORDER BY sub.cid), ARRAY[]::integer[]),
            COALESCE(ARRAY_AGG(sub.uom ORDER BY sub.cid), ARRAY[]::integer[]),
            COALESCE(ARRAY_AGG(sub.ptype ORDER BY sub.cid), ARRAY[]::text[]),
            COALESCE(ARRAY_AGG(sub.cid ORDER BY sub.cid), ARRAY[]::integer[])
        INTO v_prod_ids, v_uom_ids, v_types, v_categ_ids
        FROM (
            SELECT DISTINCT ON (pt.categ_id)
                pp.id AS pid,
                pt.uom_id AS uom,
                pt.type AS ptype,
                pt.categ_id AS cid
            FROM product_product pp
            INNER JOIN product_template pt ON pt.id = pp.product_tmpl_id
            WHERE COALESCE(pp.active, TRUE)
              AND COALESCE(pt.active, TRUE)
              AND COALESCE(pt.purchase_ok, FALSE)
              AND pt.categ_id IS NOT NULL
            ORDER BY pt.categ_id, pp.id
        ) sub;
    END IF;

    /* Last resort: single product with a category (dashboard category mix still works). */
    IF v_prod_ids IS NULL OR cardinality(v_prod_ids) = 0 THEN
        SELECT ARRAY[pp.id], ARRAY[pt.uom_id], ARRAY[pt.type], ARRAY[pt.categ_id]
        INTO v_prod_ids, v_uom_ids, v_types, v_categ_ids
        FROM product_product pp
        INNER JOIN product_template pt ON pt.id = pp.product_tmpl_id
        WHERE COALESCE(pp.active, TRUE)
          AND COALESCE(pt.active, TRUE)
          AND COALESCE(pt.purchase_ok, FALSE)
          AND pt.categ_id IS NOT NULL
        ORDER BY pp.id
        LIMIT 1;
    END IF;

    IF v_prod_ids IS NULL OR cardinality(v_prod_ids) = 0 THEN
        RAISE EXCEPTION
            'No purchasable products with product_template.categ_id. Assign categories to products or use seed_100_purchase_orders.sql.';
    END IF;

    v_n_cats := cardinality(v_prod_ids);
    RAISE NOTICE 'Multi-category seed: % distinct categories (company_id=%).', v_n_cats, v_company_id;

    FOR v_i IN 1..100 LOOP
        v_partner_id := v_partner_ids[1 + ((v_i - 1) % v_n_partners)];

        IF v_i <= 85 THEN
            v_state := 'purchase';
            v_date := date_trunc('day', clock_timestamp())
                - ((v_i * 11) || ' days')::interval
                + interval '9 hours';
            v_date_approve := v_date + interval '2 hours';
        ELSIF v_i <= 92 THEN
            v_state := 'draft';
            v_date := date_trunc('day', clock_timestamp())
                - ((v_i * 5) || ' days')::interval
                + interval '11 hours';
            v_date_approve := NULL;
        ELSIF v_i <= 96 THEN
            v_state := 'sent';
            v_date := date_trunc('day', clock_timestamp())
                - ((v_i * 6) || ' days')::interval
                + interval '12 hours';
            v_date_approve := NULL;
        ELSE
            v_state := 'to approve';
            v_date := date_trunc('day', clock_timestamp())
                - ((v_i * 4) || ' days')::interval
                + interval '13 hours';
            v_date_approve := NULL;
        END IF;

        IF v_po_has_picktype AND v_po_has_receipt THEN
            INSERT INTO purchase_order (
                name, state, date_order, date_approve, partner_id, currency_id, currency_rate,
                company_id, user_id, priority, locked, invoice_status, invoice_count,
                amount_untaxed, amount_tax, amount_total, amount_total_cc,
                fiscal_position_id, payment_term_id, picking_type_id, receipt_status,
                receipt_reminder_email, reminder_date_before_receipt, acknowledged,
                create_uid, create_date, write_uid, write_date
            ) VALUES (
                'DASH-PO-CAT-' || lpad(v_i::text, 4, '0'),
                v_state, v_date, v_date_approve, v_partner_id, v_currency_id, 1.0,
                v_company_id, v_uid, '0', FALSE,
                CASE WHEN v_state = 'purchase' THEN 'to invoice' ELSE 'no' END,
                0, 0, 0, 0, 0, NULL, NULL, v_picking_type_id,
                CASE WHEN v_state = 'purchase' THEN 'pending'::character varying ELSE NULL END,
                FALSE, 0, FALSE,
                v_uid, clock_timestamp(), v_uid, clock_timestamp()
            )
            RETURNING id INTO v_order_id;
        ELSIF v_po_has_picktype THEN
            INSERT INTO purchase_order (
                name, state, date_order, date_approve, partner_id, currency_id, currency_rate,
                company_id, user_id, priority, locked, invoice_status, invoice_count,
                amount_untaxed, amount_tax, amount_total, amount_total_cc,
                fiscal_position_id, payment_term_id, picking_type_id,
                receipt_reminder_email, reminder_date_before_receipt, acknowledged,
                create_uid, create_date, write_uid, write_date
            ) VALUES (
                'DASH-PO-CAT-' || lpad(v_i::text, 4, '0'),
                v_state, v_date, v_date_approve, v_partner_id, v_currency_id, 1.0,
                v_company_id, v_uid, '0', FALSE,
                CASE WHEN v_state = 'purchase' THEN 'to invoice' ELSE 'no' END,
                0, 0, 0, 0, 0, NULL, NULL, v_picking_type_id,
                FALSE, 0, FALSE,
                v_uid, clock_timestamp(), v_uid, clock_timestamp()
            )
            RETURNING id INTO v_order_id;
        ELSE
            INSERT INTO purchase_order (
                name, state, date_order, date_approve, partner_id, currency_id, currency_rate,
                company_id, user_id, priority, locked, invoice_status, invoice_count,
                amount_untaxed, amount_tax, amount_total, amount_total_cc,
                fiscal_position_id, payment_term_id,
                receipt_reminder_email, reminder_date_before_receipt, acknowledged,
                create_uid, create_date, write_uid, write_date
            ) VALUES (
                'DASH-PO-CAT-' || lpad(v_i::text, 4, '0'),
                v_state, v_date, v_date_approve, v_partner_id, v_currency_id, 1.0,
                v_company_id, v_uid, '0', FALSE,
                CASE WHEN v_state = 'purchase' THEN 'to invoice' ELSE 'no' END,
                0, 0, 0, 0, 0, NULL, NULL,
                FALSE, 0, FALSE,
                v_uid, clock_timestamp(), v_uid, clock_timestamp()
            )
            RETURNING id INTO v_order_id;
        END IF;

        IF v_state = 'purchase' THEN
            v_slot := 1 + ((v_i - 1) % v_n_cats);
            v_product_id := v_prod_ids[v_slot];
            v_uom_id := v_uom_ids[v_slot];
            v_product_type := v_types[v_slot];
            v_line_name := 'DASH-PO-CAT · categ_id ' || v_categ_ids[v_slot]::text || ' · #' || v_i::text;

            v_qty := 1 + (v_i % 5);
            v_price_unit := (40 + (v_i * 41) % 420)::numeric;
            v_sub1 := round(v_qty * v_price_unit, 2);
            v_date_planned_line := v_date + interval '14 days';

            IF v_product_type IN ('consu', 'service') THEN
                v_line_qty_recv_method := 'manual';
            ELSE
                v_line_qty_recv_method := NULL;
            END IF;

            v_two_lines := (v_n_cats >= 2 AND v_i % 6 = 0);
            v_order_untaxed := v_sub1;
            v_date_pl_min := v_date_planned_line;

            IF v_two_lines THEN
                v_slot2 := CASE WHEN v_slot < v_n_cats THEN v_slot + 1 ELSE 1 END;
                v_qty2 := 1 + ((v_i + 2) % 4);
                v_price2 := (55 + (v_i * 53) % 380)::numeric;
                v_sub2 := round(v_qty2 * v_price2, 2);
                v_date_pl2 := v_date + interval '10 days';
                v_type2 := v_types[v_slot2];
                IF v_type2 IN ('consu', 'service') THEN
                    v_recv2 := 'manual';
                ELSE
                    v_recv2 := NULL;
                END IF;
                v_order_untaxed := v_sub1 + v_sub2;
                v_date_pl_min := LEAST(v_date_planned_line, v_date_pl2);
            END IF;

            INSERT INTO purchase_order_line (
                order_id, sequence, display_type, is_downpayment,
                product_id, product_uom_id, product_qty, product_uom_qty,
                price_unit, discount, price_subtotal, price_tax, price_total,
                name, date_planned, company_id, partner_id,
                qty_received_method, qty_received, qty_received_manual,
                qty_invoiced, qty_to_invoice, technical_price_unit, analytic_distribution,
                create_uid, create_date, write_uid, write_date
            ) VALUES (
                v_order_id, 10, NULL, FALSE,
                v_product_id, v_uom_id, v_qty, v_qty,
                v_price_unit, 0, v_sub1, 0, v_sub1,
                v_line_name, v_date_planned_line, v_company_id, v_partner_id,
                v_line_qty_recv_method, 0, 0, 0, v_qty, 0, NULL,
                v_uid, clock_timestamp(), v_uid, clock_timestamp()
            );

            IF v_two_lines THEN
                INSERT INTO purchase_order_line (
                    order_id, sequence, display_type, is_downpayment,
                    product_id, product_uom_id, product_qty, product_uom_qty,
                    price_unit, discount, price_subtotal, price_tax, price_total,
                    name, date_planned, company_id, partner_id,
                    qty_received_method, qty_received, qty_received_manual,
                    qty_invoiced, qty_to_invoice, technical_price_unit, analytic_distribution,
                    create_uid, create_date, write_uid, write_date
                ) VALUES (
                    v_order_id, 20, NULL, FALSE,
                    v_prod_ids[v_slot2], v_uom_ids[v_slot2], v_qty2, v_qty2,
                    v_price2, 0, v_sub2, 0, v_sub2,
                    'DASH-PO-CAT · categ_id ' || v_categ_ids[v_slot2]::text || ' · #' || v_i::text || ' (2)',
                    v_date_pl2, v_company_id, v_partner_id,
                    v_recv2, 0, 0, 0, v_qty2, 0, NULL,
                    v_uid, clock_timestamp(), v_uid, clock_timestamp()
                );
            END IF;

            UPDATE purchase_order
            SET
                amount_untaxed = v_order_untaxed,
                amount_tax = 0,
                amount_total = v_order_untaxed,
                amount_total_cc = v_order_untaxed,
                invoice_status = 'to invoice',
                date_planned = v_date_pl_min,
                date_calendar_start = v_date_approve,
                write_date = clock_timestamp(),
                write_uid = v_uid
            WHERE id = v_order_id;
        END IF;
    END LOOP;

    RAISE NOTICE 'Done: DASH-PO-CAT-0001 .. DASH-PO-CAT-0100 (company_id=%, vendors=%, categories=%)',
        v_company_id, v_n_partners, v_n_cats;
END $$;

COMMIT;

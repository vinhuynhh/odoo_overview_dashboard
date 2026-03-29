-- =============================================================================
-- 100 demo purchase orders for Odoo 19 Overview dashboard (PostgreSQL)
--
-- Mix: ~85 confirmed POs (state = purchase, with lines & amounts) + RFQs
--      (draft / sent / to approve) without lines — matches dashboard KPIs.
--
-- Cleanup:
--   DELETE FROM purchase_order_line WHERE order_id IN (
--     SELECT id FROM purchase_order WHERE name LIKE 'DASH-PO-TEST-%');
--   DELETE FROM purchase_order WHERE name LIKE 'DASH-PO-TEST-%';
--
-- Default v_preferred_company_id := 1; if missing, first res_company is used.
--
-- Vendors: supplier_rank > 0 for preferred company (then same fallbacks as sale seed).
-- Products: purchase_ok, purchase_method = purchase (fallback: any purchase_ok).
--
-- With purchase_stock: sets picking_type_id (incoming for first warehouse) and
-- receipt_status = pending on confirmed rows when column exists.
-- If purchase_order has no picking_type_id column (purchase_stock not installed),
-- the script uses a shorter INSERT.
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

    -- 1) Suppliers for this company
    SELECT ARRAY_AGG(id ORDER BY id)
    INTO v_partner_ids
    FROM res_partner
    WHERE COALESCE(active, TRUE)
      AND COALESCE(supplier_rank, 0) > 0
      AND (company_id IS NULL OR company_id = v_company_id);

    -- 2) Any supplier
    IF v_partner_ids IS NULL OR cardinality(v_partner_ids) = 0 THEN
        SELECT ARRAY_AGG(id ORDER BY id)
        INTO v_partner_ids
        FROM res_partner
        WHERE COALESCE(active, TRUE)
          AND COALESCE(supplier_rank, 0) > 0;
    END IF;

    -- 3) Partners already used on purchase orders
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

    -- 4) Any active partner for company
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

    /* Prefer consu/service so optional manual received qty semantics match. */
    SELECT pp.id, pt.uom_id, pt.type
    INTO v_product_id, v_uom_id, v_product_type
    FROM product_product pp
    JOIN product_template pt ON pt.id = pp.product_tmpl_id
    WHERE COALESCE(pp.active, TRUE)
      AND COALESCE(pt.active, TRUE)
      AND COALESCE(pt.purchase_ok, FALSE)
      AND pt.type IN ('consu', 'service')
      AND (pt.purchase_method IS NULL OR pt.purchase_method = 'purchase')
      AND (pt.company_id IS NULL OR pt.company_id = v_company_id)
    ORDER BY pp.id
    LIMIT 1;

    IF v_product_id IS NULL OR v_uom_id IS NULL THEN
        SELECT pp.id, pt.uom_id, pt.type
        INTO v_product_id, v_uom_id, v_product_type
        FROM product_product pp
        JOIN product_template pt ON pt.id = pp.product_tmpl_id
        WHERE COALESCE(pp.active, TRUE)
          AND COALESCE(pt.active, TRUE)
          AND COALESCE(pt.purchase_ok, FALSE)
          AND (pt.purchase_method IS NULL OR pt.purchase_method = 'purchase')
        ORDER BY pp.id
        LIMIT 1;
    END IF;

    IF v_product_id IS NULL OR v_uom_id IS NULL THEN
        SELECT pp.id, pt.uom_id, pt.type
        INTO v_product_id, v_uom_id, v_product_type
        FROM product_product pp
        JOIN product_template pt ON pt.id = pp.product_tmpl_id
        WHERE COALESCE(pp.active, TRUE)
          AND COALESCE(pt.active, TRUE)
          AND COALESCE(pt.purchase_ok, FALSE)
        ORDER BY pp.id
        LIMIT 1;
    END IF;

    IF v_product_id IS NULL OR v_uom_id IS NULL THEN
        RAISE EXCEPTION 'No purchasable product (product_template.purchase_ok).';
    END IF;

    v_line_name := 'Test line (DASH-PO-TEST seed)';

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
                name,
                state,
                date_order,
                date_approve,
                partner_id,
                currency_id,
                currency_rate,
                company_id,
                user_id,
                priority,
                locked,
                invoice_status,
                invoice_count,
                amount_untaxed,
                amount_tax,
                amount_total,
                amount_total_cc,
                fiscal_position_id,
                payment_term_id,
                picking_type_id,
                receipt_status,
                receipt_reminder_email,
                reminder_date_before_receipt,
                acknowledged,
                create_uid,
                create_date,
                write_uid,
                write_date
            ) VALUES (
                'DASH-PO-TEST-' || lpad(v_i::text, 4, '0'),
                v_state,
                v_date,
                v_date_approve,
                v_partner_id,
                v_currency_id,
                1.0,
                v_company_id,
                v_uid,
                '0',
                FALSE,
                CASE WHEN v_state = 'purchase' THEN 'to invoice' ELSE 'no' END,
                0,
                0,
                0,
                0,
                0,
                NULL,
                NULL,
                v_picking_type_id,
                CASE WHEN v_state = 'purchase' THEN 'pending'::character varying ELSE NULL END,
                FALSE,
                0,
                FALSE,
                v_uid,
                clock_timestamp(),
                v_uid,
                clock_timestamp()
            )
            RETURNING id INTO v_order_id;
        ELSIF v_po_has_picktype THEN
            INSERT INTO purchase_order (
                name,
                state,
                date_order,
                date_approve,
                partner_id,
                currency_id,
                currency_rate,
                company_id,
                user_id,
                priority,
                locked,
                invoice_status,
                invoice_count,
                amount_untaxed,
                amount_tax,
                amount_total,
                amount_total_cc,
                fiscal_position_id,
                payment_term_id,
                picking_type_id,
                receipt_reminder_email,
                reminder_date_before_receipt,
                acknowledged,
                create_uid,
                create_date,
                write_uid,
                write_date
            ) VALUES (
                'DASH-PO-TEST-' || lpad(v_i::text, 4, '0'),
                v_state,
                v_date,
                v_date_approve,
                v_partner_id,
                v_currency_id,
                1.0,
                v_company_id,
                v_uid,
                '0',
                FALSE,
                CASE WHEN v_state = 'purchase' THEN 'to invoice' ELSE 'no' END,
                0,
                0,
                0,
                0,
                0,
                NULL,
                NULL,
                v_picking_type_id,
                FALSE,
                0,
                FALSE,
                v_uid,
                clock_timestamp(),
                v_uid,
                clock_timestamp()
            )
            RETURNING id INTO v_order_id;
        ELSE
            INSERT INTO purchase_order (
                name,
                state,
                date_order,
                date_approve,
                partner_id,
                currency_id,
                currency_rate,
                company_id,
                user_id,
                priority,
                locked,
                invoice_status,
                invoice_count,
                amount_untaxed,
                amount_tax,
                amount_total,
                amount_total_cc,
                fiscal_position_id,
                payment_term_id,
                receipt_reminder_email,
                reminder_date_before_receipt,
                acknowledged,
                create_uid,
                create_date,
                write_uid,
                write_date
            ) VALUES (
                'DASH-PO-TEST-' || lpad(v_i::text, 4, '0'),
                v_state,
                v_date,
                v_date_approve,
                v_partner_id,
                v_currency_id,
                1.0,
                v_company_id,
                v_uid,
                '0',
                FALSE,
                CASE WHEN v_state = 'purchase' THEN 'to invoice' ELSE 'no' END,
                0,
                0,
                0,
                0,
                0,
                NULL,
                NULL,
                FALSE,
                0,
                FALSE,
                v_uid,
                clock_timestamp(),
                v_uid,
                clock_timestamp()
            )
            RETURNING id INTO v_order_id;
        END IF;

        IF v_state = 'purchase' THEN
            v_qty := 1 + (v_i % 5);
            v_price_unit := (40 + (v_i * 41) % 420)::numeric;
            v_subtotal := round(v_qty * v_price_unit, 2);
            v_date_planned_line := v_date + interval '14 days';

            IF v_product_type IN ('consu', 'service') THEN
                v_line_qty_recv_method := 'manual';
            ELSE
                v_line_qty_recv_method := NULL;
            END IF;

            INSERT INTO purchase_order_line (
                order_id,
                sequence,
                display_type,
                is_downpayment,
                product_id,
                product_uom_id,
                product_qty,
                product_uom_qty,
                price_unit,
                discount,
                price_subtotal,
                price_tax,
                price_total,
                name,
                date_planned,
                company_id,
                partner_id,
                qty_received_method,
                qty_received,
                qty_received_manual,
                qty_invoiced,
                qty_to_invoice,
                technical_price_unit,
                analytic_distribution,
                create_uid,
                create_date,
                write_uid,
                write_date
            ) VALUES (
                v_order_id,
                10,
                NULL,
                FALSE,
                v_product_id,
                v_uom_id,
                v_qty,
                v_qty,
                v_price_unit,
                0,
                v_subtotal,
                0,
                v_subtotal,
                v_line_name,
                v_date_planned_line,
                v_company_id,
                v_partner_id,
                v_line_qty_recv_method,
                0,
                0,
                0,
                v_qty,
                0,
                NULL,
                v_uid,
                clock_timestamp(),
                v_uid,
                clock_timestamp()
            );

            UPDATE purchase_order
            SET
                amount_untaxed = v_subtotal,
                amount_tax = 0,
                amount_total = v_subtotal,
                amount_total_cc = v_subtotal,
                invoice_status = 'to invoice',
                date_planned = v_date_planned_line,
                date_calendar_start = v_date_approve,
                write_date = clock_timestamp(),
                write_uid = v_uid
            WHERE id = v_order_id;
        END IF;
    END LOOP;

    RAISE NOTICE 'Done: DASH-PO-TEST-0001 .. DASH-PO-TEST-0100 (company_id=%, vendors=%)', v_company_id, v_n_partners;
END $$;

COMMIT;

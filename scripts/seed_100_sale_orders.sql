-- =============================================================================
-- 100 test sale orders for Odoo dashboard (PostgreSQL)
-- Partner pick order: customer_rank → existing SO partners → company partners → any
-- Cleanup: DELETE FROM sale_order WHERE name LIKE 'DASH-TEST-%';
-- Default v_preferred_company_id := 1; if missing, first res_company is used.
-- sale_order_line: amount_invoiced / amount_to_invoice are non-stored in Odoo 19 (no DB column).
-- With sale_stock: sets picking_policy = direct and warehouse_id (first active wh).
-- If your DB has no stock_warehouse rows, add a warehouse in Odoo or remove warehouse_id from INSERT.
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_preferred_company_id integer := 1;
    v_company_id           integer;
    v_uid          integer;
    v_partner_id   integer;
    v_inv_id       integer;
    v_ship_id      integer;
    v_currency_id  integer;
    v_pricelist_id integer;
    v_product_id   integer;
    v_uom_id       integer;
    v_line_name    text;
    v_price_unit   numeric;
    v_qty          numeric;
    v_subtotal     numeric;
    v_order_id     integer;
    v_state        text;
    v_date         timestamp without time zone;
    v_i            integer;
    v_partner_ids  integer[];
    v_n_partners   integer;
    v_pl_name_udt  text;
    v_warehouse_id integer;
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

    -- 1) Marked customers for this company (or shared / NULL company)
    SELECT ARRAY_AGG(id ORDER BY id)
    INTO v_partner_ids
    FROM res_partner
    WHERE COALESCE(active, TRUE)
      AND COALESCE(customer_rank, 0) > 0
      AND (company_id IS NULL OR company_id = v_company_id);

    -- 2) Any marked customer
    IF v_partner_ids IS NULL OR cardinality(v_partner_ids) = 0 THEN
        SELECT ARRAY_AGG(id ORDER BY id)
        INTO v_partner_ids
        FROM res_partner
        WHERE COALESCE(active, TRUE)
          AND COALESCE(customer_rank, 0) > 0;
    END IF;

    -- 3) Partners already used on sale orders (same company)
    IF v_partner_ids IS NULL OR cardinality(v_partner_ids) = 0 THEN
        SELECT ARRAY_AGG(pid ORDER BY pid)
        INTO v_partner_ids
        FROM (
            SELECT DISTINCT so.partner_id AS pid
            FROM sale_order so
            WHERE so.partner_id IS NOT NULL
              AND so.company_id = v_company_id
            ORDER BY pid
            LIMIT 200
        ) x;
    END IF;

    -- 4) Any active partner for this company or shared
    IF v_partner_ids IS NULL OR cardinality(v_partner_ids) = 0 THEN
        SELECT ARRAY_AGG(id ORDER BY id)
        INTO v_partner_ids
        FROM res_partner
        WHERE COALESCE(active, TRUE)
          AND (company_id IS NULL OR company_id = v_company_id);
    END IF;

    -- 5) Last resort: any active partner (subquery — LIMIT is not allowed inside ARRAY_AGG)
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
            'No partners in res_partner. Create a contact or set v_company_id to your company id.';
    END IF;

    v_n_partners := cardinality(v_partner_ids);

    SELECT c.currency_id
    INTO v_currency_id
    FROM res_company c
    WHERE c.id = v_company_id;

    IF v_currency_id IS NULL THEN
        RAISE EXCEPTION 'Company id % has no currency_id set on res_company.', v_company_id;
    END IF;

    SELECT pl.id
    INTO v_pricelist_id
    FROM product_pricelist pl
    WHERE COALESCE(pl.active, TRUE)
      AND (pl.company_id IS NULL OR pl.company_id = v_company_id)
    ORDER BY pl.id
    LIMIT 1;

    IF v_pricelist_id IS NULL THEN
        SELECT pl.id
        INTO v_pricelist_id
        FROM product_pricelist pl
        WHERE COALESCE(pl.active, TRUE)
        ORDER BY pl.id
        LIMIT 1;
    END IF;

    -- Inactive pricelists still work for raw SQL seeding
    IF v_pricelist_id IS NULL THEN
        SELECT pl.id
        INTO v_pricelist_id
        FROM product_pricelist pl
        ORDER BY pl.id
        LIMIT 1;
    END IF;

    -- Empty table: create a minimal pricelist (name column = jsonb or varchar)
    IF v_pricelist_id IS NULL THEN
        SELECT c.udt_name
        INTO v_pl_name_udt
        FROM information_schema.columns c
        WHERE c.table_schema = ANY (current_schemas(TRUE))
          AND c.table_name = 'product_pricelist'
          AND c.column_name = 'name';

        IF v_pl_name_udt = 'jsonb' THEN
            INSERT INTO product_pricelist (
                name,
                currency_id,
                company_id,
                active,
                sequence,
                create_uid,
                create_date,
                write_uid,
                write_date
            ) VALUES (
                jsonb_build_object('en_US', 'DASH-TEST Seed Pricelist'),
                v_currency_id,
                v_company_id,
                TRUE,
                16,
                v_uid,
                clock_timestamp(),
                v_uid,
                clock_timestamp()
            )
            RETURNING id INTO v_pricelist_id;
        ELSE
            INSERT INTO product_pricelist (
                name,
                currency_id,
                company_id,
                active,
                sequence,
                create_uid,
                create_date,
                write_uid,
                write_date
            ) VALUES (
                'DASH-TEST Seed Pricelist',
                v_currency_id,
                v_company_id,
                TRUE,
                16,
                v_uid,
                clock_timestamp(),
                v_uid,
                clock_timestamp()
            )
            RETURNING id INTO v_pricelist_id;
        END IF;
    END IF;

    IF v_pricelist_id IS NULL THEN
        RAISE EXCEPTION 'Could not resolve or create product_pricelist (table missing?).';
    END IF;

    -- sale_stock: warehouse (helps confirmed orders; NULL if none / DB without stock)
    v_warehouse_id := NULL;
    SELECT sw.id
    INTO v_warehouse_id
    FROM stock_warehouse sw
    WHERE sw.company_id = v_company_id
      AND COALESCE(sw.active, TRUE)
    ORDER BY sw.id
    LIMIT 1;

    SELECT pp.id, pt.uom_id
    INTO v_product_id, v_uom_id
    FROM product_product pp
    JOIN product_template pt ON pt.id = pp.product_tmpl_id
    WHERE COALESCE(pp.active, TRUE)
      AND COALESCE(pt.active, TRUE)
      AND COALESCE(pt.sale_ok, FALSE)
      AND (pt.company_id IS NULL OR pt.company_id = v_company_id)
    ORDER BY pp.id
    LIMIT 1;

    IF v_product_id IS NULL OR v_uom_id IS NULL THEN
        SELECT pp.id, pt.uom_id
        INTO v_product_id, v_uom_id
        FROM product_product pp
        JOIN product_template pt ON pt.id = pp.product_tmpl_id
        WHERE COALESCE(pp.active, TRUE)
          AND COALESCE(pt.active, TRUE)
          AND COALESCE(pt.sale_ok, FALSE)
        ORDER BY pp.id
        LIMIT 1;
    END IF;

    IF v_product_id IS NULL OR v_uom_id IS NULL THEN
        RAISE EXCEPTION 'No saleable product (product_product + product_template: active, sale_ok).';
    END IF;

    v_line_name := 'Test line (DASH-TEST seed)';

    FOR v_i IN 1..100 LOOP
        v_partner_id := v_partner_ids[1 + ((v_i - 1) % v_n_partners)];

        SELECT COALESCE(p.id, v_partner_id)
        INTO v_inv_id
        FROM res_partner p
        WHERE p.parent_id = v_partner_id
          AND p.type = 'invoice'
          AND COALESCE(p.active, TRUE)
        LIMIT 1;
        IF v_inv_id IS NULL THEN
            v_inv_id := v_partner_id;
        END IF;

        SELECT COALESCE(p.id, v_partner_id)
        INTO v_ship_id
        FROM res_partner p
        WHERE p.parent_id = v_partner_id
          AND p.type = 'delivery'
          AND COALESCE(p.active, TRUE)
        LIMIT 1;
        IF v_ship_id IS NULL THEN
            v_ship_id := v_partner_id;
        END IF;

        IF v_i <= 85 THEN
            v_state := 'sale';
            v_date := date_trunc('day', clock_timestamp())
                - ((v_i * 13) || ' days')::interval
                + interval '10 hours';
        ELSE
            v_state := CASE WHEN v_i % 2 = 0 THEN 'draft' ELSE 'sent' END;
            v_date := date_trunc('day', clock_timestamp())
                - ((v_i * 7) || ' days')::interval
                + interval '14 hours';
        END IF;

        INSERT INTO sale_order (
            name,
            state,
            date_order,
            partner_id,
            partner_invoice_id,
            partner_shipping_id,
            pricelist_id,
            currency_id,
            currency_rate,
            company_id,
            user_id,
            team_id,
            fiscal_position_id,
            payment_term_id,
            amount_untaxed,
            amount_tax,
            amount_total,
            invoice_status,
            require_signature,
            require_payment,
            locked,
            prepayment_percent,
            picking_policy,
            warehouse_id,
            create_uid,
            create_date,
            write_uid,
            write_date
        ) VALUES (
            'DASH-TEST-' || lpad(v_i::text, 4, '0'),
            v_state,
            v_date,
            v_partner_id,
            v_inv_id,
            v_ship_id,
            v_pricelist_id,
            v_currency_id,
            1.0,
            v_company_id,
            v_uid,
            NULL,
            NULL,
            NULL,
            0,
            0,
            0,
            'no',
            FALSE,
            FALSE,
            FALSE,
            0,
            'direct',
            v_warehouse_id,
            v_uid,
            clock_timestamp(),
            v_uid,
            clock_timestamp()
        )
        RETURNING id INTO v_order_id;

        IF v_state = 'sale' THEN
            v_qty := 1 + (v_i % 5);
            v_price_unit := (50 + (v_i * 37) % 450)::numeric;
            v_subtotal := round(v_qty * v_price_unit, 2);

            INSERT INTO sale_order_line (
                order_id,
                sequence,
                display_type,
                is_downpayment,
                product_id,
                product_uom_id,
                product_uom_qty,
                price_unit,
                discount,
                price_subtotal,
                price_tax,
                price_total,
                price_reduce_taxexcl,
                price_reduce_taxinc,
                customer_lead,
                qty_delivered_method,
                qty_delivered,
                qty_invoiced,
                qty_to_invoice,
                invoice_status,
                untaxed_amount_invoiced,
                untaxed_amount_to_invoice,
                name,
                state,
                company_id,
                currency_id,
                order_partner_id,
                salesman_id,
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
                v_price_unit,
                0,
                v_subtotal,
                0,
                v_subtotal,
                v_price_unit,
                v_price_unit,
                0,
                'manual',
                0,
                0,
                v_qty,
                'to invoice',
                0,
                v_subtotal,
                v_line_name,
                'sale',
                v_company_id,
                v_currency_id,
                v_partner_id,
                v_uid,
                NULL,
                v_uid,
                clock_timestamp(),
                v_uid,
                clock_timestamp()
            );

            UPDATE sale_order
            SET
                amount_untaxed = v_subtotal,
                amount_tax = 0,
                amount_total = v_subtotal,
                invoice_status = 'to invoice',
                write_date = clock_timestamp(),
                write_uid = v_uid
            WHERE id = v_order_id;
        END IF;
    END LOOP;

    RAISE NOTICE 'Done: DASH-TEST-0001 .. DASH-TEST-0100 (company_id=%, partners=%)', v_company_id, v_n_partners;
END $$;

COMMIT;

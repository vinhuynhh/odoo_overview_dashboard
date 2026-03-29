# -*- coding: utf-8 -*-
"""Shared date ranges and trend bucketing for Sales / Purchase overview dashboards."""
from datetime import datetime, timedelta

from dateutil.relativedelta import relativedelta

CUSTOM_RANGE_MAX_DAYS = 366


def _custom_trend_segments(d0, d_end_excl, max_bars=12):
    """Split [d0, d_end_excl) into up to max_bars half-open segments."""
    total_days = (d_end_excl - d0).days
    if total_days <= 0:
        return [(d0, d_end_excl)], [d0.strftime("%d %b")]
    n = min(max_bars, total_days)
    segments = []
    labels = []
    for i in range(n):
        a = (i * total_days) // n
        b = ((i + 1) * total_days) // n
        if b <= a:
            b = a + 1
        seg_start = d0 + timedelta(days=a)
        seg_end = d0 + timedelta(days=b)
        if i == n - 1:
            seg_end = d_end_excl
        segments.append((seg_start, seg_end))
        labels.append(seg_start.strftime("%d %b"))
    return segments, labels


def resolve_custom_overview_period(date_from_str, date_to_str):
    """User-selected inclusive date range. No prior-period comparison."""
    if not date_from_str or not date_to_str:
        raise ValueError("Start and end date are required.")
    ds = (date_from_str or "").strip()[:10]
    de = (date_to_str or "").strip()[:10]
    try:
        d0 = datetime.strptime(ds, "%Y-%m-%d").date()
        d1_inclusive = datetime.strptime(de, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError("Invalid date format. Use YYYY-MM-DD.") from exc
    if d0 > d1_inclusive:
        d0, d1_inclusive = d1_inclusive, d0
    span_inclusive = (d1_inclusive - d0).days + 1
    if span_inclusive > CUSTOM_RANGE_MAX_DAYS:
        raise ValueError(
            "Date range cannot exceed %s days." % CUSTOM_RANGE_MAX_DAYS
        )
    if span_inclusive < 1:
        raise ValueError("Invalid date range.")
    current_start = d0
    current_end = d1_inclusive + timedelta(days=1)
    period_label = "%s – %s" % (
        d0.strftime("%d %b %Y"),
        d1_inclusive.strftime("%d %b %Y"),
    )
    trend_segments, trend_labels = _custom_trend_segments(current_start, current_end)
    return {
        "period": "custom",
        "current_start": current_start,
        "current_end": current_end,
        "prev_start": current_start,
        "prev_end": current_start,
        "period_label": period_label,
        "trend_segments": trend_segments,
        "trend_labels": trend_labels,
        "compare_previous": False,
    }


def _fmt_quarter_short(p_start):
    return f"Q{(p_start.month - 1) // 3 + 1} '{p_start.strftime('%y')}"


def resolve_overview_period(period, today):
    """Build current/previous windows and trend chart segments.

    :returns: dict with keys:
        period, current_start, current_end, prev_start, prev_end, period_label,
        trend_segments (list of (date, date) half-open [start, end)),
        trend_labels (parallel list of short strings)
    """
    period = (period or "month").strip().lower()

    def trail_month():
        current_start = today.replace(day=1)
        current_end = current_start + relativedelta(months=1)
        prev_start = current_start - relativedelta(months=1)
        prev_end = current_start
        period_label = today.strftime("%B %Y")
        trend_steps = 6
        trend_delta = relativedelta(months=1)
        return current_start, current_end, prev_start, prev_end, period_label, trend_steps, trend_delta, "month", "backward"

    if period == "year":
        current_start = today.replace(month=1, day=1)
        current_end = current_start + relativedelta(years=1)
        prev_start = current_start - relativedelta(years=1)
        prev_end = current_start
        period_label = today.strftime("%Y")
        trend_steps = 5
        trend_delta = relativedelta(years=1)
        trend_style = "year"
        trend_mode = "backward"
    elif period == "quarter":
        q_month = ((today.month - 1) // 3) * 3 + 1
        current_start = today.replace(month=q_month, day=1)
        current_end = current_start + relativedelta(months=3)
        prev_start = current_start - relativedelta(months=3)
        prev_end = current_start
        period_label = f"Q{(today.month - 1) // 3 + 1} {today.year}"
        trend_steps = 4
        trend_delta = relativedelta(months=3)
        trend_style = "quarter"
        trend_mode = "backward"
    elif period == "week":
        weekday = today.weekday()  # Mon = 0
        current_start = today - timedelta(days=weekday)
        current_end = current_start + timedelta(days=7)
        prev_start = current_start - timedelta(days=7)
        prev_end = current_start
        day_end = current_end - timedelta(days=1)
        period_label = f"{current_start.strftime('%d %b')} – {day_end.strftime('%d %b %Y')}"
        trend_steps = 8
        trend_delta = relativedelta(weeks=1)
        trend_style = "week"
        trend_mode = "backward"
    elif period == "last_month":
        first_this = today.replace(day=1)
        current_end = first_this
        current_start = first_this - relativedelta(months=1)
        prev_end = current_start
        prev_start = current_start - relativedelta(months=1)
        period_label = current_start.strftime("%B %Y")
        trend_steps = 6
        trend_delta = relativedelta(months=1)
        trend_style = "month"
        trend_mode = "backward"
    elif period == "last_quarter":
        first_this_q = today.replace(month=(((today.month - 1) // 3) * 3 + 1), day=1)
        current_end = first_this_q
        current_start = first_this_q - relativedelta(months=3)
        prev_end = current_start
        prev_start = current_start - relativedelta(months=3)
        period_label = f"Q{(current_start.month - 1) // 3 + 1} {current_start.year}"
        trend_steps = 4
        trend_delta = relativedelta(months=3)
        trend_style = "quarter"
        trend_mode = "backward"
    elif period == "last_year":
        current_start = today.replace(year=today.year - 1, month=1, day=1)
        current_end = today.replace(month=1, day=1)
        prev_start = current_start.replace(year=current_start.year - 1)
        prev_end = current_start
        period_label = str(current_start.year)
        trend_steps = 5
        trend_delta = relativedelta(years=1)
        trend_style = "year"
        trend_mode = "backward"
    elif period == "last_7_days":
        current_end = today + timedelta(days=1)
        current_start = today - timedelta(days=6)
        prev_end = current_start
        prev_start = prev_end - timedelta(days=7)
        period_label = f"{current_start.strftime('%d %b')} – {today.strftime('%d %b %Y')}"
        trend_steps = 7
        trend_delta = relativedelta(days=1)
        trend_style = "day"
        trend_mode = "forward"
    elif period == "last_30_days":
        current_end = today + timedelta(days=1)
        current_start = today - timedelta(days=29)
        prev_end = current_start
        prev_start = prev_end - timedelta(days=30)
        period_label = f"{current_start.strftime('%d %b')} – {today.strftime('%d %b %Y')}"
        trend_steps = 6
        trend_delta = relativedelta(days=5)
        trend_style = "day"
        trend_mode = "forward_weekish"
    else:
        period = "month"
        (
            current_start,
            current_end,
            prev_start,
            prev_end,
            period_label,
            trend_steps,
            trend_delta,
            trend_style,
            trend_mode,
        ) = trail_month()

    trend_segments = []
    trend_labels = []

    if trend_mode == "backward":
        for i in range(trend_steps - 1, -1, -1):
            p_start = current_start - (trend_delta * i)
            p_end = p_start + trend_delta
            trend_segments.append((p_start, p_end))
            if trend_style == "year":
                trend_labels.append(p_start.strftime("%Y"))
            elif trend_style == "quarter":
                trend_labels.append(_fmt_quarter_short(p_start))
            elif trend_style == "week":
                trend_labels.append(p_start.strftime("%d %b"))
            else:
                trend_labels.append(p_start.strftime("%b"))
    elif trend_mode == "forward":
        for i in range(trend_steps):
            p_start = current_start + (trend_delta * i)
            p_end = p_start + trend_delta
            if p_end > current_end:
                p_end = current_end
            trend_segments.append((p_start, p_end))
            trend_labels.append(p_start.strftime("%d %b"))
    else:  # forward_weekish — fixed 5-day buckets inside [current_start, current_end)
        for i in range(trend_steps):
            p_start = current_start + timedelta(days=5 * i)
            p_end = p_start + timedelta(days=5)
            if p_end > current_end:
                p_end = current_end
            trend_segments.append((p_start, p_end))
            trend_labels.append(p_start.strftime("%d %b"))

    return {
        "period": period,
        "current_start": current_start,
        "current_end": current_end,
        "prev_start": prev_start,
        "prev_end": prev_end,
        "period_label": period_label,
        "trend_segments": trend_segments,
        "trend_labels": trend_labels,
        "compare_previous": True,
    }

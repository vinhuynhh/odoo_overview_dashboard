/** @odoo-module **/

export function deltaPillClass(pct) {
    if (pct === null || pct === undefined) {
        return "o_so_pill o_so_pill_neutral";
    }
    const n = pct;
    if (n > 0) {
        return "o_so_pill o_so_pill_up";
    }
    if (n < 0) {
        return "o_so_pill o_so_pill_down";
    }
    return "o_so_pill o_so_pill_neutral";
}

export function formatDeltaPct(pct) {
    if (pct === null || pct === undefined) {
        return "";
    }
    const n = pct;
    if (n > 0) {
        return `+${n}%`;
    }
    if (n < 0) {
        return `${n}%`;
    }
    return "0%";
}

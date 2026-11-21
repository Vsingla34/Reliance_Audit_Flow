/**
 * categoryPolicy.ts — which stock categories appear in a report.
 *
 * Rule: a category only gets columns when it has quantity. If Primary Damage,
 * Sampling and BBD are all 0, reports show Non-Saleable alone (the
 * single-category template layout). Nothing is merged or relabelled — the
 * report always reflects exactly what was recorded.
 */
export type CategoryKey = 'damage' | 'sampling' | 'nonSaleable' | 'bbd';
export const CATEGORY_ORDER: CategoryKey[] = ['damage', 'sampling', 'nonSaleable', 'bbd'];

interface QtyFields {
    qtyDamaged?: number | null;
    qtyNonSaleable?: number | null;
    qtyBBD?: number | null;
    qtySampling?: number | null;
}

export function categoryQtyOf(i: QtyFields, key: CategoryKey): number {
    switch (key) {
        case 'damage': return Number(i.qtyDamaged) || 0;
        case 'sampling': return Number(i.qtySampling) || 0;
        case 'nonSaleable': return Number(i.qtyNonSaleable) || 0;
        case 'bbd': return Number(i.qtyBBD) || 0;
    }
}

/** Categories with quantity > 0 across the items, in report order.
 *  With no quantity at all, falls back to Non-Saleable alone. */
export function activeCategoryKeys(items: QtyFields[]): CategoryKey[] {
    const keys = CATEGORY_ORDER.filter(k => items.some(i => categoryQtyOf(i, k) > 0));
    return keys.length ? keys : ['nonSaleable'];
}
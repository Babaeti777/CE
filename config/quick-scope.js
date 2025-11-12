export const QUICK_SCOPE_CONFIG = [
    {
        id: 'foundation',
        scopeLabel: 'Foundation System',
        category: 'foundation',
        fallbackMaterial: 'slab',
        quantity: ({ sqft }) => sqft,
        hint: 'Uses footprint square footage to price concrete work.',
    },
    {
        id: 'framing',
        scopeLabel: 'Structural Framing',
        category: 'framing',
        fallbackMaterial: 'wood',
        quantity: ({ sqft, floors }) => sqft * floors,
        hint: 'Multiplies footprint by the floor count for framing volume.',
    },
    {
        id: 'exterior',
        scopeLabel: 'Building Envelope',
        category: 'exterior',
        fallbackMaterial: 'vinyl',
        quantity: ({ sqft, floors }) => sqft * floors * 0.8,
        hint: 'Approx. 80% of exterior wall area for skin systems.',
    },
];

export const QUICK_SCOPE_ORDER = QUICK_SCOPE_CONFIG.map(cfg => cfg.id);
export const QUICK_SCOPE_CATEGORIES = [...new Set(QUICK_SCOPE_CONFIG.map(cfg => cfg.category))];

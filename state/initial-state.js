export const EMPTY_COMPANY_INFO = Object.freeze({
    name: '',
    address: '',
    phone: '',
    email: '',
});

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
export const QUICK_SCOPE_CATEGORIES = [
    ...new Set(QUICK_SCOPE_CONFIG.map(cfg => cfg.category)),
];

export const DEFAULT_MATERIAL_UNITS = {
    foundation: 'sq ft',
    framing: 'sq ft',
    exterior: 'sq ft',
    roofing: 'sq ft',
    flooring: 'sq ft',
    insulation: 'sq ft',
    interiorFinishes: 'sq ft',
    openings: 'each',
    mechanical: 'ton',
    plumbing: 'fixture',
    electrical: 'sq ft',
    sitework: 'sq ft',
    fireProtection: 'sq ft',
    specialties: 'allowance',
    demolition: 'sq ft',
};

export const PRIORITY_LINE_ITEM_CATEGORIES = ['Demolition'];

export function createInitialState() {
    return {
        currentTab: 'dashboard',
        materialPrices: {},
        lineItemCategories: {},
        laborRates: {},
        equipmentRates: {},
        regionalAdjustments: {},
        costIndices: {},
        referenceAssemblies: [],
        databaseMeta: {
            version: '0.0.0',
            lastUpdated: null,
            releaseNotes: [],
            sources: [],
            updateUrl: null,
            description: '',
            primarySource: '',
            highlights: [],
        },
        savedProjects: [],
        companyInfo: { ...EMPTY_COMPANY_INFO },
        currentEstimate: null,
        quickEstimatorItems: [],
        editingProjectId: null,
        lineItemId: 0,
        lastFocusedInput: null,
        calcMode: 'basic',
        calculator: {
            displayValue: '0',
            firstOperand: null,
            waitingForSecondOperand: false,
            operator: null,
        },
        pendingUpdate: null,
        syncProfileId: null,
        remoteSyncEnabled: false,
        remoteSyncStatus: 'disabled',
        authUser: null,
        firebaseConfig: null,
    };
}

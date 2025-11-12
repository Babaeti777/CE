import { EMPTY_COMPANY_INFO } from '../config/app-constants.js';

export const DEFAULT_DATABASE_META = {
    version: '0.0.0',
    lastUpdated: null,
    releaseNotes: [],
    sources: [],
};

export const DEFAULT_CALCULATOR_STATE = {
    displayValue: '0',
    firstOperand: null,
    waitingForSecondOperand: false,
    operator: null,
};

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
        databaseMeta: { ...DEFAULT_DATABASE_META },
        savedProjects: [],
        companyInfo: { ...EMPTY_COMPANY_INFO },
        currentEstimate: null,
        quickEstimatorItems: [],
        editingProjectId: null,
        lineItemId: 0,
        lastFocusedInput: null,
        calcMode: 'basic',
        calculator: { ...DEFAULT_CALCULATOR_STATE },
        pendingUpdate: null,
        syncProfileId: null,
        remoteSyncEnabled: false,
        remoteSyncStatus: 'disabled',
        authUser: null,
        firebaseConfig: null,
    };
}

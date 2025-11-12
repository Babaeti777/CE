import { EMPTY_COMPANY_INFO } from '../config/app-constants.js';

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

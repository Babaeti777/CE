import { TakeoffManager } from './takeoff.js';

(function() {
        'use strict';

        const DATABASE_CACHE_KEY = 'ce:materials:cache:v2';
        const SETTINGS_STORAGE_KEY = 'ce:settings';
        const SYNC_STATUS_RESET_DELAY = 2500;
        const FREQUENCY_INTERVALS = {
            daily: 24 * 60 * 60 * 1000,
            weekly: 7 * 24 * 60 * 60 * 1000,
            monthly: 30 * 24 * 60 * 60 * 1000
        };

        // --- STATE MANAGEMENT ---
        const state = {
            currentTab: 'dashboard',
            materialPrices: {},
            lineItemCategories: {},
            laborRates: {},
            equipmentRates: {},
            regionalAdjustments: {},
            costIndices: {},
            referenceAssemblies: [],
            databaseMeta: {},
            savedProjects: [],
            companyInfo: { name: '', address: '', phone: '', email: '' },
            currentEstimate: null,
            editingProjectId: null,
            lineItemId: 0,
            lastFocusedInput: null,
            calcMode: "basic",
            calculator: {
                displayValue: '0',
                firstOperand: null,
                waitingForSecondOperand: false,
                operator: null
            },
            lineItemCategories: {},
            laborRates: {},
            equipmentRates: {},
            regionalAdjustments: {},
            databaseMeta: { version: '0.0.0', lastUpdated: null, releaseNotes: [], sources: [] },
            pendingUpdate: null,
        };

        let takeoffManager = null;
        let autoSyncTimeoutId = null;
        let autoSyncInFlight = false;

        async function loadDatabase() {
            try {
                const cached = loadCachedDatabase();
                if (cached) {
                    applyDatabase(cached, { persist: false });
                }

                const res = await fetch('database.json', { cache: 'no-store' });
                if (!res.ok) throw new Error(`Failed to load database: ${res.status}`);
                const data = await res.json();
                applyDatabase(data);
            } catch (err) {
                console.error('Error loading database:', err);
                showToast('Unable to load material database. Offline data will be used if available.', 'error');
            }
        }

        function loadCachedDatabase() {
            try {
                const cached = localStorage.getItem('materialDatabase');
                return cached ? JSON.parse(cached) : null;
            } catch (error) {
                console.warn('Unable to parse cached database payload.', error);
                return null;
            }
        }

        function applyDatabase(data, options = {}) {
            if (!data) return;
            const { persist = true, announce = false } = options;

            const normalizedMaterials = {};
            const materialSource = data.sources?.[0]?.name || '';
            Object.entries(data.materialPrices || {}).forEach(([category, materials]) => {
                normalizedMaterials[category] = {};
                Object.entries(materials || {}).forEach(([key, entry]) => {
                    normalizedMaterials[category][key] = normalizeMaterialEntry(category, key, entry, data.lastUpdated, materialSource);
                });
            });

            state.materialPrices = normalizedMaterials;
            state.lineItemCategories = data.lineItemCategories || {};
            state.laborRates = data.laborRates || {};
            state.equipmentRates = data.equipmentRates || {};
            state.regionalAdjustments = data.regionalAdjustments || {};
            state.databaseMeta = {
                version: data.version || '0.0.0',
                lastUpdated: data.lastUpdated || null,
                releaseNotes: data.releaseNotes || [],
                sources: data.sources || [],
            };

            if (persist) {
                const payload = {
                    ...data,
                    materialPrices: normalizedMaterials,
                };
                localStorage.setItem('materialDatabase', JSON.stringify(payload));
            }

            updateQuickEstimatorCards();
            populateMaterialsTable();
            updateDatabaseBadge();

            if (announce) {
                showToast(`Material database updated to v${state.databaseMeta.version}`, 'success');
            }
        }

        const DEFAULT_MATERIAL_UNITS = {
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

        const PRIORITY_LINE_ITEM_CATEGORIES = ['Demolition'];

        function normalizeMaterialEntry(category, key, entry, fallbackUpdated, fallbackSource) {
            const normalized = {};
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                normalized.label = entry.label || entry.name || toTitleCase(key);
                normalized.cost = typeof entry.cost === 'number' ? entry.cost : parseFloat(entry.cost) || 0;
                normalized.unit = entry.unit || DEFAULT_MATERIAL_UNITS[category] || 'unit';
                normalized.source = entry.source || fallbackSource || '';
                normalized.lastUpdated = entry.lastUpdated || fallbackUpdated || null;
                normalized.notes = entry.notes || '';
                if (entry.sku) normalized.sku = entry.sku;
            } else {
                normalized.label = toTitleCase(key);
                normalized.cost = typeof entry === 'number' ? entry : parseFloat(entry) || 0;
                normalized.unit = DEFAULT_MATERIAL_UNITS[category] || 'unit';
                normalized.source = fallbackSource || '';
                normalized.lastUpdated = fallbackUpdated || null;
                normalized.notes = '';
            }
            return normalized;
        }

        function getMaterialData(category, key) {
            return state.materialPrices?.[category]?.[key] || normalizeMaterialEntry(category, key, 0, state.databaseMeta.lastUpdated, state.databaseMeta.sources?.[0]?.name);
        }

        function updateQuickEstimatorCards() {
            const foundationCards = document.querySelectorAll('[data-foundation]');
            foundationCards.forEach(card => {
                const key = card.dataset.foundation;
                const material = getMaterialData('foundation', key);
                const priceEl = card.querySelector('.material-price');
                if (priceEl) priceEl.textContent = `${formatCurrency(material.cost)}/${material.unit}`;
            });

            const framingCards = document.querySelectorAll('[data-framing]');
            framingCards.forEach(card => {
                const key = card.dataset.framing;
                const material = getMaterialData('framing', key);
                const priceEl = card.querySelector('.material-price');
                if (priceEl) priceEl.textContent = `${formatCurrency(material.cost)}/${material.unit}`;
            });

            const exteriorCards = document.querySelectorAll('[data-exterior]');
            exteriorCards.forEach(card => {
                const key = card.dataset.exterior;
                const material = getMaterialData('exterior', key);
                const priceEl = card.querySelector('.material-price');
                if (priceEl) priceEl.textContent = `${formatCurrency(material.cost)}/${material.unit}`;
            });
        }

        function toTitleCase(value = '') {
            return value
                .replace(/[_-]/g, ' ')
                .replace(/([a-z])([A-Z])/g, '$1 $2')
                .split(' ')
                .filter(Boolean)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }

        function updateDatabaseBadge(message) {
            const badge = document.getElementById('syncStatus');
            if (!badge) return;
            const textEl = badge.querySelector('span');
            if (!textEl) return;

            if (message) {
                textEl.textContent = message;
                return;
            }

            const versionInfo = state.databaseMeta.version ? `v${state.databaseMeta.version}` : 'synced';
            const updatedOn = state.databaseMeta.lastUpdated ? ` • Updated ${formatDateForDisplay(state.databaseMeta.lastUpdated)}` : '';
            textEl.textContent = `Database ${versionInfo}${updatedOn}`;
        }

        function setSyncState(status, message) {
            const badge = document.getElementById('syncStatus');
            if (!badge) return;

            badge.classList.remove('syncing', 'success', 'warning', 'error');
            if (status) badge.classList.add(status);
            updateDatabaseBadge(message);
        }

        function formatDateForDisplay(dateString) {
            if (!dateString) return '';
            try {
                const date = new Date(dateString);
                if (Number.isNaN(date.getTime())) return dateString;
                return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            } catch (error) {
                return dateString;
            }
        }

        function compareVersions(a, b) {
            const toSegments = (value) => String(value ?? '0').split('.').map(segment => parseInt(segment, 10) || 0);
            const aSeg = toSegments(a);
            const bSeg = toSegments(b);
            const length = Math.max(aSeg.length, bSeg.length);
            for (let i = 0; i < length; i += 1) {
                const aVal = aSeg[i] ?? 0;
                const bVal = bSeg[i] ?? 0;
                if (aVal > bVal) return 1;
                if (aVal < bVal) return -1;
            }
            return 0;
        }

        function isNewerVersion(candidate, baseline) {
            return compareVersions(candidate, baseline) === 1;
        }

        function saveSettings() {
            try {
                const payload = {
                    autoUpdate: state.autoUpdate,
                    updateFrequency: state.updateFrequency,
                    lastSyncCheck: state.lastSyncCheck
                };
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
            } catch (error) {
                console.warn('Unable to persist settings', error);
            }
        }

        function getFrequencyInterval(frequency = state.updateFrequency) {
            return FREQUENCY_INTERVALS[frequency] || FREQUENCY_INTERVALS.weekly;
        }

        function clearAutoSyncTimer() {
            if (autoSyncTimeoutId) {
                clearTimeout(autoSyncTimeoutId);
                autoSyncTimeoutId = null;
            }
        }

        function scheduleAutoSync({ immediate = false } = {}) {
            clearAutoSyncTimer();

            if (state.autoUpdate === 'disabled') {
                state.nextSyncPlanned = null;
                updateLastUpdateDisplay();
                return;
            }

            const now = Date.now();
            const interval = getFrequencyInterval();
            const lastCheck = state.lastSyncCheck ? new Date(state.lastSyncCheck).getTime() : null;

            let delay = interval;
            if (immediate) {
                delay = 0;
            } else if (lastCheck) {
                const elapsed = now - lastCheck;
                delay = elapsed >= interval ? 0 : interval - elapsed;
            } else {
                delay = 0;
            }

            const nextRun = new Date(now + delay);
            state.nextSyncPlanned = nextRun.toISOString();
            updateLastUpdateDisplay();

            autoSyncTimeoutId = setTimeout(runAutoSyncCycle, delay);
        }

        async function runAutoSyncCycle() {
            if (autoSyncInFlight || state.autoUpdate === 'disabled') return;
            autoSyncInFlight = true;
            try {
                await syncDatabase({ autoApply: true, silent: true });
            } finally {
                autoSyncInFlight = false;
            }
        }

        function applyDatabasePayload(payload, { fromRemote = false, source = 'local', persist = false, suppressReleaseNotes = false } = {}) {
            if (!payload) return;

            if (!fromRemote || suppressReleaseNotes) {
                state.pendingReleaseNotes = null;
            }

            const previousCategories = state.lineItemCategories || {};

            state.materialPrices = payload.materialPrices || {};
            state.lineItemCategories = payload.lineItemCategories ? { ...payload.lineItemCategories } : {};
            if (previousCategories['Takeoff Measurements'] && !state.lineItemCategories['Takeoff Measurements']) {
                state.lineItemCategories['Takeoff Measurements'] = previousCategories['Takeoff Measurements'];
            }
            state.laborRates = payload.laborRates || {};
            state.equipmentRates = payload.equipmentRates || {};
            state.regionalAdjustments = payload.regionalAdjustments || {};
            state.costIndices = payload.costIndices || {};
            state.referenceAssemblies = payload.referenceAssemblies || [];

            const metadata = payload.metadata || {};
            const previousMeta = state.databaseMeta || {};
            const lastSynced = fromRemote
                ? metadata.lastSynced || new Date().toISOString()
                : metadata.lastSynced || previousMeta.lastSynced || null;

            state.databaseMeta = {
                version: metadata.version || previousMeta.version || '0.0.0',
                lastUpdated: metadata.lastUpdated || previousMeta.lastUpdated || null,
                updateUrl: metadata.updateUrl || previousMeta.updateUrl || null,
                releaseTitle: metadata.releaseTitle || previousMeta.releaseTitle || '',
                description: metadata.description || previousMeta.description || '',
                primarySource: metadata.primarySource || previousMeta.primarySource || '',
                sources: metadata.sources || previousMeta.sources || [],
                highlights: metadata.highlights || previousMeta.highlights || [],
                lastSynced
            };

            if (fromRemote && !suppressReleaseNotes) {
                state.pendingReleaseNotes = payload.metadata || null;
            }

            if (persist && fromRemote) {
                persistDatabase(payload);
            }

            refreshMaterialDependentViews();
        }

        function refreshMaterialDependentViews() {
            updateQuickEstimatorCards();
            populateMaterialsTable();
            populateLaborTable();
            populateEquipmentTable();
            populateRegionTable();
            updateLastUpdateDisplay();
            refreshLineItemCategoryOptions();
        }

        function setSyncBadge(message, status = 'idle') {
            const badge = document.getElementById('syncStatus');
            if (!badge) return;
            badge.classList.remove('syncing', 'success', 'error');
            if (status === 'syncing') badge.classList.add('syncing');
            if (status === 'success') badge.classList.add('success');
            if (status === 'error') badge.classList.add('error');
            const span = badge.querySelector('span');
            if (span) span.textContent = message;
        }

        async function syncDatabase({ autoApply = false, silent = false, manual = false } = {}) {
            const checkTimestamp = new Date().toISOString();
            state.lastSyncCheck = checkTimestamp;
            saveSettings();
            updateLastUpdateDisplay();

            const updateUrl = state.databaseMeta?.updateUrl;
            if (!updateUrl) {
                if (manual) showToast('No update source configured.', 'warning');
                scheduleAutoSync();
                return { status: 'no-source' };
            }

            setSyncBadge('Checking for updates…', 'syncing');

            try {
                const cacheBuster = updateUrl.includes('?') ? '&' : '?';
                const remoteData = await fetchJson(`${updateUrl}${cacheBuster}t=${Date.now()}`);
                if (!remoteData?.metadata?.version) {
                    throw new Error('Remote database missing version metadata.');
                }

                const currentVersion = state.databaseMeta?.version;
                const remoteVersion = remoteData.metadata.version;
                const updateAvailable = !currentVersion || isNewerVersion(currentVersion, remoteVersion);

                if (!updateAvailable) {
                    setSyncBadge('Database synced', 'success');
                    if (manual && !silent) showToast('Database is already up to date.', 'success');
                    state.pendingUpdate = null;
                    return { status: 'up-to-date' };
                }

                if (autoApply) {
                    applyDatabasePayload(remoteData, { fromRemote: true, persist: true, suppressReleaseNotes: silent });
                    setSyncBadge(`Synced to ${remoteVersion}`, 'success');
                    if (!silent) showToast(`Database updated to version ${remoteVersion}.`, 'success');
                } else {
                    state.pendingUpdate = remoteData;
                    populateUpdateModal(remoteData.metadata);
                    openModal('updateModal');
                    setSyncBadge('Update ready', 'success');
                }

                return { status: 'update-available', applied: autoApply };
            } catch (error) {
                console.warn('Unable to sync database', error);
                setSyncBadge('Sync unavailable', 'error');
                if (manual && !silent) showToast('Unable to reach update source.', 'error');
                return { status: 'error', error };
            } finally {
                scheduleAutoSync();
                if (!autoApply && !state.pendingUpdate) {
                    setTimeout(() => setSyncBadge('Database synced', 'success'), SYNC_STATUS_RESET_DELAY);
                }
            }
        }

        function populateUpdateModal(metadata) {
            const titleEl = document.getElementById('updateModalTitle');
            const metaEl = document.getElementById('updateModalMeta');
            const descriptionEl = document.getElementById('updateModalDescription');
            const listEl = document.getElementById('updateChangeList');

            if (!metadata) {
                if (descriptionEl) descriptionEl.textContent = 'No update information available.';
                if (listEl) listEl.innerHTML = '';
                return;
            }

            if (titleEl) {
                titleEl.textContent = metadata.releaseTitle || `Database Version ${metadata.version || ''}`;
            }

            if (metaEl) {
                const details = [];
                if (metadata.version) details.push(`Version ${metadata.version}`);
                if (metadata.lastUpdated) details.push(formatDate(metadata.lastUpdated));
                if (metadata.primarySource) details.push(metadata.primarySource);
                metaEl.textContent = details.join(' • ');
            }

            if (descriptionEl) {
                descriptionEl.textContent = metadata.description || 'The latest cost data is ready to apply.';
            }

            if (listEl) {
                listEl.innerHTML = '';
                const highlights = metadata.highlights || [];
                if (highlights.length === 0) {
                    const li = document.createElement('li');
                    li.className = 'update-item';
                    li.innerHTML = `<span class="update-icon">•</span><span>No release notes were provided.</span>`;
                    listEl.appendChild(li);
                } else {
                    highlights.forEach(item => {
                        const li = document.createElement('li');
                        li.className = 'update-item';
                        li.innerHTML = `<span class="update-icon">✓</span><span>${item}</span>`;
                        listEl.appendChild(li);
                    });
                }
            }
        }

        function getMaterialEntry(category, key) {
            return state.materialPrices?.[category]?.[key] ?? null;
        }

        function getMaterialPrice(category, key) {
            const entry = getMaterialEntry(category, key);
            if (entry == null) return 0;
            if (typeof entry === 'number') return entry;
            if (typeof entry === 'object' && entry.price != null) return Number(entry.price);
            return 0;
        }

        function getMaterialUnit(category, key) {
            const entry = getMaterialEntry(category, key);
            if (typeof entry === 'object' && entry.unit) return entry.unit;
            return 'unit';
        }

        function updateQuickEstimatorCards() {
            document.querySelectorAll('.material-card').forEach(card => {
                const category = card.dataset.category;
                const key = card.dataset.material || card.dataset.foundation || card.dataset.framing || card.dataset.exterior;
                if (!category || !key) return;
                const price = getMaterialPrice(category, key);
                const unit = getMaterialUnit(category, key);
                const priceElement = card.querySelector('.material-price');
                if (priceElement) {
                    priceElement.textContent = price ? `${formatCurrency(price)}/${unit}` : 'N/A';
                }
            });
        }

        function populateMaterialsTable() {
            const tableBody = document.getElementById('materialsTable');
            if (!tableBody) return;
            tableBody.innerHTML = '';

            const entries = [];
            Object.entries(state.materialPrices).forEach(([category, materials]) => {
                Object.entries(materials || {}).forEach(([name, data]) => {
                    const price = typeof data === 'object' ? data.price : data;
                    const unit = typeof data === 'object' && data.unit ? data.unit : 'unit';
                    const trend = typeof data === 'object' && typeof data.trend === 'number' ? data.trend : 0;
                    const source = typeof data === 'object' && data.source ? data.source : '';
                    entries.push({ category, name, price, unit, trend, source });
                });
            });

            entries.sort((a, b) => {
                const categoryCompare = formatCategoryName(a.category).localeCompare(formatCategoryName(b.category));
                if (categoryCompare !== 0) return categoryCompare;
                return formatMaterialName(a.name).localeCompare(formatMaterialName(b.name));
            });

            entries.forEach(entry => {
                const row = tableBody.insertRow();
                const trendSymbol = entry.trend > 0 ? '▲' : entry.trend < 0 ? '▼' : '●';
                const trendColor = entry.trend > 0 ? 'var(--danger)' : entry.trend < 0 ? 'var(--success)' : 'var(--gray-500)';
                const trendText = entry.trend === 0 ? 'No change' : `${trendSymbol} ${Math.abs(entry.trend).toFixed(1)}%`;
                if (entry.source) row.title = `Source: ${entry.source}`;
                row.innerHTML = `
                    <td>${formatMaterialName(entry.name)}</td>
                    <td>${formatCategoryName(entry.category)}</td>
                    <td>${formatCurrency(entry.price || 0)}</td>
                    <td>${entry.unit}</td>
                    <td style="color: ${trendColor}; font-weight: 600;">${trendText}</td>
                `;
            });
        }

        function populateLaborTable() {
            const tableBody = document.getElementById('laborTable');
            if (!tableBody) return;
            tableBody.innerHTML = '';

            Object.entries(state.laborRates || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .forEach(([trade, info]) => {
                    const row = tableBody.insertRow();
                    const burden = typeof info.burden === 'number' ? `${info.burden.toFixed(1)}%` : '—';
                    row.innerHTML = `
                        <td>${trade}</td>
                        <td>${formatCurrency(info.rate || 0)}</td>
                        <td>${info.unit || 'hour'}</td>
                        <td>${burden}</td>
                        <td>${info.notes || ''}</td>
                    `;
                });
        }

        function populateEquipmentTable() {
            const tableBody = document.getElementById('equipmentTable');
            if (!tableBody) return;
            tableBody.innerHTML = '';

            Object.entries(state.equipmentRates || {})
                .sort(([a], [b]) => a.localeCompare(b))
                .forEach(([name, info]) => {
                    const row = tableBody.insertRow();
                    row.innerHTML = `
                        <td>${name}</td>
                        <td>${formatCurrency(info.rate || 0)}</td>
                        <td>${info.unit || 'day'}</td>
                        <td>${info.notes || ''}</td>
                    `;
                });
        }

        function populateRegionTable() {
            const tableBody = document.getElementById('regionTable');
            if (!tableBody) return;
            tableBody.innerHTML = '';

            const regions = Array.isArray(state.regionalAdjustments?.regions) ? state.regionalAdjustments.regions : [];
            regions.forEach(region => {
                const row = tableBody.insertRow();
                const markets = Array.isArray(region.markets) ? region.markets.join(', ') : '';
                const multiplier = typeof region.multiplier === 'number' ? region.multiplier.toFixed(2) : region.multiplier || '';
                row.innerHTML = `
                    <td>${region.name || ''}</td>
                    <td>${multiplier}</td>
                    <td>${markets}</td>
                    <td>${region.notes || ''}</td>
                `;
            });
        }

        function updateLastUpdateDisplay() {
            const lastUpdateEl = document.getElementById('lastUpdate');
            const lastSyncedEl = document.getElementById('lastSynced');
            const lastCheckEl = document.getElementById('lastCheck');
            const nextSyncEl = document.getElementById('nextSync');
            if (lastUpdateEl) lastUpdateEl.textContent = state.databaseMeta?.lastUpdated ? formatDate(state.databaseMeta.lastUpdated) : 'Unknown';
            if (lastSyncedEl) lastSyncedEl.textContent = state.databaseMeta?.lastSynced ? formatDate(state.databaseMeta.lastSynced) : 'Not synced';
            if (lastCheckEl) lastCheckEl.textContent = state.lastSyncCheck ? formatDateTime(state.lastSyncCheck) : 'No checks yet';
            if (nextSyncEl) {
                if (state.autoUpdate === 'disabled') {
                    nextSyncEl.textContent = 'Auto update off';
                } else if (state.nextSyncPlanned) {
                    nextSyncEl.textContent = formatDateTime(state.nextSyncPlanned);
                } else {
                    nextSyncEl.textContent = 'Scheduling…';
                }
            }

            const sourceList = document.getElementById('sourceList');
            if (sourceList) {
                sourceList.innerHTML = '';
                const sources = state.databaseMeta?.sources || [];
                if (sources.length === 0) {
                    const li = document.createElement('li');
                    li.textContent = 'No source information available.';
                    sourceList.appendChild(li);
                } else {
                    sources.forEach(src => {
                        const li = document.createElement('li');
                        li.textContent = src;
                        sourceList.appendChild(li);
                    });
                }
            }
        }
        function init() {
            loadSavedData();
            setupEventListeners();
            setupNavigation();
            populateMaterialsTable();
            loadProjects();
            updateDashboard();
            initCharts();
            checkForUpdatesOnLoad();

            takeoffManager = new TakeoffManager({
                showToast,
                onPushToEstimate: handleTakeoffPush
            });
            takeoffManager.init();

            const bidDateInput = document.getElementById('bidDate');
            if (bidDateInput) {
                bidDateInput.value = new Date().toISOString().split('T')[0];
            }
        }

        function loadSavedData() {
            try {
                const savedData = localStorage.getItem('constructionProjects');
                state.savedProjects = savedData ? JSON.parse(savedData) : [];
                state.savedProjects.forEach(p => { if (!p.status) p.status = 'review'; });
                const companyData = localStorage.getItem('companyInfo');
                state.companyInfo = companyData ? JSON.parse(companyData) : state.companyInfo;
                document.getElementById('companyName').value = state.companyInfo.name || '';
                document.getElementById('companyAddress').value = state.companyInfo.address || '';
                document.getElementById('companyPhone').value = state.companyInfo.phone || '';
                document.getElementById('companyEmail').value = state.companyInfo.email || '';
                const settings = loadSettingsFromStorage();
                state.autoUpdate = settings.autoUpdate || state.autoUpdate;
                state.updateFrequency = settings.updateFrequency || state.updateFrequency;
                state.lastSyncCheck = settings.lastSyncCheck || state.lastSyncCheck;
                const autoUpdateSelect = document.getElementById('autoUpdate');
                if (autoUpdateSelect) autoUpdateSelect.value = state.autoUpdate;
                const frequencySelect = document.getElementById('updateFrequency');
                if (frequencySelect) frequencySelect.value = state.updateFrequency;
                const theme = localStorage.getItem('darkMode');
                if (theme === 'on') document.body.classList.add('dark-mode');
            } catch (e) {
                console.error('Error loading saved data:', e);
                state.savedProjects = [];
            }
        }

        // --- EVENT LISTENERS ---
        function setupEventListeners() {
            document.getElementById('menuToggle')?.addEventListener('click', toggleSidebar);
            document.getElementById('estimatorForm')?.addEventListener('submit', handleEstimatorSubmit);
            document.getElementById('laborCost')?.addEventListener('input', handleLaborMultiplierChange);
            document.querySelectorAll('.material-card').forEach(card => card.addEventListener('click', handleMaterialSelection));
            document.getElementById('saveProjectBtn')?.addEventListener('click', saveProject);
            document.getElementById('addLineItemBtn')?.addEventListener('click', () => addLineItem());
            document.getElementById('generatePricingBtn')?.addEventListener('click', () => updateWorksheetTotals({ announce: true }));
            document.getElementById('resetWorksheetBtn')?.addEventListener('click', resetWorksheet);

            // Export Buttons
            document.getElementById('exportPdfBtn')?.addEventListener('click', exportAsPdf);
            document.getElementById('exportXlsxBtn')?.addEventListener('click', exportAsXlsx);
            document.getElementById('exportCsvBtn')?.addEventListener('click', exportAsCsv);

            document.getElementById('saveBidBtn')?.addEventListener('click', saveBid);
            document.getElementById('saveCompanyBtn')?.addEventListener('click', saveCompanyInfo);
            document.getElementById('checkUpdatesBtn')?.addEventListener('click', checkForUpdates);
            document.getElementById('applyUpdateBtn')?.addEventListener('click', applyUpdate);
            document.getElementById('laterBtn')?.addEventListener('click', () => closeModal('updateModal'));
            document.getElementById('newProjectBtn')?.addEventListener('click', () => openModal('newProjectModal'));
            document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
            document.getElementById('projectSearch')?.addEventListener('input', (e) => loadProjects(e.target.value));

            document.getElementById('exportProjectsBtn')?.addEventListener('click', exportProjects);
            document.getElementById('importProjectsBtn')?.addEventListener('click', () => document.getElementById('importProjectsInput').click());
            document.getElementById('importProjectsInput')?.addEventListener('change', importProjects);

            document.getElementById('startQuickBtn')?.addEventListener('click', () => { closeModal('newProjectModal'); switchTab('estimator'); });
            document.getElementById('startDetailedBtn')?.addEventListener('click', () => { closeModal('newProjectModal'); switchTab('detailed'); });
            document.getElementById('closeNewProjectModal')?.addEventListener('click', () => closeModal('newProjectModal'));
            document.getElementById('autoUpdate')?.addEventListener('change', handleAutoUpdateChange);
            document.getElementById('updateFrequency')?.addEventListener('change', handleUpdateFrequencyChange);

            // Modals
            document.getElementById('closeUpdateModal')?.addEventListener('click', () => closeModal('updateModal'));
            document.getElementById('calculatorBtn')?.addEventListener('click', () => openModal('calculatorModal'));
            document.getElementById('closeCalculatorModal')?.addEventListener('click', () => closeModal('calculatorModal'));

            ['overhead', 'profit', 'contingency'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', updateBidTotal);
            });
            
            const lineItemsContainer = document.getElementById('lineItems');
            if (lineItemsContainer) {
                lineItemsContainer.addEventListener('change', (e) => {
                    const target = e.target;
                    const row = target.closest('.line-item-row');
                    if (!row) return;

                    if (target.dataset.field === 'category') {
                        updateItemSelectionOptions(row);
                    } else if (target.dataset.field === 'description') {
                        updateLineItemFromSelection(target);
                    }
                });
                lineItemsContainer.addEventListener('input', (e) => {
                    const target = e.target;
                    const row = target.closest('.line-item-row');
                    if (!row) return;

                    if (target.dataset.field === 'quantity' || target.dataset.field === 'rate' || target.dataset.field === 'unit') {
                        updateLineItemTotal(row);
                    }
                });
                lineItemsContainer.addEventListener('click', (e) => {
                    const removeButton = e.target.closest('.remove-line-item');
                    if (removeButton) {
                        removeLineItem(removeButton.closest('.line-item-row'));
                    }
                });
                lineItemsContainer.addEventListener('focusin', (e) => {
                    if (e.target.matches('[data-field="quantity"], [data-field="rate"]')) {
                        state.lastFocusedInput = e.target;
                    }
                });
            }
            document.getElementById('lineItemSearch')?.addEventListener('input', handleLineItemSearch);

            const worksheetBody = document.getElementById('estimateWorksheetBody');
            worksheetBody?.addEventListener('input', handleWorksheetInput);

            // Calculator
            document.getElementById('calculatorGrid')?.addEventListener('click', handleCalculatorClick);
            document.getElementById('convertUnitBtn')?.addEventListener('click', handleUnitConversion);
            document.getElementById('useValueBtn')?.addEventListener('click', useCalculatorValue);
            document.getElementById('modeBasic')?.addEventListener('click', () => updateCalcMode('basic'));
            document.getElementById('modeEngineering')?.addEventListener('click', () => updateCalcMode('engineering'));
            document.addEventListener('keydown', handleGlobalKeydown);
            document.getElementById('viewAllProjectsBtn')?.addEventListener('click', () => switchTab('projects'));
            updateCalcMode(state.calcMode);
            updateLineItemEmptyState();
        }

        // --- NAVIGATION & UI ---
        function setupNavigation() {
            document.querySelectorAll('.nav-item').forEach(item => {
                item.addEventListener('click', function() {
                    const tab = this.getAttribute('data-tab');
                    if (tab) switchTab(tab);
                });
            });

            switchTab(state.currentTab || 'dashboard');
        }

        function switchTab(tabId) {
            state.currentTab = tabId;
            document.querySelectorAll('.tab-content').forEach(tab => {
                const isActive = tab.id === `${tabId}Tab`;
                tab.classList.toggle('active', isActive);
                tab.hidden = !isActive;
                tab.setAttribute('aria-hidden', String(!isActive));
            });

            document.querySelectorAll('.nav-item').forEach(item => {
                const isActive = item.getAttribute('data-tab') === tabId;
                item.classList.toggle('active', isActive);
                item.setAttribute('aria-selected', String(isActive));
            });

            const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
            const navLabel = navItem?.querySelector('.nav-label')?.textContent || navItem?.innerText || 'Dashboard';
            const pageTitleEl = document.getElementById('pageTitle');
            if (pageTitleEl) {
                pageTitleEl.textContent = navLabel.trim() || 'Dashboard';
            }

            if (window.innerWidth <= 1024) {
                document.getElementById('sidebar')?.classList.remove('open');
            }
        }

        function toggleSidebar() {
            document.getElementById('sidebar')?.classList.toggle('open');
        }

        function toggleTheme() {
            document.body.classList.toggle('dark-mode');
            localStorage.setItem('darkMode', document.body.classList.contains('dark-mode') ? 'on' : 'off');
        }

        async function handleAutoUpdateChange(event) {
            state.autoUpdate = event.target.value;
            saveSettings();
            if (state.autoUpdate === 'disabled') {
                clearAutoSyncTimer();
                state.nextSyncPlanned = null;
                updateLastUpdateDisplay();
                setSyncBadge('Auto updates off', 'idle');
                return;
            }
            await syncDatabase({ autoApply: true, manual: true, silent: false });
        }

        function handleUpdateFrequencyChange(event) {
            state.updateFrequency = event.target.value;
            saveSettings();
            scheduleAutoSync();
        }

        function showToast(message, type = 'success') {
            const container = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;

            const icon = type === 'success' ? '✓' : type === 'error' ? '!' : '?';
            
            toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${message}</span>`;
            container.appendChild(toast);

            setTimeout(() => toast.remove(), 3000);
        }
        
        function formatCurrency(amount) {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
        }

        function formatNumber(value, { decimals = 0 } = {}) {
            if (!isFinite(value)) return '0';
            return new Intl.NumberFormat('en-US', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            }).format(value);
        }

        function formatInputNumber(value) {
            if (!isFinite(value)) return '0';
            return Number(value.toFixed(4)).toString();
        }

        function formatTimestamp(value) {
            if (!value) return '';
            try {
                const date = new Date(value);
                return new Intl.DateTimeFormat('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                }).format(date);
            } catch (err) {
                console.warn('Unable to format timestamp', err);
                return '';
            }
        }
        
        function openModal(modalId) {
            document.getElementById(modalId)?.classList.add('active');
        }
        
        function closeModal(modalId) {
            document.getElementById(modalId)?.classList.remove('active');
        }

        // --- QUICK ESTIMATOR ---
        function handleMaterialSelection(e) {
            const card = e.currentTarget;
            card.parentElement.querySelectorAll('.material-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
        }

        function handleEstimatorSubmit(e) {
            e.preventDefault();
            const form = e.target;
            const sqft = parseFloat(form.querySelector('#sqft').value);
            const floors = parseFloat(form.querySelector('#floors').value);
            const laborMultiplier = parseFloat(form.querySelector('#laborCost').value);
            const sqftValue = Number.isFinite(sqft) ? sqft : 0;
            const floorValue = Number.isFinite(floors) && floors > 0 ? floors : 1;
            const laborMultiplierValue = Number.isFinite(laborMultiplier) ? laborMultiplier : 0;

            const selected = {
                foundation: document.querySelector('.material-card[data-category="foundation"].selected')?.dataset.material,
                framing: document.querySelector('.material-card[data-category="framing"].selected')?.dataset.material,
                exterior: document.querySelector('.material-card[data-category="exterior"].selected')?.dataset.material,
            };

            if (!selected.foundation || !selected.framing || !selected.exterior) {
                showToast('Please select all material types.', 'error');
                return;
            }

            const foundationData = getMaterialData('foundation', selected.foundation);
            const framingData = getMaterialData('framing', selected.framing);
            const exteriorData = getMaterialData('exterior', selected.exterior);

            const worksheet = buildWorksheetRows({
                sqft: sqftValue,
                floors: floorValue,
                foundationData,
                framingData,
                exteriorData,
            });

            const costs = worksheet.reduce((acc, row) => {
                const total = (row.quantity || 0) * (row.unitCost || 0) * (row.adjustment || 0);
                acc[row.id] = total;
                return acc;
            }, {});

            const materialTotal = Object.values(costs).reduce((sum, cost) => sum + cost, 0);
            const laborTotal = materialTotal * laborMultiplierValue;
            const total = materialTotal + laborTotal;

            state.currentEstimate = {
                id: state.editingProjectId || state.currentEstimate?.id || Date.now(),
                estimateType: 'quick',
                name: form.querySelector('#projectName').value,
                type: form.querySelector('#projectType').value,
                sqft: sqftValue,
                floors: floorValue,
                laborMultiplier: laborMultiplierValue,
                selected,
                worksheet,
                costs,
                materialTotal,
                laborTotal,
                total,
                date: state.currentEstimate?.date || new Date().toISOString(),
                lastGenerated: new Date().toISOString(),
                status: state.currentEstimate?.status || 'review'
            };

            displayEstimate(state.currentEstimate);
        }

        function displayEstimate(estimate) {
            if (!estimate) return;
            ensureWorksheet(estimate);
            renderWorksheet(estimate);
            updateWorksheetTotals();
            document.getElementById('estimateWorkspace').style.display = estimate.worksheet?.length ? 'block' : 'none';
            document.getElementById('estimateSummary').style.display = 'block';
        }

        function buildWorksheetRows({ sqft, floors, foundationData, framingData, exteriorData }) {
            const safeSqft = Number.isFinite(sqft) ? sqft : 0;
            const safeFloors = Number.isFinite(floors) && floors > 0 ? floors : 1;

            const rows = [
                {
                    id: 'foundation',
                    scope: 'Foundation',
                    materialLabel: foundationData.label,
                    basis: `${formatNumber(safeSqft, { decimals: 0 })} ${foundationData.unit}`,
                    quantity: safeSqft,
                    unitCost: foundationData.cost,
                    adjustment: 1,
                    unit: foundationData.unit,
                },
                {
                    id: 'framing',
                    scope: 'Framing',
                    materialLabel: framingData.label,
                    basis: `${formatNumber(safeSqft * safeFloors, { decimals: 0 })} ${framingData.unit}`,
                    quantity: safeSqft * safeFloors,
                    unitCost: framingData.cost,
                    adjustment: 1,
                    unit: framingData.unit,
                },
                {
                    id: 'exterior',
                    scope: 'Exterior Envelope',
                    materialLabel: exteriorData.label,
                    basis: `${formatNumber(safeSqft * safeFloors, { decimals: 0 })} ${exteriorData.unit} × 0.8 factor`,
                    quantity: safeSqft * safeFloors,
                    unitCost: exteriorData.cost,
                    adjustment: 0.8,
                    unit: exteriorData.unit,
                }
            ];

            return rows.map(row => ({
                ...row,
                baseQuantity: row.quantity,
                baseUnitCost: row.unitCost,
                baseAdjustment: row.adjustment,
                total: row.quantity * row.unitCost * row.adjustment,
            }));
        }

        function ensureWorksheet(estimate) {
            if (!estimate.worksheet || !estimate.worksheet.length) {
                const costs = estimate.costs || {};
                estimate.worksheet = Object.entries(costs).map(([id, total]) => ({
                    id,
                    scope: toTitleCase(id),
                    materialLabel: toTitleCase(id),
                    basis: '',
                    quantity: total ? 1 : 0,
                    unitCost: total || 0,
                    adjustment: total ? 1 : 0,
                    baseQuantity: total ? 1 : 0,
                    baseUnitCost: total || 0,
                    baseAdjustment: total ? 1 : 0,
                    total: total || 0,
                }));
            }

            estimate.worksheet = estimate.worksheet.map(row => ({
                baseQuantity: row.baseQuantity ?? row.quantity ?? 0,
                baseUnitCost: row.baseUnitCost ?? row.unitCost ?? 0,
                baseAdjustment: row.baseAdjustment ?? (row.adjustment === 0 ? 0 : row.adjustment ?? 1),
                total: row.total ?? ((row.quantity || 0) * (row.unitCost || 0) * (row.adjustment || 0)),
                ...row,
            }));
        }

        function renderWorksheet(estimate) {
            const tbody = document.getElementById('estimateWorksheetBody');
            if (!tbody) return;
            tbody.innerHTML = '';

            (estimate.worksheet || []).forEach(row => {
                const tr = document.createElement('tr');
                tr.dataset.rowId = row.id;
                tr.innerHTML = `
                    <td>
                        <div class="worksheet-scope">
                            <strong>${row.scope}</strong>
                            <span>${[row.materialLabel, row.basis].filter(Boolean).join(' • ')}</span>
                        </div>
                    </td>
                    <td><input type="number" min="0" step="0.01" data-row-id="${row.id}" data-field="quantity" value="${formatInputNumber(row.quantity || 0)}"></td>
                    <td><input type="number" min="0" step="0.01" data-row-id="${row.id}" data-field="unitCost" value="${formatInputNumber(row.unitCost || 0)}"></td>
                    <td><input type="number" min="0" step="0.01" data-row-id="${row.id}" data-field="adjustment" value="${formatInputNumber(row.adjustment ?? 1)}"></td>
                    <td class="text-right" data-row-total="${row.id}">${formatCurrency(row.total || 0)}</td>
                `;
                tbody.appendChild(tr);
            });

            updateWorksheetVisibility(estimate);
        }

        function updateWorksheetVisibility(estimate) {
            const wrapper = document.querySelector('#estimateWorkspace .worksheet-table-wrapper');
            const emptyMessage = document.getElementById('worksheetEmptyMessage');
            if (!wrapper || !emptyMessage) return;
            const hasRows = Boolean(estimate?.worksheet?.length);
            wrapper.classList.toggle('empty', !hasRows);
        }

        function updateWorksheetTotals({ announce = false } = {}) {
            if (!state.currentEstimate?.worksheet) return;

            let materialTotal = 0;
            state.currentEstimate.worksheet.forEach(row => {
                const quantity = Number.isFinite(row.quantity) ? row.quantity : 0;
                const unitCost = Number.isFinite(row.unitCost) ? row.unitCost : 0;
                const adjustment = Number.isFinite(row.adjustment) ? row.adjustment : 0;
                const rowTotal = quantity * unitCost * adjustment;
                row.total = rowTotal;
                const totalCell = document.querySelector(`[data-row-total="${row.id}"]`);
                if (totalCell) {
                    totalCell.textContent = formatCurrency(rowTotal);
                }
                materialTotal += rowTotal;
            });

            const laborMultiplierInput = document.getElementById('laborCost');
            const multiplierValue = parseFloat(laborMultiplierInput?.value);
            const multiplier = Number.isNaN(multiplierValue) ? (Number.isFinite(state.currentEstimate.laborMultiplier) ? state.currentEstimate.laborMultiplier : 0) : multiplierValue;
            state.currentEstimate.laborMultiplier = multiplier;
            state.currentEstimate.materialTotal = materialTotal;
            state.currentEstimate.laborTotal = materialTotal * multiplier;
            state.currentEstimate.total = state.currentEstimate.materialTotal + state.currentEstimate.laborTotal;
            state.currentEstimate.costs = state.currentEstimate.worksheet.reduce((acc, row) => {
                acc[row.id] = row.total || 0;
                return acc;
            }, {});
            state.currentEstimate.lastGenerated = new Date().toISOString();

            updateEstimateSummary(state.currentEstimate);
            if (announce) {
                showToast('Pricing refreshed from worksheet.', 'success');
            }
        }

        function updateEstimateSummary(estimate) {
            document.getElementById('materialCost').textContent = formatCurrency(estimate.materialTotal || 0);
            document.getElementById('laborCostDisplay').textContent = formatCurrency(estimate.laborTotal || 0);
            document.getElementById('totalCost').textContent = formatCurrency(estimate.total || 0);

            const multiplierDisplay = document.getElementById('laborMultiplierDisplay');
            if (multiplierDisplay) {
                const multiplier = Number.isFinite(estimate.laborMultiplier) ? estimate.laborMultiplier : 0;
                const formatted = Number(multiplier.toFixed(2));
                multiplierDisplay.textContent = `${formatted.toString()}×`;
            }

            const sqftValue = Number.isFinite(estimate.sqft) ? estimate.sqft : parseFloat(document.getElementById('sqft')?.value) || 0;
            const costPerSqFt = sqftValue ? estimate.total / sqftValue : 0;
            document.getElementById('costPerSqFt').textContent = sqftValue ? formatCurrency(costPerSqFt) : '$0';

            const metaEl = document.getElementById('estimateMeta');
            if (metaEl) {
                const generated = formatTimestamp(estimate.lastGenerated);
                const scopeCount = estimate.worksheet?.length || 0;
                const scopeLabel = `${scopeCount} scope${scopeCount === 1 ? '' : 's'} selected`;
                metaEl.textContent = `${generated ? `Last generated ${generated} • ` : ''}${scopeLabel}`;
            }
        }

        function handleWorksheetInput(e) {
            const input = e.target;
            if (!(input instanceof Element) || input.tagName !== 'INPUT') return;
            const rowId = input.dataset.rowId;
            const field = input.dataset.field;
            if (!rowId || !field || !state.currentEstimate?.worksheet) return;

            const row = state.currentEstimate.worksheet.find(r => r.id === rowId);
            if (!row) return;

            const parsed = parseFloat(input.value);
            row[field] = Number.isNaN(parsed) ? 0 : parsed;

            updateWorksheetTotals();
        }

        function handleLaborMultiplierChange(e) {
            if (!state.currentEstimate?.worksheet) return;
            const value = parseFloat(e.target.value);
            state.currentEstimate.laborMultiplier = Number.isNaN(value) ? 0 : value;
            updateWorksheetTotals();
        }

        function resetWorksheet() {
            if (!state.currentEstimate?.worksheet) return;
            state.currentEstimate.worksheet.forEach(row => {
                row.quantity = row.baseQuantity ?? 0;
                row.unitCost = row.baseUnitCost ?? 0;
                row.adjustment = row.baseAdjustment ?? 1;

                const quantityInput = document.querySelector(`input[data-field="quantity"][data-row-id="${row.id}"]`);
                const unitCostInput = document.querySelector(`input[data-field="unitCost"][data-row-id="${row.id}"]`);
                const adjustmentInput = document.querySelector(`input[data-field="adjustment"][data-row-id="${row.id}"]`);
                if (quantityInput) quantityInput.value = formatInputNumber(row.quantity);
                if (unitCostInput) unitCostInput.value = formatInputNumber(row.unitCost);
                if (adjustmentInput) adjustmentInput.value = formatInputNumber(row.adjustment);
            });

            updateWorksheetTotals();
            showToast('Worksheet reset to catalog defaults.', 'success');
        }

        function saveProject() {
            if (!state.currentEstimate) {
                showToast('No estimate to save.', 'warning');
                return;
            }
            const estimate = {
                ...state.currentEstimate,
                estimateType: 'quick',
                status: state.currentEstimate.status || 'review',
                worksheet: state.currentEstimate.worksheet?.map(row => ({ ...row })) || [],
                costs: { ...(state.currentEstimate.costs || {}) },
                date: state.currentEstimate.date || new Date().toISOString(),
                lastGenerated: state.currentEstimate.lastGenerated || new Date().toISOString(),
            };
            if (state.editingProjectId) {
                const idx = state.savedProjects.findIndex(p => p.id === state.editingProjectId);
                if (idx !== -1) {
                    state.savedProjects[idx] = estimate;
                }
                state.editingProjectId = null;
                showToast('Project updated successfully!', 'success');
            } else {
                state.savedProjects.push(estimate);
                showToast('Project saved successfully!', 'success');
            }
            localStorage.setItem('constructionProjects', JSON.stringify(state.savedProjects));
            loadProjects();
            updateDashboard();
        }

        function populateEstimatorForm(data) {
            document.getElementById('projectName').value = data.name || '';
            document.getElementById('projectType').value = data.type || '';
            document.getElementById('sqft').value = data.sqft || '';
            document.getElementById('floors').value = data.floors || '';
            document.getElementById('laborCost').value = data.laborMultiplier || '';

            document.querySelectorAll('.material-card[data-category="foundation"]').forEach(c => {
                c.classList.toggle('selected', c.dataset.material === data.selected?.foundation);
            });
            document.querySelectorAll('.material-card[data-category="framing"]').forEach(c => {
                c.classList.toggle('selected', c.dataset.material === data.selected?.framing);
            });
            document.querySelectorAll('.material-card[data-category="exterior"]').forEach(c => {
                c.classList.toggle('selected', c.dataset.material === data.selected?.exterior);
            });
        }

        function editProject(id) {
            const project = state.savedProjects.find(p => p.id === id && p.estimateType === 'quick');
            if (!project) return;
            state.editingProjectId = id;
            state.currentEstimate = {
                ...project,
                worksheet: project.worksheet ? project.worksheet.map(row => ({ ...row })) : [],
                costs: { ...(project.costs || {}) },
            };
            populateEstimatorForm(state.currentEstimate);
            displayEstimate(state.currentEstimate);
            switchTab('estimator');
        }

        function editBid(id) {
            const bid = state.savedProjects.find(p => p.id === id && p.estimateType === 'detailed');
            if (!bid) return;
            state.editingProjectId = id;
            document.getElementById('bidProjectName').value = bid.name || '';
            document.getElementById('clientName').value = bid.clientName || '';
            document.getElementById('bidDate').value = bid.bidDate || '';
            document.getElementById('completionDays').value = bid.completionDays || '';
            document.getElementById('overhead').value = bid.overheadPercent || 10;
            document.getElementById('profit').value = bid.profitPercent || 15;
            document.getElementById('contingency').value = bid.contingencyPercent || 5;
            document.getElementById('lineItems').innerHTML = '';
            bid.lineItems.forEach(item => addLineItem(item, { position: 'bottom' }));
            updateBidTotal();
            switchTab('detailed');
        }

        function saveCompanyInfo() {
            state.companyInfo = {
                name: document.getElementById('companyName').value,
                address: document.getElementById('companyAddress').value,
                phone: document.getElementById('companyPhone').value,
                email: document.getElementById('companyEmail').value,
            };
            localStorage.setItem('companyInfo', JSON.stringify(state.companyInfo));
            showToast('Company information saved!', 'success');
        }

        function getSortedLineItemCategories() {
            const categories = Object.keys(state.lineItemCategories || {});
            return categories.sort((a, b) => {
                const aIndex = PRIORITY_LINE_ITEM_CATEGORIES.indexOf(a);
                const bIndex = PRIORITY_LINE_ITEM_CATEGORIES.indexOf(b);
                if (aIndex !== -1 || bIndex !== -1) {
                    if (aIndex === -1) return 1;
                    if (bIndex === -1) return -1;
                    return aIndex - bIndex;
                }
                return a.localeCompare(b);
            });
        }

        function refreshLineItemCategoryOptions() {
            const categories = getSortedLineItemCategories();
            document.querySelectorAll('.line-item-row').forEach(row => {
                const categorySelect = row.querySelector('[data-field="category"]');
                const descriptionSelect = row.querySelector('[data-field="description"]');
                if (!categorySelect || !descriptionSelect) return;
                const previousCategory = categorySelect.value;
                const previousDescription = descriptionSelect.value;
                categorySelect.innerHTML = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
                if (categories.includes(previousCategory)) {
                    categorySelect.value = previousCategory;
                } else if (categories.length) {
                    categorySelect.value = categories[0];
                }
                updateItemSelectionOptions(row, { preserveExisting: true, previousDescription });
            });
            updateLineItemEmptyState();
        }

        // --- DETAILED BIDDING ---
        function addLineItem(item = null, { position = 'top' } = {}) {
            if (item?.category && !state.lineItemCategories[item.category]) {
                state.lineItemCategories[item.category] = [];
            }

            state.lineItemId++;
            const div = document.createElement('div');
            div.className = 'line-item-row';
            div.dataset.id = state.lineItemId;

            const categories = getSortedLineItemCategories();
            const categoryOptions = categories
                .map(cat => `<option value="${cat}">${cat}</option>`)
                .join('');

            const totalValue = item ? (item.total ?? (item.quantity || 0) * (item.rate || 0)) : 0;

            div.innerHTML = `
                <select class="form-select" data-field="category">${categoryOptions}</select>
                <select class="form-select" data-field="description"></select>
                <input type="number" class="form-input" data-field="quantity" placeholder="Qty" value="${item ? item.quantity : 1}" min="0">
                <input type="text" class="form-input" data-field="unit" placeholder="Unit" value="${item ? item.unit : ''}">
                <input type="number" class="form-input" data-field="rate" placeholder="Rate" value="${item ? item.rate : 0}" step="0.01" min="0">
                <div class="line-item-total" style="font-weight: 600; text-align: right;">${formatCurrency(totalValue)}</div>
                <button class="btn btn-ghost remove-line-item">&times;</button>
            `;

            const container = document.getElementById('lineItems');
            if (position === 'top' && container.firstChild) {
                container.prepend(div);
            } else {
                container.appendChild(div);
            }

            const categorySelect = div.querySelector('[data-field="category"]');
            if (item?.category && state.lineItemCategories[item.category]) {
                categorySelect.value = item.category;
            }

            updateItemSelectionOptions(div, { preserveExisting: !!item, previousDescription: item?.description });

            if (item) {
                const descriptionSelect = div.querySelector('[data-field="description"]');
                if (item.category && !state.lineItemCategories[item.category]?.some(entry => entry.name === item.description)) {
                    descriptionSelect.innerHTML += `<option value="${item.description}">${item.description}</option>`;
                }
                if (item.description) {
                    descriptionSelect.value = item.description;
                }
                div.querySelector('[data-field="quantity"]').value = item.quantity ?? 1;
                div.querySelector('[data-field="unit"]').value = item.unit ?? '';
                div.querySelector('[data-field="rate"]').value = item.rate ?? 0;
                updateLineItemTotal(div);
            }

            updateLineItemEmptyState();
        }
        
        function updateItemSelectionOptions(row, { preserveExisting = false, previousDescription } = {}) {
            const categorySelect = row.querySelector('[data-field="category"]');
            const descriptionSelect = row.querySelector('[data-field="description"]');
            if (!categorySelect || !descriptionSelect) return;
            const selectedCategory = categorySelect.value;

            const items = state.lineItemCategories[selectedCategory] || [];
            descriptionSelect.innerHTML = items.map(item => `<option value="${item.name}">${item.name}</option>`).join('');
            const hasPrevious = previousDescription && items.some(item => item.name === previousDescription);
            if (preserveExisting && hasPrevious) {
                descriptionSelect.value = previousDescription;
            } else if (items.length) {
                descriptionSelect.value = items[0].name;
            } else {
                descriptionSelect.value = '';
            }
            updateLineItemFromSelection(descriptionSelect, { preserveExisting });
        }

        function updateLineItemFromSelection(selectElement, { preserveExisting = false } = {}) {
            const row = selectElement.closest('.line-item-row');
            if (!row) return;
            const category = row.querySelector('[data-field="category"]').value;
            const description = selectElement.value;

            const itemData = state.lineItemCategories[category]?.find(i => i.name === description);

            if (itemData) {
                const unitField = row.querySelector('[data-field="unit"]');
                const rateField = row.querySelector('[data-field="rate"]');
                if (unitField && (!preserveExisting || !unitField.value)) {
                    unitField.value = itemData.unit || '';
                }
                if (rateField) {
                    const currentRate = parseFloat(rateField.value);
                    if (!preserveExisting || !currentRate) {
                        rateField.value = itemData.rate ?? 0;
                    }
                }
                updateLineItemTotal(row);
            }
        }

        function removeLineItem(row) {
            row.remove();
            updateBidTotal();
            updateLineItemEmptyState();
        }

        function updateLineItemTotal(row) {
            const quantity = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
            const rate = parseFloat(row.querySelector('[data-field="rate"]').value) || 0;
            const total = quantity * rate;
            row.querySelector('.line-item-total').textContent = formatCurrency(total);
            updateBidTotal();
        }

        function updateLineItemEmptyState() {
            const container = document.getElementById('lineItems');
            const wrapper = container?.closest('.line-item-table-wrapper');
            const message = document.getElementById('lineItemEmptyMessage');
            if (!container || !wrapper || !message) return;
            const hasRows = Boolean(container.querySelector('.line-item-row'));
            wrapper.classList.toggle('empty', !hasRows);
            message.textContent = 'Add your first item to start building the bid.';
            message.style.display = hasRows ? 'none' : 'block';
        }

        function handleLineItemSearch(e) {
            const term = e.target.value.trim().toLowerCase();
            const rows = document.querySelectorAll('#lineItems .line-item-row');
            let visible = 0;
            rows.forEach(row => {
                const category = row.querySelector('[data-field="category"]')?.value?.toLowerCase() || '';
                const description = row.querySelector('[data-field="description"]')?.value?.toLowerCase() || '';
                const matches = !term || category.includes(term) || description.includes(term);
                row.classList.toggle('is-hidden', !matches);
                if (matches) visible++;
            });

            const container = document.getElementById('lineItems');
            const wrapper = container?.closest('.line-item-table-wrapper');
            const message = document.getElementById('lineItemEmptyMessage');
            if (!message || !wrapper || wrapper.classList.contains('empty')) return;
            if (term && visible === 0) {
                message.textContent = 'No items match your search. Try a different term.';
                message.style.display = 'block';
            } else {
                message.textContent = 'Add your first item to start building the bid.';
                message.style.display = 'none';
            }
        }

        function updateBidTotal() {
            let subtotal = 0;
            document.querySelectorAll('.line-item-row').forEach(row => {
                const quantity = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
                const rate = parseFloat(row.querySelector('[data-field="rate"]').value) || 0;
                subtotal += quantity * rate;
            });

            const overheadPercent = parseFloat(document.getElementById('overhead').value) || 0;
            const profitPercent = parseFloat(document.getElementById('profit').value) || 0;
            const contingencyPercent = parseFloat(document.getElementById('contingency').value) || 0;
            
            const markup = subtotal * (overheadPercent / 100) + subtotal * (profitPercent / 100);
            const subtotalWithMarkup = subtotal + markup;
            const contingency = subtotalWithMarkup * (contingencyPercent / 100);
            const total = subtotalWithMarkup + contingency;

            document.getElementById('bidSubtotal').textContent = formatCurrency(subtotal);
            document.getElementById('bidMarkup').textContent = formatCurrency(markup);
            document.getElementById('bidContingency').textContent = formatCurrency(contingency);
            document.getElementById('bidTotal').textContent = formatCurrency(total);
        }
        
        function saveBid() {
            const name = document.getElementById('bidProjectName').value;
            if (!name) {
                showToast('Project name required', 'warning');
                return;
            }

            const lineItems = [];
            document.querySelectorAll('.line-item-row').forEach(row => {
                const category = row.querySelector('[data-field="category"]').value;
                const description = row.querySelector('[data-field="description"]').value;
                const quantity = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
                const unit = row.querySelector('[data-field="unit"]').value;
                const rate = parseFloat(row.querySelector('[data-field="rate"]').value) || 0;
                lineItems.push({ category, description, quantity, unit, rate, total: quantity * rate });
            });

            const overheadPercent = parseFloat(document.getElementById('overhead').value) || 0;
            const profitPercent = parseFloat(document.getElementById('profit').value) || 0;
            const contingencyPercent = parseFloat(document.getElementById('contingency').value) || 0;

            const subtotal = parseFloat(document.getElementById('bidSubtotal').textContent.replace(/[^0-9.-]+/g, '')) || 0;
            const markup = parseFloat(document.getElementById('bidMarkup').textContent.replace(/[^0-9.-]+/g, '')) || 0;
            const contingency = parseFloat(document.getElementById('bidContingency').textContent.replace(/[^0-9.-]+/g, '')) || 0;
            const total = parseFloat(document.getElementById('bidTotal').textContent.replace(/[^0-9.-]+/g, '')) || 0;

            const bid = {
                id: state.editingProjectId || Date.now(),
                estimateType: 'detailed',
                name,
                clientName: document.getElementById('clientName').value,
                bidDate: document.getElementById('bidDate').value,
                completionDays: document.getElementById('completionDays').value,
                lineItems,
                overheadPercent,
                profitPercent,
                contingencyPercent,
                subtotal,
                markup,
                contingency,
                total,
                date: new Date().toISOString(),
                status: state.editingProjectId ? state.savedProjects.find(p => p.id === state.editingProjectId)?.status : 'review'
            };
            if (state.editingProjectId) {
                const idx = state.savedProjects.findIndex(p => p.id === state.editingProjectId);
                if (idx !== -1) {
                    state.savedProjects[idx] = bid;
                }
                state.editingProjectId = null;
                showToast('Bid updated!', 'success');
            } else {
                state.savedProjects.push(bid);
                showToast('Bid saved!', 'success');
            }
            localStorage.setItem('constructionProjects', JSON.stringify(state.savedProjects));
            loadProjects();
            updateDashboard();
        }

        // --- CALCULATOR ---
        function updateCalculatorDisplay() {
            document.getElementById('calculatorDisplay').textContent = state.calculator.displayValue;
        }

        function handleCalculatorClick(e) {
            const { value } = e.target.dataset;
            if (!value) return;

            if (!isNaN(parseFloat(value)) || value === '.') {
                inputDigit(value);
            } else if (value in { '+': 1, '-': 1, '*': 1, '/': 1 }) {
                handleOperator(value);
            } else if (value === '=') {
                handleOperator(value);
            } else if (value === 'clear') {
                resetCalculator();
            } else if (value === 'backspace') {
                state.calculator.displayValue = state.calculator.displayValue.slice(0, -1) || '0';
            } else if (value === '%') {
                state.calculator.displayValue = String(parseFloat(state.calculator.displayValue) / 100);
            } else if (value === "sin") {
                state.calculator.displayValue = String(Math.sin(parseFloat(state.calculator.displayValue)));
            } else if (value === "cos") {
                state.calculator.displayValue = String(Math.cos(parseFloat(state.calculator.displayValue)));
            } else if (value === "tan") {
                state.calculator.displayValue = String(Math.tan(parseFloat(state.calculator.displayValue)));
            } else if (value === "sqrt") {
                state.calculator.displayValue = String(Math.sqrt(parseFloat(state.calculator.displayValue)));
            }
            updateCalculatorDisplay();
        }

        function handleGlobalKeydown(event) {
            const modal = document.getElementById('calculatorModal');
            if (!modal || !modal.classList.contains('active')) return;

            const key = event.key;

            if (/^[0-9]$/.test(key)) {
                inputDigit(key);
                updateCalculatorDisplay();
                event.preventDefault();
                return;
            }

            if (key === '.') {
                inputDigit('.');
                updateCalculatorDisplay();
                event.preventDefault();
                return;
            }

            if (['+', '-', '*', '/'].includes(key)) {
                handleOperator(key);
                updateCalculatorDisplay();
                event.preventDefault();
                return;
            }

            if (key === 'Enter' || key === '=') {
                handleOperator('=');
                updateCalculatorDisplay();
                event.preventDefault();
                return;
            }

            if (key === 'Backspace') {
                state.calculator.displayValue = state.calculator.displayValue.slice(0, -1) || '0';
                updateCalculatorDisplay();
                event.preventDefault();
                return;
            }

            if (key === 'Delete') {
                resetCalculator();
                updateCalculatorDisplay();
                event.preventDefault();
                return;
            }

            if (key === '%') {
                state.calculator.displayValue = String(parseFloat(state.calculator.displayValue) / 100);
                updateCalculatorDisplay();
                event.preventDefault();
                return;
            }

            if (key === 'Escape') {
                closeModal('calculatorModal');
                event.preventDefault();
            }
        }

        function inputDigit(digit) {
            const { displayValue, waitingForSecondOperand } = state.calculator;
            if (waitingForSecondOperand) {
                state.calculator.displayValue = digit;
                state.calculator.waitingForSecondOperand = false;
            } else {
                state.calculator.displayValue = displayValue === '0' ? digit : displayValue + digit;
            }
        }
        
        function handleOperator(nextOperator) {
            const { firstOperand, displayValue, operator } = state.calculator;
            const inputValue = parseFloat(displayValue);

            if (operator && state.calculator.waitingForSecondOperand) {
                state.calculator.operator = nextOperator;
                return;
            }

            if (firstOperand == null && !isNaN(inputValue)) {
                state.calculator.firstOperand = inputValue;
            } else if (operator) {
                const result = calculate(firstOperand, inputValue, operator);
                state.calculator.displayValue = `${parseFloat(result.toFixed(7))}`;
                state.calculator.firstOperand = result;
            }
            
            state.calculator.waitingForSecondOperand = true;
            state.calculator.operator = nextOperator;
        }

        function calculate(first, second, op) {
            if (op === '+') return first + second;
            if (op === '-') return first - second;
            if (op === '*') return first * second;
            if (op === '/') return first / second;
            return second;
        }

        function resetCalculator() {
            state.calculator.displayValue = '0';
            state.calculator.firstOperand = null;
            state.calculator.waitingForSecondOperand = false;
            state.calculator.operator = null;
        }
        
        function handleUnitConversion() {
            const fromUnit = document.getElementById('unitFrom').value;
            const toUnit = document.getElementById('unitTo').value;
            const value = parseFloat(state.calculator.displayValue);

            const conversions = {
                'ft-in': val => val * 12,
                'in-ft': val => val / 12,
                'sqft-sqyd': val => val / 9,
                'sqyd-sqft': val => val * 9,
            };

            const key = `${fromUnit}-${toUnit}`;
            if (!conversions[key]) {
                showToast('Invalid unit conversion', 'error');
                return;
            }

            const result = conversions[key](value);
            state.calculator.displayValue = String(parseFloat(result.toFixed(5)));
            updateCalculatorDisplay();
        }

        function useCalculatorValue() {
            if (!state.lastFocusedInput) {
                showToast('Select a quantity or rate field first.', 'warning');
                return;
            }
            state.lastFocusedInput.value = state.calculator.displayValue;
            state.lastFocusedInput.dispatchEvent(new Event('input', { bubbles: true }));
            closeModal('calculatorModal');
        }

        function updateCalcMode(mode) {
            state.calcMode = mode;

            const basicTools = document.getElementById('basicTools');
            const engineeringBtns = document.getElementById('engineeringBtns');
            const modeBasicBtn = document.getElementById('modeBasic');
            const modeEngineeringBtn = document.getElementById('modeEngineering');

            if (basicTools) basicTools.style.display = mode === 'basic' ? 'block' : 'none';
            if (engineeringBtns) engineeringBtns.style.display = mode === 'engineering' ? 'grid' : 'none';
            modeBasicBtn?.classList.toggle('active', mode === 'basic');
            modeEngineeringBtn?.classList.toggle('active', mode === 'engineering');
        }

        function handleTakeoffPush(rows) {
            if (!Array.isArray(rows) || !rows.length) {
                showToast('No takeoff data to send to the estimate.', 'warning');
                return;
            }

            ensureTakeoffCategory(rows);
            rows.forEach((row) => {
                const quantity = parseFloat(row.quantity) || 0;
                addLineItem({
                    category: 'Takeoff Measurements',
                    description: row.drawing ? `${row.label} (${row.drawing})` : row.label,
                    quantity,
                    unit: row.unit,
                    rate: 0,
                    total: 0
                });

                measurement.subItems.forEach(subItem => {
                    const subDescription = subItem.label && subItem.label.trim()
                        ? `${description} - ${subItem.label.trim()}`
                        : `${description} - Sub-item`;
                    const subNotes = subItem.notes && subItem.notes.trim() ? ` (${subItem.notes.trim()})` : '';
                    addLineItem({
                        category: 'Takeoff Measurements',
                        description: `${subDescription}${subNotes}`,
                        quantity: typeof subItem.quantity === 'number' && !Number.isNaN(subItem.quantity) ? subItem.quantity : 0,
                        unit: subItem.unit || '',
                        rate: 0,
                        total: 0
                    });
                });
            });
            updateBidTotal();
            showToast('Takeoff measurements added to the detailed estimate.', 'success');
            switchTab('detailed');
        }

        function ensureTakeoffCategory(rows) {
            if (!state.lineItemCategories['Takeoff Measurements']) {
                state.lineItemCategories['Takeoff Measurements'] = [];
            }
            const category = state.lineItemCategories['Takeoff Measurements'];
            rows.forEach((row) => {
                const existing = category.find((item) => item.name === row.label);
                if (!existing) {
                    category.push({
                        name: row.label,
                        unit: row.unit,
                        rate: 0
                    });
                } else {
                    existing.unit = row.unit;
                }
            });
        }

        function getBidDataForExport() {
            const projectName = document.getElementById('bidProjectName').value || 'N/A';
            const clientName = document.getElementById('clientName').value || 'N/A';
            const bidDate = new Date(document.getElementById('bidDate').value).toLocaleDateString();
            
            const data = [
                ['Project Name', projectName],
                ['Client Name', clientName],
                ['Bid Date', bidDate],
                [], // Spacer row
                ['Category', 'Description', 'Quantity', 'Unit', 'Rate', 'Total']
            ];

            let currentCategory = '';
            document.querySelectorAll('.line-item-row').forEach(row => {
                const category = row.querySelector('[data-field="category"]').value;
                if (category !== currentCategory) {
                    currentCategory = category;
                    // Add category as a full-width row spanning all columns
                    data.push([category, '', '', '', '', '']);
                }
                const description = row.querySelector('[data-field="description"]').value;
                const quantity = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
                const unit = row.querySelector('[data-field="unit"]').value;
                const rate = parseFloat(row.querySelector('[data-field="rate"]').value) || 0;
                const total = quantity * rate;
                data.push(['', description, quantity, unit, rate, total]);
            });
            
            data.push([]); // Spacer row
            
            const subtotal = parseFloat(document.getElementById('bidSubtotal').textContent.replace(/[^0-9.-]+/g,""));
            const markup = parseFloat(document.getElementById('bidMarkup').textContent.replace(/[^0-9.-]+/g,""));
            const contingency = parseFloat(document.getElementById('bidContingency').textContent.replace(/[^0-9.-]+/g,""));
            const total = parseFloat(document.getElementById('bidTotal').textContent.replace(/[^0-9.-]+/g,""));

            data.push(['', '', '', '', 'Subtotal', subtotal]);
            data.push(['', '', '', '', 'Markup', markup]);
            data.push(['', '', '', '', 'Contingency', contingency]);
            data.push(['', '', '', '', 'Total Bid', total]);

            return { data, projectName };
        }

        function exportAsXlsx() {
            const { data, projectName } = getBidDataForExport();
            const worksheet = XLSX.utils.aoa_to_sheet(data);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Bid');
            XLSX.writeFile(workbook, `Bid-${projectName}.xlsx`);
            showToast('Excel file generated!', 'success');
        }

        function exportAsCsv() {
            const { data, projectName } = getBidDataForExport();
            let csvContent = "data:text/csv;charset=utf-8,";
            
            data.forEach(rowArray => {
                let row = rowArray.map(item => `"${String(item).replace(/\"/g, '\"\"')}"`).join(",");
                csvContent += row + "\r\n";
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `Bid-${projectName}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('CSV file generated!', 'success');
        }

        function exportAsPdf() {
            const projectName = document.getElementById('bidProjectName').value || 'N/A';
            const clientName = document.getElementById('clientName').value || 'N/A';
            const bidDate = new Date(document.getElementById('bidDate').value).toLocaleDateString();
            const completionDays = document.getElementById('completionDays').value || 'N/A';
            const company = state.companyInfo;

            let lineItemsHtml = '';
            let currentCategory = '';
            document.querySelectorAll('.line-item-row').forEach(row => {
                const category = row.querySelector('[data-field="category"]').value;
                if (category !== currentCategory) {
                    currentCategory = category;
                    lineItemsHtml += `<tr><td colspan="5" class="category-row">${currentCategory}</td></tr>`;
                }
                const description = row.querySelector('[data-field="description"]').value;
                const quantity = row.querySelector('[data-field="quantity"]').value;
                const unit = row.querySelector('[data-field="unit"]').value;
                const rate = formatCurrency(parseFloat(row.querySelector('[data-field="rate"]').value) || 0);
                const total = row.querySelector('.line-item-total').textContent;
                lineItemsHtml += `
                    <tr>
                        <td>${description}</td>
                        <td class="text-right">${quantity}</td>
                        <td>${unit}</td>
                        <td class="text-right">${rate}</td>
                        <td class="text-right">${total}</td>
                    </tr>
                `;
            });

            const subtotal = document.getElementById('bidSubtotal').textContent;
            const markup = document.getElementById('bidMarkup').textContent;
            const contingency = document.getElementById('bidContingency').textContent;
            const total = document.getElementById('bidTotal').textContent;

            const reportHtml = `
                <html>
                <head>
                    <title>Bid Report: ${projectName}</title>
                    <style>
                        body { font-family: 'Inter', sans-serif; margin: 0; padding: 2rem; color: #333; }
                        .header { text-align: center; margin-bottom: 2rem; }
                        .header h1 { margin: 0; color: #4f46e5; }
                        .header p { margin: 0; color: #666; }
                        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 2rem; padding: 1.5rem; background: #f9f9f9; border-radius: 8px; }
                        .info-grid div { display: flex; flex-direction: column; }
                        .info-grid span { font-weight: 600; margin-bottom: 0.25rem; color: #4f46e5; }
                        table { width: 100%; border-collapse: collapse; margin-bottom: 2rem; }
                        th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #eee; }
                        th { background: #f1f5f9; font-weight: 600; }
                        .text-right { text-align: right; }
                        .category-row { background: #e0e7ff; font-weight: bold; }
                        .summary { float: right; width: 40%; }
                        .summary-item { display: flex; justify-content: space-between; padding: 0.5rem; }
                        .summary-item.total { font-weight: bold; font-size: 1.2rem; border-top: 2px solid #333; margin-top: 0.5rem; }
                        .print-note { margin-top: 4rem; text-align: center; color: #888; font-style: italic; }
                        @media print { .print-note { display: none; } }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>Construction Bid Proposal</h1>
                        <p>${company.name || 'Construction Estimator Pro'}</p>
                        <p>${company.address || ''}</p>
                        <p>${company.phone ? company.phone + ' | ' : ''}${company.email || ''}</p>
                    </div>
                    <div class="info-grid">
                        <div><span>Project Name:</span> ${projectName}</div>
                        <div><span>Client Name:</span> ${clientName}</div>
                        <div><span>Bid Date:</span> ${bidDate}</div>
                        <div><span>Est. Timeline:</span> ${completionDays} days</div>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Description</th>
                                <th class="text-right">Quantity</th>
                                <th>Unit</th>
                                <th class="text-right">Rate</th>
                                <th class="text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>${lineItemsHtml}</tbody>
                    </table>
                    <div class="summary">
                        <div class="summary-item"><span>Subtotal:</span> <span>${subtotal}</span></div>
                        <div class="summary-item"><span>Markup (Overhead & Profit):</span> <span>${markup}</span></div>
                        <div class="summary-item"><span>Contingency:</span> <span>${contingency}</span></div>
                        <div class="summary-item total"><span>Total Bid Price:</span> <span>${total}</span></div>
                    </div>
                    <div class="print-note">
                        <p>To save, use your browser's print function (Ctrl+P or Cmd+P) and select "Save as PDF".</p>
                    </div>
                </body>
                </html>
            `;

            const reportWindow = window.open('', '_blank');
            reportWindow.document.write(reportHtml);
            reportWindow.document.close();
            showToast('PDF report generated in new tab.', 'success');
        }

        // --- PROJECTS & MATERIALS ---
        function loadProjects(searchTerm = '') {
            const list = document.getElementById('projectsList');
            list.innerHTML = '';
            
            const filteredProjects = state.savedProjects.filter(p =>
                p.name.toLowerCase().includes(searchTerm.toLowerCase())
            );

            if (filteredProjects.length === 0) {
                list.innerHTML = `<p style="color: var(--gray-600);">No saved projects found.</p>`;
                return;
            }

            filteredProjects.forEach(p => {
                const div = document.createElement('div');
                div.style = "padding: 1rem; background: var(--gray-100); border-radius: 12px; margin-bottom: 1rem;";
                const typeLabel = p.estimateType === 'detailed' ? 'Detailed' : 'Quick';
                div.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h4 style="font-weight: 600;">${p.name}</h4>
                            <p style="color: var(--gray-600); font-size: 0.875rem;">${p.type || ''}${p.sqft ? ' • ' + p.sqft + ' sqft' : ''} • ${typeLabel}</p>
                        </div>
                        <div style="text-align: right;">
                            <p style="font-weight: 700; color: var(--primary);">${formatCurrency(p.total)}</p>
                            <p style="color: var(--gray-600); font-size: 0.75rem;">${new Date(p.date).toLocaleDateString()}</p>
                            <select class="form-select project-status" data-id="${p.id}" style="margin-top:0.25rem;">
                                <option value="review" ${p.status === 'review' ? 'selected' : ''}>Under Review</option>
                                <option value="won" ${p.status === 'won' ? 'selected' : ''}>Won</option>
                                <option value="lost" ${p.status === 'lost' ? 'selected' : ''}>Lost</option>
                            </select>
                            <button class="btn btn-secondary ${p.estimateType === 'quick' ? 'edit-project' : 'edit-bid'}" data-id="${p.id}" style="margin-top:0.25rem;">Edit</button>
                        </div>
                    </div>
                `;
                const statusSelect = div.querySelector('.project-status');
                statusSelect.addEventListener('change', (e) => updateProjectStatus(p.id, e.target.value));
                div.querySelector('.edit-project')?.addEventListener('click', () => editProject(p.id));
                div.querySelector('.edit-bid')?.addEventListener('click', () => editBid(p.id));
                list.appendChild(div);
            });
        }

        function updateProjectStatus(id, status) {
            const proj = state.savedProjects.find(p => p.id === id);
            if (!proj) return;
            proj.status = status;
            localStorage.setItem('constructionProjects', JSON.stringify(state.savedProjects));
            updateDashboard();
        }

        function exportProjects() {
            const data = JSON.stringify(state.savedProjects);
            const blob = new Blob([data], { type: 'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'projects.json';
            link.click();
        }

        function importProjects(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const projects = JSON.parse(reader.result);
                    if (Array.isArray(projects)) {
                        state.savedProjects = projects;
                        localStorage.setItem('constructionProjects', JSON.stringify(projects));
                        loadProjects();
                        updateDashboard();
                        showToast('Projects imported!', 'success');
                    }
                } catch (err) {
                    showToast('Invalid project file.', 'error');
                }
            };
            reader.readAsText(file);
        }

        function updateDashboard() {
            const totalProjectsEl = document.getElementById('totalProjects');
            const totalValueEl = document.getElementById('totalValue');
            const reviewEl = document.getElementById('reviewCount');
            const winRateEl = document.getElementById('winRate');
            const recentList = document.getElementById('recentProjectsList');

            const totalProjects = state.savedProjects.length;
            const totalValue = state.savedProjects.reduce((sum, p) => sum + (p.total || 0), 0);
            const review = state.savedProjects.filter(p => p.status === 'review').length;
            const wins = state.savedProjects.filter(p => p.status === 'won').length;
            const totalConsidered = state.savedProjects.filter(p => p.status !== 'review').length;
            const winRate = totalConsidered ? Math.round((wins / totalConsidered) * 100) : 0;

            if (totalProjectsEl) totalProjectsEl.textContent = totalProjects;
            if (totalValueEl) totalValueEl.textContent = formatCurrency(totalValue);
            if (reviewEl) reviewEl.textContent = review;
            if (winRateEl) winRateEl.textContent = winRate + '%';

            if (!recentList) return;
            recentList.innerHTML = '';
            const recent = state.savedProjects.slice().sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,3);
            if (recent.length === 0) {
                recentList.innerHTML = `<p style="color: var(--gray-600);">No saved projects.</p>`;
                return;
            }
            recent.forEach(p => {
                const div = document.createElement('div');
                div.style = "padding: 1rem; background: var(--gray-100); border-radius: 12px; margin-bottom: 1rem; cursor:pointer;";
                const typeLabel = p.estimateType === 'detailed' ? 'Detailed' : 'Quick';
                div.innerHTML = `
                    <div style="display:flex; justify-content: space-between; align-items:center;">
                        <div>
                            <h4 style="font-weight:600;">${p.name}</h4>
                            <p style="color: var(--gray-600); font-size:0.875rem;">${p.type || ''}${p.sqft ? ' • ' + p.sqft + ' sqft' : ''} • ${typeLabel}</p>
                        </div>
                        <div style="text-align:right;">
                            <p style="font-weight:700; color: var(--primary);">${formatCurrency(p.total)}</p>
                            <p style="color: var(--gray-600); font-size:0.75rem;">${new Date(p.date).toLocaleDateString()}</p>
                        </div>
                    </div>
                `;
                div.addEventListener('click', () => {
                    if (p.estimateType === 'quick') {
                        editProject(p.id);
                    } else {
                        switchTab('projects');
                    }
                });
                recentList.appendChild(div);
            });
        }

        function populateMaterialsTable() {
            const tableBody = document.getElementById('materialsTable');
            if (!tableBody) return;
            tableBody.innerHTML = '';
            Object.entries(state.materialPrices).forEach(([category, materials]) => {
                Object.entries(materials).forEach(([key, material]) => {
                    const row = tableBody.insertRow();
                    const trend = Math.random() > 0.5 ? '▲' : '▼';
                    const trendColor = trend === '▲' ? 'var(--danger)' : 'var(--success)';
                    row.innerHTML = `
                        <td>${material.label || toTitleCase(key)}</td>
                        <td>${toTitleCase(category)}</td>
                        <td>${formatCurrency(material.cost)}</td>
                        <td>${material.unit || 'unit'}</td>
                        <td style="color: ${trendColor}; font-weight: bold;">${trend} ${(Math.random() * 5).toFixed(1)}%</td>
                    `;
                });
            });
        }

        // --- CHARTS ---
        function initCharts() {
            const ctxPrice = document.getElementById('priceChart')?.getContext('2d');
            if (ctxPrice) new Chart(ctxPrice, {
                type: 'line',
                data: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                    datasets: [
                        { label: 'Lumber', data: [12, 19, 13, 15, 12, 13], borderColor: 'rgba(99, 102, 241, 1)', tension: 0.4, fill: false },
                        { label: 'Steel', data: [20, 22, 21, 24, 25, 23], borderColor: 'rgba(16, 185, 129, 1)', tension: 0.4, fill: false }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });

        }

        // --- SETTINGS & UPDATES ---
        async function checkForUpdatesOnLoad() {
            const result = await checkForUpdates({ silent: true });
            if (result.updateAvailable) {
                openModal('updateModal');
            }
        }

        async function checkForUpdates(options = {}) {
            if (options instanceof Event) {
                options.preventDefault?.();
                options = {};
            }
            const { silent = false } = options;
            setSyncState('syncing', 'Checking for updates...');
            try {
                const manifest = await fetchUpdateManifest();
                if (manifest && isNewerVersion(manifest.latestVersion, state.databaseMeta.version)) {
                    state.pendingUpdate = manifest;
                    populateUpdateModal(manifest);
                    setSyncState('warning', `Update v${manifest.latestVersion} available`);
                    if (!silent) openModal('updateModal');
                    return { updateAvailable: true, manifest };
                }

                state.pendingUpdate = null;
                setSyncState('success');
                if (!silent) showToast('Your material database is already up to date.', 'success');
                return { updateAvailable: false };
            } catch (error) {
                console.error('Error checking for updates:', error);
                setSyncState('error', 'Update check failed');
                if (!silent) showToast('Unable to check for updates. Please try again later.', 'error');
                return { updateAvailable: false, error };
            }
        }

        async function fetchUpdateManifest() {
            const res = await fetch('data/update-manifest.json', { cache: 'no-store' });
            if (!res.ok) throw new Error(`Manifest request failed: ${res.status}`);
            return res.json();
        }

        function populateUpdateModal(manifest) {
            const titleEl = document.getElementById('updateTitle');
            const metaEl = document.getElementById('updateMeta');
            const summaryEl = document.getElementById('updateSummary');
            const highlightsEl = document.getElementById('updateHighlights');

            if (titleEl) titleEl.textContent = manifest.title || 'Material Cost Update Available';
            if (metaEl) {
                const metaParts = [];
                if (manifest.lastUpdated) metaParts.push(`Published ${formatDateForDisplay(manifest.lastUpdated)}`);
                if (state.databaseMeta.version) metaParts.push(`Current: v${state.databaseMeta.version}`);
                if (manifest.latestVersion) metaParts.push(`New: v${manifest.latestVersion}`);
                metaEl.textContent = metaParts.join(' • ');
            }
            if (summaryEl) summaryEl.textContent = manifest.summary || 'Apply the update to synchronize with the latest regional pricing feed.';
            if (highlightsEl) {
                highlightsEl.innerHTML = '';
                const highlights = manifest.highlights && manifest.highlights.length ? manifest.highlights : ['Pricing aligned with latest market releases.'];
                highlights.forEach(item => {
                    const li = document.createElement('li');
                    li.className = 'update-item';
                    li.innerHTML = `<span class="update-icon">✓</span><span>${item}</span>`;
                    highlightsEl.appendChild(li);
                });
            }
        }

        async function applyUpdate() {
            if (!state.pendingUpdate) {
                showToast('No updates are available right now.', 'error');
                return;
            }

            setSyncState('syncing', 'Downloading update...');

            try {
                const res = await fetch(state.pendingUpdate.dataUrl, { cache: 'no-store' });
                if (!res.ok) throw new Error(`Update download failed: ${res.status}`);
                const data = await res.json();

                if (data.version && !isNewerVersion(data.version, state.databaseMeta.version)) {
                    throw new Error('Downloaded database is not newer than the installed version.');
                }

                applyDatabase(data, { announce: true });
                state.pendingUpdate = null;
                closeModal('updateModal');
                setSyncState('success');
            } catch (error) {
                console.error('Failed to apply update:', error);
                setSyncState('error', 'Update failed');
                showToast('Update failed. Please try again later.', 'error');
            }
        }
        
        // --- RUN APP ---
        document.addEventListener('DOMContentLoaded', async () => {
            await loadDatabase();
            init();
        });

    })();

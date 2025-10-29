    (function() {
        'use strict';

        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        if (pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js';
        }

        // --- STATE MANAGEMENT ---
        const state = {
            currentTab: 'dashboard',
            materialPrices: {},
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
            takeoff: {
                mode: 'line',
                pages: [],
                activePageId: null,
                points: [],
                previewPoint: null,
                counters: { line: 1, perimeter: 1, area: 1, count: 1, diameter: 1 },
                canvas: null,
                context: null,
                filters: { page: 'all', trade: 'all', floor: 'all', method: 'all', sort: 'page' }
            }
        };

        const TAKEOFF_COLORS = ['#0d6efd', '#ff6b35', '#2ca58d', '#ffc107', '#6f42c1', '#20c997'];

        async function loadDatabase() {
            try {
                const res = await fetch('database.json');
                const data = await res.json();
                state.materialPrices = data.materialPrices || {};
                state.lineItemCategories = data.lineItemCategories || {};
            } catch (err) {
                console.error('Error loading database:', err);
            }
        }

        // --- INITIALIZATION ---
        function init() {
            loadSavedData();
            setupEventListeners();
            updateShapeInputs();
            setupNavigation();
            populateMaterialsTable();
            loadProjects();
            updateDashboard();
            initCharts();
            checkForUpdatesOnLoad();
            initializeTakeoff();

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
            document.querySelectorAll('.material-card').forEach(card => card.addEventListener('click', handleMaterialSelection));
            document.getElementById('saveProjectBtn')?.addEventListener('click', saveProject);
            document.getElementById('addLineItemBtn')?.addEventListener('click', () => addLineItem());
            
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
            
            // Modals
            document.getElementById('closeUpdateModal')?.addEventListener('click', () => closeModal('updateModal'));
            document.getElementById('calculatorBtn')?.addEventListener('click', () => openModal('calculatorModal'));
            document.getElementById('closeCalculatorModal')?.addEventListener('click', () => closeModal('calculatorModal'));

            ['overhead', 'profit', 'contingency'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', updateBidTotal);
            });
            
            const lineItemsContainer = document.getElementById('lineItems');
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
            
            // Calculator
            document.getElementById('calculatorGrid')?.addEventListener('click', handleCalculatorClick);
            document.getElementById('convertUnitBtn')?.addEventListener('click', handleUnitConversion);
            document.getElementById('useValueBtn')?.addEventListener('click', useCalculatorValue);
            document.getElementById('modeBasic')?.addEventListener('click', () => updateCalcMode('basic'));
            document.getElementById('modeEngineering')?.addEventListener('click', () => updateCalcMode('engineering'));
            document.getElementById("shapeSelect")?.addEventListener("change", updateShapeInputs);
            document.getElementById("calcAreaBtn")?.addEventListener("click", calculateArea);
            document.getElementById('takeoffUpload')?.addEventListener('change', handleTakeoffUpload);
            document.getElementById('takeoffMode')?.addEventListener('change', (e) => setTakeoffMode(e.target.value));
            document.getElementById('takeoffScale')?.addEventListener('input', (e) => updateActivePageScale(e.target.value));
            document.getElementById('clearTakeoffBtn')?.addEventListener('click', clearActiveTakeoff);
            document.getElementById('exportTakeoffCsvBtn')?.addEventListener('click', exportTakeoffCsv);
            document.getElementById('pushTakeoffToBidBtn')?.addEventListener('click', pushTakeoffToEstimate);
            document.getElementById('takeoffPages')?.addEventListener('input', handleTakeoffPageInput);
            document.getElementById('takeoffPages')?.addEventListener('click', handleTakeoffPageClick);
            document.getElementById('takeoffFilterPage')?.addEventListener('change', (e) => updateTakeoffFilter('page', e.target.value));
            document.getElementById('takeoffFilterTrade')?.addEventListener('change', (e) => updateTakeoffFilter('trade', e.target.value));
            document.getElementById('takeoffFilterFloor')?.addEventListener('change', (e) => updateTakeoffFilter('floor', e.target.value));
            document.getElementById('takeoffFilterMethod')?.addEventListener('change', (e) => updateTakeoffFilter('method', e.target.value));
            document.getElementById('takeoffSort')?.addEventListener('change', (e) => updateTakeoffFilter('sort', e.target.value));
            const takeoffTable = document.getElementById('takeoffTableBody');
            takeoffTable?.addEventListener('input', handleTakeoffTableInput);
            takeoffTable?.addEventListener('change', handleTakeoffTableChange);
            takeoffTable?.addEventListener('click', handleTakeoffTableClick);
            document.getElementById('viewAllProjectsBtn')?.addEventListener('click', () => switchTab('projects'));
            updateCalcMode(state.calcMode);
        }

        // --- NAVIGATION & UI ---
        function setupNavigation() {
            document.querySelectorAll('.nav-item').forEach(item => {
                item.addEventListener('click', function() {
                    const tab = this.getAttribute('data-tab');
                    switchTab(tab);
                });
            });
        }

        function switchTab(tabId) {
            state.currentTab = tabId;
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(`${tabId}Tab`)?.classList.add('active');
            
            document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
            document.querySelector(`.nav-item[data-tab="${tabId}"]`)?.classList.add('active');

            const pageTitle = document.querySelector(`.nav-item[data-tab="${tabId}"]`)?.innerText || 'Dashboard';
            document.getElementById('pageTitle').textContent = pageTitle;
            
            if (window.innerWidth <= 1024) {
                document.getElementById('sidebar').classList.remove('open');
            }
        }

        function toggleSidebar() {
            document.getElementById('sidebar')?.classList.toggle('open');
        }

        function toggleTheme() {
            document.body.classList.toggle('dark-mode');
            localStorage.setItem('darkMode', document.body.classList.contains('dark-mode') ? 'on' : 'off');
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

            const selected = {
                foundation: document.querySelector('[data-foundation].selected')?.dataset.foundation,
                framing: document.querySelector('[data-framing].selected')?.dataset.framing,
                exterior: document.querySelector('[data-exterior].selected')?.dataset.exterior,
            };

            if (!selected.foundation || !selected.framing || !selected.exterior) {
                showToast('Please select all material types.', 'error');
                return;
            }

            const costs = {
                foundation: state.materialPrices.foundation[selected.foundation] * sqft,
                framing: state.materialPrices.framing[selected.framing] * sqft * floors,
                exterior: state.materialPrices.exterior[selected.exterior] * sqft * floors * 0.8,
            };

            const materialTotal = Object.values(costs).reduce((sum, cost) => sum + cost, 0);
            const laborTotal = materialTotal * laborMultiplier;
            const total = materialTotal + laborTotal;

            state.currentEstimate = {
                id: state.editingProjectId || state.currentEstimate?.id || Date.now(),
                estimateType: 'quick',
                name: form.querySelector('#projectName').value,
                type: form.querySelector('#projectType').value,
                sqft, floors, laborMultiplier,
                selected,
                costs,
                materialTotal, laborTotal, total,
                date: new Date().toISOString(),
                status: state.currentEstimate?.status || 'review'
            };

            displayEstimate(state.currentEstimate);
        }

        function displayEstimate(estimate) {
            document.getElementById('materialCost').textContent = formatCurrency(estimate.materialTotal);
            document.getElementById('laborCostDisplay').textContent = formatCurrency(estimate.laborTotal);
            document.getElementById('totalCost').textContent = formatCurrency(estimate.total);

            const breakdownContent = document.getElementById('breakdownContent');
            breakdownContent.innerHTML = `
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--gray-200);"><span>Foundation:</span> <strong>${formatCurrency(estimate.costs.foundation)}</strong></div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--gray-200);"><span>Framing:</span> <strong>${formatCurrency(estimate.costs.framing)}</strong></div>
                <div style="display: flex; justify-content: space-between;"><span>Exterior:</span> <strong>${formatCurrency(estimate.costs.exterior)}</strong></div>
            `;

            document.getElementById('breakdownCard').style.display = 'block';
            document.getElementById('estimateSummary').style.display = 'block';
        }

        function saveProject() {
            if (!state.currentEstimate) {
                showToast('No estimate to save.', 'warning');
                return;
            }
            const estimate = { ...state.currentEstimate, estimateType: 'quick', status: state.currentEstimate.status || 'review' };
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

            document.querySelectorAll('[data-foundation]').forEach(c => {
                c.classList.toggle('selected', c.dataset.foundation === data.selected?.foundation);
            });
            document.querySelectorAll('[data-framing]').forEach(c => {
                c.classList.toggle('selected', c.dataset.framing === data.selected?.framing);
            });
            document.querySelectorAll('[data-exterior]').forEach(c => {
                c.classList.toggle('selected', c.dataset.exterior === data.selected?.exterior);
            });
        }

        function editProject(id) {
            const project = state.savedProjects.find(p => p.id === id && p.estimateType === 'quick');
            if (!project) return;
            state.editingProjectId = id;
            state.currentEstimate = { ...project };
            populateEstimatorForm(project);
            displayEstimate(project);
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
            bid.lineItems.forEach(item => addLineItem(item));
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

        // --- DETAILED BIDDING ---
        function addLineItem(item = null) {
            if (item?.category && !state.lineItemCategories[item.category]) {
                state.lineItemCategories[item.category] = [];
            }

            state.lineItemId++;
            const div = document.createElement('div');
            div.className = 'line-item-row';
            div.dataset.id = state.lineItemId;

            const categoryOptions = Object.keys(state.lineItemCategories)
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
            container.appendChild(div);

            const categorySelect = div.querySelector('[data-field="category"]');
            if (item?.category) {
                categorySelect.value = item.category;
            }

            updateItemSelectionOptions(div);

            if (item) {
                const descriptionSelect = div.querySelector('[data-field="description"]');
                if (item.category && !state.lineItemCategories[item.category]?.some(entry => entry.name === item.description)) {
                    descriptionSelect.innerHTML = `<option value="${item.description}">${item.description}</option>`;
                }
                if (item.description) {
                    descriptionSelect.value = item.description;
                }
                div.querySelector('[data-field="quantity"]').value = item.quantity ?? 1;
                div.querySelector('[data-field="unit"]').value = item.unit ?? '';
                div.querySelector('[data-field="rate"]').value = item.rate ?? 0;
                updateLineItemTotal(div);
            }
        }
        
        function updateItemSelectionOptions(row) {
            const categorySelect = row.querySelector('[data-field="category"]');
            const descriptionSelect = row.querySelector('[data-field="description"]');
            const selectedCategory = categorySelect.value;
            
            const items = state.lineItemCategories[selectedCategory] || [];
            descriptionSelect.innerHTML = items.map(item => `<option value="${item.name}">${item.name}</option>`).join('');
            updateLineItemFromSelection(descriptionSelect);
        }

        function updateLineItemFromSelection(selectElement) {
            const row = selectElement.closest('.line-item-row');
            const category = row.querySelector('[data-field="category"]').value;
            const description = selectElement.value;
            
            const itemData = state.lineItemCategories[category]?.find(i => i.name === description);
            
            if (itemData) {
                row.querySelector('[data-field="unit"]').value = itemData.unit;
                row.querySelector('[data-field="rate"]').value = itemData.rate;
                updateLineItemTotal(row);
            }
        }

        function removeLineItem(row) {
            row.remove();
            updateBidTotal();
        }

        function updateLineItemTotal(row) {
            const quantity = parseFloat(row.querySelector('[data-field="quantity"]').value) || 0;
            const rate = parseFloat(row.querySelector('[data-field="rate"]').value) || 0;
            const total = quantity * rate;
            row.querySelector('.line-item-total').textContent = formatCurrency(total);
            updateBidTotal();
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

        function updateShapeInputs() {
            const shapeSelect = document.getElementById('shapeSelect');
            const dim1Input = document.getElementById('dim1');
            const dim2Input = document.getElementById('dim2');
            const dim2Group = document.getElementById('dim2Group');

            if (!shapeSelect || !dim1Input || !dim2Input || !dim2Group) return;

            const shape = shapeSelect.value;
            if (shape === 'circle') {
                dim1Input.placeholder = 'Radius';
                dim2Group.style.display = 'none';
            } else if (shape === 'triangle') {
                dim1Input.placeholder = 'Base';
                dim2Input.placeholder = 'Height';
                dim2Group.style.display = 'block';
            } else {
                dim1Input.placeholder = 'Length';
                dim2Input.placeholder = 'Width';
                dim2Group.style.display = 'block';
            }
        }

        function calculateArea() {
            const shapeSelect = document.getElementById('shapeSelect');
            const dim1Input = document.getElementById('dim1');
            const dim2Input = document.getElementById('dim2');
            const resultEl = document.getElementById('takeoffResult');

            if (!shapeSelect || !dim1Input || !dim2Input || !resultEl) return;

            const shape = shapeSelect.value;
            const d1 = parseFloat(dim1Input.value) || 0;
            const d2 = parseFloat(dim2Input.value) || 0;

            let area = 0;
            if (shape === 'rectangle') area = d1 * d2;
            else if (shape === 'circle') area = Math.PI * d1 * d1;
            else if (shape === 'triangle') area = 0.5 * d1 * d2;

            resultEl.textContent = `Area: ${area.toFixed(2)}`;
        }

        // --- TAKEOFF TOOLS ---
        function initializeTakeoff() {
            const canvas = document.getElementById('takeoffCanvas');
            state.takeoff.canvas = canvas || null;
            state.takeoff.context = canvas ? canvas.getContext('2d') : null;

            canvas?.addEventListener('click', handleTakeoffCanvasClick);
            canvas?.addEventListener('mousemove', handleTakeoffCanvasMove);
            canvas?.addEventListener('mouseleave', handleTakeoffCanvasLeave);
            canvas?.addEventListener('dblclick', handleTakeoffCanvasDoubleClick);

            renderTakeoffPages();
            renderTakeoffFilters();
            renderTakeoffMeasurements();
            updateTakeoffStatus('Upload drawings to begin measuring.');
        }

        async function handleTakeoffUpload(event) {
            const files = Array.from(event.target.files || []);
            if (!files.length) return;

            const newPages = [];
            for (const file of files) {
                try {
                    const pages = await createTakeoffPagesFromFile(file);
                    newPages.push(...pages);
                } catch (error) {
                    console.error('Error loading plan:', error);
                    showToast(`Unable to load ${file.name}.`, 'error');
                }
            }

            if (newPages.length) {
                state.takeoff.pages.push(...newPages);
                if (!state.takeoff.activePageId) {
                    setActiveTakeoffPage(newPages[0].id);
                } else {
                    renderTakeoffPages();
                    renderTakeoffMeasurements();
                }
                renderTakeoffFilters();
                updateTakeoffStatus('Drawing uploaded. Select a page to begin measuring.');
            }

            event.target.value = '';
        }

        async function createTakeoffPagesFromFile(file) {
            const pages = [];
            const isPdf = (file.type && file.type.toLowerCase() === 'application/pdf') || file.name.toLowerCase().endsWith('.pdf');

            if (isPdf) {
                if (typeof pdfjsLib === 'undefined') {
                    showToast('PDF support is unavailable. Please check your connection.', 'error');
                    return pages;
                }
                if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.js';
                }
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: 1.5 });
                    const tempCanvas = document.createElement('canvas');
                    const tempContext = tempCanvas.getContext('2d');
                    tempCanvas.width = viewport.width;
                    tempCanvas.height = viewport.height;
                    await page.render({ canvasContext: tempContext, viewport }).promise;
                    const dataUrl = tempCanvas.toDataURL('image/png');
                    pages.push(createTakeoffPage({
                        name: `${file.name.replace(/\.pdf$/i, '')} - Page ${i}`,
                        pageNumber: i,
                        imageSrc: dataUrl
                    }));
                }
            } else {
                const dataUrl = await readFileAsDataUrl(file);
                pages.push(createTakeoffPage({ name: file.name, imageSrc: dataUrl }));
            }

            return pages;
        }

        async function readFileAsDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const result = typeof ev.target?.result === 'string' ? ev.target.result : null;
                    if (result) resolve(result);
                    else reject(new Error('Unable to read file.'));
                };
                reader.onerror = () => reject(new Error('Unable to read file.'));
                reader.readAsDataURL(file);
            });
        }

        function createTakeoffPage({ name, imageSrc, pageNumber = null }) {
            return {
                id: createTakeoffId('page'),
                name: name || `Page ${state.takeoff.pages.length + 1}`.trim(),
                trade: '',
                floor: '',
                method: '',
                pageNumber,
                scale: 1,
                imageSrc: imageSrc || '',
                measurements: [],
                createdAt: Date.now()
            };
        }

        function getActiveTakeoffPage() {
            return state.takeoff.pages.find(page => page.id === state.takeoff.activePageId) || null;
        }

        function setActiveTakeoffPage(pageId) {
            if (state.takeoff.activePageId === pageId) return;
            state.takeoff.activePageId = pageId || null;
            state.takeoff.points = [];
            state.takeoff.previewPoint = null;

            const page = getActiveTakeoffPage();
            const scaleInput = document.getElementById('takeoffScale');
            if (scaleInput) {
                scaleInput.value = page ? page.scale : 1;
                scaleInput.disabled = !page;
            }

            const img = document.getElementById('takeoffPreview');
            if (img) {
                if (!page || !page.imageSrc) {
                    img.style.display = 'none';
                    img.removeAttribute('src');
                    prepareTakeoffCanvas(0, 0);
                    drawTakeoff();
                } else {
                    img.onload = () => {
                        requestAnimationFrame(() => {
                            const rect = img.getBoundingClientRect();
                            const width = rect.width || img.naturalWidth || 0;
                            const height = rect.height || img.naturalHeight || 0;
                            prepareTakeoffCanvas(width, height);
                            drawTakeoff();
                        });
                        img.style.display = 'block';
                    };
                    img.src = page.imageSrc;
                }
            }

            renderTakeoffPages();
            renderTakeoffMeasurements();
            updateTakeoffStatus(page ? 'Select a takeoff mode and start measuring.' : 'Upload drawings to begin measuring.');
        }

        function renderTakeoffPages() {
            const container = document.getElementById('takeoffPages');
            if (!container) return;
            container.innerHTML = '';

            if (!state.takeoff.pages.length) {
                const empty = document.createElement('div');
                empty.className = 'takeoff-page-empty';
                empty.innerHTML = 'Upload plan sheets to build your takeoff workspace.';
                container.appendChild(empty);
                return;
            }

            state.takeoff.pages
                .slice()
                .sort((a, b) => a.createdAt - b.createdAt)
                .forEach(page => {
                    const item = document.createElement('div');
                    item.className = 'takeoff-page-item';
                    item.dataset.id = page.id;

                    const header = document.createElement('div');
                    header.className = 'takeoff-page-header';

                    const label = document.createElement('label');
                    label.className = 'takeoff-page-select';

                    const radio = document.createElement('input');
                    radio.type = 'radio';
                    radio.name = 'takeoffPage';
                    radio.value = page.id;
                    radio.checked = page.id === state.takeoff.activePageId;

                    const title = document.createElement('input');
                    title.type = 'text';
                    title.className = 'takeoff-meta-input';
                    title.dataset.field = 'name';
                    title.value = page.name;
                    title.placeholder = 'Page name';

                    label.append(radio, title);

                    const removeBtn = document.createElement('button');
                    removeBtn.type = 'button';
                    removeBtn.className = 'takeoff-remove-page';
                    removeBtn.dataset.action = 'remove';
                    removeBtn.innerHTML = '&times;';

                    header.append(label, removeBtn);
                    item.appendChild(header);

                    const meta = document.createElement('div');
                    meta.className = 'takeoff-page-meta';
                    meta.append(
                        createTakeoffPageField('Trade', 'trade', page.trade, 'e.g. Electrical'),
                        createTakeoffPageField('Floor', 'floor', page.floor, 'e.g. Level 2'),
                        createTakeoffPageField('Method', 'method', page.method, 'e.g. Linear')
                    );
                    if (page.pageNumber !== null) {
                        meta.append(createTakeoffPageField('Page #', 'pageNumber', page.pageNumber));
                    }
                    item.appendChild(meta);

                    container.appendChild(item);
                });
        }

        function createTakeoffPageField(labelText, field, value, placeholder = '') {
            const wrapper = document.createElement('label');
            wrapper.className = 'takeoff-page-field';

            const span = document.createElement('span');
            span.textContent = labelText;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'takeoff-meta-input';
            input.dataset.field = field;
            input.value = value ?? '';
            if (placeholder) input.placeholder = placeholder;

            wrapper.append(span, input);
            return wrapper;
        }

        function handleTakeoffPageInput(event) {
            const field = event.target.dataset.field;
            if (!field) return;
            const item = event.target.closest('.takeoff-page-item');
            if (!item?.dataset.id) return;

            const page = state.takeoff.pages.find(p => p.id === item.dataset.id);
            if (!page) return;

            if (field === 'pageNumber') {
                page.pageNumber = event.target.value;
            } else {
                page[field] = event.target.value;
            }

            if (field === 'name') {
                renderTakeoffPages();
                renderTakeoffMeasurements();
            } else if (['trade', 'floor', 'method'].includes(field)) {
                renderTakeoffMeasurements();
                renderTakeoffFilters();
            }
        }

        function handleTakeoffPageClick(event) {
            const item = event.target.closest('.takeoff-page-item');
            if (!item?.dataset.id) return;
            const pageId = item.dataset.id;

            if (event.target.matches('input[type="radio"]')) {
                setActiveTakeoffPage(pageId);
            } else if (event.target.closest('[data-action="remove"]')) {
                removeTakeoffPage(pageId);
            }
        }

        function removeTakeoffPage(pageId) {
            const index = state.takeoff.pages.findIndex(page => page.id === pageId);
            if (index === -1) return;

            const [removed] = state.takeoff.pages.splice(index, 1);
            if (removed?.measurements?.length) {
                showToast(`Removed ${removed.measurements.length} measurement(s) with the page.`, 'warning');
            }

            if (state.takeoff.activePageId === pageId) {
                state.takeoff.activePageId = state.takeoff.pages[0]?.id || null;
                state.takeoff.points = [];
                state.takeoff.previewPoint = null;
            }

            renderTakeoffPages();
            renderTakeoffFilters();
            renderTakeoffMeasurements();
            drawTakeoff();
            updateTakeoffStatus(state.takeoff.activePageId ? 'Select a mode to continue measuring.' : 'Upload drawings to begin measuring.');
        }

        function updateActivePageScale(value) {
            const page = getActiveTakeoffPage();
            if (!page) return;
            const numericValue = parseFloat(value);
            if (!Number.isFinite(numericValue) || numericValue <= 0) return;
            page.scale = numericValue;
            renderTakeoffMeasurements();
            drawTakeoff();
        }

        function clearActiveTakeoff() {
            const page = getActiveTakeoffPage();
            if (!page) {
                showToast('Select a drawing page first.', 'warning');
                return;
            }
            page.measurements = [];
            state.takeoff.points = [];
            state.takeoff.previewPoint = null;
            renderTakeoffMeasurements();
            drawTakeoff();
            updateTakeoffStatus('All measurements cleared from this page.');
        }

        function renderTakeoffFilters() {
            const pageSelect = document.getElementById('takeoffFilterPage');
            if (pageSelect) {
                const previous = pageSelect.value || 'all';
                pageSelect.innerHTML = '<option value="all">All Pages</option>' + state.takeoff.pages
                    .map(page => `<option value="${page.id}">${page.name || 'Untitled Page'}</option>`)
                    .join('');
                pageSelect.value = previous;
            }

            const tradeSelect = document.getElementById('takeoffFilterTrade');
            const floorSelect = document.getElementById('takeoffFilterFloor');
            const methodSelect = document.getElementById('takeoffFilterMethod');

            const trades = new Set();
            const floors = new Set();
            const methods = new Set();

            getAllTakeoffMeasurements().forEach(({ measurement }) => {
                if (measurement.trade) trades.add(measurement.trade);
                if (measurement.floor) floors.add(measurement.floor);
                if (measurement.method) methods.add(measurement.method);
            });

            if (tradeSelect) {
                const prev = tradeSelect.value || 'all';
                tradeSelect.innerHTML = '<option value="all">All Trades</option>' + Array.from(trades)
                    .sort()
                    .map(val => `<option value="${val}">${val}</option>`)
                    .join('');
                tradeSelect.value = prev;
            }

            if (floorSelect) {
                const prev = floorSelect.value || 'all';
                floorSelect.innerHTML = '<option value="all">All Floors</option>' + Array.from(floors)
                    .sort()
                    .map(val => `<option value="${val}">${val}</option>`)
                    .join('');
                floorSelect.value = prev;
            }

            if (methodSelect) {
                const prev = methodSelect.value || 'all';
                methodSelect.innerHTML = '<option value="all">All Methods</option>' + Array.from(methods)
                    .sort()
                    .map(val => `<option value="${val}">${val}</option>`)
                    .join('');
                methodSelect.value = prev;
            }
        }

        function updateTakeoffFilter(field, value) {
            state.takeoff.filters[field] = value;
            renderTakeoffMeasurements();
        }

        function getAllTakeoffMeasurements() {
            return state.takeoff.pages.flatMap(page =>
                page.measurements.map(measurement => ({ measurement, page }))
            );
        }

        function ensureMeasurementFields(measurement) {
            if (!measurement) return;
            if (!Array.isArray(measurement.subItems)) {
                measurement.subItems = [];
            }
            if (typeof measurement.itemDescription !== 'string') {
                measurement.itemDescription = '';
            }
            if (typeof measurement.itemNotes !== 'string') {
                measurement.itemNotes = '';
            }
            if (typeof measurement.itemUnit !== 'string' || !measurement.itemUnit) {
                measurement.itemUnit = getTakeoffUnits(measurement);
            }
            if (typeof measurement.itemQuantity !== 'number' || Number.isNaN(measurement.itemQuantity)) {
                measurement.itemQuantity = parseFloat(getTakeoffValue(measurement).toFixed(2));
            }
            if (typeof measurement.showSubItems !== 'boolean') {
                measurement.showSubItems = false;
            }
        }

        function renderTakeoffMeasurements() {
            const tbody = document.getElementById('takeoffTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';

            const filters = state.takeoff.filters;
            const measurements = getAllTakeoffMeasurements().filter(({ measurement, page }) => {
                if (filters.page !== 'all' && measurement.pageId !== filters.page) return false;
                if (filters.trade !== 'all' && measurement.trade !== filters.trade) return false;
                if (filters.floor !== 'all' && measurement.floor !== filters.floor) return false;
                if (filters.method !== 'all' && measurement.method !== filters.method) return false;
                return true;
            });

            const sorters = {
                page: (a, b) => (a.page.name || '').localeCompare(b.page.name || ''),
                trade: (a, b) => (a.measurement.trade || '').localeCompare(b.measurement.trade || ''),
                floor: (a, b) => (a.measurement.floor || '').localeCompare(b.measurement.floor || ''),
                method: (a, b) => (a.measurement.method || '').localeCompare(b.measurement.method || ''),
                label: (a, b) => a.measurement.label.localeCompare(b.measurement.label)
            };
            const sorter = sorters[filters.sort] || sorters.page;
            measurements.sort(sorter);

            if (!measurements.length) {
                const emptyRow = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 12;
                cell.style.padding = '0.75rem';
                cell.style.color = 'var(--gray-500)';
                cell.textContent = 'No measurements yet.';
                emptyRow.appendChild(cell);
                tbody.appendChild(emptyRow);
                return;
            }

            const pageOptions = state.takeoff.pages.map(page => ({ id: page.id, name: page.name || 'Untitled Page' }));

            measurements.forEach(({ measurement }) => {
                ensureMeasurementFields(measurement);

                const measuredValue = getTakeoffValue(measurement).toFixed(2);
                const measuredUnits = getTakeoffUnits(measurement);
                const measuredDetails = getTakeoffDetails(measurement);

                const row = document.createElement('tr');
                row.className = 'takeoff-row';
                row.dataset.id = measurement.id;

                const toggleCell = document.createElement('td');
                const toggleBtn = document.createElement('button');
                toggleBtn.type = 'button';
                toggleBtn.className = 'takeoff-toggle';
                toggleBtn.dataset.action = 'toggle-subitems';
                toggleBtn.title = measurement.showSubItems ? 'Hide sub-items' : 'Show sub-items';
                toggleBtn.setAttribute('aria-expanded', measurement.showSubItems ? 'true' : 'false');
                toggleBtn.setAttribute('aria-label', measurement.showSubItems ? 'Hide sub-items' : 'Show sub-items');
                toggleBtn.textContent = measurement.showSubItems ? '▾' : '▸';
                toggleCell.appendChild(toggleBtn);

                const nameCell = document.createElement('td');
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'takeoff-name-input';
                nameInput.value = measurement.label;
                nameInput.dataset.field = 'label';
                nameCell.appendChild(nameInput);

                const descriptionCell = document.createElement('td');
                const descriptionInput = document.createElement('input');
                descriptionInput.type = 'text';
                descriptionInput.className = 'takeoff-meta-input takeoff-description-input';
                descriptionInput.dataset.field = 'itemDescription';
                descriptionInput.placeholder = 'Describe the item';
                descriptionInput.value = measurement.itemDescription || '';
                descriptionCell.appendChild(descriptionInput);

                const pageCell = document.createElement('td');
                const pageSelect = document.createElement('select');
                pageSelect.className = 'takeoff-meta-select';
                pageSelect.dataset.field = 'pageId';
                pageOptions.forEach(option => {
                    const opt = document.createElement('option');
                    opt.value = option.id;
                    opt.textContent = option.name;
                    if (option.id === measurement.pageId) opt.selected = true;
                    pageSelect.appendChild(opt);
                });
                pageCell.appendChild(pageSelect);

                const tradeCell = document.createElement('td');
                const tradeInput = document.createElement('input');
                tradeInput.type = 'text';
                tradeInput.className = 'takeoff-meta-input';
                tradeInput.dataset.field = 'trade';
                tradeInput.value = measurement.trade || '';
                tradeCell.appendChild(tradeInput);

                const floorCell = document.createElement('td');
                const floorInput = document.createElement('input');
                floorInput.type = 'text';
                floorInput.className = 'takeoff-meta-input';
                floorInput.dataset.field = 'floor';
                floorInput.value = measurement.floor || '';
                floorCell.appendChild(floorInput);

                const methodCell = document.createElement('td');
                const methodInput = document.createElement('input');
                methodInput.type = 'text';
                methodInput.className = 'takeoff-meta-input';
                methodInput.dataset.field = 'method';
                methodInput.value = measurement.method || '';
                methodCell.appendChild(methodInput);

                const modeCell = document.createElement('td');
                modeCell.textContent = formatTakeoffModeLabel(measurement.type);

                const quantityCell = document.createElement('td');
                const quantityWrapper = document.createElement('div');
                quantityWrapper.className = 'takeoff-quantity-wrapper';
                const quantityInput = document.createElement('input');
                quantityInput.type = 'number';
                quantityInput.min = '0';
                quantityInput.step = '0.01';
                quantityInput.className = 'takeoff-meta-input takeoff-quantity-input';
                quantityInput.dataset.field = 'itemQuantity';
                quantityInput.value = measurement.itemQuantity ?? measuredValue;
                quantityInput.placeholder = measuredValue;
                const quantityHint = document.createElement('div');
                quantityHint.className = 'takeoff-quantity-hint';
                quantityHint.textContent = measuredDetails
                    ? `Measured: ${measuredValue} ${measuredUnits} (${measuredDetails})`
                    : `Measured: ${measuredValue} ${measuredUnits}`;
                quantityWrapper.append(quantityInput, quantityHint);
                quantityCell.appendChild(quantityWrapper);

                const unitsCell = document.createElement('td');
                const unitInput = document.createElement('input');
                unitInput.type = 'text';
                unitInput.className = 'takeoff-meta-input takeoff-unit-input';
                unitInput.dataset.field = 'itemUnit';
                unitInput.value = measurement.itemUnit || measuredUnits;
                unitsCell.appendChild(unitInput);

                const notesCell = document.createElement('td');
                const notesInput = document.createElement('input');
                notesInput.type = 'text';
                notesInput.className = 'takeoff-meta-input takeoff-notes-input';
                notesInput.dataset.field = 'itemNotes';
                notesInput.placeholder = 'Add notes';
                notesInput.value = measurement.itemNotes || '';
                notesCell.appendChild(notesInput);

                const actionCell = document.createElement('td');
                actionCell.className = 'takeoff-actions-cell';
                const addSubItemBtn = document.createElement('button');
                addSubItemBtn.type = 'button';
                addSubItemBtn.className = 'btn btn-secondary btn-compact';
                addSubItemBtn.dataset.action = 'add-subitem';
                addSubItemBtn.textContent = '+ Sub-item';
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'takeoff-remove';
                removeBtn.dataset.action = 'remove-measurement';
                removeBtn.textContent = '×';
                actionCell.append(addSubItemBtn, removeBtn);

                row.append(toggleCell, nameCell, descriptionCell, pageCell, tradeCell, floorCell, methodCell, modeCell, quantityCell, unitsCell, notesCell, actionCell);
                tbody.appendChild(row);

                if (measurement.showSubItems || measurement.subItems.length) {
                    const subRow = document.createElement('tr');
                    subRow.className = 'takeoff-subitems-row';
                    subRow.dataset.parentId = measurement.id;
                    const subCell = document.createElement('td');
                    subCell.colSpan = 12;
                    const subContainer = document.createElement('div');
                    subContainer.className = 'takeoff-subitems';

                    const summary = document.createElement('div');
                    summary.className = 'takeoff-measurement-summary';
                    summary.textContent = measuredDetails
                        ? `${formatTakeoffModeLabel(measurement.type)} • ${measuredValue} ${measuredUnits} • ${measuredDetails}`
                        : `${formatTakeoffModeLabel(measurement.type)} • ${measuredValue} ${measuredUnits}`;
                    subContainer.appendChild(summary);

                    const subHeader = document.createElement('div');
                    subHeader.className = 'takeoff-subitems-header';
                    const subTitle = document.createElement('span');
                    subTitle.textContent = measurement.subItems.length ? 'Sub-items' : 'No sub-items yet';
                    const subAddBtn = document.createElement('button');
                    subAddBtn.type = 'button';
                    subAddBtn.className = 'btn btn-secondary btn-compact';
                    subAddBtn.dataset.action = 'add-subitem';
                    subAddBtn.textContent = 'Add Sub-item';
                    subHeader.append(subTitle, subAddBtn);
                    subContainer.appendChild(subHeader);

                    if (measurement.subItems.length) {
                        const subTable = document.createElement('table');
                        subTable.className = 'takeoff-subitems-table';
                        const subHead = document.createElement('thead');
                        subHead.innerHTML = '<tr><th>Name</th><th>Quantity</th><th>Unit</th><th>Notes</th><th></th></tr>';
                        const subBody = document.createElement('tbody');

                        measurement.subItems.forEach(subItem => {
                            const subItemRow = document.createElement('tr');

                            const subNameCell = document.createElement('td');
                            const subNameInput = document.createElement('input');
                            subNameInput.type = 'text';
                            subNameInput.className = 'takeoff-subitem-input';
                            subNameInput.dataset.subitemField = 'label';
                            subNameInput.dataset.subitemId = subItem.id;
                            subNameInput.value = subItem.label || '';
                            subNameInput.placeholder = 'Name';
                            subNameCell.appendChild(subNameInput);

                            const subQuantityCell = document.createElement('td');
                            const subQuantityInput = document.createElement('input');
                            subQuantityInput.type = 'number';
                            subQuantityInput.min = '0';
                            subQuantityInput.step = '0.01';
                            subQuantityInput.className = 'takeoff-subitem-input';
                            subQuantityInput.dataset.subitemField = 'quantity';
                            subQuantityInput.dataset.subitemId = subItem.id;
                            subQuantityInput.value = subItem.quantity ?? '';
                            subQuantityInput.placeholder = 'Qty';
                            subQuantityCell.appendChild(subQuantityInput);

                            const subUnitCell = document.createElement('td');
                            const subUnitInput = document.createElement('input');
                            subUnitInput.type = 'text';
                            subUnitInput.className = 'takeoff-subitem-input';
                            subUnitInput.dataset.subitemField = 'unit';
                            subUnitInput.dataset.subitemId = subItem.id;
                            subUnitInput.value = subItem.unit || '';
                            subUnitInput.placeholder = 'Unit';
                            subUnitCell.appendChild(subUnitInput);

                            const subNotesCell = document.createElement('td');
                            const subNotesInput = document.createElement('input');
                            subNotesInput.type = 'text';
                            subNotesInput.className = 'takeoff-subitem-input';
                            subNotesInput.dataset.subitemField = 'notes';
                            subNotesInput.dataset.subitemId = subItem.id;
                            subNotesInput.value = subItem.notes || '';
                            subNotesInput.placeholder = 'Notes';
                            subNotesCell.appendChild(subNotesInput);

                            const subActionCell = document.createElement('td');
                            const subRemoveBtn = document.createElement('button');
                            subRemoveBtn.type = 'button';
                            subRemoveBtn.className = 'takeoff-remove';
                            subRemoveBtn.dataset.action = 'remove-subitem';
                            subRemoveBtn.dataset.subitemId = subItem.id;
                            subRemoveBtn.textContent = '×';
                            subActionCell.appendChild(subRemoveBtn);

                            subItemRow.append(subNameCell, subQuantityCell, subUnitCell, subNotesCell, subActionCell);
                            subBody.appendChild(subItemRow);
                        });

                        subTable.append(subHead, subBody);
                        subContainer.appendChild(subTable);
                    }

                    subCell.appendChild(subContainer);
                    subRow.appendChild(subCell);
                    if (!measurement.showSubItems && measurement.subItems.length) {
                        subRow.style.display = 'none';
                    }
                    tbody.appendChild(subRow);
                }
            });
        }

        function handleTakeoffTableInput(event) {
            const subitemField = event.target.dataset.subitemField;
            if (subitemField) {
                const subRow = event.target.closest('.takeoff-subitems-row');
                if (!subRow?.dataset.parentId) return;
                const info = findTakeoffMeasurement(subRow.dataset.parentId);
                if (!info) return;
                ensureMeasurementFields(info.measurement);
                const subItem = info.measurement.subItems.find(item => item.id === event.target.dataset.subitemId);
                if (!subItem) return;
                if (subitemField === 'quantity') {
                    const value = parseFloat(event.target.value);
                    subItem.quantity = Number.isNaN(value) ? undefined : value;
                } else {
                    subItem[subitemField] = event.target.value;
                }
                return;
            }

            const field = event.target.dataset.field;
            if (!field || event.target.tagName === 'SELECT') return;
            const row = event.target.closest('tr.takeoff-row');
            if (!row?.dataset.id) return;
            const info = findTakeoffMeasurement(row.dataset.id);
            if (!info) return;
            const { measurement } = info;
            ensureMeasurementFields(measurement);

            if (field === 'label') {
                measurement.label = event.target.value;
            } else if (['trade', 'floor', 'method'].includes(field)) {
                measurement[field] = event.target.value;
                renderTakeoffFilters();
            } else if (field === 'itemDescription') {
                measurement.itemDescription = event.target.value;
            } else if (field === 'itemNotes') {
                measurement.itemNotes = event.target.value;
            } else if (field === 'itemQuantity') {
                const value = parseFloat(event.target.value);
                measurement.itemQuantity = Number.isNaN(value) ? undefined : value;
            } else if (field === 'itemUnit') {
                measurement.itemUnit = event.target.value;
            }
        }

        function handleTakeoffTableChange(event) {
            const field = event.target.dataset.field;
            if (!field) return;
            const row = event.target.closest('tr.takeoff-row');
            if (!row?.dataset.id) return;
            const info = findTakeoffMeasurement(row.dataset.id);
            if (!info) return;
            const { measurement, page } = info;
            ensureMeasurementFields(measurement);

            if (field === 'pageId') {
                if (measurement.pageId === event.target.value) return;
                page.measurements = page.measurements.filter(item => item.id !== measurement.id);
                const nextPage = state.takeoff.pages.find(p => p.id === event.target.value);
                if (nextPage) {
                    measurement.pageId = nextPage.id;
                    nextPage.measurements.push(measurement);
                }
                renderTakeoffMeasurements();
                renderTakeoffPages();
                drawTakeoff();
            }
        }

        function handleTakeoffTableClick(event) {
            const actionEl = event.target.closest('[data-action]');
            if (!actionEl) return;
            const action = actionEl.dataset.action;

            if (action === 'remove-measurement') {
                const row = actionEl.closest('tr.takeoff-row');
                if (!row?.dataset.id) return;
                const info = findTakeoffMeasurement(row.dataset.id);
                if (!info) return;
                const { measurement, page } = info;
                page.measurements = page.measurements.filter(item => item.id !== measurement.id);
                renderTakeoffMeasurements();
                renderTakeoffFilters();
                drawTakeoff();
                updateTakeoffStatus('Measurement removed.');
                return;
            }

            let measurementId = null;
            const measurementRow = actionEl.closest('tr.takeoff-row');
            if (measurementRow?.dataset.id) {
                measurementId = measurementRow.dataset.id;
            } else {
                const subRow = actionEl.closest('.takeoff-subitems-row');
                if (subRow?.dataset.parentId) {
                    measurementId = subRow.dataset.parentId;
                }
            }

            if (!measurementId) return;
            const info = findTakeoffMeasurement(measurementId);
            if (!info) return;
            const { measurement } = info;
            ensureMeasurementFields(measurement);

            if (action === 'toggle-subitems') {
                measurement.showSubItems = !measurement.showSubItems;
                renderTakeoffMeasurements();
            } else if (action === 'add-subitem') {
                const defaultQuantity = typeof measurement.itemQuantity === 'number' && !Number.isNaN(measurement.itemQuantity)
                    ? measurement.itemQuantity
                    : parseFloat(getTakeoffValue(measurement).toFixed(2));
                const defaultUnit = measurement.itemUnit || getTakeoffUnits(measurement);
                measurement.subItems.push({
                    id: createTakeoffId('subitem'),
                    label: '',
                    quantity: defaultQuantity,
                    unit: defaultUnit,
                    notes: ''
                });
                measurement.showSubItems = true;
                renderTakeoffMeasurements();
                updateTakeoffStatus('Sub-item added.');
            } else if (action === 'remove-subitem') {
                const subItemId = actionEl.dataset.subitemId;
                if (!subItemId) return;
                measurement.subItems = measurement.subItems.filter(subItem => subItem.id !== subItemId);
                if (!measurement.subItems.length) {
                    measurement.showSubItems = false;
                }
                renderTakeoffMeasurements();
                updateTakeoffStatus('Sub-item removed.');
            }
        }

        function findTakeoffMeasurement(id) {
            for (const page of state.takeoff.pages) {
                const measurement = page.measurements.find(item => item.id === id);
                if (measurement) {
                    return { measurement, page };
                }
            }
            return null;
        }

        function setTakeoffMode(mode) {
            state.takeoff.mode = mode;
            state.takeoff.points = [];
            state.takeoff.previewPoint = null;
            drawTakeoff();

            const instructions = {
                line: 'Click a start and end point to measure length.',
                perimeter: 'Click to add points and double-click to finish the perimeter.',
                area: 'Click to add vertices, then double-click to finish the area.',
                count: 'Click each item on the plan to add to the quantity.',
                diameter: 'Click two points to measure the diameter.'
            };
            updateTakeoffStatus(instructions[mode] || 'Select a drawing to begin measuring.');
        }

        function handleTakeoffCanvasClick(event) {
            const canvas = state.takeoff.canvas;
            const page = getActiveTakeoffPage();
            if (!canvas || !page || canvas.width === 0 || canvas.height === 0) {
                showToast('Select a drawing page first.', 'warning');
                return;
            }

            const rect = canvas.getBoundingClientRect();
            const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            const mode = state.takeoff.mode;

            if (mode === 'count') {
                finalizeCountMeasurement(point);
                return;
            }

            state.takeoff.points.push(point);

            if (mode === 'line' && state.takeoff.points.length === 2) {
                finalizeLinearMeasurement('line');
            } else if (mode === 'diameter' && state.takeoff.points.length === 2) {
                finalizeLinearMeasurement('diameter');
            } else if ((mode === 'area' || mode === 'perimeter') && state.takeoff.points.length >= 2) {
                updateTakeoffStatus('Double-click to complete the measurement.');
                drawTakeoff();
            } else {
                drawTakeoff();
            }
        }

        function finalizeCountMeasurement(point) {
            const page = getActiveTakeoffPage();
            if (!page) return;
            const measurement = {
                id: createTakeoffId('measurement'),
                type: 'count',
                label: `Count ${state.takeoff.counters.count++}`,
                points: [point],
                count: 1,
                pageId: page.id,
                trade: page.trade,
                floor: page.floor,
                method: page.method
            };
            addTakeoffMeasurement(measurement);
            updateTakeoffStatus(`${measurement.label} saved.`);
        }

        function finalizeLinearMeasurement(type) {
            const page = getActiveTakeoffPage();
            if (!page) return;
            const [start, end] = state.takeoff.points;
            const pixels = Math.hypot(end.x - start.x, end.y - start.y);
            const measurement = {
                id: createTakeoffId('measurement'),
                type,
                label: `${type === 'diameter' ? 'Diameter' : 'Line'} ${state.takeoff.counters[type]++}`,
                points: [start, end],
                pixels,
                pageId: page.id,
                trade: page.trade,
                floor: page.floor,
                method: page.method || (type === 'line' ? 'Linear' : 'Diameter')
            };
            state.takeoff.points = [];
            state.takeoff.previewPoint = null;
            addTakeoffMeasurement(measurement);
            const value = getTakeoffValue(measurement).toFixed(2);
            updateTakeoffStatus(`${measurement.label} saved: ${value} ${getTakeoffUnits(measurement)}.`);
        }

        function finalizeAreaMeasurement() {
            const page = getActiveTakeoffPage();
            const mode = state.takeoff.mode;
            if (!page || state.takeoff.points.length < 3) return;
            const points = [...state.takeoff.points];
            const measurement = {
                id: createTakeoffId('measurement'),
                type: mode,
                label: `${mode === 'perimeter' ? 'Perimeter' : 'Area'} ${state.takeoff.counters[mode]++}`,
                points,
                pixelArea: calculatePolygonArea(points),
                pixelPerimeter: calculatePolygonPerimeter(points),
                pageId: page.id,
                trade: page.trade,
                floor: page.floor,
                method: page.method || (mode === 'area' ? 'Area' : 'Perimeter')
            };
            state.takeoff.points = [];
            state.takeoff.previewPoint = null;
            addTakeoffMeasurement(measurement);
            const value = getTakeoffValue(measurement).toFixed(2);
            updateTakeoffStatus(`${measurement.label} saved: ${value} ${getTakeoffUnits(measurement)}.`);
        }

        function handleTakeoffCanvasMove(event) {
            if (!state.takeoff.points.length) return;
            const canvas = state.takeoff.canvas;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            state.takeoff.previewPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            drawTakeoff();
        }

        function handleTakeoffCanvasLeave() {
            state.takeoff.previewPoint = null;
            drawTakeoff();
        }

        function handleTakeoffCanvasDoubleClick() {
            if (state.takeoff.mode === 'area' || state.takeoff.mode === 'perimeter') {
                finalizeAreaMeasurement();
            }
        }

        function addTakeoffMeasurement(measurement) {
            const page = state.takeoff.pages.find(p => p.id === measurement.pageId);
            if (!page) return;
            ensureMeasurementFields(measurement);
            page.measurements.push(measurement);
            renderTakeoffMeasurements();
            renderTakeoffFilters();
            drawTakeoff();
        }

        function drawTakeoff() {
            const canvas = state.takeoff.canvas;
            const ctx = state.takeoff.context;
            if (!canvas || !ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const page = getActiveTakeoffPage();
            if (page) {
                page.measurements.forEach((measurement, index) => {
                    drawMeasurement(ctx, measurement, index);
                });
            }

            if (state.takeoff.points.length) {
                ctx.save();
                ctx.strokeStyle = '#f97316';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                ctx.beginPath();
                ctx.moveTo(state.takeoff.points[0].x, state.takeoff.points[0].y);
                for (let i = 1; i < state.takeoff.points.length; i++) {
                    ctx.lineTo(state.takeoff.points[i].x, state.takeoff.points[i].y);
                }
                if (state.takeoff.previewPoint) {
                    ctx.lineTo(state.takeoff.previewPoint.x, state.takeoff.previewPoint.y);
                }
                ctx.stroke();
                ctx.setLineDash([]);
                state.takeoff.points.forEach(point => drawHandle(ctx, point));
                if (state.takeoff.previewPoint) {
                    drawHandle(ctx, state.takeoff.previewPoint, true);
                }
                ctx.restore();
            }
        }

        function drawMeasurement(ctx, measurement, index) {
            const color = TAKEOFF_COLORS[index % TAKEOFF_COLORS.length];
            ctx.save();
            if (measurement.type === 'line' || measurement.type === 'diameter') {
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(measurement.points[0].x, measurement.points[0].y);
                ctx.lineTo(measurement.points[1].x, measurement.points[1].y);
                ctx.stroke();
                measurement.points.forEach(point => drawHandle(ctx, point));
                const midX = (measurement.points[0].x + measurement.points[1].x) / 2;
                const midY = (measurement.points[0].y + measurement.points[1].y) / 2;
                drawMeasurementLabel(ctx, midX, midY, `${getTakeoffValue(measurement).toFixed(2)} ${getTakeoffUnits(measurement)}`);
            } else if (measurement.type === 'area' || measurement.type === 'perimeter') {
                ctx.strokeStyle = color;
                ctx.fillStyle = measurement.type === 'area' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(15, 118, 110, 0.15)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(measurement.points[0].x, measurement.points[0].y);
                for (let i = 1; i < measurement.points.length; i++) {
                    ctx.lineTo(measurement.points[i].x, measurement.points[i].y);
                }
                ctx.closePath();
                if (measurement.type === 'area') ctx.fill();
                ctx.stroke();
                measurement.points.forEach(point => drawHandle(ctx, point));
                const centroid = calculateCentroid(measurement.points);
                drawMeasurementLabel(ctx, centroid.x, centroid.y, `${getTakeoffValue(measurement).toFixed(2)} ${getTakeoffUnits(measurement)}`);
            } else if (measurement.type === 'count') {
                const point = measurement.points[0];
                drawHandle(ctx, point);
                drawMeasurementLabel(ctx, point.x, point.y, measurement.label);
            }
            ctx.restore();
        }

        function drawHandle(ctx, point, preview = false) {
            ctx.save();
            ctx.fillStyle = preview ? '#f97316' : '#1f2937';
            ctx.beginPath();
            ctx.arc(point.x, point.y, preview ? 5 : 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        function drawMeasurementLabel(ctx, x, y, text) {
            const canvas = state.takeoff.canvas;
            if (!canvas) return;
            ctx.save();
            ctx.font = '12px Inter, sans-serif';
            ctx.textBaseline = 'top';
            const padding = 4;
            const metrics = ctx.measureText(text);
            const textWidth = metrics.width;
            const textHeight = (metrics.actualBoundingBoxAscent || 9) + (metrics.actualBoundingBoxDescent || 3);
            const bgX = Math.min(Math.max(0, x - textWidth / 2 - padding), canvas.width - textWidth - padding * 2);
            const bgY = Math.min(Math.max(0, y - textHeight / 2 - padding), canvas.height - textHeight - padding * 2);
            ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
            ctx.fillRect(bgX, bgY, textWidth + padding * 2, textHeight + padding * 2);
            ctx.fillStyle = 'white';
            ctx.fillText(text, bgX + padding, bgY + padding);
            ctx.restore();
        }

        function calculateCentroid(points) {
            let area = 0;
            let cx = 0;
            let cy = 0;
            for (let i = 0; i < points.length; i++) {
                const j = (i + 1) % points.length;
                const cross = points[i].x * points[j].y - points[j].x * points[i].y;
                area += cross;
                cx += (points[i].x + points[j].x) * cross;
                cy += (points[i].y + points[j].y) * cross;
            }
            area *= 0.5;
            if (Math.abs(area) < 1e-5) {
                const avgX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
                const avgY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
                return { x: avgX, y: avgY };
            }
            return { x: cx / (6 * area), y: cy / (6 * area) };
        }

        function calculatePolygonArea(points) {
            let area = 0;
            for (let i = 0; i < points.length; i++) {
                const j = (i + 1) % points.length;
                area += points[i].x * points[j].y - points[j].x * points[i].y;
            }
            return Math.abs(area) / 2;
        }

        function calculatePolygonPerimeter(points) {
            let perimeter = 0;
            for (let i = 0; i < points.length; i++) {
                const j = (i + 1) % points.length;
                perimeter += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
            }
            return perimeter;
        }

        function getTakeoffValue(measurement) {
            const page = state.takeoff.pages.find(p => p.id === measurement.pageId);
            const scale = page?.scale > 0 ? page.scale : 1;
            if (measurement.type === 'line' || measurement.type === 'diameter') {
                return measurement.pixels / scale;
            }
            if (measurement.type === 'area') {
                return measurement.pixelArea / (scale * scale);
            }
            if (measurement.type === 'perimeter') {
                return measurement.pixelPerimeter / scale;
            }
            if (measurement.type === 'count') {
                return measurement.count || 1;
            }
            return 0;
        }

        function getTakeoffUnits(measurement) {
            if (measurement.type === 'area') return 'sq ft';
            if (measurement.type === 'perimeter') return 'ft';
            if (measurement.type === 'count') return 'ea';
            return 'ft';
        }

        function getTakeoffDetails(measurement) {
            const page = state.takeoff.pages.find(p => p.id === measurement.pageId);
            const scale = page?.scale > 0 ? page.scale : 1;
            if (measurement.type === 'area') {
                const perimeter = measurement.pixelPerimeter / scale;
                return `Perimeter: ${perimeter.toFixed(2)} ft`;
            }
            if (measurement.type === 'perimeter') {
                return `Segments: ${measurement.points.length}`;
            }
            return '';
        }

        function formatTakeoffModeLabel(type) {
            const labels = {
                line: 'Line',
                area: 'Area',
                count: 'Count',
                diameter: 'Diameter',
                perimeter: 'Perimeter'
            };
            return labels[type] || type;
        }

        function updateTakeoffStatus(message) {
            const statusEl = document.getElementById('takeoffStatus');
            if (!statusEl) return;
            statusEl.textContent = message;
        }

        function exportTakeoffCsv() {
            const measurements = getAllTakeoffMeasurements();
            if (!measurements.length) {
                showToast('No takeoff data available to export.', 'warning');
                return;
            }

            const rows = [['Item', 'Description', 'Notes', 'Page', 'Trade', 'Floor', 'Method', 'Mode', 'Quantity', 'Units', 'Measured Details', 'Sub Items']];
            measurements.forEach(({ measurement, page }) => {
                ensureMeasurementFields(measurement);
                const measuredValue = getTakeoffValue(measurement).toFixed(2);
                const measuredUnits = getTakeoffUnits(measurement);
                const measuredDetails = getTakeoffDetails(measurement);
                const quantity = typeof measurement.itemQuantity === 'number' && !Number.isNaN(measurement.itemQuantity)
                    ? measurement.itemQuantity
                    : measuredValue;
                const description = (measurement.itemDescription && measurement.itemDescription.trim()) || measurement.label;
                const notes = measurement.itemNotes && measurement.itemNotes.trim() ? measurement.itemNotes.trim() : '';
                const subItems = measurement.subItems.map(subItem => {
                    const label = subItem.label && subItem.label.trim() ? subItem.label.trim() : 'Sub-item';
                    const quantityParts = [];
                    if (typeof subItem.quantity === 'number' && !Number.isNaN(subItem.quantity)) {
                        quantityParts.push(subItem.quantity);
                    }
                    if (subItem.unit) {
                        quantityParts.push(subItem.unit);
                    }
                    const quantityText = quantityParts.length ? ` (${quantityParts.join(' ')})` : '';
                    const subNotes = subItem.notes && subItem.notes.trim() ? ` - ${subItem.notes.trim()}` : '';
                    return `${label}${quantityText}${subNotes}`;
                }).join('; ');
                rows.push([
                    measurement.label,
                    description,
                    notes,
                    page.name || 'Untitled Page',
                    measurement.trade || '',
                    measurement.floor || '',
                    measurement.method || '',
                    formatTakeoffModeLabel(measurement.type),
                    quantity,
                    measurement.itemUnit || measuredUnits,
                    measuredDetails ? `${measuredValue} ${measuredUnits} • ${measuredDetails}` : `${measuredValue} ${measuredUnits}`,
                    subItems
                ]);
            });

            const csvContent = rows
                .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
                .join('\r\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `takeoff-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            showToast('Takeoff CSV exported!', 'success');
        }

        function pushTakeoffToEstimate() {
            const measurements = getAllTakeoffMeasurements();
            if (!measurements.length) {
                showToast('No takeoff data to send to the estimate.', 'warning');
                return;
            }

            ensureTakeoffCategory();
            measurements.forEach(({ measurement }) => {
                ensureMeasurementFields(measurement);
                const measuredValue = parseFloat(getTakeoffValue(measurement).toFixed(2));
                const quantity = typeof measurement.itemQuantity === 'number' && !Number.isNaN(measurement.itemQuantity)
                    ? measurement.itemQuantity
                    : measuredValue;
                const description = (measurement.itemDescription && measurement.itemDescription.trim()) || measurement.label;
                const notes = measurement.itemNotes && measurement.itemNotes.trim() ? ` (${measurement.itemNotes.trim()})` : '';

                addLineItem({
                    category: 'Takeoff Measurements',
                    description: `${description}${notes}`,
                    quantity,
                    unit: measurement.itemUnit || getTakeoffUnits(measurement),
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

        function ensureTakeoffCategory() {
            if (!state.lineItemCategories['Takeoff Measurements']) {
                state.lineItemCategories['Takeoff Measurements'] = [];
            }
            const category = state.lineItemCategories['Takeoff Measurements'];
            getAllTakeoffMeasurements().forEach(({ measurement }) => {
                ensureMeasurementFields(measurement);
                const baseName = (measurement.itemDescription && measurement.itemDescription.trim()) || measurement.label;
                const baseUnit = measurement.itemUnit || getTakeoffUnits(measurement);
                const ensureItem = (name, unit) => {
                    if (!name) return;
                    const existing = category.find(item => item.name === name);
                    if (!existing) {
                        category.push({ name, unit: unit || '', rate: 0 });
                    } else if (unit) {
                        existing.unit = unit;
                    }
                };

                ensureItem(baseName, baseUnit);
                measurement.subItems.forEach(subItem => {
                    const subName = (subItem.label && subItem.label.trim()) || `${baseName} - Sub-item`;
                    ensureItem(subName, subItem.unit || '');
                });
            });
        }

        function createTakeoffId(prefix) {
            return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        }

        function createMeasurementId() {
            return createTakeoffId('measurement');
        }

        function prepareTakeoffCanvas(width, height) {
            const canvas = state.takeoff.canvas;
            if (!canvas) return;
            const resolvedWidth = Math.max(1, Math.round(width || 0));
            const resolvedHeight = Math.max(1, Math.round(height || 0));
            canvas.width = resolvedWidth;
            canvas.height = resolvedHeight;
            canvas.style.width = `${resolvedWidth}px`;
            canvas.style.height = `${resolvedHeight}px`;
            state.takeoff.context = canvas.getContext('2d');
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
            tableBody.innerHTML = '';
            Object.entries(state.materialPrices).forEach(([category, materials]) => {
                Object.entries(materials).forEach(([name, price]) => {
                    const row = tableBody.insertRow();
                    const trend = Math.random() > 0.5 ? '▲' : '▼';
                    const trendColor = trend === '▲' ? 'var(--danger)' : 'var(--success)';
                    row.innerHTML = `
                        <td>${name.charAt(0).toUpperCase() + name.slice(1)}</td>
                        <td>${category.charAt(0).toUpperCase() + category.slice(1)}</td>
                        <td>${formatCurrency(price)}</td>
                        <td>sqft</td>
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
        function checkForUpdatesOnLoad() {
            setTimeout(() => {
                openModal('updateModal');
            }, 3000);
        }
        
        function checkForUpdates() {
            const syncBadge = document.getElementById('syncStatus');
            syncBadge.classList.add('syncing');
            syncBadge.querySelector('span').textContent = 'Checking...';
            
            setTimeout(() => {
                syncBadge.classList.remove('syncing');
                openModal('updateModal');
            }, 2000);
        }

        function applyUpdate() {
            const syncBadge = document.getElementById('syncStatus');
            syncBadge.classList.add('syncing');
            syncBadge.querySelector('span').textContent = 'Updating...';
            
            setTimeout(() => {
                state.materialPrices.framing.wood *= 0.95;
                state.materialPrices.framing.steel *= 1.03;
                
                closeModal('updateModal');
                populateMaterialsTable();
                
                syncBadge.classList.remove('syncing');
                syncBadge.classList.add('success');
                syncBadge.querySelector('span').textContent = 'Database Synced';
                
                showToast('Material database updated!', 'success');
                
                setTimeout(() => syncBadge.classList.remove('success'), 3000);
            }, 2500);
        }
        
        // --- RUN APP ---
        document.addEventListener('DOMContentLoaded', async () => {
            await loadDatabase();
            init();
        });

    })();

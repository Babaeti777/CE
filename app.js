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
                scale: 1,
                points: [],
                records: [],
                counter: 1
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
            setupNavigation();
            populateMaterialsTable();
            loadProjects();
            updateDashboard();
            initCharts();
            checkForUpdatesOnLoad();
            setupTakeoffTools();
            renderTakeoffRecords();
            updateTakeoffMeasurementDisplay();

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
            document.getElementById("planUpload")?.addEventListener("change", handlePlanUpload);
            document.getElementById('planScale')?.addEventListener('input', handlePlanScaleChange);
            document.getElementById('takeoffMode')?.addEventListener('change', (e) => setTakeoffMode(e.target.value));
            document.getElementById('completeMeasurementBtn')?.addEventListener('click', completeTakeoffMeasurement);
            document.getElementById('undoTakeoffPointBtn')?.addEventListener('click', undoTakeoffPoint);
            document.getElementById('clearTakeoffBtn')?.addEventListener('click', clearTakeoffMeasurements);
            document.getElementById('exportTakeoffCsvBtn')?.addEventListener('click', exportTakeoffCsv);
            document.getElementById('takeoffRecordsBody')?.addEventListener('input', handleTakeoffRecordInput);
            document.getElementById('takeoffRecordsBody')?.addEventListener('click', handleTakeoffRecordClick);
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
            state.lineItemId++;
            const div = document.createElement('div');
            div.className = 'line-item-row';
            div.dataset.id = state.lineItemId;
            
            const categoryOptions = Object.keys(state.lineItemCategories).map(cat => `<option value="${cat}">${cat}</option>`).join('');
            
            div.innerHTML = `
                <select class="form-select" data-field="category">${categoryOptions}</select>
                <select class="form-select" data-field="description"></select>
                <input type="number" class="form-input" data-field="quantity" placeholder="Qty" value="${item ? item.quantity : 1}" min="0">
                <input type="text" class="form-input" data-field="unit" placeholder="Unit" value="${item ? item.unit : ''}">
                <input type="number" class="form-input" data-field="rate" placeholder="Rate" value="${item ? item.rate : 0}" step="0.01" min="0">
                <div class="line-item-total" style="font-weight: 600; text-align: right;">${formatCurrency(item ? item.total : 0)}</div>
                <button class="btn btn-ghost remove-line-item">&times;</button>
            `;
            
            document.getElementById('lineItems').appendChild(div);
            updateItemSelectionOptions(div);
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

        async function handlePlanUpload(e) {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
                clearTakeoffMeasurements(false);

                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                    if (!pdfjsLib) {
                        showToast('PDF viewer is unavailable in this browser.', 'error');
                        return;
                    }

                    const arrayBuffer = await file.arrayBuffer();
                    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                    const page = await pdf.getPage(1);
                    const viewport = page.getViewport({ scale: 1 });
                    const targetWidth = 1100;
                    const scale = Math.min(2.5, targetWidth / viewport.width);
                    const scaledViewport = page.getViewport({ scale });
                    const canvasEl = document.createElement('canvas');
                    const context = canvasEl.getContext('2d');
                    canvasEl.width = scaledViewport.width;
                    canvasEl.height = scaledViewport.height;
                    await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
                    const dataUrl = canvasEl.toDataURL('image/png');
                    displayPlanImage(dataUrl, false);
                } else {
                    const objectUrl = URL.createObjectURL(file);
                    displayPlanImage(objectUrl, true);
                }

                e.target.value = '';
                showToast('Plan loaded successfully. Start placing measurement points.', 'success');
            } catch (error) {
                console.error('Error loading plan:', error);
                showToast('Failed to load plan. Please try again.', 'error');
            }
        }

        function displayPlanImage(src, revokeAfterLoad) {
            const img = document.getElementById('planPreview');
            const container = document.getElementById('planContainer');
            const canvas = document.getElementById('takeoffCanvas');
            if (!img || !container || !canvas) return;

            img.onload = () => {
                if (revokeAfterLoad) {
                    URL.revokeObjectURL(src);
                }
                container.style.display = 'block';
                syncTakeoffCanvasSize();
                resetTakeoffDrawing();
            };

            img.onerror = () => {
                if (revokeAfterLoad) {
                    URL.revokeObjectURL(src);
                }
                container.style.display = 'none';
                showToast('Unable to display the selected plan.', 'error');
            };

            img.src = src;
            img.style.display = 'block';
        }

        function setupTakeoffTools() {
            const canvas = document.getElementById('takeoffCanvas');
            if (!canvas) return;
            canvas.addEventListener('click', handleTakeoffCanvasClick);
            window.addEventListener('resize', syncTakeoffCanvasSize);

            const modeSelect = document.getElementById('takeoffMode');
            if (modeSelect) {
                modeSelect.value = state.takeoff.mode;
            }

            const scaleInput = document.getElementById('planScale');
            if (scaleInput) {
                scaleInput.value = state.takeoff.scale;
            }
        }

        function syncTakeoffCanvasSize() {
            const img = document.getElementById('planPreview');
            const canvas = document.getElementById('takeoffCanvas');
            if (!img || !canvas || img.style.display === 'none') return;

            const rect = img.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            canvas.width = rect.width;
            canvas.height = rect.height;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
            renderTakeoffCanvas();
        }

        function handlePlanScaleChange(e) {
            const value = parseFloat(e.target.value);
            if (!Number.isFinite(value) || value <= 0) {
                if (e.target.value !== '') {
                    showToast('Scale must be a positive number.', 'warning');
                }
                return;
            }
            state.takeoff.scale = value;
            updateTakeoffMeasurementDisplay();
        }

        function setTakeoffMode(mode) {
            state.takeoff.mode = mode;
            resetTakeoffDrawing();
            updateTakeoffMeasurementDisplay();
        }

        function handleTakeoffCanvasClick(event) {
            const canvas = event.currentTarget;
            const rect = canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            state.takeoff.points.push({ x, y });
            renderTakeoffCanvas();
            updateTakeoffMeasurementDisplay();
        }

        function completeTakeoffMeasurement() {
            const mode = state.takeoff.mode;
            const points = state.takeoff.points;

            if (mode === 'count' && points.length === 0) {
                showToast('Place at least one marker to record a count.', 'warning');
                return;
            }

            if ((mode === 'line' || mode === 'perimeter') && points.length < 2) {
                showToast('Place at least two points to measure a line.', 'warning');
                return;
            }

            if (mode === 'area' && points.length < 3) {
                showToast('Place at least three points to measure an area.', 'warning');
                return;
            }

            const value = calculateMeasurementFromPoints(points, mode);
            if (value === null) {
                showToast('Set a valid scale before recording measurements.', 'error');
                return;
            }

            const record = {
                id: Date.now(),
                name: `Measurement ${state.takeoff.counter++}`,
                type: mode,
                value,
                unit: getTakeoffUnit(mode),
                points: points.map(pt => ({ ...pt })),
                color: TAKEOFF_COLORS[state.takeoff.records.length % TAKEOFF_COLORS.length]
            };

            state.takeoff.records.push(record);
            state.takeoff.points = [];
            renderTakeoffRecords();
            renderTakeoffCanvas();
            updateTakeoffMeasurementDisplay();
            showToast('Measurement saved to the takeoff log.', 'success');
        }

        function undoTakeoffPoint() {
            if (state.takeoff.points.length === 0) {
                showToast('No points to undo.', 'warning');
                return;
            }
            state.takeoff.points.pop();
            renderTakeoffCanvas();
            updateTakeoffMeasurementDisplay();
        }

        function clearTakeoffMeasurements(notify = true) {
            state.takeoff.points = [];
            state.takeoff.records = [];
            state.takeoff.counter = 1;
            renderTakeoffCanvas();
            renderTakeoffRecords();
            updateTakeoffMeasurementDisplay();
            if (notify) {
                showToast('All takeoff measurements cleared.', 'success');
            }
        }

        function resetTakeoffDrawing() {
            state.takeoff.points = [];
            renderTakeoffCanvas();
            updateTakeoffMeasurementDisplay();
        }

        function calculateMeasurementFromPoints(points, mode, preview = false) {
            if (mode === 'count') {
                return points.length;
            }

            const scale = state.takeoff.scale;
            if (!Number.isFinite(scale) || scale <= 0) {
                return null;
            }

            if (points.length < 2) {
                return preview ? 0 : null;
            }

            if (mode === 'line') {
                return roundMeasurement(sumSegmentLengths(points));
            }

            if (mode === 'perimeter') {
                if (points.length < 3 && !preview) {
                    return null;
                }
                const total = sumSegmentLengths(points) + (points.length > 2 ? distanceInFeet(points[points.length - 1], points[0]) : 0);
                return roundMeasurement(total);
            }

            if (mode === 'area') {
                if (points.length < 3) {
                    return preview ? 0 : null;
                }
                const area = polygonAreaInFeet(points);
                return roundMeasurement(area, true);
            }

            return null;
        }

        function sumSegmentLengths(points) {
            let total = 0;
            for (let i = 1; i < points.length; i++) {
                total += distanceInFeet(points[i - 1], points[i]);
            }
            return total;
        }

        function distanceInFeet(a, b) {
            const scale = state.takeoff.scale;
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            return distance / scale;
        }

        function polygonAreaInFeet(points) {
            const scale = state.takeoff.scale;
            let sum = 0;
            for (let i = 0; i < points.length; i++) {
                const current = points[i];
                const next = points[(i + 1) % points.length];
                sum += current.x * next.y - next.x * current.y;
            }
            const areaPixels = Math.abs(sum) / 2;
            return areaPixels / (scale * scale);
        }

        function roundMeasurement(value, isArea = false) {
            const precision = isArea ? 2 : 2;
            return Number(value.toFixed(precision));
        }

        function getTakeoffUnit(mode) {
            if (mode === 'area') return 'sq ft';
            if (mode === 'count') return 'count';
            return 'ft';
        }

        function renderTakeoffCanvas() {
            const canvas = document.getElementById('takeoffCanvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            state.takeoff.records.forEach(record => {
                drawTakeoffShape(ctx, record.points, record.type, record.color, false);
            });

            drawTakeoffShape(ctx, state.takeoff.points, state.takeoff.mode, '#ff6b35', true);
        }

        function drawTakeoffShape(ctx, points, mode, color, isCurrent) {
            if (!points || points.length === 0) return;

            ctx.save();
            ctx.lineWidth = isCurrent ? 2 : 1.5;
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.globalAlpha = isCurrent ? 0.9 : 0.45;

            if (mode === 'count') {
                points.forEach(pt => {
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, isCurrent ? 6 : 5, 0, Math.PI * 2);
                    ctx.fill();
                });
            } else {
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
                if ((mode === 'perimeter' || mode === 'area') && points.length > 2) {
                    ctx.closePath();
                }
                ctx.stroke();

                if ((mode === 'area' || mode === 'perimeter') && points.length > 2) {
                    ctx.globalAlpha = isCurrent ? 0.15 : 0.18;
                    ctx.fill();
                }
            }

            ctx.globalAlpha = 1;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            points.forEach(pt => {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });

            ctx.restore();
        }

        function renderTakeoffRecords() {
            const tbody = document.getElementById('takeoffRecordsBody');
            const section = document.getElementById('takeoffRecordsSection');
            if (!tbody || !section) return;

            tbody.innerHTML = '';

            state.takeoff.records.forEach(record => {
                const row = document.createElement('tr');
                row.dataset.id = String(record.id);

                const nameCell = document.createElement('td');
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'form-input takeoff-name-input';
                nameInput.value = record.name;
                nameCell.appendChild(nameInput);

                const typeCell = document.createElement('td');
                typeCell.textContent = capitalize(record.type);

                const qtyCell = document.createElement('td');
                qtyCell.textContent = record.unit === 'count'
                    ? `${formatMeasurement(record.value, record.unit)}`
                    : `${formatMeasurement(record.value, record.unit)} ${record.unit}`;

                const actionCell = document.createElement('td');
                actionCell.style.display = 'flex';
                actionCell.style.gap = '0.5rem';
                actionCell.style.flexWrap = 'wrap';

                const addBtn = document.createElement('button');
                addBtn.className = 'btn btn-secondary takeoff-add-btn';
                addBtn.textContent = 'Add to Estimate';

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'btn btn-ghost takeoff-delete-btn';
                deleteBtn.textContent = 'Remove';

                actionCell.appendChild(addBtn);
                actionCell.appendChild(deleteBtn);

                row.appendChild(nameCell);
                row.appendChild(typeCell);
                row.appendChild(qtyCell);
                row.appendChild(actionCell);

                tbody.appendChild(row);
            });

            section.style.display = state.takeoff.records.length ? 'block' : 'none';
        }

        function formatMeasurement(value, unit) {
            if (unit === 'count') {
                return String(value);
            }
            return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        function capitalize(str) {
            return str.charAt(0).toUpperCase() + str.slice(1);
        }

        function updateTakeoffMeasurementDisplay() {
            const measurementEl = document.getElementById('takeoffMeasurement');
            if (!measurementEl) return;

            if (state.takeoff.points.length === 0) {
                measurementEl.textContent = 'Click on the plan to start a measurement.';
                return;
            }

            const value = calculateMeasurementFromPoints(state.takeoff.points, state.takeoff.mode, true);
            if (value === null) {
                measurementEl.textContent = 'Enter a valid scale to calculate measurements.';
                return;
            }

            const unit = getTakeoffUnit(state.takeoff.mode);
            const label = state.takeoff.mode === 'line'
                ? 'Current length'
                : state.takeoff.mode === 'perimeter'
                    ? 'Current perimeter'
                    : state.takeoff.mode === 'area'
                        ? 'Current area'
                        : 'Current count';
            const measurementText = unit === 'count'
                ? `${formatMeasurement(value, unit)}`
                : `${formatMeasurement(value, unit)} ${unit}`;
            measurementEl.textContent = `${label}: ${measurementText}`;
        }

        function handleTakeoffRecordInput(event) {
            const input = event.target;
            if (!input.classList.contains('takeoff-name-input')) return;

            const row = input.closest('tr');
            if (!row) return;
            const id = Number(row.dataset.id);
            const record = state.takeoff.records.find(r => r.id === id);
            if (record) {
                record.name = input.value;
            }
        }

        function handleTakeoffRecordClick(event) {
            const button = event.target.closest('button');
            if (!button) return;

            const row = button.closest('tr');
            if (!row) return;
            const id = Number(row.dataset.id);

            if (button.classList.contains('takeoff-add-btn')) {
                applyMeasurementToEstimate(id);
            } else if (button.classList.contains('takeoff-delete-btn')) {
                removeTakeoffRecord(id);
            }
        }

        function removeTakeoffRecord(id) {
            const index = state.takeoff.records.findIndex(r => r.id === id);
            if (index === -1) return;
            state.takeoff.records.splice(index, 1);
            renderTakeoffRecords();
            renderTakeoffCanvas();
            showToast('Measurement removed.', 'success');
        }

        function applyMeasurementToEstimate(id) {
            const record = state.takeoff.records.find(r => r.id === id);
            if (!record) return;

            const quantity = record.unit === 'count' ? record.value : Number(record.value.toFixed(2));

            if (state.lastFocusedInput && state.lastFocusedInput.closest('.line-item-row')) {
                const row = state.lastFocusedInput.closest('.line-item-row');
                const quantityInput = row.querySelector('[data-field="quantity"]');
                if (quantityInput) {
                    quantityInput.value = quantity;
                }
                const unitInput = row.querySelector('[data-field="unit"]');
                if (unitInput) {
                    unitInput.value = record.unit;
                }
                updateLineItemTotal(row);
                showToast(`Applied "${record.name}" to the selected line item.`, 'success');
                return;
            }

            addLineItem();
            const rows = document.querySelectorAll('.line-item-row');
            const newRow = rows[rows.length - 1];
            if (newRow) {
                const quantityInput = newRow.querySelector('[data-field="quantity"]');
                if (quantityInput) {
                    quantityInput.value = quantity;
                }
                const unitInput = newRow.querySelector('[data-field="unit"]');
                if (unitInput) {
                    unitInput.value = record.unit;
                }
                updateLineItemTotal(newRow);
            }

            showToast(`Added "${record.name}" to a new line item. Adjust details as needed.`, 'success');
        }

        function exportTakeoffCsv() {
            if (!state.takeoff.records.length) {
                showToast('No measurements to export.', 'warning');
                return;
            }

            let csvContent = 'data:text/csv;charset=utf-8,';
            csvContent += 'Name,Type,Quantity,Unit\r\n';

            state.takeoff.records.forEach(record => {
                const quantity = record.unit === 'count' ? record.value : record.value.toFixed(2);
                csvContent += `"${record.name.replace(/"/g, '""')}","${capitalize(record.type)}",${quantity},"${record.unit}"\r\n`;
            });

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', 'takeoff-measurements.csv');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('Takeoff measurements exported as CSV.', 'success');
        }

        // --- REPORTING & EXPORTING ---
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

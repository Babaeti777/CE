import { LifecycleManager } from './services/lifecycle-manager.js';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';

if (pdfjsLib?.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.mjs';
    pdfjsLib.GlobalWorkerOptions.workerType = 'module';
}

const SUPPORTED_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/svg+xml'
]);

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;

function createId(prefix = 'drawing') {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).replace(/[&<>'"]/g, (char) => {
        switch (char) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case "'":
                return '&#39;';
            default:
                return char;
        }
    });
}

function formatMeta(drawing) {
    if (!drawing) {
        return '';
    }
    const parts = [drawing.name];
    if (drawing.trade) parts.push(drawing.trade);
    if (drawing.floor) parts.push(`Floor ${drawing.floor}`);
    if (drawing.page) parts.push(`Page ${drawing.page}`);
    if (drawing.type === 'pdf' && drawing.totalPages) {
        parts.push(`${drawing.totalPages} page${drawing.totalPages > 1 ? 's' : ''}`);
    }
    return parts.filter(Boolean).join(' • ');
}

export class TakeoffManager {
    constructor({ toastService, estimateService, storageService } = {}) {
        this.services = {
            toast: typeof toastService === 'function'
                ? (message, type = 'info') => toastService(message, type)
                : (message, type = 'info') => console.info(`[${type}] ${message}`),
            estimate: estimateService || null,
            storage: storageService || null
        };

        this.lifecycle = new LifecycleManager();
        this.elements = {};
        this.state = {
            drawings: [],
            filter: '',
            sortBy: 'trade',
            sortDir: 'asc',
            currentDrawingId: null,
            zoom: 1,
            isFullscreen: false,
            previewPoint: null
        };

        this.measurements = new Map();
        this.labelCounters = new Map();
        this.previewToken = 0;
        this.pointerSession = null;
        this.handlers = {
            windowResize: () => {
                this.applyZoom();
            }
        };
    }

    init() {
        this.cacheDom();
        this.bindEvents();
        this.renderDrawingList();
        this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
        this.updateZoomIndicator();
        this.updatePdfControls();
        this.updateFullscreenButton();
        this.updateStatus('Upload plan files to start measuring.');
        this.refreshMeasurementTable();
        this.updateQuickShapeFields();
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.handlers.windowResize);
        }
    }

    destroy() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.handlers.windowResize);
        }
        this.lifecycle?.cleanup?.();
        this.closePdfViewer({ silent: true });
        this.cleanupDrawings();
    }

    cacheDom() {
        const byId = (id) => document.getElementById(id);
        this.elements = {
            drawingInput: byId('takeoffDrawingInput'),
            sortSelect: byId('takeoffSortSelect'),
            sortDirection: byId('takeoffSortDirection'),
            searchInput: byId('takeoffSearchInput'),
            drawingTableBody: byId('takeoffDrawingTableBody'),
            drawingEmpty: byId('takeoffDrawingEmpty'),
            measurementTableBody: byId('takeoffMeasurementTableBody'),
            measurementEmpty: byId('takeoffMeasurementEmpty'),
            planContainer: byId('takeoffPlanContainer'),
            planInner: byId('takeoffPlanInner'),
            planPreview: byId('takeoffPlanPreview'),
            canvas: byId('takeoffCanvas'),
            zoomOutBtn: byId('takeoffZoomOutBtn'),
            zoomInBtn: byId('takeoffZoomInBtn'),
            zoomResetBtn: byId('takeoffZoomResetBtn'),
            zoomIndicator: byId('takeoffZoomIndicator'),
            status: byId('takeoffStatus'),
            activeMeta: byId('takeoffActiveMeta'),
            pdfControls: byId('takeoffPdfControls'),
            pdfPrevBtn: byId('takeoffPdfPrev'),
            pdfNextBtn: byId('takeoffPdfNext'),
            pdfPageInput: byId('takeoffPdfPageInput'),
            pdfPageTotal: byId('takeoffPdfPageTotal'),
            pdfOpenBtn: byId('takeoffPdfOpen'),
            pdfDownloadBtn: byId('takeoffPdfDownload'),
            openPdfBtn: byId('takeoffOpenPdfBtn'),
            pdfModal: byId('takeoffPdfModal'),
            pdfModalOverlay: byId('takeoffPdfModalOverlay'),
            pdfModalClose: byId('takeoffPdfModalClose'),
            pdfFrame: byId('takeoffPdfFrame'),
            fullscreenBtn: byId('takeoffFullscreenBtn'),
            fullScreenToggle: byId('takeoffFullScreenToggle'),
            quickCalcBtn: byId('takeoffQuickCalcBtn'),
            shapeSelect: byId('takeoffShapeSelect'),
            dim1Input: byId('takeoffDim1'),
            dim2Input: byId('takeoffDim2'),
            dim2Group: byId('takeoffDim2Group'),
            quickResult: byId('takeoffQuickResult'),
            clearBtn: byId('takeoffClearBtn'),
            exportCsvBtn: byId('takeoffExportCsvBtn'),
            pushBtn: byId('takeoffPushBtn')
        };
    }

    bindEvents() {
        const {
            drawingInput,
            sortSelect,
            sortDirection,
            searchInput,
            drawingTableBody,
            measurementTableBody,
            zoomOutBtn,
            zoomInBtn,
            zoomResetBtn,
            pdfPrevBtn,
            pdfNextBtn,
            pdfPageInput,
            pdfOpenBtn,
            pdfDownloadBtn,
            openPdfBtn,
            pdfModalOverlay,
            pdfModalClose,
            fullscreenBtn,
            fullScreenToggle,
            quickCalcBtn,
            shapeSelect,
            dim1Input,
            dim2Input,
            clearBtn,
            exportCsvBtn,
            pushBtn
        } = this.elements;

        this.lifecycle.addEventListener(drawingInput, 'change', (event) => this.handleDrawingUpload(event));
        this.lifecycle.addEventListener(sortSelect, 'change', (event) => {
            this.state.sortBy = event.target.value;
            this.renderDrawingList();
        });
        this.lifecycle.addEventListener(sortDirection, 'click', () => {
            this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
            this.renderDrawingList();
        });
        this.lifecycle.addEventListener(searchInput, 'input', (event) => {
            this.state.filter = event.target.value.toLowerCase();
            this.renderDrawingList();
        });
        this.lifecycle.addEventListener(drawingTableBody, 'click', (event) => this.handleDrawingTableClick(event));
        this.lifecycle.addEventListener(drawingTableBody, 'input', (event) => this.handleDrawingTableInput(event));
        this.lifecycle.addEventListener(measurementTableBody, 'click', (event) => this.handleMeasurementTableClick(event));

        this.lifecycle.addEventListener(zoomOutBtn, 'click', () => this.stepZoom(-ZOOM_STEP));
        this.lifecycle.addEventListener(zoomInBtn, 'click', () => this.stepZoom(ZOOM_STEP));
        this.lifecycle.addEventListener(zoomResetBtn, 'click', () => this.resetZoom());

        this.lifecycle.addEventListener(pdfPrevBtn, 'click', () => this.navigatePdfPage(-1));
        this.lifecycle.addEventListener(pdfNextBtn, 'click', () => this.navigatePdfPage(1));
        this.lifecycle.addEventListener(pdfPageInput, 'change', (event) => {
            const value = parseInt(event.target.value, 10);
            if (Number.isFinite(value)) {
                this.jumpToPdfPage(value);
            } else {
                this.updatePdfToolbar(this.getActiveDrawing());
            }
        });
        const openPdfHandler = () => this.openActivePdfInViewer();
        this.lifecycle.addEventListener(pdfOpenBtn, 'click', openPdfHandler);
        this.lifecycle.addEventListener(openPdfBtn, 'click', openPdfHandler);
        this.lifecycle.addEventListener(pdfDownloadBtn, 'click', () => this.downloadActivePdf());

        const closeModalHandler = () => this.closePdfViewer();
        this.lifecycle.addEventListener(pdfModalOverlay, 'click', closeModalHandler);
        this.lifecycle.addEventListener(pdfModalClose, 'click', closeModalHandler);

        this.lifecycle.addEventListener(fullscreenBtn, 'click', () => this.toggleFullscreen());
        this.lifecycle.addEventListener(fullScreenToggle, 'click', () => this.toggleFullscreen());
        this.lifecycle.addEventListener(document, 'keydown', (event) => {
            if (event.key === 'Escape' && this.state.isFullscreen) {
                this.setFullscreen(false);
            }
        });

        this.lifecycle.addEventListener(shapeSelect, 'change', () => this.handleQuickShapeChange());
        this.lifecycle.addEventListener(dim1Input, 'input', () => this.clearQuickResult());
        this.lifecycle.addEventListener(dim2Input, 'input', () => this.clearQuickResult());
        this.lifecycle.addEventListener(quickCalcBtn, 'click', (event) => {
            event?.preventDefault?.();
            this.handleQuickShapeCalc();
        });

        this.lifecycle.addEventListener(clearBtn, 'click', (event) => {
            event?.preventDefault?.();
            this.clearMeasurements();
        });
        this.lifecycle.addEventListener(exportCsvBtn, 'click', (event) => {
            event?.preventDefault?.();
            this.exportMeasurementsToCsv();
        });
        this.lifecycle.addEventListener(pushBtn, 'click', (event) => {
            event?.preventDefault?.();
            this.pushMeasurementsToEstimate();
        });
    }

    getMeasurementStore(drawingId, { create = false } = {}) {
        if (!drawingId) {
            return null;
        }
        let store = this.measurements.get(drawingId);
        if (!store) {
            if (!create) {
                return null;
            }
            store = { items: [] };
            this.measurements.set(drawingId, store);
            return store;
        }
        if (Array.isArray(store)) {
            store = { items: [...store] };
            this.measurements.set(drawingId, store);
        } else if (!Array.isArray(store.items)) {
            store.items = [];
        }
        return store;
    }

    getMeasurementItems(drawingId = this.state.currentDrawingId) {
        if (!drawingId) {
            return [];
        }
        const store = this.getMeasurementStore(drawingId);
        const items = this.normalizeMeasurements(store);
        if (!Array.isArray(items)) {
            return [];
        }
        return items;
    }

    prepareMeasurement(measurement) {
        if (!measurement || typeof measurement !== 'object') {
            return null;
        }
        if (!measurement.id) {
            measurement.id = createId('measurement');
        }
        return measurement;
    }

    setMeasurementItems(drawingId, items = []) {
        if (!drawingId) {
            return;
        }
        const store = this.getMeasurementStore(drawingId, { create: true });
        const normalized = Array.isArray(items)
            ? items.map((item) => this.prepareMeasurement(item)).filter(Boolean)
            : [];
        store.items = normalized;
        if (drawingId === this.state.currentDrawingId) {
            this.refreshMeasurementTable(drawingId);
        }
        this.drawMeasurements();
    }

    addMeasurement(drawingId, measurement) {
        if (!drawingId || !measurement) {
            return null;
        }
        const store = this.getMeasurementStore(drawingId, { create: true });
        const prepared = this.prepareMeasurement(measurement);
        if (!prepared) {
            return null;
        }
        store.items.push(prepared);
        if (drawingId === this.state.currentDrawingId) {
            this.refreshMeasurementTable(drawingId);
        }
        this.drawMeasurements();
        return prepared;
    }

    updateMeasurement(drawingId, measurementId, updates = {}) {
        if (!drawingId || !measurementId) {
            return null;
        }
        const store = this.getMeasurementStore(drawingId);
        if (!store) {
            return null;
        }
        const list = this.normalizeMeasurements(store);
        const measurement = list.find((item) => item.id === measurementId);
        if (!measurement) {
            return null;
        }
        Object.assign(measurement, updates);
        if (drawingId === this.state.currentDrawingId) {
            this.refreshMeasurementTable(drawingId);
        }
        this.drawMeasurements();
        return measurement;
    }

    removeMeasurement(drawingId, measurementId, { silent = false } = {}) {
        if (!drawingId || !measurementId) {
            return false;
        }
        const store = this.getMeasurementStore(drawingId);
        if (!store) {
            return false;
        }
        const list = this.normalizeMeasurements(store);
        const index = list.findIndex((item) => item.id === measurementId);
        if (index === -1) {
            return false;
        }
        list.splice(index, 1);
        if (drawingId === this.state.currentDrawingId) {
            this.refreshMeasurementTable(drawingId);
        }
        this.drawMeasurements();
        if (!silent) {
            this.updateStatus('Measurement removed.');
        }
        return true;
    }

    clearMeasurements(drawingId = this.state.currentDrawingId) {
        if (!drawingId) {
            this.services.toast('Select a drawing to clear measurements.', 'warning');
            return;
        }
        const store = this.getMeasurementStore(drawingId);
        const list = this.normalizeMeasurements(store);
        if (!list || list.length === 0) {
            this.updateStatus('No measurements to clear.');
            return;
        }
        store.items = [];
        if (drawingId === this.state.currentDrawingId) {
            this.refreshMeasurementTable(drawingId);
        }
        this.drawMeasurements();
        this.updateStatus('Measurements cleared.');
    }

    refreshMeasurementTable(drawingId = this.state.currentDrawingId) {
        const { measurementTableBody, measurementEmpty } = this.elements;
        if (!measurementTableBody) {
            return;
        }

        measurementTableBody.innerHTML = '';

        if (!drawingId || drawingId !== this.state.currentDrawingId) {
            if (measurementEmpty) {
                measurementEmpty.classList.toggle('is-hidden', false);
            }
            return;
        }

        const measurements = this.getMeasurementItems(drawingId);
        const fragment = document.createDocumentFragment();

        measurements.forEach((measurement) => {
            const prepared = this.prepareMeasurement(measurement);
            if (!prepared) {
                return;
            }
            const row = this.createMeasurementRow(prepared);
            this.updateMeasurementRow(row, prepared);
            fragment.appendChild(row);
        });

        measurementTableBody.appendChild(fragment);
        if (measurementEmpty) {
            measurementEmpty.classList.toggle('is-hidden', measurements.length > 0);
        }
    }

    createMeasurementRow(measurement) {
        const row = document.createElement('tr');
        row.dataset.id = measurement?.id || '';
        row.innerHTML = `
            <td class="takeoff-measurement-name"></td>
            <td class="takeoff-measurement-mode"></td>
            <td class="takeoff-measurement-quantity"></td>
            <td class="takeoff-measurement-units"></td>
            <td class="takeoff-measurement-details"></td>
            <td class="takeoff-measurement-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-action="remove">Remove</button>
            </td>
        `;
        return row;
    }

    updateMeasurementRow(row, measurement) {
        if (!row || !measurement) {
            return;
        }
        row.dataset.id = measurement.id || '';
        const nameCell = row.querySelector('.takeoff-measurement-name');
        const modeCell = row.querySelector('.takeoff-measurement-mode');
        const quantityCell = row.querySelector('.takeoff-measurement-quantity');
        const unitsCell = row.querySelector('.takeoff-measurement-units');
        const detailsCell = row.querySelector('.takeoff-measurement-details');

        if (nameCell) {
            nameCell.textContent = measurement.name || measurement.label || 'Measurement';
        }
        if (modeCell) {
            modeCell.textContent = measurement.mode || measurement.type || '';
        }
        if (quantityCell) {
            const value = measurement.quantity ?? measurement.value ?? measurement.area ?? null;
            quantityCell.textContent = this.formatMeasurementValue(value);
        }
        if (unitsCell) {
            unitsCell.textContent = measurement.units || measurement.unit || '';
        }
        if (detailsCell) {
            detailsCell.textContent = measurement.details || measurement.description || '';
        }
    }

    formatMeasurementValue(value) {
        if (value === null || value === undefined) {
            return '';
        }
        if (value === '') {
            return '';
        }
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return String(value);
        }
        const precision = Math.abs(number) < 1 ? 4 : 2;
        return number.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: precision
        });
    }

    handleMeasurementTableClick(event) {
        const button = event.target.closest('[data-action]');
        if (!button) {
            return;
        }
        const action = button.dataset.action;
        if (action !== 'remove') {
            return;
        }
        const row = button.closest('tr[data-id]');
        const measurementId = row?.dataset?.id;
        if (!measurementId) {
            return;
        }
        const drawingId = this.state.currentDrawingId;
        if (!drawingId) {
            return;
        }
        this.removeMeasurement(drawingId, measurementId);
    }

    clearQuickResult() {
        const { quickResult } = this.elements;
        if (quickResult) {
            quickResult.textContent = '';
        }
    }

    handleQuickShapeChange() {
        this.updateQuickShapeFields();
        this.clearQuickResult();
    }

    updateQuickShapeFields() {
        const { shapeSelect, dim1Input, dim2Input, dim2Group } = this.elements;
        if (!shapeSelect || !dim1Input) {
            return;
        }
        const shape = shapeSelect.value || 'rectangle';
        const dim1Label = dim1Input.closest('.form-group')?.querySelector('label');
        const dim2Label = dim2Input?.closest('.form-group')?.querySelector('label');

        if (shape === 'circle') {
            if (dim1Label) dim1Label.textContent = 'Radius';
            dim1Input.placeholder = 'Radius';
            if (dim2Group) {
                dim2Group.classList.add('is-hidden');
            }
            if (dim2Input) {
                dim2Input.value = '';
            }
            if (dim2Label) dim2Label.textContent = 'Dimension 2';
        } else if (shape === 'triangle') {
            if (dim1Label) dim1Label.textContent = 'Base';
            dim1Input.placeholder = 'Base';
            if (dim2Label) dim2Label.textContent = 'Height';
            if (dim2Input) {
                dim2Input.placeholder = 'Height';
            }
            if (dim2Group) {
                dim2Group.classList.remove('is-hidden');
            }
        } else {
            if (dim1Label) dim1Label.textContent = 'Length';
            dim1Input.placeholder = 'Length';
            if (dim2Label) dim2Label.textContent = 'Width';
            if (dim2Input) {
                dim2Input.placeholder = 'Width';
            }
            if (dim2Group) {
                dim2Group.classList.remove('is-hidden');
            }
        }
    }

    handleQuickShapeCalc() {
        const { shapeSelect, dim1Input, dim2Input, quickResult } = this.elements;
        if (!shapeSelect || !dim1Input || !quickResult) {
            return;
        }

        const shape = shapeSelect.value || 'rectangle';
        const dim1 = parseFloat(dim1Input.value);
        const dim2 = parseFloat(dim2Input?.value);

        let area = null;
        if (shape === 'circle') {
            if (!Number.isFinite(dim1) || dim1 <= 0) {
                quickResult.textContent = 'Enter a valid radius to calculate area.';
                return;
            }
            area = Math.PI * (dim1 ** 2);
        } else if (shape === 'triangle') {
            if (!Number.isFinite(dim1) || dim1 <= 0 || !Number.isFinite(dim2) || dim2 <= 0) {
                quickResult.textContent = 'Enter valid base and height to calculate area.';
                return;
            }
            area = 0.5 * dim1 * dim2;
        } else {
            if (!Number.isFinite(dim1) || dim1 <= 0 || !Number.isFinite(dim2) || dim2 <= 0) {
                quickResult.textContent = 'Enter valid dimensions to calculate area.';
                return;
            }
            area = dim1 * dim2;
        }

        quickResult.textContent = `Area: ${this.formatMeasurementValue(area)} sq ft`;
        this.updateStatus('Quick shape area calculated.');
    }

    exportMeasurementsToCsv() {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.services.toast('Select a drawing to export measurements.', 'warning');
            return;
        }
        const measurements = this.getMeasurementItems(drawing.id);
        if (!measurements.length) {
            this.services.toast('No measurements to export.', 'warning');
            return;
        }

        const headers = ['Name', 'Mode', 'Quantity', 'Units', 'Details'];
        const rows = measurements.map((measurement) => [
            measurement.name || measurement.label || '',
            measurement.mode || measurement.type || '',
            this.formatMeasurementValue(measurement.quantity ?? measurement.value ?? measurement.area ?? ''),
            measurement.units || measurement.unit || '',
            measurement.details || measurement.description || ''
        ].map((value) => {
            const text = value === null || value === undefined ? '' : String(value);
            if (/[",\n]/.test(text)) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        }).join(','));

        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const baseName = drawing.name ? drawing.name.replace(/\.[^.]+$/, '') : 'takeoff';
        link.download = `${baseName || 'takeoff'}-measurements.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.updateStatus('Measurements exported to CSV.');
    }

    pushMeasurementsToEstimate() {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.services.toast('Select a drawing to send measurements to the estimate.', 'warning');
            return;
        }
        const measurements = this.getMeasurementItems(drawing.id);
        if (!measurements.length) {
            this.services.toast('Add measurements before sending to the estimate.', 'warning');
            return;
        }
        if (!this.services.estimate?.push) {
            this.services.toast('Estimate service unavailable.', 'error');
            return;
        }
        try {
            this.services.estimate.push({ drawing, measurements });
            this.updateStatus('Measurements sent to the estimate.');
        } catch (error) {
            console.error('Unable to push measurements to estimate', error);
            this.services.toast('Unable to send measurements to the estimate.', 'error');
        }
    }

    cleanupDrawings() {
        this.state.drawings.forEach((drawing) => {
            if (drawing.objectUrl) {
                URL.revokeObjectURL(drawing.objectUrl);
                drawing.objectUrl = null;
            }
            if (drawing.previewUrl && drawing.previewUrl.startsWith('blob:')) {
                URL.revokeObjectURL(drawing.previewUrl);
                drawing.previewUrl = null;
            }
            drawing.pdfDoc?.destroy?.();
        });
        this.state.drawings = [];
        this.measurements.clear();
        this.refreshMeasurementTable();
        this.drawMeasurements();
    }

    async handleDrawingUpload(event) {
        const files = Array.from(event?.target?.files || []);
        if (!files.length) {
            return;
        }

        const newDrawings = [];
        for (const file of files) {
            try {
                const drawing = await this.createDrawingFromFile(file);
                newDrawings.push(drawing);
            } catch (error) {
                this.services.toast(`Unable to load ${file.name}: ${error.message}`, 'error');
                console.error('Failed to load drawing', error);
            }
        }

        if (!newDrawings.length) {
            return;
        }

        this.state.drawings.push(...newDrawings);
        if (!this.state.currentDrawingId) {
            this.state.currentDrawingId = newDrawings[0].id;
        }

        this.renderDrawingList();
        await this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
        this.refreshMeasurementTable();
        this.drawMeasurements();
        this.updateStatus(`${newDrawings.length} drawing${newDrawings.length === 1 ? '' : 's'} added.`);

        if (this.elements.drawingInput) {
            this.elements.drawingInput.value = '';
        }
    }

    async createDrawingFromFile(file) {
        const id = createId();
        const objectUrl = URL.createObjectURL(file);
        const base = {
            id,
            name: file.name,
            trade: '',
            floor: '',
            page: '',
            createdAt: Date.now(),
            type: SUPPORTED_IMAGE_TYPES.has(file.type) ? 'image' : 'pdf',
            objectUrl,
            file
        };

        if (base.type === 'image') {
            return {
                ...base,
                previewUrl: objectUrl,
                naturalWidth: null,
                naturalHeight: null
            };
        }

        const pdfDoc = await pdfjsLib.getDocument({ url: objectUrl }).promise;
        return {
            ...base,
            pdfDoc,
            totalPages: pdfDoc.numPages,
            currentPage: 1,
            previewUrl: null
        };
    }

    getActiveDrawing() {
        return this.state.drawings.find((drawing) => drawing.id === this.state.currentDrawingId) || null;
    }

    getFilteredDrawings() {
        const { drawings, filter, sortBy, sortDir } = this.state;
        const filtered = filter
            ? drawings.filter((drawing) => {
                const haystack = [drawing.name, drawing.trade, drawing.floor, drawing.page]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                return haystack.includes(filter);
            })
            : [...drawings];

        filtered.sort((a, b) => {
            const direction = sortDir === 'asc' ? 1 : -1;
            const valueA = (a[sortBy] || '').toString().toLowerCase();
            const valueB = (b[sortBy] || '').toString().toLowerCase();
            if (valueA < valueB) return -1 * direction;
            if (valueA > valueB) return 1 * direction;
            return (a.createdAt - b.createdAt) * direction;
        });

        return filtered;
    }

    renderDrawingList() {
        const { drawingTableBody, drawingEmpty } = this.elements;
        if (!drawingTableBody) {
            return;
        }

        const drawings = this.getFilteredDrawings();
        const activeDrawingId = this.state.currentDrawingId;

        drawingTableBody.innerHTML = drawings.map((drawing) => {
            const isActive = drawing.id === activeDrawingId;
            const typeLabel = drawing.type === 'pdf' ? 'PDF Document' : 'Image';
            return `
                <tr data-id="${escapeHtml(drawing.id)}" class="${isActive ? 'is-active' : ''}">
                    <td>
                        <div class="takeoff-drawing-name">
                            <span class="takeoff-drawing-title">${escapeHtml(drawing.name)}</span>
                            <span class="takeoff-drawing-subtitle">${typeLabel}</span>
                        </div>
                    </td>
                    <td>
                        <input type="text" class="form-input takeoff-input" data-field="trade" value="${escapeHtml(drawing.trade || '')}" placeholder="Trade">
                    </td>
                    <td>
                        <input type="text" class="form-input takeoff-input" data-field="floor" value="${escapeHtml(drawing.floor || '')}" placeholder="Floor">
                    </td>
                    <td>
                        <input type="text" class="form-input takeoff-input" data-field="page" value="${escapeHtml(drawing.page || '')}" placeholder="Page">
                    </td>
                    <td class="takeoff-actions">
                        <button type="button" class="btn btn-secondary btn-sm" data-action="select">View</button>
                        <button type="button" class="btn btn-ghost btn-sm" data-action="remove" aria-label="Remove drawing">Remove</button>
                    </td>
                </tr>
            `;
        }).join('');

        if (drawingEmpty) {
            drawingEmpty.classList.toggle('is-hidden', drawings.length > 0);
        }
    }

    handleDrawingTableClick(event) {
        const button = event.target.closest('[data-action]');
        if (button) {
            const row = button.closest('tr[data-id]');
            if (!row) return;
            const id = row.dataset.id;
            if (button.dataset.action === 'remove') {
                this.removeDrawing(id);
            } else if (button.dataset.action === 'select') {
                this.selectDrawing(id);
            }
            return;
        }

        if (event.target.closest('input')) {
            return;
        }

        const row = event.target.closest('tr[data-id]');
        if (row) {
            this.selectDrawing(row.dataset.id);
        }
        this.drawMeasurements();
    }

    handleDrawingTableInput(event) {
        const field = event.target.dataset.field;
        if (!field) return;
        const row = event.target.closest('tr[data-id]');
        if (!row) return;
        const drawing = this.state.drawings.find((item) => item.id === row.dataset.id);
        if (!drawing) return;
        drawing[field] = event.target.value;
        if (field === 'trade' || field === 'floor' || field === 'page') {
            this.updateActiveDrawingDisplay();
        }
        this.drawMeasurements();
    }

    drawMeasurements() {
        const { canvas } = this.elements;
        if (!canvas) {
            return;
        }

        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }

        const width = Number.isFinite(canvas.width) ? canvas.width : canvas.clientWidth || 0;
        const height = Number.isFinite(canvas.height) ? canvas.height : canvas.clientHeight || 0;
        context.clearRect(0, 0, width, height);

        const drawing = this.getActiveDrawing();
        if (!drawing) {
            return;
        }

        const overlay = this.measurements.get(drawing.id);
        const measurements = this.normalizeMeasurements(overlay);
        if (!measurements.length) {
            return;
        }

        measurements.forEach((measurement) => this.renderMeasurement(context, measurement));
    }

    normalizeMeasurements(overlay) {
        if (!overlay) {
            return [];
        }
        if (Array.isArray(overlay)) {
            return overlay;
        }
        if (Array.isArray(overlay?.items)) {
            return overlay.items;
        }
        return [];
    }

    renderMeasurement(context, measurement) {
        if (!measurement || typeof measurement !== 'object') {
            return;
        }

        const rawPoints = Array.isArray(measurement.points) ? measurement.points : [];
        const scale = Number.isFinite(this.state.zoom) ? this.state.zoom : 1;
        const points = rawPoints
            .map((point) => this.toCanvasPoint(point, scale))
            .filter(Boolean);

        if (!points.length) {
            return;
        }

        context.save();
        context.lineWidth = measurement.lineWidth ?? 2;
        context.strokeStyle = measurement.color || 'rgba(0, 123, 255, 0.85)';

        context.beginPath();
        points.forEach(({ x, y }, index) => {
            if (index === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        });

        const shouldClosePath = Boolean(measurement.closed) || (measurement.fill && points.length > 2);
        if (shouldClosePath) {
            context.closePath();
        }

        if (measurement.fill) {
            context.fillStyle = measurement.fill;
            context.fill();
        }

        context.stroke();

        if (measurement.label) {
            const anchorPoint = this.getLabelAnchor(measurement, points, scale);
            if (anchorPoint) {
                context.fillStyle = measurement.labelColor || context.strokeStyle;
                context.font = measurement.labelFont || '12px sans-serif';
                const offsetX = measurement.labelOffsetX ?? 8;
                const offsetY = measurement.labelOffsetY ?? -8;
                context.fillText(
                    measurement.label,
                    anchorPoint.x + offsetX,
                    anchorPoint.y + offsetY
                );
            }
        }

        context.restore();
    }

    toCanvasPoint(point, scale) {
        if (!point) {
            return null;
        }
        const x = Number.isFinite(point.x) ? point.x : Number.isFinite(point[0]) ? point[0] : null;
        const y = Number.isFinite(point.y) ? point.y : Number.isFinite(point[1]) ? point[1] : null;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
        }
        return { x: x * scale, y: y * scale };
    }

    getLabelAnchor(measurement, points, scale) {
        if (measurement.labelPosition) {
            return this.toCanvasPoint(measurement.labelPosition, scale);
        }
        return points[points.length - 1] || null;
    }

    removeDrawing(id) {
        const index = this.state.drawings.findIndex((drawing) => drawing.id === id);
        if (index === -1) return;

        const [removed] = this.state.drawings.splice(index, 1);
        if (removed?.objectUrl) {
            URL.revokeObjectURL(removed.objectUrl);
        }
        removed?.pdfDoc?.destroy?.();
        this.measurements.delete(id);

        if (this.state.currentDrawingId === id) {
            this.state.currentDrawingId = this.state.drawings[0]?.id || null;
        }

        this.renderDrawingList();
        this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
        this.refreshMeasurementTable();
        this.drawMeasurements();
        this.updateStatus(`${removed?.name || 'Drawing'} removed.`);
    }

    selectDrawing(id) {
        if (!id || this.state.currentDrawingId === id) {
            return;
        }
        this.state.currentDrawingId = id;
        this.state.zoom = 1;
        this.renderDrawingList();
        this.updateZoomIndicator();
        this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
        this.refreshMeasurementTable();
        this.drawMeasurements();
    }

    updatePlanVisibility() {
        const drawing = this.getActiveDrawing();
        const { planContainer } = this.elements;
        if (!planContainer) return;
        planContainer.classList.toggle('is-hidden', !drawing);
    }

    async updateActiveDrawingDisplay() {
        const drawing = this.getActiveDrawing();
        const { activeMeta } = this.elements;
        if (activeMeta) {
            activeMeta.textContent = formatMeta(drawing);
        }
        await this.updatePlanPreview(drawing);
        this.updatePdfControls(drawing);
    }

    async updatePlanPreview(drawing) {
        const token = ++this.previewToken;
        const { planPreview, planInner, canvas } = this.elements;
        if (!planPreview || !planInner) {
            return;
        }

        if (!drawing) {
            planPreview.removeAttribute('src');
            if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
                canvas.style.width = '0px';
                canvas.style.height = '0px';
            }
            planInner.style.transform = 'scale(1)';
            return;
        }

        if (drawing.type === 'image') {
            await this.loadImagePreview(drawing, token);
        } else {
            await this.loadPdfPreview(drawing, token);
        }
    }

    async loadImagePreview(drawing, token) {
        const { planPreview, canvas, planInner } = this.elements;
        if (!planPreview) return;

        return new Promise((resolve) => {
            const handleLoad = () => {
                if (token !== this.previewToken) {
                    return resolve();
                }
                drawing.naturalWidth = planPreview.naturalWidth;
                drawing.naturalHeight = planPreview.naturalHeight;
                this.sizeCanvasToDrawing(drawing);
                resolve();
            };

            planPreview.onload = handleLoad;
            planPreview.onerror = () => {
                if (token !== this.previewToken) return resolve();
                this.services.toast('Unable to load image preview.', 'error');
                resolve();
            };
            planPreview.src = drawing.previewUrl;
            if (canvas) {
                canvas.style.display = '';
            }
            if (planInner) {
                planInner.style.transform = `scale(${this.state.zoom})`;
            }
        });
    }

    async loadPdfPreview(drawing, token) {
        const { planPreview, planInner } = this.elements;
        if (!planPreview || !drawing?.pdfDoc) return;

        const pageNumber = clamp(drawing.currentPage || 1, 1, drawing.totalPages || 1);
        try {
            const page = await drawing.pdfDoc.getPage(pageNumber);
            if (token !== this.previewToken) return;
            const viewport = page.getViewport({ scale: 1.25 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: context, viewport }).promise;
            if (token !== this.previewToken) return;
            const dataUrl = canvas.toDataURL();
            drawing.previewUrl = dataUrl;
            drawing.currentPage = pageNumber;
            planPreview.src = dataUrl;
            this.sizeCanvasToDrawing({
                naturalWidth: viewport.width,
                naturalHeight: viewport.height
            });
            if (planInner) {
                planInner.style.transform = `scale(${this.state.zoom})`;
            }
        } catch (error) {
            if (token !== this.previewToken) return;
            console.error('Unable to render PDF page', error);
            this.services.toast('Unable to render PDF preview.', 'error');
        }
    }

    sizeCanvasToDrawing(drawing) {
        const { canvas, planInner } = this.elements;
        if (!canvas || !drawing) return;
        const width = Math.max(drawing.naturalWidth || drawing.width || canvas.width, 1);
        const height = Math.max(drawing.naturalHeight || drawing.height || canvas.height, 1);
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        if (planInner) {
            planInner.style.width = `${width}px`;
            planInner.style.height = `${height}px`;
        }
    }

    updatePdfControls(drawing = this.getActiveDrawing()) {
        const { pdfControls, pdfPageInput, pdfPageTotal, pdfDownloadBtn, pdfOpenBtn, openPdfBtn } = this.elements;
        const isPdf = Boolean(drawing && drawing.type === 'pdf');
        const totalPages = drawing?.totalPages || 1;
        if (pdfControls) {
            pdfControls.classList.toggle('is-hidden', !isPdf);
        }
        if (pdfPageInput) {
            pdfPageInput.value = drawing ? drawing.currentPage || 1 : 1;
            pdfPageInput.max = totalPages;
            pdfPageInput.disabled = !isPdf;
        }
        if (pdfPageTotal) {
            pdfPageTotal.textContent = `of ${totalPages}`;
        }
        const buttons = [pdfDownloadBtn, pdfOpenBtn, openPdfBtn];
        buttons.forEach((btn) => {
            if (btn) {
                btn.toggleAttribute('aria-hidden', !isPdf);
                btn.disabled = !isPdf;
                btn.classList.toggle('is-hidden', !isPdf && btn === openPdfBtn);
            }
        });
    }

    updateStatus(message) {
        const { status } = this.elements;
        if (status) {
            status.textContent = message || '';
        }
    }

    updateZoomIndicator() {
        const { zoomIndicator } = this.elements;
        if (zoomIndicator) {
            zoomIndicator.textContent = `${Math.round(this.state.zoom * 100)}%`;
        }
    }

    applyZoom() {
        const { planInner } = this.elements;
        if (!planInner) return;
        const zoom = clamp(this.state.zoom, MIN_ZOOM, MAX_ZOOM);
        this.state.zoom = zoom;
        planInner.style.transformOrigin = 'top left';
        planInner.style.transform = `scale(${zoom})`;
        this.updateZoomIndicator();
    }

    stepZoom(delta) {
        this.state.zoom = clamp(this.state.zoom + delta, MIN_ZOOM, MAX_ZOOM);
        this.applyZoom();
    }

    resetZoom() {
        this.state.zoom = 1;
        this.applyZoom();
    }

    async navigatePdfPage(delta) {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') {
            return;
        }
        const nextPage = clamp((drawing.currentPage || 1) + delta, 1, drawing.totalPages || 1);
        if (nextPage === drawing.currentPage) return;
        drawing.currentPage = nextPage;
        await this.updateActiveDrawingDisplay();
    }

    async jumpToPdfPage(pageNumber) {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') {
            return;
        }
        const nextPage = clamp(pageNumber, 1, drawing.totalPages || 1);
        if (nextPage === drawing.currentPage) {
            this.updatePdfToolbar(drawing);
            return;
        }
        drawing.currentPage = nextPage;
        await this.updateActiveDrawingDisplay();
    }

    updatePdfToolbar(drawing) {
        const { pdfPageInput, pdfPageTotal } = this.elements;
        if (!pdfPageInput || !pdfPageTotal) return;
        const totalPages = drawing?.totalPages || 1;
        pdfPageInput.value = drawing?.currentPage || 1;
        pdfPageInput.max = totalPages;
        pdfPageTotal.textContent = `of ${totalPages}`;
    }

    openActivePdfInViewer() {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') {
            this.services.toast('Select a PDF drawing first.', 'warning');
            return;
        }
        const { pdfModal, pdfFrame } = this.elements;
        if (!pdfModal || !pdfFrame) return;
        const page = drawing.currentPage || 1;
        pdfFrame.src = `${drawing.objectUrl}#page=${page}`;
        pdfModal.setAttribute('aria-hidden', 'false');
        pdfModal.classList.add('is-open');
    }

    closePdfViewer({ silent = false } = {}) {
        const { pdfModal, pdfFrame } = this.elements;
        if (!pdfModal || !pdfFrame) return;
        pdfModal.setAttribute('aria-hidden', 'true');
        pdfModal.classList.remove('is-open');
        pdfFrame.removeAttribute('src');
        if (!silent) {
            this.updateStatus('PDF reader closed.');
        }
    }

    downloadActivePdf() {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') {
            this.services.toast('Select a PDF drawing first.', 'warning');
            return;
        }
        const link = document.createElement('a');
        link.href = drawing.objectUrl;
        link.download = drawing.name || 'drawing.pdf';
        link.click();
        this.updateStatus('PDF download started.');
    }

    toggleFullscreen() {
        this.setFullscreen(!this.state.isFullscreen);
    }

    setFullscreen(enabled) {
        const { planContainer, fullScreenToggle, fullscreenBtn } = this.elements;
        this.state.isFullscreen = Boolean(enabled);
        if (planContainer) {
            planContainer.classList.toggle('takeoff-plan-fullscreen', this.state.isFullscreen);
        }
        if (fullScreenToggle) {
            fullScreenToggle.textContent = this.state.isFullscreen ? 'Exit Full View' : 'Full View';
            fullScreenToggle.setAttribute('aria-pressed', this.state.isFullscreen ? 'true' : 'false');
        }
        if (fullscreenBtn) {
            fullscreenBtn.textContent = this.state.isFullscreen ? 'Exit Full Screen' : 'Full Screen';
        }
        if (!this.state.isFullscreen && document.fullscreenElement) {
            document.exitFullscreen?.();
        }
    }

    updateFullscreenButton() {
        const { fullscreenBtn, fullScreenToggle } = this.elements;
        if (fullscreenBtn) {
            fullscreenBtn.textContent = this.state.isFullscreen ? 'Exit Full Screen' : 'Full Screen';
        }
        if (fullScreenToggle) {
            fullScreenToggle.textContent = this.state.isFullscreen ? 'Exit Full View' : 'Full View';
            fullScreenToggle.setAttribute('aria-pressed', this.state.isFullscreen ? 'true' : 'false');
        }
    }
}


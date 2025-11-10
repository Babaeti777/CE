import { LifecycleManager } from './services/lifecycle-manager.js';
import { Validator, ValidationError } from './utils/validator.js';
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

const MODE_LABELS = {
    length: 'Length',
    area: 'Area',
    count: 'Count',
    diameter: 'Diameter'
};

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
    return Math.abs(sum) / 2;
}

function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function formatMeta(drawing) {
    if (!drawing) return '';
    const parts = [drawing.name];
    if (drawing.trade) parts.push(drawing.trade);
    if (drawing.floor) parts.push(`Floor ${drawing.floor}`);
    if (drawing.page) parts.push(`Page ${drawing.page}`);
    if (drawing.type === 'pdf' && drawing.totalPages) {
        parts.push(`${drawing.totalPages} page${drawing.totalPages > 1 ? 's' : ''}`);
    }
    return parts.filter(Boolean).join(' • ');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class TakeoffManager {
    constructor({ toastService, estimateService } = {}) {
        this.services = {
            toast: typeof toastService === 'function'
                ? (message, type = 'info') => toastService(message, type)
                : (message, type = 'info') => console.info(`[${type}] ${message}`),
            estimate: estimateService || null
        };

        this.lifecycle = new LifecycleManager();
        this.elements = {};
        this.state = {
            drawings: [],
            filter: '',
            sortBy: 'trade',
            sortDir: 'asc',
            activeDrawingId: null,
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
        this.updateQuickShapeInputs();
        this.updateZoomIndicator();
        this.updateCountToolbarVisibility();
        this.updateScaleControls();
        this.renderDrawingList();
        this.renderMeasurementTable();
        this.updatePlanVisibility();
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
            planStage: byId('takeoffPlanStage'),
            planInner: byId('takeoffPlanInner'),
            planPreview: byId('takeoffPlanPreview'),
            canvas: byId('takeoffCanvas'),
            zoomOutBtn: byId('takeoffZoomOutBtn'),
            zoomInBtn: byId('takeoffZoomInBtn'),
            zoomResetBtn: byId('takeoffZoomResetBtn'),
            zoomIndicator: byId('takeoffZoomIndicator'),
            modeSelect: byId('takeoffModeSelect'),
            scaleInput: byId('takeoffScaleInput'),
            status: byId('takeoffStatus'),
            activeMeta: byId('takeoffActiveMeta'),
            fullscreenBtn: byId('takeoffFullscreenBtn'),
            fullscreenToggle: byId('takeoffFullScreenToggle'),
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

        this.canvasContext = this.elements.canvas?.getContext?.('2d') || null;
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
        on(this.elements.sortDirection, 'click', () => {
            this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
            this.elements.sortDirection.textContent = this.state.sortDir === 'asc' ? '▲' : '▼';
            this.renderDrawingList();
        });
        on(this.elements.drawingTableBody, 'click', (event) => this.handleDrawingTableClick(event));
        on(this.elements.modeSelect, 'change', (event) => this.updateMode(event.target.value));
        on(this.elements.scaleInput, 'change', (event) => this.handleScaleChange(event));
        on(this.elements.zoomInBtn, 'click', () => this.adjustZoom(ZOOM_STEP));
        on(this.elements.zoomOutBtn, 'click', () => this.adjustZoom(-ZOOM_STEP));
        on(this.elements.zoomResetBtn, 'click', () => this.setZoom(1));
        on(this.elements.planStage, 'pointerdown', (event) => this.handlePointerDown(event));
        on(this.elements.planStage, 'pointermove', (event) => this.handlePointerMove(event));
        on(this.elements.planStage, 'pointerleave', () => this.clearPreviewPoint());
        on(this.elements.planStage, 'dblclick', (event) => this.handleDoubleClick(event));
        on(this.elements.planStage, 'contextmenu', (event) => {
            if (this.state.draftPoints.length) {
                event.preventDefault();
                this.resetDraft();
            }
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
    }

    handleFileSelection(event) {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;
        files.forEach((file) => this.processFile(file));
        event.target.value = '';
    }

    async processFile(file) {
        const type = this.detectFileType(file);
        if (!type) {
            this.services.toast(`Unsupported file: ${file.name}`, 'error');
            return;
        }

        const drawing = {
            id: createId('drawing'),
            name: file.name,
            trade: '',
            floor: '',
            page: 1,
            totalPages: 1,
            type,
            file,
            url: URL.createObjectURL(file),
            pdfDoc: null,
            renderedWidth: 0,
            renderedHeight: 0,
            renderSrc: null,
            scale: 1
        };

        this.state.drawings.push(drawing);
        this.state.measurements[drawing.id] = [];
        this.state.measurementCounters[drawing.id] = { length: 0, area: 0, count: 0, diameter: 0 };
        this.services.toast(`${file.name} added to drawings.`, 'success');
        this.renderDrawingList();
        if (!this.state.activeDrawingId) {
            this.setActiveDrawing(drawing.id);
        }
    }

    detectFileType(file) {
        if (!file) return null;
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            return 'pdf';
        }
        if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
            return 'image';
        }
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif') || lower.endsWith('.svg')) {
            return 'image';
        }
        return null;
    }

    renderDrawingList() {
        const { drawings, filter, sortBy, sortDir, activeDrawingId } = this.state;
        const filtered = drawings.filter((drawing) => {
            if (!filter) return true;
            const haystack = [drawing.name, drawing.trade, drawing.floor, drawing.page].join(' ').toLowerCase();
            return haystack.includes(filter);
        });
        const sorted = filtered.sort((a, b) => {
            const dir = sortDir === 'asc' ? 1 : -1;
            const valueA = (a[sortBy] ?? '').toString().toLowerCase();
            const valueB = (b[sortBy] ?? '').toString().toLowerCase();
            if (sortBy === 'page') {
                const numA = Number.parseInt(valueA, 10) || 0;
                const numB = Number.parseInt(valueB, 10) || 0;
                return (numA - numB) * dir;
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

    handleDrawingTableClick(event) {
        const row = event.target.closest('tr[data-id]');
        if (!row) return;
        const drawingId = row.dataset.id;
        const action = event.target.dataset.action;
        if (action === 'remove') {
            this.removeDrawing(drawingId);
            return;
        }
        this.setActiveDrawing(drawingId);
    }

    removeDrawing(drawingId) {
        if (!drawingId) return;
        const index = this.state.drawings.findIndex((item) => item.id === drawingId);
        if (index === -1) return;
        const [removed] = this.state.drawings.splice(index, 1);
        if (removed?.url?.startsWith('blob:')) {
            URL.revokeObjectURL(removed.url);
        }
        delete this.state.measurements[drawingId];
        delete this.state.measurementCounters[drawingId];
        if (this.state.activeDrawingId === drawingId) {
            this.state.activeDrawingId = null;
            if (this.state.drawings.length) {
                this.setActiveDrawing(this.state.drawings[0].id);
            } else {
                this.resetPreview();
            }
            drawing.pdfDoc?.destroy?.();
        });
        this.state.drawings = [];
        this.measurements.clear();
        this.refreshMeasurementTable();
        this.drawMeasurements();
    }

    setActiveDrawing(drawingId) {
        if (!drawingId || this.state.activeDrawingId === drawingId) {
            this.renderDrawingList();
            return;
        }
        const drawing = this.state.drawings.find((item) => item.id === drawingId);
        if (!drawing) return;
        this.state.activeDrawingId = drawingId;
        this.state.zoom = 1;
        this.state.previewPoint = null;
        this.updateScaleControls(drawing);
        this.resetDraft();
        this.renderDrawingList();
        this.renderMeasurementTable();
        this.updateZoomIndicator();
        this.updateCountToolbarVisibility();
        this.updatePlanVisibility();
        this.updateActiveMeta();
        this.updatePdfControls();
        this.loadActiveDrawing();
    }

    getActiveDrawing() {
        if (!this.state.activeDrawingId) return null;
        return this.state.drawings.find((drawing) => drawing.id === this.state.activeDrawingId) || null;
    }

    async loadActiveDrawing() {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.resetPreview();
            return;
        }

        const token = ++this.previewToken;
        try {
            if (drawing.type === 'pdf') {
                await this.renderPdfDrawing(drawing, token);
            } else {
                this.renderImageDrawing(drawing, token);
            }
        } catch (error) {
            console.error(error);
            this.services.toast(`Failed to load ${drawing.name}`, 'error');
        }
    }

    renderImageDrawing(drawing, token) {
        if (token !== this.previewToken) return;
        const img = new Image();
        img.onload = () => {
            if (token !== this.previewToken) return;
            drawing.renderSrc = drawing.url;
            drawing.renderedWidth = img.naturalWidth;
            drawing.renderedHeight = img.naturalHeight;
            drawing.totalPages = 1;
            drawing.page = 1;
            this.showPreview(drawing);
        };
        img.onerror = () => {
            if (token !== this.previewToken) return;
            this.services.toast(`Unable to load image for ${drawing.name}`, 'error');
        };
        img.src = drawing.url;
    }

    async renderPdfDrawing(drawing, token) {
        if (!drawing.pdfDoc) {
            this.state.pdfLoading = true;
            this.updateStatus('Loading PDF...');
            drawing.pdfDoc = await pdfjsLib.getDocument({ url: drawing.url }).promise;
            drawing.totalPages = drawing.pdfDoc.numPages;
            drawing.page = clamp(drawing.page || 1, 1, drawing.totalPages);
            this.state.pdfLoading = false;
        }

        if (token !== this.previewToken) return;
        const page = await drawing.pdfDoc.getPage(drawing.page);
        if (token !== this.previewToken) return;
        const scale = 1.25;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
        if (token !== this.previewToken) return;
        drawing.renderSrc = canvas.toDataURL('image/png');
        drawing.renderedWidth = canvas.width;
        drawing.renderedHeight = canvas.height;
        this.showPreview(drawing);
        this.updatePdfControls();
    }

    showPreview(drawing) {
        if (!this.elements.planContainer || !this.elements.planPreview || !this.elements.canvas) {
            return;
        }
        this.elements.planContainer.classList.remove('is-hidden');
        this.elements.planInner.style.padding = '0';
        this.elements.planInner.style.display = 'block';
        this.elements.planInner.style.transformOrigin = 'top left';
        this.elements.planPreview.src = drawing.renderSrc;
        this.elements.planPreview.style.maxHeight = 'none';
        this.elements.planPreview.style.width = `${drawing.renderedWidth}px`;
        this.elements.planPreview.style.height = `${drawing.renderedHeight}px`;
        this.elements.planPreview.width = drawing.renderedWidth;
        this.elements.planPreview.height = drawing.renderedHeight;
        this.elements.canvas.width = drawing.renderedWidth;
        this.elements.canvas.height = drawing.renderedHeight;
        this.elements.canvas.style.width = `${drawing.renderedWidth}px`;
        this.elements.canvas.style.height = `${drawing.renderedHeight}px`;
        this.elements.planInner.style.width = `${drawing.renderedWidth}px`;
        this.elements.planInner.style.height = `${drawing.renderedHeight}px`;
        this.updateZoomTransform();
        this.updateCanvasSize();
        this.drawMeasurements();
        this.updateStatus(`Viewing ${drawing.name}`);
        this.updateActiveMeta();
    }

    resetPreview() {
        if (this.elements.planPreview) {
            this.elements.planPreview.removeAttribute('src');
        }
        if (this.elements.canvas) {
            this.elements.canvas.width = 0;
            this.elements.canvas.height = 0;
        }
        this.state.previewPoint = null;
        this.resetDraft();
        this.updateScaleControls(null);
        this.updateStatus('Upload plan files to start measuring.');
    }

        this.renderDrawingList();
        await this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
        this.refreshMeasurementTable();
        this.drawMeasurements();
        this.updateStatus(`${newDrawings.length} drawing${newDrawings.length === 1 ? '' : 's'} added.`);

    updatePlanVisibility() {
        const hasDrawing = Boolean(this.getActiveDrawing());
        if (this.elements.planContainer) {
            this.elements.planContainer.classList.toggle('is-hidden', !hasDrawing);
        }
        if (this.elements.openPdfBtn) {
            const drawing = this.getActiveDrawing();
            const shouldShow = hasDrawing && drawing?.type === 'pdf';
            this.elements.openPdfBtn.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
            this.elements.openPdfBtn.classList.toggle('is-hidden', !shouldShow);
        }
    }

    updateStatus(message) {
        if (!this.elements.status) return;
        this.elements.status.textContent = message;
    }

    updateZoomIndicator() {
        if (!this.elements.zoomIndicator) return;
        this.elements.zoomIndicator.textContent = `${Math.round(this.state.zoom * 100)}%`;
    }

    adjustZoom(delta) {
        this.setZoom(this.state.zoom + delta);
    }

    setZoom(value) {
        const newZoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
        if (newZoom === this.state.zoom) return;
        this.state.zoom = newZoom;
        this.updateZoomIndicator();
        this.updateZoomTransform();
    }

    updateZoomTransform() {
        if (!this.elements.planInner) return;
        this.elements.planInner.style.transform = `scale(${this.state.zoom})`;
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

    syncCountControls() {
        if (!this.elements.countColor) return;
        this.elements.countColor.value = this.state.countSettings.color;
        this.elements.countShape.value = this.state.countSettings.shape;
        this.elements.countLabel.value = this.state.countSettings.label;
    }

    updateCountSetting(key, value) {
        this.state.countSettings[key] = value;
        if (key !== 'label') {
            this.drawMeasurements();
        }
    }

    handlePointerDown(event) {
        const drawing = this.getActiveDrawing();
        if (!drawing || !this.canvasContext) return;
        const point = this.getPointerPosition(event);
        if (!point) return;
        event.preventDefault();

        if (this.state.mode === 'count') {
            this.createMeasurement({
                mode: 'count',
                points: [point],
                quantity: 1,
                units: 'ct',
                details: this.state.countSettings.label || '—',
                color: this.state.countSettings.color,
                shape: this.state.countSettings.shape,
                label: this.state.countSettings.label
            });
            this.state.previewPoint = null;
            return;
        }

        const points = [...this.state.draftPoints, point];
        this.state.draftPoints = points;
        if (this.state.mode === 'length' || this.state.mode === 'diameter') {
            if (points.length === 2) {
                this.finalizeMeasurement(points);
                this.resetDraft();
            }
        }
        this.drawMeasurements();
    }

    handlePointerMove(event) {
        const point = this.getPointerPosition(event);
        if (this.state.mode === 'count') {
            this.state.previewPoint = point || null;
            this.drawMeasurements();
            return;
        }
        if (!this.state.draftPoints.length) {
            this.state.previewPoint = null;
            return;
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

    resetDraft() {
        this.state.draftPoints = [];
        this.state.previewPoint = null;
        this.drawMeasurements();
    }

        this.renderDrawingList();
        this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
        this.refreshMeasurementTable();
        this.drawMeasurements();
        this.updateStatus(`${removed?.name || 'Drawing'} removed.`);
    }

    finalizeMeasurement(points) {
        const drawing = this.getActiveDrawing();
        if (!drawing || !points.length) return;
        const scale = (Number.isFinite(drawing.scale) && drawing.scale > 0 ? drawing.scale : this.state.scale) || 1;
        let quantity = 0;
        let units = '';
        let details = '';
        let label = '';
        const mode = this.state.mode;

        if (mode === 'length' || mode === 'diameter') {
            if (points.length < 2) return;
            const px = distance(points[0], points[points.length - 1]);
            const feet = px / scale;
            quantity = feet;
            units = 'ft';
            details = `${formatNumber(feet)} ft`;
        } else if (mode === 'area') {
            if (points.length < 3) return;
            const pxArea = computePolygonArea(points);
            const sqft = pxArea / (scale * scale);
            quantity = sqft;
            units = 'sq ft';
            details = `${formatNumber(sqft)} sq ft`;
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

    createMeasurement({ mode, points, quantity, units, details, color, shape, label }) {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const counters = this.state.measurementCounters[drawing.id] || { length: 0, area: 0, count: 0, diameter: 0 };
        counters[mode] = (counters[mode] || 0) + 1;
        this.state.measurementCounters[drawing.id] = counters;
        const name = `${MODE_LABELS[mode] || 'Measurement'} ${counters[mode]}`;
        const measurement = {
            id: createId('measurement'),
            name,
            mode,
            points: points.map((point) => ({ ...point })),
            quantity,
            units,
            details,
            color: color || '#2563eb',
            shape: shape || 'circle',
            label: label || ''
        };
        this.state.measurements[drawing.id] = this.state.measurements[drawing.id] || [];
        this.state.measurements[drawing.id].push(measurement);
        this.services.toast(`${measurement.name} added.`, 'success');
        this.renderMeasurementTable();
        this.drawMeasurements();
    }

    getActiveMeasurements() {
        const drawing = this.getActiveDrawing();
        if (!drawing) return [];
        return this.state.measurements[drawing.id] || [];
    }

    renderMeasurementTable() {
        if (!this.elements.measurementTableBody) return;
        const measurements = this.getActiveMeasurements();
        this.elements.measurementTableBody.innerHTML = measurements.map((measurement) => {
            return `
                <tr data-id="${measurement.id}">
                    <td><input type="text" class="form-input" value="${escapeHtml(measurement.name)}" data-field="name"></td>
                    <td>${escapeHtml(MODE_LABELS[measurement.mode] || measurement.mode)}</td>
                    <td>${this.formatMeasurementQuantity(measurement)}</td>
                    <td>${escapeHtml(measurement.units || (measurement.mode === 'count' ? 'ct' : 'ft'))}</td>
                    <td>${escapeHtml(measurement.details || measurement.label || '—')}</td>
                    <td class="text-right"><button type="button" class="btn btn-ghost btn-sm" data-action="delete">Delete</button></td>
                </tr>
            `;
        }).join('');
        if (this.elements.measurementEmpty) {
            this.elements.measurementEmpty.classList.toggle('is-hidden', measurements.length > 0);
        }
        this.drawMeasurements();
    }

    formatMeasurementQuantity(measurement) {
        if (measurement.mode === 'count') {
            return escapeHtml(Number.parseInt(measurement.quantity, 10) || 1);
        }
        const value = Number.isFinite(measurement.quantity) ? measurement.quantity : 0;
        return escapeHtml(formatNumber(value));
    }

    handleMeasurementNameInput(event) {
        const field = event.target.dataset.field;
        if (field !== 'name') return;
        const row = event.target.closest('tr[data-id]');
        if (!row) return;
        const id = row.dataset.id;
        const measurements = this.getActiveMeasurements();
        const measurement = measurements.find((item) => item.id === id);
        if (!measurement) return;
        measurement.name = event.target.value;
    }

    handleMeasurementTableClick(event) {
        const action = event.target.dataset.action;
        if (action !== 'delete') return;
        const row = event.target.closest('tr[data-id]');
        if (!row) return;
        this.removeMeasurement(row.dataset.id);
    }

    removeMeasurement(id) {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const list = this.state.measurements[drawing.id] || [];
        const index = list.findIndex((item) => item.id === id);
        if (index === -1) return;
        list.splice(index, 1);
        this.renderMeasurementTable();
        this.drawMeasurements();
    }

    clearMeasurements() {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        this.state.measurements[drawing.id] = [];
        this.state.measurementCounters[drawing.id] = { length: 0, area: 0, count: 0, diameter: 0 };
        this.renderMeasurementTable();
        this.drawMeasurements();
        this.services.toast('Measurements cleared.', 'info');
    }

    exportCsv() {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.services.toast('Select a drawing to export measurements.', 'error');
            return;
        }
        const measurements = this.getActiveMeasurements();
        if (!measurements.length) {
            this.services.toast('Add measurements before exporting.', 'error');
            return;
        }
        const header = ['Name', 'Mode', 'Quantity', 'Units', 'Details'];
        const rows = measurements.map((measurement) => [
            measurement.name,
            MODE_LABELS[measurement.mode] || measurement.mode,
            measurement.mode === 'count' ? 1 : formatNumber(measurement.quantity),
            measurement.units || (measurement.mode === 'count' ? 'ct' : 'ft'),
            measurement.details || measurement.label || ''
        ]);
        const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${drawing.name}-measurements.csv`;
        link.click();
        URL.revokeObjectURL(url);
        this.services.toast('CSV export generated.', 'success');
    }

    async pushToEstimate() {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.services.toast('Select a drawing first.', 'error');
            return;
        }
        const measurements = this.getActiveMeasurements();
        if (!measurements.length) {
            this.services.toast('Add measurements before sending to an estimate.', 'error');
            return;
        }
        const estimate = this.services.estimate;
        if (typeof estimate?.push !== 'function') {
            this.services.toast('Estimate service unavailable.', 'error');
            return;
        }
        try {
            await Promise.resolve(estimate.push({ drawing, measurements }));
            this.services.toast('Measurements sent to estimate.', 'success');
        } catch (error) {
            console.error('Failed to push measurements to estimate', error);
            this.services.toast('Failed to send measurements to estimate.', 'error');
        }
    }

    drawMeasurements() {
        if (!this.canvasContext) return;
        const ctx = this.canvasContext;
        const canvas = this.elements.canvas;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const measurements = this.getActiveMeasurements();
        measurements.forEach((measurement) => {
            this.drawMeasurementShape(ctx, measurement);
        });
        if (this.state.draftPoints.length) {
            this.drawDraft(ctx);
        }
        if (this.state.mode === 'count' && this.state.previewPoint) {
            this.drawCountMarker(ctx, this.state.previewPoint, this.state.countSettings.color, this.state.countSettings.shape, this.state.countSettings.label);
        }
    }

    drawMeasurementShape(ctx, measurement) {
        if (measurement.mode === 'count') {
            this.drawCountMarker(ctx, measurement.points[0], measurement.color, measurement.shape, measurement.label);
            return;
        }
        if (measurement.mode === 'area') {
            if (measurement.points.length < 3) return;
            ctx.save();
            ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 2;
            ctx.beginPath();
            measurement.points.forEach((point, index) => {
                if (index === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            });
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
            return;
        }
        if (measurement.points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(measurement.points[0].x, measurement.points[0].y);
        ctx.lineTo(measurement.points[measurement.points.length - 1].x, measurement.points[measurement.points.length - 1].y);
        ctx.stroke();
        ctx.restore();
    }

    drawDraft(ctx) {
        const points = [...this.state.draftPoints];
        if (this.state.previewPoint) {
            points.push(this.state.previewPoint);
        }
        if (this.state.mode === 'area') {
            if (points.length < 2) return;
            ctx.save();
            ctx.strokeStyle = 'rgba(37, 99, 235, 0.7)';
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            points.forEach((point, index) => {
                if (index === 0) {
                    ctx.moveTo(point.x, point.y);
                } else {
                    ctx.lineTo(point.x, point.y);
                }
            });
            ctx.stroke();
            ctx.restore();
            return;
        }
        if (points.length < 2) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.stroke();
        ctx.restore();
    }

    drawCountMarker(ctx, point, color, shape, label) {
        ctx.save();
        ctx.fillStyle = color || '#ef4444';
        ctx.strokeStyle = color || '#ef4444';
        ctx.lineWidth = 2;
        const size = 12;
        const half = size / 2;
        switch (shape) {
            case 'square':
                ctx.strokeRect(point.x - half, point.y - half, size, size);
                break;
            case 'diamond':
                ctx.beginPath();
                ctx.moveTo(point.x, point.y - half);
                ctx.lineTo(point.x + half, point.y);
                ctx.lineTo(point.x, point.y + half);
                ctx.lineTo(point.x - half, point.y);
                ctx.closePath();
                ctx.stroke();
                break;
            case 'triangle':
                ctx.beginPath();
                ctx.moveTo(point.x, point.y - half);
                ctx.lineTo(point.x + half, point.y + half);
                ctx.lineTo(point.x - half, point.y + half);
                ctx.closePath();
                ctx.stroke();
                break;
            default:
                ctx.beginPath();
                ctx.arc(point.x, point.y, half, 0, Math.PI * 2);
                ctx.stroke();
                break;
        }
        if (label) {
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(label, point.x, point.y + half + 2);
        }
        ctx.restore();
    }

    updatePdfControls() {
        const drawing = this.getActiveDrawing();
        if (!this.elements.pdfControls) return;
        const isPdf = drawing?.type === 'pdf';
        this.elements.pdfControls.classList.toggle('is-hidden', !isPdf);
        if (this.elements.openPdfBtn) {
            this.elements.openPdfBtn.classList.toggle('is-hidden', !isPdf);
            this.elements.openPdfBtn.setAttribute('aria-hidden', isPdf ? 'false' : 'true');
        }
        if (!isPdf || !drawing) return;
        if (this.elements.pdfPageInput) {
            this.elements.pdfPageInput.value = drawing.page || 1;
        }
        if (this.elements.pdfPageTotal) {
            this.elements.pdfPageTotal.textContent = `of ${drawing.totalPages || 1}`;
        }
        if (this.elements.pdfPrevBtn) {
            this.elements.pdfPrevBtn.disabled = drawing.page <= 1;
        }
        if (this.elements.pdfNextBtn) {
            this.elements.pdfNextBtn.disabled = drawing.page >= (drawing.totalPages || 1);
        }
    }

    changePdfPage(delta) {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') return;
        const nextPage = clamp(drawing.page + delta, 1, drawing.totalPages);
        if (nextPage === drawing.page) return;
        drawing.page = nextPage;
        this.updatePdfControls();
        this.loadActiveDrawing();
    }

    handlePdfPageInput(event) {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') return;
        const value = Number.parseInt(event.target.value, 10);
        if (!Number.isFinite(value)) {
            event.target.value = drawing.page;
            return;
        }
        drawing.page = clamp(value, 1, drawing.totalPages);
        event.target.value = drawing.page;
        this.updatePdfControls();
        this.loadActiveDrawing();
    }

    openPdfModal() {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf' || !this.elements.pdfModal) return;
        this.elements.pdfModal.setAttribute('aria-hidden', 'false');
        if (this.elements.pdfFrame) {
            this.elements.pdfFrame.src = drawing.url;
        }
    }

    closePdfModal() {
        if (!this.elements.pdfModal) return;
        this.elements.pdfModal.setAttribute('aria-hidden', 'true');
        if (this.elements.pdfFrame) {
            this.elements.pdfFrame.removeAttribute('src');
        }
    }

    downloadPdf() {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') return;
        const link = document.createElement('a');
        link.href = drawing.url;
        link.download = drawing.name || 'document.pdf';
        link.click();
    }

    toggleFullscreen() {
        if (!this.elements.planStage) return;
        const element = this.elements.planStage;
        if (document.fullscreenElement) {
            document.exitFullscreen?.();
        } else {
            element.requestFullscreen?.();
        }
    }

    updateFullscreenButton() {
        const isFullscreen = Boolean(document.fullscreenElement);
        if (this.elements.fullscreenBtn) {
            this.elements.fullscreenBtn.textContent = isFullscreen ? 'Exit Full Screen' : 'Full Screen';
        }
        if (this.elements.fullscreenToggle) {
            this.elements.fullscreenToggle.setAttribute('aria-pressed', isFullscreen ? 'true' : 'false');
            this.elements.fullscreenToggle.textContent = isFullscreen ? 'Exit Full View' : 'Full View';
        }
    }

    updateQuickShapeInputs() {
        if (!this.elements.quickShape) return;
        const shape = this.elements.quickShape.value;
        if (shape === 'circle') {
            this.elements.quickDim2Group.classList.add('is-hidden');
            this.elements.quickDim1.placeholder = 'Diameter';
        } else if (shape === 'triangle') {
            this.elements.quickDim2Group.classList.remove('is-hidden');
            this.elements.quickDim1.placeholder = 'Base';
            this.elements.quickDim2.placeholder = 'Height';
        } else {
            this.elements.quickDim2Group.classList.remove('is-hidden');
            this.elements.quickDim1.placeholder = 'Length';
            this.elements.quickDim2.placeholder = 'Width';
        }
        this.elements.quickResult.textContent = '';
    }

    calculateQuickShape() {
        if (!this.elements.quickShape) return;
        const shape = this.elements.quickShape.value;
        try {
            const dim1 = Validator.number(this.elements.quickDim1.value, { min: 0, fieldName: 'Dimension 1' });
            let area = 0;
            if (shape === 'circle') {
                const radius = dim1 / 2;
                area = Math.PI * radius * radius;
            } else {
                const dim2 = Validator.number(this.elements.quickDim2.value, { min: 0, fieldName: 'Dimension 2' });
                if (shape === 'triangle') {
                    area = 0.5 * dim1 * dim2;
                } else {
                    area = dim1 * dim2;
                }
            }
            this.elements.quickResult.textContent = `Estimated area: ${formatNumber(area)} sq ft`;
        } catch (error) {
            if (error instanceof ValidationError) {
                this.services.toast(error.message, 'error');
            }
        }
    }
}


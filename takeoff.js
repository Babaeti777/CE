import { LifecycleManager } from './services/lifecycle-manager.js';

const SUPPORTED_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/svg+xml'
]);

const SUPPORTED_PDF_TYPES = new Set([
    'application/pdf'
]);

const DEFAULT_PDF_SCALE = 1.5;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const ROTATION_INCREMENT = 90;

const STORAGE_KEY = 'ce.takeoff.drawings';

const MODE_LABELS = {
    length: 'Length',
    area: 'Area',
    count: 'Count',
    diameter: 'Diameter'
};

const STORAGE_KEY = 'takeoff::drawings';

const DEFAULT_COUNT_SETTINGS = {
    color: '#ef4444',
    shape: 'circle',
    label: ''
};

function byId(id) {
    if (typeof document === 'undefined') {
        return null;
    }
    return document.getElementById(id);
}

function clamp(value, min, max) {
    const numericValue = Number.isFinite(value) ? value : min;
    return Math.min(Math.max(numericValue, min), max);
}

function normalizeString(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).trim().toLowerCase();
}

function createId(prefix = 'drawing') {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function distance(a, b) {
    if (!a || !b) {
        return 0;
    }
    const dx = (a.x ?? a[0] ?? 0) - (b.x ?? b[0] ?? 0);
    const dy = (a.y ?? a[1] ?? 0) - (b.y ?? b[1] ?? 0);
    return Math.sqrt((dx * dx) + (dy * dy));
}

function computePolygonArea(points) {
    if (!Array.isArray(points) || points.length < 3) {
        return 0;
    }
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        sum += (current.x * next.y) - (next.x * current.y);
    }
    return Math.abs(sum) / 2;
}

function formatNumber(value, { maximumFractionDigits = 2 } = {}) {
    if (!Number.isFinite(value)) {
        return '0';
    }
    const digits = Math.abs(value) < 1 ? Math.min(maximumFractionDigits, 4) : maximumFractionDigits;
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits
    });
}

function computeCentroid(points) {
    if (!Array.isArray(points) || points.length === 0) {
        return null;
    }
    let sumX = 0;
    let sumY = 0;
    points.forEach((point) => {
        sumX += point.x;
        sumY += point.y;
    });
    return {
        x: sumX / points.length,
        y: sumY / points.length
    };
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

function normalizeString(value) {
    return (value ?? '').toString().toLowerCase().trim();
}

function byId(id) {
    if (typeof document === 'undefined') {
        return null;
    }
    return document.getElementById(id);
}

function formatMeta(drawing) {
    if (!drawing) {
        return '';
    }
    const parts = [drawing.name];
    if (drawing.trade) parts.push(drawing.trade);
    if (drawing.floor) parts.push(`Floor ${drawing.floor}`);
    if (drawing.page) parts.push(`Page ${drawing.page}`);
    return parts.filter(Boolean).join(' • ');
}

function escapeHtml(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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
            sortBy: 'name',
            sortDir: 'asc',
            currentDrawingId: null,
            zoom: 1,
            isFullscreen: false,
            previewPoint: null,
            draftPoints: [],
            mode: 'length',
            scale: 1,
            noteMode: false,
            countSettings: {
                color: '#ef4444',
                shape: 'circle',
                label: ''
            }
        };

        this.measurements = new Map();
        this.measurementCounters = new Map();
        this.labelCounters = new Map();
        this.previewToken = 0;
        this.resizeScheduled = false;
        this.pointerSession = null;
        this.pdfWorkerInitialized = false;
        this.handlers = {
            windowResize: () => {
                if (this.resizeScheduled) return;
                this.resizeScheduled = true;
                const scheduler = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
                    ? window.requestAnimationFrame.bind(window)
                    : (fn) => setTimeout(fn, 16);
                scheduler(() => {
                    this.resizeScheduled = false;
                    this.applyZoom();
                });
            }
        };
    }

    init() {
        this.restoreState();
        this.cacheDom();
        this.bindEvents();
        this.renderDrawingList();
        this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
        this.updateZoomIndicator();
        this.updateScaleControls();
        this.updateCountToolbarVisibility();
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
        if (this.state.isFullscreen) {
            this.setFullscreen(false);
        }
        this.cleanupDrawings();
    }

    cacheDom() {
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
            planStage: byId('takeoffPlanStage'),
            modeSelect: byId('takeoffModeSelect'),
            scaleInput: byId('takeoffScaleInput'),
            planCard: document.querySelector('.takeoff-plan-card'),
            zoomOutBtn: byId('takeoffZoomOutBtn'),
            zoomInBtn: byId('takeoffZoomInBtn'),
            zoomResetBtn: byId('takeoffZoomResetBtn'),
            zoomIndicator: byId('takeoffZoomIndicator'),
            status: byId('takeoffStatus'),
            activeMeta: byId('takeoffActiveMeta'),
            fullscreenBtn: byId('takeoffFullscreenBtn'),
            fullScreenToggle: byId('takeoffFullScreenToggle'),
            rotateLeftBtn: byId('takeoffRotateLeftBtn'),
            rotateRightBtn: byId('takeoffRotateRightBtn'),
            openDocumentBtn: byId('takeoffOpenDocumentBtn'),
            countToolbar: byId('takeoffCountToolbar'),
            countColor: byId('takeoffCountColor'),
            countShape: byId('takeoffCountShape'),
            countLabel: byId('takeoffCountLabel'),
            quickCalcBtn: byId('takeoffQuickCalcBtn'),
            shapeSelect: byId('takeoffShapeSelect'),
            dim1Input: byId('takeoffDim1'),
            dim2Input: byId('takeoffDim2'),
            dim2Group: byId('takeoffDim2Group'),
            quickResult: byId('takeoffQuickResult'),
            clearBtn: byId('takeoffClearBtn'),
            exportCsvBtn: byId('takeoffExportCsvBtn'),
            pushBtn: byId('takeoffPushBtn'),
            rotateLeftBtn: byId('takeoffRotateLeftBtn'),
            rotateRightBtn: byId('takeoffRotateRightBtn'),
            openSourceBtn: byId('takeoffOpenSourceBtn'),
            noteModeBtn: byId('takeoffNoteModeBtn'),
            annotationLayer: byId('takeoffAnnotationLayer')
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
            planStage,
            modeSelect,
            scaleInput,
            fullscreenBtn,
            fullScreenToggle,
            rotateLeftBtn,
            rotateRightBtn,
            openDocumentBtn,
            countColor,
            countShape,
            countLabel,
            quickCalcBtn,
            shapeSelect,
            dim1Input,
            dim2Input,
            clearBtn,
            exportCsvBtn,
            pushBtn,
            rotateLeftBtn,
            rotateRightBtn,
            openSourceBtn,
            noteModeBtn,
            annotationLayer
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
        this.lifecycle.addEventListener(modeSelect, 'change', (event) => this.setMode(event.target.value));
        this.lifecycle.addEventListener(scaleInput, 'change', (event) => this.handleScaleChange(event));
        this.lifecycle.addEventListener(drawingTableBody, 'click', (event) => this.handleDrawingTableClick(event));
        this.lifecycle.addEventListener(drawingTableBody, 'input', (event) => this.handleDrawingTableInput(event));
        this.lifecycle.addEventListener(measurementTableBody, 'click', (event) => this.handleMeasurementTableClick(event));

        this.lifecycle.addEventListener(zoomOutBtn, 'click', () => this.stepZoom(-ZOOM_STEP));
        this.lifecycle.addEventListener(zoomInBtn, 'click', () => this.stepZoom(ZOOM_STEP));
        this.lifecycle.addEventListener(zoomResetBtn, 'click', () => this.resetZoom());

        this.lifecycle.addEventListener(planStage, 'pointerdown', (event) => this.handlePointerDown(event));
        this.lifecycle.addEventListener(planStage, 'pointermove', (event) => this.handlePointerMove(event));
        this.lifecycle.addEventListener(planStage, 'pointerleave', () => this.clearPreviewPoint());
        this.lifecycle.addEventListener(planStage, 'dblclick', (event) => this.handleDoubleClick(event));
        this.lifecycle.addEventListener(planStage, 'contextmenu', (event) => this.handleContextMenu(event));

        this.lifecycle.addEventListener(fullscreenBtn, 'click', () => this.toggleFullscreen());
        this.lifecycle.addEventListener(fullScreenToggle, 'click', () => this.toggleFullscreen());
        this.lifecycle.addEventListener(document, 'keydown', (event) => {
            if (event.key === 'Escape' && this.state.isFullscreen) {
                this.setFullscreen(false);
            }
        });

        this.lifecycle.addEventListener(countColor, 'change', (event) => this.updateCountSetting('color', event.target.value));
        this.lifecycle.addEventListener(countShape, 'change', (event) => this.updateCountSetting('shape', event.target.value));
        this.lifecycle.addEventListener(countLabel, 'input', (event) => this.updateCountSetting('label', event.target.value));

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

        this.lifecycle.addEventListener(rotateLeftBtn, 'click', () => this.rotateActiveDrawing(-90));
        this.lifecycle.addEventListener(rotateRightBtn, 'click', () => this.rotateActiveDrawing(90));
        this.lifecycle.addEventListener(openSourceBtn, 'click', () => this.openActiveDrawingSource());
        this.lifecycle.addEventListener(noteModeBtn, 'click', () => this.toggleNoteMode());
        this.lifecycle.addEventListener(annotationLayer, 'click', (event) => this.handleAnnotationClick(event));
    }

    restoreState() {
        const storage = this.services.storage;
        if (!storage) {
            return;
        }
        try {
            const raw = storage.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return;
            }
            this.state.drawings = parsed.map((item) => {
                const planNotes = Array.isArray(item.planNotes)
                    ? item.planNotes
                    : Array.isArray(item.notes)
                        ? item.notes
                        : [];

                return {
                    ...item,
                    type: item.type || 'image',
                    annotations: Array.isArray(item.annotations) ? item.annotations : [],
                    notes: typeof item.notes === 'string' ? item.notes : '',
                    planNotes,
                    rotation: item.rotation || 0
                };
            });
            this.state.drawings.forEach((drawing) => {
                if (Array.isArray(drawing.savedMeasurements) && drawing.savedMeasurements.length) {
                    this.setMeasurementItems(drawing.id, drawing.savedMeasurements);
                }
                delete drawing.savedMeasurements;
            });
            if (this.state.drawings.length && !this.state.currentDrawingId) {
                this.state.currentDrawingId = this.state.drawings[0].id;
            }
        } catch (error) {
            console.warn('Unable to restore takeoff drawings from storage', error);
        }
    }

    persistState() {
        const storage = this.services.storage;
        if (!storage) {
            return;
        }
        try {
            const payload = this.state.drawings.map((drawing) => ({
                id: drawing.id,
                name: drawing.name,
                trade: drawing.trade,
                floor: drawing.floor,
                page: drawing.page,
                notes: drawing.notes || '',
                type: drawing.type,
                rotation: drawing.rotation || 0,
                createdAt: drawing.createdAt,
                annotations: Array.isArray(drawing.annotations) ? drawing.annotations : [],
                planNotes: Array.isArray(drawing.planNotes) ? drawing.planNotes : [],
                savedMeasurements: this.getMeasurementItems(drawing.id)
            }));
            storage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (error) {
            console.warn('Unable to persist takeoff drawings', error);
        }
    }

    createEmptyCounters() {
        return { length: 0, area: 0, count: 0, diameter: 0 };
    }

    recalculateCounters(items = []) {
        const counters = this.createEmptyCounters();
        items.forEach((item) => {
            const mode = item?.mode;
            if (mode && Object.prototype.hasOwnProperty.call(counters, mode)) {
                counters[mode] += 1;
            }
        });
        return counters;
    }

    getMeasurementCounters(drawingId, { create = false } = {}) {
        if (!drawingId) {
            return null;
        }
        let counters = this.measurementCounters.get(drawingId);
        if (!counters && create) {
            counters = this.createEmptyCounters();
            this.measurementCounters.set(drawingId, counters);
        }
        return counters || null;
    }

    generateMeasurementName(drawingId, mode) {
        const counters = this.getMeasurementCounters(drawingId, { create: true });
        if (!counters) {
            return MODE_LABELS[mode] || 'Measurement';
        }
        if (!Object.prototype.hasOwnProperty.call(counters, mode)) {
            counters[mode] = 0;
        }
        counters[mode] = (counters[mode] || 0) + 1;
        return `${MODE_LABELS[mode] || 'Measurement'} ${counters[mode]}`;
    }

    updateScaleControls(drawing = this.getActiveDrawing()) {
        const { scaleInput } = this.elements;
        if (!scaleInput) {
            return;
        }
        if (!drawing) {
            scaleInput.value = '';
            scaleInput.disabled = true;
            return;
        }
        scaleInput.disabled = false;
        const scale = this.getDrawingScale(drawing);
        scaleInput.value = Number.isFinite(scale) ? scale : '';
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
            if (!this.measurementCounters.has(drawingId)) {
                this.measurementCounters.set(drawingId, this.createEmptyCounters());
            }
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
        this.measurementCounters.set(drawingId, this.recalculateCounters(normalized));
        if (drawingId === this.state.currentDrawingId) {
            this.refreshMeasurementTable(drawingId);
        }
        this.drawMeasurements();
        this.persistState();
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
        this.persistState();
        return prepared;
    }

    createMeasurement({ mode, points, quantity, units, details, color, shape, label, labelPosition, fill, closed }) {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            return null;
        }
        const drawingId = drawing.id;
        const sequence = this.updateCountCounters(drawingId, mode || 'length');
        const name = `${MODE_LABELS[mode] || 'Measurement'} ${sequence}`;
        const payload = {
            id: createId('measurement'),
            name,
            mode,
            points: Array.isArray(points) ? points.map((point) => ({ ...point })) : [],
            quantity,
            units,
            details,
            color,
            shape,
            label,
            labelPosition,
            fill,
            closed
        };
        return this.addMeasurement(drawingId, payload);
    }

    finalizeMeasurement(points) {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            return null;
        }
        const mode = this.state.mode;
        const normalizedPoints = Array.isArray(points)
            ? points.map((point) => ({
                x: Number(point.x),
                y: Number(point.y)
            })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
            : [];
        if (!normalizedPoints.length) {
            return null;
        }

        const scale = this.getDrawingScale(drawing);
        let quantity = 0;
        let units = '';
        let details = '';
        let label = '';
        let labelPosition = null;
        let color = undefined;
        let fill = undefined;
        let closed = false;

        if (mode === 'length' || mode === 'diameter') {
            if (normalizedPoints.length < 2) {
                return null;
            }
            const start = normalizedPoints[0];
            const end = normalizedPoints[normalizedPoints.length - 1];
            const pixels = distance(start, end);
            const feet = pixels / (scale || 1);
            quantity = feet;
            units = 'ft';
            const formatted = formatNumber(feet);
            details = `${formatted} ft`;
            label = mode === 'diameter' ? `Ø ${formatted} ft` : `${formatted} ft`;
            labelPosition = {
                x: (start.x + end.x) / 2,
                y: (start.y + end.y) / 2
            };
        } else if (mode === 'area') {
            if (normalizedPoints.length < 3) {
                return null;
            }
            const closedPoints = [...normalizedPoints, normalizedPoints[0]];
            const pxArea = computePolygonArea(closedPoints);
            const sqft = pxArea / ((scale || 1) ** 2);
            quantity = sqft;
            units = 'sq ft';
            const formatted = formatNumber(sqft);
            details = `${formatted} sq ft`;
            label = `${formatted} sq ft`;
            labelPosition = computeCentroid(normalizedPoints);
            color = 'rgba(37, 99, 235, 0.85)';
            fill = 'rgba(37, 99, 235, 0.15)';
            closed = true;
        } else {
            return null;
        }

        const measurement = this.createMeasurement({
            mode,
            points: normalizedPoints,
            quantity,
            units,
            details,
            color,
            fill,
            closed,
            label,
            labelPosition
        });
        if (measurement) {
            this.updateStatus(`${MODE_LABELS[mode]} measurement added.`);
        }
        return measurement;
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
        this.persistState();
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
        this.measurementCounters.set(drawingId, this.createEmptyCounters());
        this.resetDraft();
        if (drawingId === this.state.currentDrawingId) {
            this.refreshMeasurementTable(drawingId);
        }
        this.drawMeasurements();
        this.updateStatus('Measurements cleared.');
        this.measurementCounters.delete(drawingId);
        this.persistState();
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
            const label = MODE_LABELS[measurement.mode] || measurement.type || measurement.mode || '';
            modeCell.textContent = label;
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

    updateCountSetting(field, value) {
        if (!field || !(field in this.state.countSettings)) {
            return;
        }
        const nextValue = field === 'label'
            ? value
            : (value || this.state.countSettings[field]);
        this.state.countSettings = {
            ...this.state.countSettings,
            [field]: nextValue
        };
        this.updateCountToolbarVisibility();
        if (field !== 'label') {
            this.drawMeasurements();
        }
    }

    updateModeControls() {
        const { modeSelect } = this.elements;
        if (modeSelect && modeSelect.value !== this.state.mode) {
            modeSelect.value = this.state.mode;
        }
    }

    setMode(mode) {
        const allowed = new Set(Object.keys(MODE_LABELS));
        const normalized = allowed.has(mode) ? mode : 'length';
        if (this.state.mode === normalized) {
            return;
        }
        this.state.mode = normalized;
        this.resetDraft();
        this.updateModeControls();
        const { planStage } = this.elements;
        if (planStage) {
            planStage.dataset.mode = normalized;
        }
        this.updateCountToolbarVisibility();
        this.updateStatus(`${MODE_LABELS[normalized]} mode active.`);
    }

    updateCountToolbarVisibility() {
        const { countToolbar } = this.elements;
        if (countToolbar) {
            countToolbar.classList.toggle('is-hidden', this.state.mode !== 'count');
        }
    }

    handleScaleChange(event) {
        const value = Number.parseFloat(event?.target?.value);
        if (!Number.isFinite(value) || value <= 0) {
            if (event?.target) {
                event.target.value = this.state.scale;
            }
            this.services.toast('Enter a valid scale greater than 0.', 'warning');
            return;
        }
        this.state.scale = value;
        const drawing = this.getActiveDrawing();
        if (drawing) {
            drawing.scale = value;
        }
        this.updateStatus(`Scale set to ${formatNumber(value, { maximumFractionDigits: 4 })} px per ft.`);
        if (drawing) {
            this.recalculateMeasurementValues(drawing.id);
            this.refreshMeasurementTable(drawing.id);
        }
        this.drawMeasurements();
    }

    updateScaleInput(drawing = this.getActiveDrawing()) {
        const { scaleInput } = this.elements;
        if (!scaleInput) {
            return;
        }
        const scale = this.getDrawingScale(drawing);
        if (Number.isFinite(scale) && scale > 0) {
            scaleInput.value = scale;
        }
    }

    getDrawingScale(drawing = this.getActiveDrawing()) {
        if (drawing) {
            const value = Number(drawing.scale);
            if (Number.isFinite(value) && value > 0) {
                return value;
            }
        }
        const fallback = Number(this.state.scale);
        if (Number.isFinite(fallback) && fallback > 0) {
            return fallback;
        }
        return 1;
    }

    updateCountCounters(drawingId, mode) {
        if (!drawingId) {
            return 0;
        }
        const counters = this.measurementCounters.get(drawingId) || {
            length: 0,
            area: 0,
            count: 0,
            diameter: 0
        };
        counters[mode] = (counters[mode] || 0) + 1;
        this.measurementCounters.set(drawingId, counters);
        return counters[mode];
    }

    recalculateMeasurementValues(drawingId) {
        if (!drawingId) {
            return;
        }
        const drawing = this.state.drawings.find((item) => item.id === drawingId);
        if (!drawing) {
            return;
        }
        const scale = this.getDrawingScale(drawing);
        const store = this.getMeasurementStore(drawingId);
        const items = this.normalizeMeasurements(store);
        items.forEach((measurement) => {
            if (!measurement || !Array.isArray(measurement.points)) {
                return;
            }
            if (measurement.mode === 'length' || measurement.mode === 'diameter') {
                if (measurement.points.length < 2) {
                    return;
                }
                const start = measurement.points[0];
                const end = measurement.points[measurement.points.length - 1];
                const px = distance(start, end);
                const feet = px / (scale || 1);
                const formatted = formatNumber(feet);
                measurement.quantity = feet;
                measurement.units = 'ft';
                measurement.details = `${formatted} ft`;
                measurement.label = measurement.mode === 'diameter'
                    ? `Ø ${formatted} ft`
                    : `${formatted} ft`;
                measurement.labelPosition = {
                    x: (start.x + end.x) / 2,
                    y: (start.y + end.y) / 2
                };
            } else if (measurement.mode === 'area') {
                if (measurement.points.length < 3) {
                    return;
                }
                const closedPoints = [...measurement.points, measurement.points[0]];
                const pxArea = computePolygonArea(closedPoints);
                const sqft = pxArea / ((scale || 1) ** 2);
                const formatted = formatNumber(sqft);
                measurement.quantity = sqft;
                measurement.units = 'sq ft';
                measurement.details = `${formatted} sq ft`;
                measurement.label = `${formatted} sq ft`;
                measurement.labelPosition = computeCentroid(measurement.points);
                measurement.closed = true;
                measurement.fill = measurement.fill || 'rgba(37, 99, 235, 0.15)';
                measurement.color = measurement.color || 'rgba(37, 99, 235, 0.85)';
            }
        });
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
            if (drawing.sourceUrl && drawing.sourceUrl.startsWith('blob:')) {
                URL.revokeObjectURL(drawing.sourceUrl);
                drawing.sourceUrl = null;
            }
            if (drawing.previewUrl && drawing.previewUrl.startsWith('blob:')) {
                URL.revokeObjectURL(drawing.previewUrl);
                drawing.previewUrl = null;
            }
        });
        this.state.drawings = [];
        this.measurements.clear();
        this.measurementCounters.clear();
        this.refreshMeasurementTable();
        this.drawMeasurements();
        this.persistState();
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
                if (drawing) {
                    newDrawings.push(drawing);
                }
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
        this.persistState();

        if (this.elements.drawingInput) {
            this.elements.drawingInput.value = '';
        }
    }

    async createDrawingFromFile(file) {
        const id = createId();

        if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
            const sourceUrl = URL.createObjectURL(file);
            return {
                id,
                name: file.name,
                trade: '',
                floor: '',
                page: '',
                createdAt: Date.now(),
                type: 'image',
                objectUrl: sourceUrl,
                sourceUrl,
                file,
                previewUrl: sourceUrl,
                naturalWidth: null,
                naturalHeight: null,
                rotation: 0,
                annotations: [],
                notes: '',
                planNotes: []
            };
        }

        if (SUPPORTED_PDF_TYPES.has(file.type)) {
            return this.createPdfDrawing(file, id);
        }

        throw new Error('Unsupported file type. Upload PDF, PNG, JPG, GIF, SVG, or WebP plans.');
    }

    async createPdfDrawing(file, id) {
        await this.ensurePdfWorker();
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pageNumber = 1;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: DEFAULT_PDF_SCALE });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
        const previewUrl = canvas.toDataURL('image/png');
        const sourceUrl = URL.createObjectURL(file);

        return {
            id,
            name: file.name,
            trade: '',
            floor: '',
            page: String(pageNumber),
            createdAt: Date.now(),
            type: 'pdf',
            objectUrl: sourceUrl,
            sourceUrl,
            file,
            previewUrl,
            rotation: 0,
            annotations: [],
            notes: '',
            planNotes: [],
            pdfData: arrayBuffer,
            pdfPageCount: pdf.numPages,
            currentPage: pageNumber,
            naturalWidth: canvas.width,
            naturalHeight: canvas.height
        };

        try {
            if (SUPPORTED_IMAGE_TYPES.has(file.type) || extension.match(/\.(png|jpe?g|webp|gif|svg)$/)) {
                drawing.type = 'image';
                await this.prepareImagePreview(drawing, { rotation: 0 });
                return drawing;
            }

            if (SUPPORTED_PDF_TYPES.has(file.type) || extension.endsWith('.pdf')) {
                drawing.type = 'pdf';
                await this.preparePdfPreview(drawing, { rotation: 0 });
                return drawing;
            }
        } catch (error) {
            URL.revokeObjectURL(objectUrl);
            throw error;
        }

        URL.revokeObjectURL(objectUrl);
        throw new Error('Unsupported file type. Upload PDF, PNG, JPG, GIF, or WebP plans.');
    }

    async prepareImagePreview(drawing, { rotation = 0 } = {}) {
        if (!drawing) return;
        if (!drawing.sourceDataUrl) {
            drawing.sourceDataUrl = await this.readFileAsDataURL(drawing.file);
        }

        const image = await this.loadImage(drawing.sourceDataUrl);
        drawing.originalWidth = image.naturalWidth;
        drawing.originalHeight = image.naturalHeight;
        drawing.rotation = ((rotation % 360) + 360) % 360;

        const { dataUrl, width, height } = await this.renderImageWithRotation(image, drawing.rotation);
        drawing.previewUrl = dataUrl;
        drawing.naturalWidth = width;
        drawing.naturalHeight = height;
    }

    async preparePdfPreview(drawing, { rotation = 0 } = {}) {
        if (typeof window === 'undefined' || !window.pdfjsLib) {
            throw new Error('PDF preview support is not available.');
        }

        const loadingTask = window.pdfjsLib.getDocument({ url: drawing.objectUrl });
        const pdf = await loadingTask.promise;
        try {
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 1.5, rotation: ((rotation % 360) + 360) % 360 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: context, viewport }).promise;

            drawing.previewUrl = canvas.toDataURL('image/png');
            drawing.naturalWidth = canvas.width;
            drawing.naturalHeight = canvas.height;
            drawing.rotation = ((rotation % 360) + 360) % 360;
            drawing.pageCount = pdf.numPages;
        } finally {
            pdf.cleanup?.();
            pdf.destroy?.();
        }
    }

    async readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Unable to read file.'));
            reader.readAsDataURL(file);
        });
    }

    async loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Unable to load image.'));
            img.src = src;
        });
    }

    async renderImageWithRotation(image, rotation) {
        const angle = ((rotation % 360) + 360) % 360;
        const needsSwap = angle === 90 || angle === 270;
        const width = needsSwap ? image.naturalHeight : image.naturalWidth;
        const height = needsSwap ? image.naturalWidth : image.naturalHeight;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = Math.max(Math.round(width), 1);
        canvas.height = Math.max(Math.round(height), 1);
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate((angle * Math.PI) / 180);
        context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
        return {
            dataUrl: canvas.toDataURL('image/png'),
            width: canvas.width,
            height: canvas.height
        };
    }

    async ensurePdfWorker() {
        if (this.pdfWorkerInitialized) {
            return;
        }
        if (typeof window === 'undefined' || !window.pdfjsLib) {
            throw new Error('PDF renderer not available.');
        }
        const workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
        }
        this.pdfWorkerInitialized = true;
    }

    async refreshDrawingPreview(drawing) {
        if (!drawing) {
            return;
        }
        if (drawing.type === 'pdf') {
            await this.renderPdfPreview(drawing);
        } else {
            await this.renderImagePreview(drawing);
        }
    }

    async renderImagePreview(drawing) {
        if (!drawing?.sourceUrl) {
            return;
        }
        const image = await this.loadImageResource(drawing.sourceUrl);
        const rotation = (drawing.rotation || 0) % 360;
        if (!rotation) {
            drawing.previewUrl = drawing.sourceUrl;
            drawing.naturalWidth = image.naturalWidth;
            drawing.naturalHeight = image.naturalHeight;
            return;
        }

        const radians = rotation * Math.PI / 180;
        const swap = rotation % 180 !== 0;
        const width = swap ? image.naturalHeight : image.naturalWidth;
        const height = swap ? image.naturalWidth : image.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.translate(width / 2, height / 2);
        context.rotate(radians);
        context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
        drawing.previewUrl = canvas.toDataURL('image/png');
        drawing.naturalWidth = width;
        drawing.naturalHeight = height;
    }

    async renderPdfPreview(drawing) {
        await this.ensurePdfWorker();
        const data = drawing.pdfData || await drawing.file?.arrayBuffer();
        if (!data) {
            return;
        }
        drawing.pdfData = data;
        const pdf = await window.pdfjsLib.getDocument({ data }).promise;
        const pageIndex = drawing.currentPage || 1;
        const page = await pdf.getPage(pageIndex);
        const viewport = page.getViewport({ scale: DEFAULT_PDF_SCALE, rotation: drawing.rotation || 0 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
        drawing.previewUrl = canvas.toDataURL('image/png');
        drawing.naturalWidth = canvas.width;
        drawing.naturalHeight = canvas.height;
        drawing.pdfPageCount = pdf.numPages;
    }

    loadImageResource(url) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = url;
        });
    }

    getActiveDrawing() {
        return this.state.drawings.find((drawing) => drawing.id === this.state.currentDrawingId) || null;
    }

    getFilteredDrawings() {
        const { drawings, filter, sortBy, sortDir } = this.state;
        const filtered = filter
            ? drawings.filter((drawing) => {
                const haystack = [drawing.name, drawing.trade, drawing.floor, drawing.page, drawing.notes]
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
            const typeLabel = drawing.type === 'pdf' ? 'PDF Plan' : 'Image Plan';
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
                    <td>
                        <input type="text" class="form-input takeoff-input" data-field="notes" value="${escapeHtml(drawing.notes || '')}" placeholder="Notes">
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

    ensurePlanNotesCollection(drawing) {
        if (!drawing) {
            return [];
        }

        if (!Array.isArray(drawing.planNotes)) {
            if (Array.isArray(drawing.notes)) {
                drawing.planNotes = [...drawing.notes];
                drawing.notes = '';
            } else {
                drawing.planNotes = [];
            }
        }

        return drawing.planNotes;
    }

    renderNotes(drawing) {
        const { noteList } = this.elements;
        if (!noteList) {
            return;
        }

        if (!drawing) {
            noteList.innerHTML = '<li class="takeoff-note-item takeoff-note-empty">Select a drawing to capture plan notes.</li>';
            return;
        }

        const notes = this.ensurePlanNotesCollection(drawing);
        if (!notes.length) {
            noteList.innerHTML = '<li class="takeoff-note-item takeoff-note-empty">No notes yet. Add context before sharing takeoffs.</li>';
            return;
        }

        noteList.innerHTML = notes.map((note) => {
            const timestamp = note.createdAt ? new Date(note.createdAt).toLocaleString() : '';
            return `
                <li class="takeoff-note-item" data-note-id="${escapeHtml(note.id)}">
                    <div class="takeoff-note-text">${escapeHtml(note.text)}</div>
                    <div class="takeoff-note-meta">
                        ${escapeHtml(timestamp)}
                        <button type="button" class="btn btn-ghost takeoff-note-remove" data-action="remove-note" aria-label="Remove note">Remove</button>
                    </div>
                </li>
            `;
        }).join('');
    }

    handleAddNote() {
        const { noteInput } = this.elements;
        const drawing = this.getActiveDrawing();
        if (!drawing || !noteInput) {
            this.showToast('Select a drawing before adding a note.', 'warning');
            return;
        }

        const text = noteInput.value.trim();
        if (!text) {
            this.showToast('Enter a note before saving.', 'warning');
            return;
        }

        const notes = this.ensurePlanNotesCollection(drawing);

        notes.unshift({
            id: createId('note'),
            text,
            createdAt: Date.now()
        });
        noteInput.value = '';
        this.renderNotes(drawing);
        this.showToast('Note added to drawing.', 'success');
    }

    handleNoteListClick(event) {
        const removeButton = event.target.closest('[data-action="remove-note"]');
        if (!removeButton) {
            return;
        }
        const item = removeButton.closest('[data-note-id]');
        const drawing = this.getActiveDrawing();
        if (!drawing || !item) {
            return;
        }

        const noteId = item.getAttribute('data-note-id');
        drawing.planNotes = this.ensurePlanNotesCollection(drawing).filter((note) => note.id !== noteId);
        this.renderNotes(drawing);
        this.showToast('Note removed.', 'info');
    }

    async rotateActiveDrawing(delta = ROTATION_INCREMENT) {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.showToast('Select a drawing before rotating.', 'warning');
            return;
        }
        const nextRotation = ((drawing.rotation || 0) + delta) % 360;
        try {
            if (drawing.type === 'pdf') {
                await this.preparePdfPreview(drawing, { rotation: nextRotation });
            } else {
                await this.prepareImagePreview(drawing, { rotation: nextRotation });
            }
            await this.updatePlanPreview(drawing);
            this.drawMeasurements();
            this.updateStatus(`Rotation set to ${drawing.rotation}°.`);
        } catch (error) {
            console.error('Unable to rotate drawing', error);
            this.showToast('Unable to rotate document preview.', 'error');
        }
    }

    openActiveDocument() {
        if (typeof window === 'undefined') {
            return;
        }
        const drawing = this.getActiveDrawing();
        if (!drawing || !drawing.objectUrl) {
            this.showToast('Select a drawing before opening the source file.', 'warning');
            return;
        }
        try {
            window.open(drawing.objectUrl, '_blank', 'noopener');
        } catch (error) {
            console.error('Unable to open drawing', error);
            this.showToast('Unable to open the original document.', 'error');
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
        if (field === 'trade' || field === 'floor' || field === 'page' || field === 'notes') {
            this.updateActiveDrawingDisplay();
        }
        const point = this.getPointerPosition(event);
        if (point) {
            this.state.previewPoint = point;
        }
        this.drawMeasurements();
        this.persistState();
    }

    handleContextMenu(event) {
        if (!this.state.draftPoints.length) {
            return;
        }
        event.preventDefault();
        this.resetDraft();
    }

    resetDraft() {
        this.state.draftPoints = [];
        this.state.previewPoint = null;
        this.drawMeasurements();
    }

    clearPreviewPoint() {
        if (this.state.previewPoint) {
            this.state.previewPoint = null;
            this.drawMeasurements();
        }
    }

    drawMeasurements() {
        const { canvas } = this.elements;
        if (!canvas) {
            return;
        }

        const context = this.canvasContext || canvas.getContext('2d');
        if (!this.canvasContext && context) {
            this.canvasContext = context;
        }
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
        measurements.forEach((measurement) => this.renderMeasurement(context, measurement));

        if (this.state.mode === 'count' && this.state.previewPoint) {
            this.renderCountMarker(context, this.state.previewPoint, this.state.countSettings.color, this.state.countSettings.shape, this.state.countSettings.label, this.state.zoom);
        }

        if (this.state.draftPoints.length) {
            this.renderDraft(context);
        }
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

        if (measurement.mode === 'count') {
            const point = Array.isArray(measurement.points) ? measurement.points[0] : null;
            if (!point) {
                return;
            }
            this.renderCountMarker(
                context,
                point,
                measurement.color || this.state.countSettings.color,
                measurement.shape || this.state.countSettings.shape,
                measurement.label || this.state.countSettings.label,
                this.state.zoom
            );
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
        return { x, y };
    }

    getLabelAnchor(measurement, points, scale) {
        if (measurement.labelPosition) {
            return this.toCanvasPoint(measurement.labelPosition, scale);
        }
        return points[points.length - 1] || null;
    }

    renderDraft(context) {
        const zoom = Number.isFinite(this.state.zoom) ? this.state.zoom : 1;
        const basePoints = [...this.state.draftPoints];
        if (this.state.mode !== 'count' && this.state.previewPoint) {
            basePoints.push(this.state.previewPoint);
        }
        const points = basePoints
            .map((point) => this.toCanvasPoint(point, zoom))
            .filter(Boolean);
        if (points.length < 1) {
            return;
        }
        context.save();
        context.setLineDash([6, 4]);
        context.lineWidth = 1;
        context.strokeStyle = 'rgba(37, 99, 235, 0.7)';
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
            context.lineTo(points[index].x, points[index].y);
        }
        if (this.state.mode === 'area' && points.length > 2) {
            context.closePath();
        }
        context.stroke();
        context.restore();
    }

    renderCountMarker(context, point, color, shape, label, zoomValue = 1) {
        const zoom = Number.isFinite(zoomValue) ? zoomValue : 1;
        const scaledPoint = this.toCanvasPoint(point, zoom);
        if (!scaledPoint) {
            return;
        }
        const size = 12 * zoom;
        const half = size / 2;
        context.save();
        context.strokeStyle = color || '#ef4444';
        context.fillStyle = color || '#ef4444';
        context.lineWidth = 2;
        switch (shape) {
            case 'square':
                context.strokeRect(scaledPoint.x - half, scaledPoint.y - half, size, size);
                break;
            case 'diamond':
                context.beginPath();
                context.moveTo(scaledPoint.x, scaledPoint.y - half);
                context.lineTo(scaledPoint.x + half, scaledPoint.y);
                context.lineTo(scaledPoint.x, scaledPoint.y + half);
                context.lineTo(scaledPoint.x - half, scaledPoint.y);
                context.closePath();
                context.stroke();
                break;
            case 'triangle':
                context.beginPath();
                context.moveTo(scaledPoint.x, scaledPoint.y - half);
                context.lineTo(scaledPoint.x + half, scaledPoint.y + half);
                context.lineTo(scaledPoint.x - half, scaledPoint.y + half);
                context.closePath();
                context.stroke();
                break;
            default:
                context.beginPath();
                context.arc(scaledPoint.x, scaledPoint.y, half, 0, Math.PI * 2);
                context.stroke();
                break;
        }

        if (label) {
            context.font = `${Math.max(12 * zoom, 10)}px sans-serif`;
            context.fillText(label, scaledPoint.x + half + 4, scaledPoint.y + 4);
        }
        context.restore();
    }

    toggleNoteMode(force) {
        const drawing = this.getActiveDrawing();
        const nextState = typeof force === 'boolean' ? force : !this.state.noteMode;
        if (!drawing) {
            this.state.noteMode = false;
            if (this.elements.noteModeBtn) {
                this.elements.noteModeBtn.setAttribute('aria-pressed', 'false');
            }
            this.services.toast('Select a drawing before adding notes.', 'warning');
            return;
        }
        this.state.noteMode = nextState;
        if (this.elements.noteModeBtn) {
            this.elements.noteModeBtn.setAttribute('aria-pressed', nextState ? 'true' : 'false');
        }
        this.updateStatus(nextState
            ? 'Note mode enabled — click the plan to place a note.'
            : 'Note mode disabled.');
    }

    addNoteAt(point) {
        const drawing = this.getActiveDrawing();
        if (!drawing || !point) {
            return;
        }
        const text = window.prompt('Add note text');
        if (text === null) {
            return;
        }
        const trimmed = text.trim();
        if (!trimmed) {
            this.updateStatus('Note cancelled.');
            return;
        }

        const width = drawing.naturalWidth || this.elements.planInner?.offsetWidth || 0;
        const height = drawing.naturalHeight || this.elements.planInner?.offsetHeight || 0;
        const annotation = {
            id: createId('note'),
            x: clamp(point.x, 0, width),
            y: clamp(point.y, 0, height),
            text: trimmed
        };
        drawing.annotations = Array.isArray(drawing.annotations) ? drawing.annotations : [];
        drawing.annotations.push(annotation);
        this.renderNotes();
        this.persistState();
        this.updateStatus('Note added.');
    }

    renderNotes() {
        const { annotationLayer, noteModeBtn } = this.elements;
        if (!annotationLayer) {
            return;
        }
        annotationLayer.innerHTML = '';
        const drawing = this.getActiveDrawing();
        if (!drawing || !Array.isArray(drawing.annotations)) {
            if (noteModeBtn) {
                noteModeBtn.setAttribute('aria-pressed', 'false');
            }
            this.state.noteMode = false;
            return;
        }

        drawing.annotations.forEach((note) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'takeoff-note';
            button.dataset.id = note.id;
            button.style.left = `${note.x}px`;
            button.style.top = `${note.y}px`;
            button.textContent = note.text || 'Note';
            annotationLayer.appendChild(button);
        });

        if (noteModeBtn) {
            noteModeBtn.setAttribute('aria-pressed', this.state.noteMode ? 'true' : 'false');
        }
    }

    handleAnnotationClick(event) {
        const target = event.target.closest('.takeoff-note');
        if (!target) {
            return;
        }
        const drawing = this.getActiveDrawing();
        if (!drawing || !Array.isArray(drawing.annotations)) {
            return;
        }
        const note = drawing.annotations.find((item) => item.id === target.dataset.id);
        if (!note) {
            return;
        }
        const updated = window.prompt('Edit note text (leave empty to remove)', note.text || '');
        if (updated === null) {
            return;
        }
        const trimmed = updated.trim();
        if (!trimmed) {
            drawing.annotations = drawing.annotations.filter((item) => item.id !== note.id);
            this.updateStatus('Note removed.');
        } else {
            note.text = trimmed;
            this.updateStatus('Note updated.');
        }
        this.renderNotes();
        this.persistState();
    }

    rotateAnnotations(drawing, delta, prevWidth, prevHeight) {
        if (!Array.isArray(drawing?.annotations) || !drawing.annotations.length) {
            return;
        }
        const normalized = ((delta % 360) + 360) % 360;
        if (!normalized || !prevWidth || !prevHeight) {
            return;
        }
        drawing.annotations.forEach((note) => {
            const { x, y } = note;
            if (normalized === 90) {
                note.x = prevHeight - y;
                note.y = x;
            } else if (normalized === 180) {
                note.x = prevWidth - x;
                note.y = prevHeight - y;
            } else if (normalized === 270) {
                note.x = y;
                note.y = prevWidth - x;
            }
        });
    }

    updatePdfControls(drawing) {
        const { openSourceBtn, rotateLeftBtn, rotateRightBtn, noteModeBtn } = this.elements;
        const hasDrawing = Boolean(drawing);
        const hasSource = Boolean(drawing?.sourceUrl);
        [rotateLeftBtn, rotateRightBtn, noteModeBtn].forEach((btn) => {
            if (btn) {
                btn.disabled = !hasDrawing;
            }
        });
        if (openSourceBtn) {
            openSourceBtn.disabled = !hasSource;
        }
        if (!hasDrawing) {
            this.state.noteMode = false;
            if (noteModeBtn) {
                noteModeBtn.setAttribute('aria-pressed', 'false');
            }
        }
    }

    async rotateActiveDrawing(delta = 90) {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.services.toast('Select a drawing before rotating.', 'warning');
            return;
        }
        const step = delta >= 0 ? 90 : -90;
        const normalizedDelta = (Math.round(delta / 90) || (delta > 0 ? 1 : -1)) * step;
        const rotation = ((drawing.rotation || 0) + normalizedDelta + 360) % 360;
        const prevWidth = drawing.naturalWidth || this.elements.planInner?.offsetWidth || 0;
        const prevHeight = drawing.naturalHeight || this.elements.planInner?.offsetHeight || 0;
        drawing.rotation = rotation;

        try {
            await this.refreshDrawingPreview(drawing);
            this.rotateAnnotations(drawing, normalizedDelta, prevWidth, prevHeight);
            this.setMeasurementItems(drawing.id, []);
            await this.updatePlanPreview(drawing);
            this.refreshMeasurementTable(drawing.id);
            this.drawMeasurements();
            this.renderNotes();
            this.updateStatus(`Rotated drawing to ${rotation}°. Existing measurements were cleared.`);
            this.persistState();
        } catch (error) {
            console.error('Failed to rotate drawing', error);
            this.services.toast('Unable to rotate drawing.', 'error');
        }
    }

    openActiveDrawingSource() {
        const drawing = this.getActiveDrawing();
        if (!drawing || !drawing.sourceUrl) {
            this.services.toast('Upload a drawing before opening the original.', 'warning');
            return;
        }
        window.open(drawing.sourceUrl, '_blank', 'noopener');
    }

    removeDrawing(id) {
        const index = this.state.drawings.findIndex((drawing) => drawing.id === id);
        if (index === -1) return;

        const [removed] = this.state.drawings.splice(index, 1);
        if (removed?.objectUrl) {
            URL.revokeObjectURL(removed.objectUrl);
        }
        if (removed?.sourceUrl && removed.sourceUrl.startsWith('blob:')) {
            URL.revokeObjectURL(removed.sourceUrl);
        }
        this.measurements.delete(id);
        this.measurementCounters.delete(id);

        let nextId = this.state.currentDrawingId;
        if (nextId === id) {
            nextId = this.state.drawings[0]?.id || null;
        }

        this.state.currentDrawingId = null;
        if (nextId) {
            this.selectDrawing(nextId);
        } else {
            this.renderDrawingList();
            this.updateActiveDrawingDisplay();
            this.updatePlanVisibility();
            this.refreshMeasurementTable();
            this.drawMeasurements();
            this.updatePdfControls(null);
            this.updateScaleControls();
            this.updateZoomIndicator();
            this.updateCountToolbarVisibility();
        }

        this.updateStatus('Drawing removed.');
        this.persistState();
    }

    getPointerPosition(event) {
        const { planInner, canvas, planContainer } = this.elements;
        const target = planInner || canvas || planContainer;
        if (!target || typeof target.getBoundingClientRect !== 'function') {
            return null;
        }

        let clientX;
        let clientY;
        if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
            clientX = event.clientX;
            clientY = event.clientY;
        } else if (event?.touches?.length) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else if (event?.changedTouches?.length) {
            clientX = event.changedTouches[0].clientX;
            clientY = event.changedTouches[0].clientY;
        } else {
            return null;
        }

        const rect = target.getBoundingClientRect();
        const zoom = Number.isFinite(this.state.zoom) && this.state.zoom > 0 ? this.state.zoom : 1;
        const x = (clientX - rect.left) / zoom;
        const y = (clientY - rect.top) / zoom;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
        }
        return { x, y };
    }

    handlePointerDown(event) {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.services.toast('Upload a drawing before measuring.', 'warning');
            return;
        }
        const point = this.getPointerPosition(event);
        if (!point) {
            return;
        }

        if (this.state.noteMode) {
            event.preventDefault?.();
            this.addNoteAt(point);
            return;
        }

        if (this.state.mode === 'count') {
            event.preventDefault?.();
            const measurement = this.createMeasurement({
                mode: 'count',
                points: [point],
                quantity: 1,
                units: 'ea',
                details: this.state.countSettings.label || 'Count marker',
                color: this.state.countSettings.color,
                shape: this.state.countSettings.shape,
                label: this.state.countSettings.label
            });
            if (measurement) {
                this.updateStatus('Count marker added.');
                this.persistState();
            }
            return;
        }

        if (!this.state.draftPoints.length) {
            this.state.draftPoints = [point];
            this.state.previewPoint = null;
            this.drawMeasurements();
            return;
        }

        if (this.state.mode === 'length' || this.state.mode === 'diameter') {
            const points = [...this.state.draftPoints, point];
            event.preventDefault?.();
            const measurement = this.finalizeMeasurement(points);
            if (measurement) {
                this.persistState();
            }
            this.resetDraft();
            return;
        }

        if (this.state.mode === 'area') {
            this.state.draftPoints.push(point);
            this.drawMeasurements();
        }
    }

    handlePointerMove(event) {
        const point = this.getPointerPosition(event);
        if (this.state.mode === 'count') {
            this.state.previewPoint = point;
            this.drawMeasurements();
            return;
        }
        if (!this.state.draftPoints.length) {
            if (this.state.previewPoint !== point) {
                this.state.previewPoint = point;
                this.drawMeasurements();
            }
            return;
        }
        this.state.previewPoint = point;
        this.drawMeasurements();
    }

    handleDoubleClick(event) {
        if (this.state.mode !== 'area') {
            return;
        }
        if (!this.state.draftPoints.length) {
            return;
        }
        const point = this.getPointerPosition(event);
        const points = [...this.state.draftPoints];
        if (point) {
            points.push(point);
        }
        event.preventDefault?.();
        this.finalizeMeasurement(points);
        this.resetDraft();
    }

    handlePlanContextMenu(event) {
        if (this.state.draftPoints.length) {
            event.preventDefault();
            this.resetDraft();
        }
    }

    drawDraft(context) {
        if (!this.state.draftPoints.length) {
            return;
        }
        if (this.state.mode === 'count') {
            return;
        }
        const scale = Number.isFinite(this.state.zoom) ? this.state.zoom : 1;
        const basePoints = [...this.state.draftPoints];
        if (this.state.previewPoint) {
            basePoints.push(this.state.previewPoint);
        }
        const points = basePoints
            .map((point) => this.toCanvasPoint(point, scale))
            .filter(Boolean);
        if (!points.length) {
            return;
        }
        context.save();
        context.lineWidth = 2;
        context.strokeStyle = 'rgba(37, 99, 235, 0.9)';
        context.setLineDash([6, 4]);
        context.beginPath();
        points.forEach(({ x, y }, index) => {
            if (index === 0) {
                context.moveTo(x, y);
            } else {
                context.lineTo(x, y);
            }
        });
        if (this.state.mode === 'area' && points.length > 2) {
            context.closePath();
            context.fillStyle = 'rgba(37, 99, 235, 0.12)';
            context.fill();
        }
        context.stroke();
        context.restore();
    }

    drawCountMarker(context, point, color, shape, label) {
        if (!point) {
            return;
        }
        const scale = Number.isFinite(this.state.zoom) ? this.state.zoom : 1;
        const canvasPoint = this.toCanvasPoint(point, scale);
        if (!canvasPoint) {
            return;
        }
        const { x, y } = canvasPoint;
        const size = 9;
        context.save();
        context.lineWidth = 2;
        context.fillStyle = color || '#ef4444';
        context.strokeStyle = 'rgba(17, 24, 39, 0.6)';
        context.beginPath();
        switch (shape) {
            case 'square':
                context.rect(x - size, y - size, size * 2, size * 2);
                context.closePath();
                break;
            case 'diamond':
                context.moveTo(x, y - size);
                context.lineTo(x + size, y);
                context.lineTo(x, y + size);
                context.lineTo(x - size, y);
                context.closePath();
                break;
            case 'triangle':
                context.moveTo(x, y - size);
                context.lineTo(x + size, y + size);
                context.lineTo(x - size, y + size);
                context.closePath();
                break;
            case 'circle':
            default:
                context.arc(x, y, size, 0, Math.PI * 2);
                context.closePath();
                break;
        }
        context.fill();
        context.stroke();
        if (label) {
            context.font = '12px sans-serif';
            context.fillStyle = color || '#ef4444';
            context.textBaseline = 'middle';
            context.fillText(label, x + size + 6, y);
        }
        context.restore();
    }

    selectDrawing(id) {
        if (!id || this.state.currentDrawingId === id) {
            return;
        }
        this.state.currentDrawingId = id;
        this.state.zoom = 1;
        const drawing = this.getActiveDrawing();
        this.state.scale = this.getDrawingScale(drawing);
        this.resetDraft();
        this.updateScaleInput(drawing);
        this.updateModeControls();
        this.updateCountToolbarVisibility();
        this.renderDrawingList();
        this.updateZoomIndicator();
        this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
        this.refreshMeasurementTable();
        this.drawMeasurements();
        this.renderNotes();
    }

    updatePlanVisibility() {
        const drawing = this.getActiveDrawing();
        const { planContainer, fullscreenBtn, fullScreenToggle } = this.elements;
        const hasDrawing = Boolean(drawing);
        if (!planContainer) return;
        planContainer.classList.toggle('is-hidden', !hasDrawing);
        [fullscreenBtn, fullScreenToggle].forEach((btn) => {
            if (btn) {
                btn.disabled = !hasDrawing;
                btn.classList.toggle('is-disabled', !hasDrawing);
            }
        });
        if (!hasDrawing && this.state.isFullscreen) {
            this.setFullscreen(false);
        }
    }

    updatePdfControls(drawing) {
        const { rotateLeftBtn, rotateRightBtn, openDocumentBtn } = this.elements;
        const hasDrawing = Boolean(drawing);
        [rotateLeftBtn, rotateRightBtn, openDocumentBtn].forEach((btn) => {
            if (btn) {
                btn.disabled = !hasDrawing;
                btn.classList.toggle('is-disabled', !hasDrawing);
            }
        });
        if (openDocumentBtn) {
            openDocumentBtn.setAttribute('aria-disabled', hasDrawing ? 'false' : 'true');
        }
    }

    async updateActiveDrawingDisplay() {
        const drawing = this.getActiveDrawing();
        const { activeMeta } = this.elements;
        if (activeMeta) {
            activeMeta.textContent = formatMeta(drawing);
        }
        await this.updatePlanPreview(drawing);
        this.renderNotes();
        this.updatePdfControls(drawing);
        this.renderNotes(drawing);
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

        if (!drawing.previewUrl && drawing.sourceUrl) {
            await this.refreshDrawingPreview(drawing);
        }

        if (!drawing.previewUrl) {
            planPreview.removeAttribute('src');
            return;
        }

        await this.loadImagePreview(drawing, token);
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


    sizeCanvasToDrawing(drawing) {
        const { canvas, planInner, annotationLayer } = this.elements;
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
        if (annotationLayer) {
            annotationLayer.style.width = `${width}px`;
            annotationLayer.style.height = `${height}px`;
        }
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

    toggleFullscreen() {
        if (!this.getActiveDrawing()) {
            this.services.toast('Select a drawing before entering full view.', 'warning');
            return;
        }
        this.setFullscreen(!this.state.isFullscreen);
    }

    setFullscreen(enabled) {
        const { planCard, fullScreenToggle, fullscreenBtn } = this.elements;
        this.state.isFullscreen = Boolean(enabled);
        if (planCard) {
            planCard.classList.toggle('takeoff-plan-card--fullscreen', this.state.isFullscreen);
        }
        if (typeof document !== 'undefined') {
            document.body?.classList.toggle('takeoff-fullscreen-active', this.state.isFullscreen);
        }
        if (fullScreenToggle) {
            fullScreenToggle.textContent = this.state.isFullscreen ? 'Exit Full View' : 'Full View';
            fullScreenToggle.setAttribute('aria-pressed', this.state.isFullscreen ? 'true' : 'false');
        }
        if (fullscreenBtn) {
            fullscreenBtn.textContent = this.state.isFullscreen ? 'Exit Full Screen' : 'Full Screen';
        }
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.toggle('takeoff-fullscreen-active', this.state.isFullscreen);
        }
        if (!this.state.isFullscreen && document.fullscreenElement) {
            document.exitFullscreen?.();
        }
        this.applyZoom();
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


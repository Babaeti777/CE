import { LifecycleManager } from './services/lifecycle-manager.js';

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

function createId(prefix = 'drawing') {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function formatNumber(value) {
    if (!Number.isFinite(value)) return '0';
    return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 1 : 2 });
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

export class TakeoffManager {
    constructor({ toastService, storageService } = {}) {
        this.services = {
            toast: typeof toastService === 'function'
                ? (message, type = 'info') => toastService(message, type)
                : (message, type = 'info') => console.info(`[${type}] ${message}`),
            storage: storageService || null
        };

        this.state = {
            drawings: [],
            filter: '',
            sortBy: 'name',
            currentDrawingId: null
        };

        this.elements = {};
    }

    init() {
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
            planStage,
            modeSelect,
            scaleInput,
            fullscreenBtn,
            fullScreenToggle,
            countColor,
            countShape,
            countLabel,
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
        this.elements.sortSelect?.addEventListener('change', (event) => {
            this.state.sortBy = event.target.value || 'name';
            this.renderDrawings();
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

            this.setActiveDrawing(drawingId);
        });

        this.elements.measurementList?.addEventListener('click', (event) => {
            const removeBtn = event.target.closest('[data-action="remove-measurement"]');
            if (!removeBtn) return;
            const measurementId = removeBtn.getAttribute('data-id');
            if (!measurementId) return;
            this.removeMeasurement(measurementId);
        });
    }

    restoreState() {
        const storage = this.services.storage;
        if (!storage) return;
        try {
            const raw = storage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                this.state.drawings = parsed.map(drawing => ({
                    ...drawing,
                    measurements: Array.isArray(drawing.measurements) ? drawing.measurements : []
                }));
                if (this.state.drawings.length && !this.state.currentDrawingId) {
                    this.state.currentDrawingId = this.state.drawings[0].id;
                }
            }
        } catch (error) {
            console.warn('Unable to restore takeoff drawings from storage', error);
        }
    }

    persistState() {
        const storage = this.services.storage;
        if (!storage) return;
        try {
            storage.setItem(STORAGE_KEY, JSON.stringify(this.state.drawings));
        } catch (error) {
            console.warn('Unable to persist takeoff drawings', error);
        }
    }

    handleDrawingFormSubmit(event) {
        event.preventDefault();
        const name = this.elements.drawingName?.value.trim();
        if (!name) {
            this.showToast('Add a sheet name to save the drawing.', 'error');
            return;
        }

        const drawing = {
            id: createId('drawing'),
            name,
            trade: this.elements.drawingTrade?.value.trim() || '',
            floor: this.elements.drawingFloor?.value.trim() || '',
            notes: this.elements.drawingNotes?.value.trim() || '',
            measurements: []
        };

        this.state.drawings.push(drawing);
        this.state.currentDrawingId = drawing.id;
        this.persistState();
        this.renderDrawings();
        this.updateActiveMeta();
        this.renderMeasurements();
        this.updateSummary();

        this.elements.drawingForm?.reset();
        this.elements.drawingName?.focus();
        this.showToast('Drawing added to your takeoff set.', 'success');
    }

    handleMeasurementFormSubmit(event) {
        event.preventDefault();
        const activeDrawing = this.getActiveDrawing();
        if (!activeDrawing) {
            this.showToast('Select a drawing before adding measurements.', 'error');
            return;
        }

        const label = this.elements.measurementLabel?.value.trim();
        const mode = this.elements.measurementMode?.value || 'area';
        const valueRaw = parseFloat(this.elements.measurementValue?.value || '0');
        const unit = this.elements.measurementUnit?.value.trim();

        if (!label) {
            this.showToast('Give the measurement a descriptive label.', 'error');
            return;
        }

        if (!Number.isFinite(valueRaw) || valueRaw <= 0) {
            this.showToast('Enter a measurement value greater than zero.', 'error');
            return;
        }

        const measurement = {
            id: createId('measure'),
            label,
            mode,
            value: valueRaw,
            unit: unit || this.defaultUnitForMode(mode),
            createdAt: Date.now()
        };

        activeDrawing.measurements.push(measurement);
        this.persistState();
        this.renderMeasurements();
        this.updateSummary();

        this.elements.measurementForm?.reset();
        this.elements.measurementMode.value = mode;
        this.elements.measurementLabel?.focus();
        this.showToast('Measurement saved.', 'success');
    }

    renderDrawings() {
        const body = this.elements.drawingTableBody;
        if (!body) return;
        body.innerHTML = '';

        const query = normalizeString(this.state.filter);
        const sortBy = this.state.sortBy;
        const drawings = [...this.state.drawings]
            .filter(drawing => {
                if (!query) return true;
                return [drawing.name, drawing.trade, drawing.floor, drawing.notes]
                    .some(value => normalizeString(value).includes(query));
            })
            .sort((a, b) => this.compareDrawings(a, b, sortBy));

        drawings.forEach(drawing => {
            const row = document.createElement('tr');
            row.dataset.id = drawing.id;
            row.className = drawing.id === this.state.currentDrawingId ? 'is-active' : '';
            row.innerHTML = `
                <td>${drawing.name || 'Untitled'}</td>
                <td>${drawing.trade || '—'}</td>
                <td>${drawing.floor || '—'}</td>
                <td>${drawing.notes || ''}</td>
                <td class="text-right"><button type="button" class="btn btn-ghost" data-action="remove-drawing">Remove</button></td>
            `;
            body.appendChild(row);
        });

        if (this.elements.drawingEmptyState) {
            this.elements.drawingEmptyState.style.display = drawings.length ? 'none' : 'block';
        }
    }

    renderMeasurements() {
        const container = this.elements.measurementList;
        if (!container) return;
        container.innerHTML = '';

        const drawing = this.getActiveDrawing();
        if (!drawing) {
            container.innerHTML = '<p class="takeoff-empty">Select a drawing to start tracking measurements.</p>';
            return;
        }

        if (!drawing.measurements.length) {
            container.innerHTML = '<p class="takeoff-empty">Add measurements to build your takeoff summary.</p>';
            return;
        }

        drawing.measurements
            .sort((a, b) => a.createdAt - b.createdAt)
            .forEach(measurement => {
                const item = document.createElement('div');
                item.className = 'takeoff-measurement-item';
                item.innerHTML = `
                    <div class="takeoff-measurement-meta">
                        <span>${measurement.label}</span>
                        <span class="text-muted text-sm">${measurement.mode.toUpperCase()} • ${formatNumber(measurement.value)} ${measurement.unit}</span>
                    </div>
                    <div class="takeoff-measurement-actions">
                        <button type="button" class="btn btn-ghost" data-action="remove-measurement" data-id="${measurement.id}">Remove</button>
                    </div>
                `;
                container.appendChild(item);
            });
    }

    updateSummary() {
        const container = this.elements.summaryContainer;
        if (!container) return;
        container.innerHTML = '';

        const drawing = this.getActiveDrawing();
        if (!drawing || !drawing.measurements.length) {
            container.innerHTML = '<p class="takeoff-empty">No measurements captured yet.</p>';
            return;
        }

        const byUnit = new Map();
        drawing.measurements.forEach(measurement => {
            const key = measurement.unit || measurement.mode;
            const entry = byUnit.get(key) || { total: 0, count: 0 };
            entry.total += measurement.value;
            entry.count += 1;
            byUnit.set(key, entry);
        });

        byUnit.forEach((entry, unit) => {
            const summaryItem = document.createElement('div');
            summaryItem.className = 'takeoff-summary-item';
            summaryItem.innerHTML = `
                <span>${unit}</span>
                <span>${formatNumber(entry.total)} (${entry.count} item${entry.count === 1 ? '' : 's'})</span>
            `;
            container.appendChild(summaryItem);
        });
    }

    updateActiveMeta() {
        if (!this.elements.activeMeta) return;
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.elements.activeMeta.textContent = 'Select a drawing to begin capturing measurements.';
            return;
        }
        const parts = [drawing.name];
        if (drawing.trade) parts.push(drawing.trade);
        if (drawing.floor) parts.push(`Level ${drawing.floor}`);
        if (drawing.notes) parts.push(drawing.notes);
        this.elements.activeMeta.textContent = parts.filter(Boolean).join(' • ');
    }

    compareDrawings(a, b, sortBy) {
        const map = {
            name: [a.name, b.name],
            trade: [a.trade, b.trade],
            floor: [a.floor, b.floor]
        };
        const [valA, valB] = map[sortBy] || map.name;
        return normalizeString(valA).localeCompare(normalizeString(valB));
    }

    setActiveDrawing(drawingId) {
        if (this.state.currentDrawingId === drawingId) return;
        this.state.currentDrawingId = drawingId;
        this.renderDrawings();
        this.updateActiveMeta();
        this.renderMeasurements();
        this.updateSummary();
    }

    removeDrawing(drawingId) {
        const index = this.state.drawings.findIndex(drawing => drawing.id === drawingId);
        if (index === -1) return;
        this.state.drawings.splice(index, 1);
        if (this.state.currentDrawingId === drawingId) {
            this.state.currentDrawingId = this.state.drawings[0]?.id || null;
        }
        this.persistState();
        this.renderDrawings();
        this.updateActiveMeta();
        this.renderMeasurements();
        this.updateSummary();
        this.showToast('Drawing removed.', 'success');
    }

    removeMeasurement(measurementId) {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const index = drawing.measurements.findIndex(item => item.id === measurementId);
        if (index === -1) return;
        drawing.measurements.splice(index, 1);
        this.persistState();
        this.renderMeasurements();
        this.updateSummary();
        this.showToast('Measurement removed.', 'success');
    }

    getActiveDrawing() {
        if (!this.state.currentDrawingId) return null;
        return this.state.drawings.find(drawing => drawing.id === this.state.currentDrawingId) || null;
    }

    defaultUnitForMode(mode) {
        switch (mode) {
            case 'area':
                return 'sq ft';
            case 'length':
                return 'lf';
            case 'count':
            default:
                return 'ea';
        }
    }

    showToast(message, type = 'info') {
        this.services.toast(message, type);
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
        });
        this.state.drawings = [];
        this.measurements.clear();
        this.measurementCounters.clear();
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

        if (this.elements.drawingInput) {
            this.elements.drawingInput.value = '';
        }
    }

    async createDrawingFromFile(file) {
        const id = createId();
        const objectUrl = URL.createObjectURL(file);
        if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
            URL.revokeObjectURL(objectUrl);
            throw new Error('Unsupported file type. Upload PNG, JPG, GIF, or WebP plans.');
        }

        return {
            id,
            name: file.name,
            trade: '',
            floor: '',
            page: '',
            createdAt: Date.now(),
            type: 'image',
            objectUrl,
            file,
            previewUrl: objectUrl,
            naturalWidth: null,
            naturalHeight: null
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
            const typeLabel = 'Image Plan';
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
        const point = this.getPointerPosition(event);
        if (point) {
            this.state.previewPoint = point;
        }
        this.drawMeasurements();
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

    removeDrawing(id) {
        const index = this.state.drawings.findIndex((drawing) => drawing.id === id);
        if (index === -1) return;

        const [removed] = this.state.drawings.splice(index, 1);
        if (removed?.objectUrl) {
            URL.revokeObjectURL(removed.objectUrl);
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
            this.updatePdfControls();
            this.updateScaleControls();
            this.updateZoomIndicator();
            this.updateCountToolbarVisibility();
        }

        this.updateStatus('Drawing removed.');
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

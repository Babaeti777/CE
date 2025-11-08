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

function createId(prefix = 'id') {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function formatNumber(value, digits = 2) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        return Number(0).toFixed(digits);
    }
    return parsed.toFixed(digits);
}

function computePolygonArea(points) {
    if (!points.length) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        sum += (current.x * next.y) - (next.x * current.y);
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
            scale: 1,
            mode: 'length',
            previewPoint: null,
            draftPoints: [],
            pdfLoading: false,
            countSettings: {
                color: '#ef4444',
                shape: 'circle',
                label: ''
            },
            measurementCounters: {},
            measurements: {}
        };

        this.previewToken = 0;
    }

    init() {
        this.cacheDom();
        this.bindEvents();
        this.updateQuickShapeInputs();
        this.updateZoomIndicator();
        this.updateCountToolbarVisibility();
        this.renderDrawingList();
        this.renderMeasurementTable();
        this.updatePlanVisibility();
        this.updatePdfControls();
        this.updateFullscreenButton();
        this.updateStatus('Upload plan files to start measuring.');
    }

    destroy() {
        this.lifecycle?.cleanup?.();
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
            measurementTableBody: byId('takeoffMeasurementTableBody'),
            measurementEmpty: byId('takeoffMeasurementEmpty'),
            clearBtn: byId('takeoffClearBtn'),
            exportBtn: byId('takeoffExportCsvBtn'),
            pushBtn: byId('takeoffPushBtn'),
            countToolbar: byId('takeoffCountToolbar'),
            countColor: byId('takeoffCountColor'),
            countShape: byId('takeoffCountShape'),
            countLabel: byId('takeoffCountLabel'),
            quickShape: byId('takeoffShapeSelect'),
            quickDim1: byId('takeoffDim1'),
            quickDim2: byId('takeoffDim2'),
            quickDim2Group: byId('takeoffDim2Group'),
            quickBtn: byId('takeoffQuickCalcBtn'),
            quickResult: byId('takeoffQuickResult')
        };

        this.canvasContext = this.elements.canvas?.getContext?.('2d') || null;
    }

    bindEvents() {
        const on = (target, event, handler, options) => {
            if (!target) return;
            this.lifecycle.addEventListener(target, event, handler, options);
        };

        on(this.elements.drawingInput, 'change', (event) => this.handleFileSelection(event));
        on(this.elements.searchInput, 'input', (event) => {
            this.state.filter = event.target.value.trim().toLowerCase();
            this.renderDrawingList();
        });
        on(this.elements.sortSelect, 'change', (event) => {
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
        on(this.elements.planStage, 'keydown', (event) => {
            if (event.key === 'Escape' && this.state.draftPoints.length) {
                this.resetDraft();
            }
        });
        on(this.elements.fullscreenBtn, 'click', () => this.toggleFullscreen());
        on(this.elements.fullscreenToggle, 'click', () => this.toggleFullscreen());
        on(document, 'fullscreenchange', () => this.updateFullscreenButton());
        on(this.elements.pdfPrevBtn, 'click', () => this.changePdfPage(-1));
        on(this.elements.pdfNextBtn, 'click', () => this.changePdfPage(1));
        on(this.elements.pdfPageInput, 'change', (event) => this.handlePdfPageInput(event));
        on(this.elements.pdfOpenBtn, 'click', () => this.openPdfModal());
        on(this.elements.pdfDownloadBtn, 'click', () => this.downloadPdf());
        on(this.elements.openPdfBtn, 'click', () => this.openPdfModal());
        on(this.elements.pdfModalClose, 'click', () => this.closePdfModal());
        on(this.elements.pdfModalOverlay, 'click', () => this.closePdfModal());
        on(this.elements.clearBtn, 'click', () => this.clearMeasurements());
        on(this.elements.exportBtn, 'click', () => this.exportCsv());
        on(this.elements.pushBtn, 'click', () => this.pushToEstimate());
        on(this.elements.measurementTableBody, 'click', (event) => this.handleMeasurementTableClick(event));
        on(this.elements.measurementTableBody, 'input', (event) => this.handleMeasurementNameInput(event));
        on(this.elements.countColor, 'input', (event) => this.updateCountSetting('color', event.target.value));
        on(this.elements.countShape, 'change', (event) => this.updateCountSetting('shape', event.target.value));
        on(this.elements.countLabel, 'input', (event) => this.updateCountSetting('label', event.target.value));
        on(this.elements.quickShape, 'change', () => this.updateQuickShapeInputs());
        on(this.elements.quickBtn, 'click', () => this.calculateQuickShape());
        on(window, 'resize', () => this.updateCanvasSize());
    }

    cleanupDrawings() {
        this.state.drawings.forEach((drawing) => {
            if (drawing.url?.startsWith('blob:')) {
                URL.revokeObjectURL(drawing.url);
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
            renderSrc: null
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
            if (valueA === valueB) return 0;
            return valueA > valueB ? dir : -dir;
        });

        if (this.elements.drawingTableBody) {
            this.elements.drawingTableBody.innerHTML = sorted.map((drawing) => {
                const isActive = drawing.id === activeDrawingId;
                return `
                    <tr data-id="${drawing.id}" class="${isActive ? 'is-active' : ''}">
                        <td>${escapeHtml(drawing.name)}</td>
                        <td>${escapeHtml(drawing.trade || '—')}</td>
                        <td>${escapeHtml(drawing.floor || '—')}</td>
                        <td>${escapeHtml(drawing.page || '—')}</td>
                        <td class="text-right">
                            <button type="button" class="btn btn-ghost btn-sm" data-action="activate">${isActive ? 'Active' : 'Open'}</button>
                            <button type="button" class="btn btn-ghost btn-sm" data-action="remove">Remove</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        if (this.elements.drawingEmpty) {
            this.elements.drawingEmpty.classList.toggle('is-hidden', sorted.length > 0);
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
        }
        this.renderDrawingList();
        this.renderMeasurementTable();
        this.updatePlanVisibility();
        this.services.toast(`${removed?.name || 'Drawing'} removed.`, 'info');
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
        this.updateStatus('Upload plan files to start measuring.');
    }

    updateActiveMeta() {
        if (!this.elements.activeMeta) return;
        this.elements.activeMeta.textContent = formatMeta(this.getActiveDrawing());
    }

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

    updateCanvasSize() {
        if (!this.elements.planInner) return;
        this.updateZoomTransform();
        this.drawMeasurements();
    }

    updateMode(mode) {
        if (!MODE_LABELS[mode]) return;
        this.state.mode = mode;
        this.resetDraft();
        this.updateCountToolbarVisibility();
        this.services.toast(`${MODE_LABELS[mode]} mode selected.`);
    }

    handleScaleChange(event) {
        try {
            const value = Validator.number(event.target.value, { min: 0.0001, fieldName: 'Scale' });
            this.state.scale = value;
        } catch (error) {
            if (error instanceof ValidationError) {
                this.services.toast(error.message, 'error');
            }
        }
    }

    updateCountToolbarVisibility() {
        if (!this.elements.countToolbar) return;
        this.elements.countToolbar.classList.toggle('is-hidden', this.state.mode !== 'count');
        this.syncCountControls();
    }

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
        this.state.previewPoint = point || null;
        this.drawMeasurements();
    }

    clearPreviewPoint() {
        this.state.previewPoint = null;
        this.drawMeasurements();
    }

    handleDoubleClick(event) {
        if (this.state.mode !== 'area' || this.state.draftPoints.length < 3) return;
        this.finalizeMeasurement(this.state.draftPoints);
        this.resetDraft();
        this.drawMeasurements();
    }

    resetDraft() {
        this.state.draftPoints = [];
        this.state.previewPoint = null;
        this.drawMeasurements();
    }

    getPointerPosition(event) {
        if (!this.elements.planInner || !this.elements.canvas) return null;
        const rect = this.elements.planInner.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const x = (event.clientX - rect.left) / this.state.zoom;
        const y = (event.clientY - rect.top) / this.state.zoom;
        const width = this.elements.canvas.width;
        const height = this.elements.canvas.height;
        if (x < 0 || y < 0 || x > width || y > height) return null;
        return { x, y };
    }

    finalizeMeasurement(points) {
        const drawing = this.getActiveDrawing();
        if (!drawing || !points.length) return;
        const scale = this.state.scale || 1;
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

        this.createMeasurement({ mode, points, quantity, units, details, label });
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

    pushToEstimate() {
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
        if (this.services.estimate) {
            this.services.estimate({ drawing, measurements });
        }
        this.services.toast('Measurements sent to estimate.', 'success');
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


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
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;

function createId(prefix = 'drawing') {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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

export class TakeoffManager {
    constructor({ toastService, estimateService, storageService } = {}) {
        this.services = {
            toast: typeof toastService === 'function'
                ? (message, type = 'info') => toastService(message, type)
                : (message, type = 'info') => console.info(`[${type}] ${message}`),
            estimate: estimateService || null,
            storage: storageService || null
        };

        this.state = {
            drawings: [],
            filter: '',
            sortBy: 'trade',
            sortDir: 'asc',
            activeId: null,
            zoom: 1,
            scale: 1,
            mode: 'length',
            preview: null,
            countSettings: {
                color: '#ef4444',
                shape: 'circle',
                label: ''
            }
        };

        this.measurements = new Map();
        this.labelCounters = new Map();
        this.previewToken = 0;
        this.pointerSession = null;
        this.elements = {};
        this.handlers = {
            pointerMove: (event) => this.handlePointerMove(event),
            pointerUp: (event) => this.handlePointerUp(event),
            pointerLeave: () => this.cancelPointerSession(),
            windowResize: () => this.applyZoom()
        };
    }

    init() {
        this.cacheDom();
        this.bindEvents();
        this.renderDrawingList();
        this.updatePlanVisibility();
        this.updateMode(this.state.mode);
        this.updateZoomIndicator();
        this.updatePdfControls();
        this.updateCountToolbarVisibility();
        this.updateQuickShapeInputs();
        this.renderMeasurementTable();
        this.updateStatus('Upload plan files to start measuring.');
        window.addEventListener('resize', this.handlers.windowResize);
    }

    destroy() {
        window.removeEventListener('resize', this.handlers.windowResize);
        this.cleanupDrawings();
        this.closePdfModal();
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
            modeSelect: byId('takeoffModeSelect'),
            scaleInput: byId('takeoffScaleInput'),
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
            measurementTableBody: byId('takeoffMeasurementTableBody'),
            measurementEmpty: byId('takeoffMeasurementEmpty'),
            clearBtn: byId('takeoffClearBtn'),
            exportBtn: byId('takeoffExportCsvBtn'),
            pushBtn: byId('takeoffPushBtn'),
            countToolbar: byId('takeoffCountToolbar'),
            countColorInput: byId('takeoffCountColor'),
            countShapeSelect: byId('takeoffCountShape'),
            countLabelInput: byId('takeoffCountLabel'),
            quickShapeSelect: byId('takeoffShapeSelect'),
            quickDim1: byId('takeoffDim1'),
            quickDim2: byId('takeoffDim2'),
            quickDim2Group: byId('takeoffDim2Group'),
            quickBtn: byId('takeoffQuickCalcBtn'),
            quickResult: byId('takeoffQuickResult')
        };

        if (this.elements.canvas) {
            this.canvasContext = this.elements.canvas.getContext('2d');
        }
    }

    bindEvents() {
        const {
            drawingInput,
            searchInput,
            sortSelect,
            sortDirection,
            drawingTableBody,
            modeSelect,
            scaleInput,
            zoomInBtn,
            zoomOutBtn,
            zoomResetBtn,
            canvas,
            clearBtn,
            exportBtn,
            pushBtn,
            countColorInput,
            countShapeSelect,
            countLabelInput,
            quickShapeSelect,
            quickBtn,
            openPdfBtn,
            pdfPrevBtn,
            pdfNextBtn,
            pdfPageInput,
            pdfOpenBtn,
            pdfDownloadBtn,
            pdfModalClose,
            pdfModalOverlay,
            fullscreenBtn,
            fullScreenToggle
        } = this.elements;

        drawingInput?.addEventListener('change', (event) => {
            const files = event.target.files;
            if (files?.length) {
                this.handleFileSelection(files);
            }
            event.target.value = '';
        });

        searchInput?.addEventListener('input', (event) => {
            this.state.filter = event.target.value || '';
            this.renderDrawingList();
        });

        sortSelect?.addEventListener('change', (event) => {
            this.state.sortBy = event.target.value || 'trade';
            this.renderDrawingList();
        });

        sortDirection?.addEventListener('click', () => {
            this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
            sortDirection.textContent = this.state.sortDir === 'asc' ? '▲' : '▼';
            this.renderDrawingList();
        });

        drawingTableBody?.addEventListener('click', (event) => this.handleDrawingTableClick(event));
        drawingTableBody?.addEventListener('input', (event) => this.handleDrawingTableInput(event));

        modeSelect?.addEventListener('change', (event) => this.updateMode(event.target.value));
        scaleInput?.addEventListener('change', (event) => this.updateScale(event.target.value));

        zoomInBtn?.addEventListener('click', () => this.setZoom(this.state.zoom + ZOOM_STEP));
        zoomOutBtn?.addEventListener('click', () => this.setZoom(this.state.zoom - ZOOM_STEP));
        zoomResetBtn?.addEventListener('click', () => this.setZoom(1));

        canvas?.addEventListener('pointerdown', (event) => this.handlePointerDown(event));
        canvas?.addEventListener('pointerleave', this.handlers.pointerLeave);

        clearBtn?.addEventListener('click', () => this.clearMeasurements());
        exportBtn?.addEventListener('click', () => this.exportMeasurements());
        pushBtn?.addEventListener('click', () => this.pushMeasurements());

        countColorInput?.addEventListener('input', (event) => this.updateCountSetting('color', event.target.value));
        countShapeSelect?.addEventListener('change', (event) => this.updateCountSetting('shape', event.target.value));
        countLabelInput?.addEventListener('input', (event) => this.updateCountSetting('label', event.target.value));

        quickShapeSelect?.addEventListener('change', () => this.updateQuickShapeInputs());
        quickBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            this.handleQuickShape();
        });

        openPdfBtn?.addEventListener('click', () => this.openPdfModal());
        pdfPrevBtn?.addEventListener('click', () => this.changePdfPage(-1));
        pdfNextBtn?.addEventListener('click', () => this.changePdfPage(1));
        pdfPageInput?.addEventListener('change', (event) => this.setPdfPage(Number.parseInt(event.target.value, 10) || 1));
        pdfOpenBtn?.addEventListener('click', () => this.openPdfModal());
        pdfDownloadBtn?.addEventListener('click', () => this.downloadActivePdf());
        pdfModalClose?.addEventListener('click', () => this.closePdfModal());
        pdfModalOverlay?.addEventListener('click', () => this.closePdfModal());

        fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
        fullScreenToggle?.addEventListener('click', () => this.togglePlanExpansion());
    }

    async handleFileSelection(fileList) {
        const files = Array.from(fileList);
        if (!files.length) return;

        for (const file of files) {
            try {
                const drawing = await this.createDrawingFromFile(file);
                this.state.drawings.push(drawing);
                this.measurements.set(drawing.id, []);
                this.toast(`${drawing.name} loaded`, 'success');
            } catch (error) {
                console.error('Failed to load drawing', error);
                this.toast(`Could not load ${file.name}`, 'error');
            }
        }

        if (!this.state.activeId && this.state.drawings.length) {
            await this.setActiveDrawing(this.state.drawings[0].id);
        } else {
            this.renderDrawingList();
        }
    }

    async createDrawingFromFile(file) {
        const id = createId('drawing');
        const url = URL.createObjectURL(file);
        const base = {
            id,
            file,
            url,
            name: file.name,
            trade: '',
            floor: '',
            page: '',
            type: 'image',
            preview: '',
            dimensions: null,
            totalPages: 1,
            currentPage: 1,
            pdfDoc: null
        };

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            base.type = 'pdf';
            const loadingTask = pdfjsLib.getDocument({ url });
            const pdfDoc = await loadingTask.promise;
            base.pdfDoc = pdfDoc;
            base.totalPages = pdfDoc.numPages;
            await this.renderPdfPage(base, 1);
        } else if (SUPPORTED_IMAGE_TYPES.has(file.type) || file.type === '') {
            await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    base.preview = url;
                    base.dimensions = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
                    resolve();
                };
                img.onerror = reject;
                img.src = url;
            });
        } else {
            URL.revokeObjectURL(url);
            throw new Error('Unsupported file type');
        }

        return base;
    }

    cleanupDrawings() {
        this.state.drawings.forEach((drawing) => {
            if (drawing.url) URL.revokeObjectURL(drawing.url);
            if (drawing.pdfDoc?.cleanup) {
                try { drawing.pdfDoc.cleanup(); } catch (error) { console.warn('PDF cleanup failed', error); }
            }
            if (drawing.pdfDoc?.destroy) {
                try { drawing.pdfDoc.destroy(); } catch (error) { console.warn('PDF destroy failed', error); }
            }
        });
        this.state.drawings = [];
        this.measurements.clear();
        this.labelCounters.clear();
    }

    handleDrawingTableClick(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const id = target.dataset.id;

        if (target.dataset.action === 'remove' && id) {
            event.preventDefault();
            event.stopPropagation();
            this.removeDrawing(id);
            return;
        }

        if (target.dataset.action === 'select' && id) {
            event.preventDefault();
            this.setActiveDrawing(id);
        }
    }

    handleDrawingTableInput(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const id = target.dataset.id;
        const field = target.dataset.field;
        if (!id || !field) return;
        const drawing = this.state.drawings.find((item) => item.id === id);
        if (!drawing) return;
        drawing[field] = target.value;
        if (this.state.activeId === id) {
            this.updateActiveMeta();
        }
    }

    async setActiveDrawing(id) {
        if (!id) return;
        if (this.state.activeId === id) {
            this.renderDrawingList();
            return;
        }

        const drawing = this.state.drawings.find((item) => item.id === id);
        if (!drawing) return;

        this.state.activeId = id;
        this.state.preview = null;
        await this.displayDrawing(drawing);
        this.renderDrawingList();
        this.renderMeasurementTable();
    }

    removeDrawing(id) {
        const index = this.state.drawings.findIndex((item) => item.id === id);
        if (index === -1) return;
        const [removed] = this.state.drawings.splice(index, 1);
        if (removed?.url) URL.revokeObjectURL(removed.url);
        if (removed?.pdfDoc?.cleanup) {
            try { removed.pdfDoc.cleanup(); } catch (error) { console.warn('PDF cleanup failed', error); }
        }
        if (removed?.pdfDoc?.destroy) {
            try { removed.pdfDoc.destroy(); } catch (error) { console.warn('PDF destroy failed', error); }
        }
        this.measurements.delete(id);
        this.labelCounters.delete(id);
        this.toast(`${removed?.name || 'Drawing'} removed`, 'info');

        if (this.state.activeId === id) {
            this.state.activeId = null;
            const fallback = this.state.drawings[0];
            if (fallback) {
                this.setActiveDrawing(fallback.id);
            } else {
                this.updatePlanVisibility(false);
                this.renderMeasurementTable();
            }
        } else {
            this.renderDrawingList();
        }
    }

    async displayDrawing(drawing) {
        if (!drawing || !this.elements.planContainer) return;

        this.updatePlanVisibility(true);
        this.updateActiveMeta();
        this.updatePdfControls(drawing);
        this.updateOpenPdfButton(drawing);

        if (drawing.type === 'pdf') {
            await this.renderPdfPage(drawing, drawing.currentPage);
        }

        this.updatePlanImage(drawing);
        this.setZoom(1);
    }

    updatePlanImage(drawing) {
        const { planPreview, planStage, planInner } = this.elements;
        if (!planPreview || !drawing?.preview) return;
        planPreview.src = drawing.preview;
        planPreview.alt = drawing.name || 'Drawing preview';
        planStage?.setAttribute('aria-busy', 'true');
        planPreview.onload = () => {
            planStage?.removeAttribute('aria-busy');
            this.applyZoom();
        };
        if (!planPreview.complete) return;
        planStage?.removeAttribute('aria-busy');
        planInner?.style.setProperty('--takeoff-width', `${drawing.dimensions?.width || 0}px`);
        this.applyZoom();
    }

    async renderPdfPage(drawing, pageNumber) {
        if (!drawing?.pdfDoc) return;
        const safePage = clamp(pageNumber, 1, drawing.totalPages || 1);
        drawing.currentPage = safePage;
        const page = await drawing.pdfDoc.getPage(safePage);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
        drawing.preview = canvas.toDataURL();
        drawing.dimensions = { width: viewport.width, height: viewport.height };
        if (this.state.activeId === drawing.id) {
            this.updatePdfControls(drawing);
        }
    }

    updatePlanVisibility(show = Boolean(this.getActiveDrawing())) {
        const { planContainer, drawingEmpty } = this.elements;
        planContainer?.classList.toggle('is-hidden', !show);
        drawingEmpty?.classList.toggle('is-hidden', this.state.drawings.length > 0);
    }

    updateActiveMeta() {
        if (!this.elements.activeMeta) return;
        const drawing = this.getActiveDrawing();
        this.elements.activeMeta.textContent = formatMeta(drawing) || '';
    }

    updatePdfControls(drawing = this.getActiveDrawing()) {
        const { pdfControls, pdfPageInput, pdfPageTotal, pdfPrevBtn, pdfNextBtn } = this.elements;
        const isPdf = drawing?.type === 'pdf';
        pdfControls?.classList.toggle('is-hidden', !isPdf);
        if (!isPdf) return;
        const total = drawing?.totalPages || 1;
        const current = drawing?.currentPage || 1;
        if (pdfPageInput) {
            pdfPageInput.value = String(current);
            pdfPageInput.max = String(total);
        }
        if (pdfPageTotal) {
            pdfPageTotal.textContent = `of ${total}`;
        }
        pdfPrevBtn?.setAttribute('aria-disabled', current <= 1 ? 'true' : 'false');
        pdfPrevBtn && (pdfPrevBtn.disabled = current <= 1);
        pdfNextBtn?.setAttribute('aria-disabled', current >= total ? 'true' : 'false');
        pdfNextBtn && (pdfNextBtn.disabled = current >= total);
    }

    updateOpenPdfButton(drawing = this.getActiveDrawing()) {
        const { openPdfBtn } = this.elements;
        if (!openPdfBtn) return;
        const isPdf = drawing?.type === 'pdf';
        openPdfBtn.classList.toggle('is-hidden', !isPdf);
        openPdfBtn.setAttribute('aria-hidden', isPdf ? 'false' : 'true');
    }

    updateZoomIndicator() {
        if (!this.elements.zoomIndicator) return;
        const value = Math.round(this.state.zoom * 100);
        this.elements.zoomIndicator.textContent = `${value}%`;
        if (this.elements.zoomOutBtn) {
            this.elements.zoomOutBtn.disabled = this.state.zoom <= MIN_ZOOM;
        }
        if (this.elements.zoomInBtn) {
            this.elements.zoomInBtn.disabled = this.state.zoom >= MAX_ZOOM;
        }
    }

    setZoom(nextZoom) {
        this.state.zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
        this.applyZoom();
        this.updateZoomIndicator();
    }

    applyZoom() {
        const drawing = this.getActiveDrawing();
        const { planPreview, canvas, planInner, planStage } = this.elements;
        if (!drawing || !planPreview || !canvas || !drawing.dimensions) return;
        const width = drawing.dimensions.width * this.state.zoom;
        const height = drawing.dimensions.height * this.state.zoom;
        planPreview.style.width = `${width}px`;
        planPreview.style.height = `${height}px`;
        planPreview.style.maxHeight = 'none';
        if (planInner) {
            planInner.style.width = `${width}px`;
            planInner.style.height = `${height}px`;
            planInner.style.display = 'block';
        }
        if (planStage) {
            planStage.style.overflow = 'auto';
        }
        canvas.width = Math.max(1, Math.round(width));
        canvas.height = Math.max(1, Math.round(height));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.style.left = '0';
        canvas.style.top = '0';
        canvas.style.right = '';
        canvas.style.bottom = '';
        canvas.style.transform = '';
        this.renderOverlay();
    }

    handlePointerDown(event) {
        if (event.button !== 0) return;
        const point = this.getCanvasPoint(event);
        if (!point) return;
        if (this.state.mode === 'count') {
            const measurement = this.buildCountMeasurement(point);
            if (measurement) {
                this.addMeasurement(measurement);
            }
            return;
        }

        this.pointerSession = { start: point, pointerId: event.pointerId };
        const { canvas } = this.elements;
        canvas?.setPointerCapture?.(event.pointerId);
        canvas?.addEventListener('pointermove', this.handlers.pointerMove);
        canvas?.addEventListener('pointerup', this.handlers.pointerUp);
    }

    handlePointerMove(event) {
        if (!this.pointerSession) return;
        const point = this.getCanvasPoint(event);
        if (!point) return;
        this.pointerSession.current = point;
        this.state.preview = {
            type: this.state.mode,
            start: this.pointerSession.start,
            end: point,
            settings: { ...this.state.countSettings }
        };
        this.renderOverlay();
    }

    handlePointerUp(event) {
        if (!this.pointerSession) return;
        const { canvas } = this.elements;
        canvas?.releasePointerCapture?.(this.pointerSession.pointerId);
        canvas?.removeEventListener('pointermove', this.handlers.pointerMove);
        canvas?.removeEventListener('pointerup', this.handlers.pointerUp);

        const point = this.getCanvasPoint(event);
        const start = this.pointerSession.start;
        this.pointerSession = null;
        const mode = this.state.mode;
        this.state.preview = null;
        if (!point) {
            this.renderOverlay();
            return;
        }

        const measurement = this.buildMeasurementFromDrag(start, point, mode);
        if (measurement) {
            this.addMeasurement(measurement);
        } else {
            this.renderOverlay();
        }
    }

    cancelPointerSession() {
        const { canvas } = this.elements;
        canvas?.removeEventListener('pointermove', this.handlers.pointerMove);
        canvas?.removeEventListener('pointerup', this.handlers.pointerUp);
        this.pointerSession = null;
        if (this.state.preview) {
            this.state.preview = null;
            this.renderOverlay();
        }
    }

    getCanvasPoint(event) {
        const { canvas } = this.elements;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (Number.isNaN(x) || Number.isNaN(y)) return null;
        return {
            x: x / this.state.zoom,
            y: y / this.state.zoom
        };
    }

    buildMeasurementFromDrag(start, end, mode) {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 2) return null;

        if (mode === 'length') {
            return this.createLengthMeasurement(start, end, distance);
        }
        if (mode === 'area') {
            return this.createAreaMeasurement(start, end);
        }
        if (mode === 'diameter') {
            return this.createDiameterMeasurement(start, end, distance);
        }
        return null;
    }

    buildCountMeasurement(point) {
        const drawing = this.getActiveDrawing();
        if (!drawing) return null;
        const { color, shape, label } = this.state.countSettings;
        const labelBase = label?.trim() || 'Count';
        const measurementLabel = this.makeLabel(labelBase);
        return {
            id: createId('measure'),
            type: 'count',
            label: measurementLabel,
            quantity: 1,
            units: 'ea',
            details: `${shape} • ${color}`,
            displayValue: '1 ea',
            points: [point],
            meta: { color, shape }
        };
    }

    createLengthMeasurement(start, end, distancePx) {
        const label = this.makeLabel('Length');
        const lengthFt = distancePx / (this.state.scale || 1);
        return {
            id: createId('measure'),
            type: 'length',
            label,
            quantity: Number(lengthFt.toFixed(2)),
            units: 'ft',
            details: `${distancePx.toFixed(1)} px`,
            displayValue: `${lengthFt.toFixed(2)} ft`,
            points: [start, end],
            meta: { distancePx }
        };
    }

    createAreaMeasurement(start, end) {
        const widthPx = Math.abs(end.x - start.x);
        const heightPx = Math.abs(end.y - start.y);
        if (widthPx < 2 || heightPx < 2) return null;
        const areaPx = widthPx * heightPx;
        const widthFt = widthPx / (this.state.scale || 1);
        const heightFt = heightPx / (this.state.scale || 1);
        const areaFt2 = areaPx / Math.pow(this.state.scale || 1, 2);
        const label = this.makeLabel('Area');
        return {
            id: createId('measure'),
            type: 'area',
            label,
            quantity: Number(areaFt2.toFixed(2)),
            units: 'ft²',
            details: `${widthFt.toFixed(2)} ft × ${heightFt.toFixed(2)} ft`,
            displayValue: `${areaFt2.toFixed(2)} ft²`,
            points: [start, end],
            meta: { widthPx, heightPx }
        };
    }

    createDiameterMeasurement(start, end, distancePx) {
        const label = this.makeLabel('Diameter');
        const diameterFt = distancePx / (this.state.scale || 1);
        const radiusFt = diameterFt / 2;
        return {
            id: createId('measure'),
            type: 'diameter',
            label,
            quantity: Number(diameterFt.toFixed(2)),
            units: 'ft',
            details: `Radius ${radiusFt.toFixed(2)} ft`,
            displayValue: `${diameterFt.toFixed(2)} ft`,
            points: [start, end],
            meta: { distancePx }
        };
    }

    addMeasurement(measurement) {
        const drawingId = this.state.activeId;
        if (!drawingId) return;
        const list = this.measurements.get(drawingId) || [];
        list.push(measurement);
        this.measurements.set(drawingId, list);
        this.renderMeasurementTable();
        this.renderOverlay();
        this.updateStatus(`${measurement.label} saved to measurements.`);
    }

    clearMeasurements() {
        const drawingId = this.state.activeId;
        if (!drawingId) return;
        this.measurements.set(drawingId, []);
        this.labelCounters.set(drawingId, {});
        this.renderMeasurementTable();
        this.renderOverlay();
        this.updateStatus('Measurements cleared for this drawing.');
    }

    removeMeasurement(id) {
        const drawingId = this.state.activeId;
        if (!drawingId) return;
        const list = this.measurements.get(drawingId) || [];
        const next = list.filter((item) => item.id !== id);
        this.measurements.set(drawingId, next);
        this.renderMeasurementTable();
        this.renderOverlay();
    }

    renderMeasurementTable() {
        const { measurementTableBody, measurementEmpty } = this.elements;
        if (!measurementTableBody || !measurementEmpty) return;
        const list = this.getActiveMeasurements();
        measurementTableBody.innerHTML = '';
        measurementEmpty.classList.toggle('is-hidden', list.length > 0);
        if (!list.length) return;

        const fragment = document.createDocumentFragment();
        list.forEach((measurement) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${measurement.label}</td>
                <td>${measurement.type}</td>
                <td>${measurement.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td>${measurement.units}</td>
                <td>${measurement.details || ''}</td>
                <td><button type="button" class="btn btn-ghost btn-sm" data-action="delete" data-id="${measurement.id}">Remove</button></td>
            `;
            fragment.appendChild(row);
        });

        measurementTableBody.appendChild(fragment);
        measurementTableBody.querySelectorAll('button[data-action="delete"]').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                const id = button.dataset.id;
                if (id) {
                    this.removeMeasurement(id);
                }
            });
        });
    }

    renderOverlay() {
        const { canvas } = this.elements;
        if (!canvas || !this.canvasContext) return;
        const ctx = this.canvasContext;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const measurements = this.getActiveMeasurements();
        measurements.forEach((measurement) => this.drawMeasurement(ctx, measurement));
        if (this.state.preview) {
            this.drawPreview(ctx, this.state.preview);
        }
    }

    drawMeasurement(ctx, measurement) {
        const zoom = this.state.zoom;
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const type = measurement.type;
        if (type === 'length') {
            const [start, end] = measurement.points;
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = Math.max(2, 2 * zoom);
            ctx.beginPath();
            ctx.moveTo(start.x * zoom, start.y * zoom);
            ctx.lineTo(end.x * zoom, end.y * zoom);
            ctx.stroke();
            this.drawLabel(ctx, measurement.displayValue, this.midpoint(start, end), '#2563eb');
        } else if (type === 'area') {
            const [start, end] = measurement.points;
            const x = Math.min(start.x, end.x) * zoom;
            const y = Math.min(start.y, end.y) * zoom;
            const width = Math.abs(end.x - start.x) * zoom;
            const height = Math.abs(end.y - start.y) * zoom;
            ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = Math.max(2, 2 * zoom);
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            ctx.fill();
            ctx.stroke();
            this.drawLabel(ctx, measurement.displayValue, { x: x / zoom + width / (2 * zoom), y: y / zoom + height / (2 * zoom) }, '#065f46');
        } else if (type === 'diameter') {
            const [start, end] = measurement.points;
            const center = this.midpoint(start, end);
            const radius = Math.hypot(end.x - start.x, end.y - start.y) / 2;
            ctx.strokeStyle = '#a855f7';
            ctx.lineWidth = Math.max(2, 2 * zoom);
            ctx.beginPath();
            ctx.arc(center.x * zoom, center.y * zoom, radius * zoom, 0, Math.PI * 2);
            ctx.stroke();
            this.drawLabel(ctx, measurement.displayValue, center, '#6b21a8');
        } else if (type === 'count') {
            const [point] = measurement.points;
            const size = 10 * Math.max(1, zoom);
            const color = measurement.meta?.color || '#ef4444';
            ctx.fillStyle = color;
            ctx.strokeStyle = '#1f2937';
            ctx.lineWidth = 1.5;
            const x = point.x * zoom;
            const y = point.y * zoom;
            if (measurement.meta?.shape === 'square') {
                ctx.beginPath();
                ctx.rect(x - size / 2, y - size / 2, size, size);
                ctx.fill();
                ctx.stroke();
            } else if (measurement.meta?.shape === 'diamond') {
                ctx.beginPath();
                ctx.moveTo(x, y - size / 2);
                ctx.lineTo(x + size / 2, y);
                ctx.lineTo(x, y + size / 2);
                ctx.lineTo(x - size / 2, y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            } else if (measurement.meta?.shape === 'triangle') {
                ctx.beginPath();
                ctx.moveTo(x, y - size / 2);
                ctx.lineTo(x + size / 2, y + size / 2);
                ctx.lineTo(x - size / 2, y + size / 2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(x, y, size / 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            this.drawLabel(ctx, measurement.label, { x: point.x, y: point.y + (size / zoom) }, color);
        }
        ctx.restore();
    }

    drawPreview(ctx, preview) {
        const zoom = this.state.zoom;
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = Math.max(2, 2 * zoom);
        if (preview.type === 'length' || preview.type === 'diameter') {
            ctx.beginPath();
            ctx.moveTo(preview.start.x * zoom, preview.start.y * zoom);
            ctx.lineTo(preview.end.x * zoom, preview.end.y * zoom);
            ctx.stroke();
        } else if (preview.type === 'area') {
            const x = Math.min(preview.start.x, preview.end.x) * zoom;
            const y = Math.min(preview.start.y, preview.end.y) * zoom;
            const width = Math.abs(preview.end.x - preview.start.x) * zoom;
            const height = Math.abs(preview.end.y - preview.start.y) * zoom;
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            ctx.stroke();
        }
        ctx.restore();
    }

    drawLabel(ctx, text, point, color) {
        if (!text) return;
        const zoom = this.state.zoom;
        ctx.save();
        ctx.fillStyle = 'rgba(17, 24, 39, 0.85)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 4;
        ctx.font = `${Math.max(12, 12 * zoom)}px "Inter", "Segoe UI", sans-serif`;
        const x = point.x * zoom;
        const y = point.y * zoom;
        ctx.strokeText(text, x + 8, y + 8);
        ctx.fillStyle = color || '#111827';
        ctx.fillText(text, x + 8, y + 8);
        ctx.restore();
    }

    midpoint(a, b) {
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    updateMode(mode) {
        const nextMode = ['length', 'area', 'count', 'diameter'].includes(mode) ? mode : 'length';
        this.state.mode = nextMode;
        if (this.elements.modeSelect) {
            this.elements.modeSelect.value = nextMode;
        }
        this.updateCountToolbarVisibility();
        this.updateStatus(`Mode set to ${nextMode}.`);
    }

    updateScale(value) {
        const numeric = Number.parseFloat(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            this.elements.scaleInput && (this.elements.scaleInput.value = String(this.state.scale));
            this.toast('Scale must be a positive number.', 'warning');
            return;
        }
        this.state.scale = numeric;
        this.elements.scaleInput && (this.elements.scaleInput.value = String(numeric));
        this.updateStatus(`Scale updated to ${numeric} px/ft.`);
    }

    updateCountToolbarVisibility() {
        const isCount = this.state.mode === 'count';
        this.elements.countToolbar?.classList.toggle('is-hidden', !isCount);
    }

    updateCountSetting(key, value) {
        this.state.countSettings[key] = value;
    }

    updateQuickShapeInputs() {
        const shape = this.elements.quickShapeSelect?.value || 'rectangle';
        if (!this.elements.quickDim1 || !this.elements.quickDim2 || !this.elements.quickDim2Group) return;
        if (shape === 'circle') {
            this.elements.quickDim1.placeholder = 'Diameter';
            this.elements.quickDim2Group.classList.add('is-hidden');
        } else if (shape === 'triangle') {
            this.elements.quickDim1.placeholder = 'Base';
            this.elements.quickDim2.placeholder = 'Height';
            this.elements.quickDim2Group.classList.remove('is-hidden');
        } else {
            this.elements.quickDim1.placeholder = 'Length';
            this.elements.quickDim2.placeholder = 'Width';
            this.elements.quickDim2Group.classList.remove('is-hidden');
        }
    }

    handleQuickShape() {
        const shape = this.elements.quickShapeSelect?.value || 'rectangle';
        const dim1 = Number.parseFloat(this.elements.quickDim1?.value || '0');
        const dim2 = Number.parseFloat(this.elements.quickDim2?.value || '0');
        let area = 0;
        if (shape === 'circle') {
            if (!Number.isFinite(dim1) || dim1 <= 0) {
                this.updateQuickResult('Enter a valid diameter.');
                return;
            }
            const radius = dim1 / 2;
            area = Math.PI * radius * radius;
        } else if (shape === 'triangle') {
            if (!(Number.isFinite(dim1) && dim1 > 0 && Number.isFinite(dim2) && dim2 > 0)) {
                this.updateQuickResult('Enter base and height.');
                return;
            }
            area = 0.5 * dim1 * dim2;
        } else {
            if (!(Number.isFinite(dim1) && dim1 > 0 && Number.isFinite(dim2) && dim2 > 0)) {
                this.updateQuickResult('Enter length and width.');
                return;
            }
            area = dim1 * dim2;
        }
        this.updateQuickResult(`Area: ${area.toFixed(2)} sq units`);
    }

    updateQuickResult(message) {
        if (!this.elements.quickResult) return;
        this.elements.quickResult.textContent = message;
    }

    changePdfPage(offset) {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') return;
        const nextPage = clamp((drawing.currentPage || 1) + offset, 1, drawing.totalPages || 1);
        this.setPdfPage(nextPage);
    }

    async setPdfPage(pageNumber) {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') return;
        await this.renderPdfPage(drawing, pageNumber);
        this.updatePdfControls(drawing);
        this.updatePlanImage(drawing);
        this.updateStatus(`PDF page ${drawing.currentPage} loaded.`);
    }

    openPdfModal() {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') return;
        const { pdfModal, pdfFrame } = this.elements;
        if (!pdfModal || !pdfFrame) return;
        pdfFrame.src = drawing.url;
        pdfModal.setAttribute('aria-hidden', 'false');
        pdfModal.classList.remove('is-hidden');
    }

    closePdfModal() {
        const { pdfModal, pdfFrame } = this.elements;
        if (!pdfModal) return;
        pdfModal.classList.add('is-hidden');
        pdfModal.setAttribute('aria-hidden', 'true');
        if (pdfFrame) {
            pdfFrame.removeAttribute('src');
        }
    }

    downloadActivePdf() {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') return;
        const link = document.createElement('a');
        link.href = drawing.url;
        link.download = drawing.name || 'drawing.pdf';
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    toggleFullscreen() {
        const element = this.elements.planStage;
        if (!element) return;
        if (document.fullscreenElement) {
            document.exitFullscreen?.();
        } else {
            element.requestFullscreen?.();
        }
    }

    togglePlanExpansion() {
        const stage = this.elements.planStage;
        const btn = this.elements.fullScreenToggle;
        if (!stage || !btn) return;
        const expanded = stage.classList.toggle('takeoff-plan-expanded');
        btn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
        btn.textContent = expanded ? 'Exit Full View' : 'Full View';
        if (expanded) {
            stage.style.minHeight = '70vh';
        } else {
            stage.style.minHeight = '';
        }
        this.applyZoom();
    }

    getActiveDrawing() {
        if (!this.state.activeId) return null;
        return this.state.drawings.find((item) => item.id === this.state.activeId) || null;
    }

    getActiveMeasurements() {
        if (!this.state.activeId) return [];
        return this.measurements.get(this.state.activeId) || [];
    }

    makeLabel(base) {
        const drawingId = this.state.activeId;
        if (!drawingId) return base;
        if (!this.labelCounters.has(drawingId)) {
            this.labelCounters.set(drawingId, {});
        }
        const counters = this.labelCounters.get(drawingId);
        counters[base] = (counters[base] || 0) + 1;
        return `${base} ${counters[base]}`;
    }

    renderDrawingList() {
        const { drawingTableBody, drawingEmpty } = this.elements;
        if (!drawingTableBody || !drawingEmpty) return;
        const search = (this.state.filter || '').toLowerCase();
        const sortBy = this.state.sortBy;
        const sortDir = this.state.sortDir === 'asc' ? 1 : -1;
        const drawings = [...this.state.drawings]
            .filter((drawing) => {
                if (!search) return true;
                return [drawing.name, drawing.trade, drawing.floor, drawing.page]
                    .some((value) => (value || '').toString().toLowerCase().includes(search));
            })
            .sort((a, b) => {
                const valueA = (a[sortBy] ?? '').toString().toLowerCase();
                const valueB = (b[sortBy] ?? '').toString().toLowerCase();
                if (valueA === valueB) return 0;
                return valueA > valueB ? sortDir : -sortDir;
            });

        drawingTableBody.innerHTML = '';
        if (!drawings.length) {
            drawingEmpty.textContent = this.state.drawings.length ? 'No drawings match your filters.' : 'Upload plan files to begin building your takeoff.';
            drawingEmpty.classList.remove('is-hidden');
            return;
        }
        drawingEmpty.classList.add('is-hidden');

        const fragment = document.createDocumentFragment();
        drawings.forEach((drawing) => {
            const row = document.createElement('tr');
            row.classList.toggle('is-active', drawing.id === this.state.activeId);
            row.innerHTML = `
                <td>
                    <button type="button" class="btn btn-link" data-action="select" data-id="${drawing.id}">${drawing.name}</button>
                </td>
                <td><input type="text" class="form-input" data-action="meta" data-field="trade" data-id="${drawing.id}" value="${drawing.trade || ''}" placeholder="Trade"></td>
                <td><input type="text" class="form-input" data-action="meta" data-field="floor" data-id="${drawing.id}" value="${drawing.floor || ''}" placeholder="Floor"></td>
                <td><input type="text" class="form-input" data-action="meta" data-field="page" data-id="${drawing.id}" value="${drawing.page || ''}" placeholder="Page"></td>
                <td><button type="button" class="btn btn-ghost btn-sm" data-action="remove" data-id="${drawing.id}">Remove</button></td>
            `;
            fragment.appendChild(row);
        });

        drawingTableBody.appendChild(fragment);
    }

    updateStatus(message) {
        if (!this.elements.status) return;
        this.elements.status.textContent = message;
    }

    exportMeasurements() {
        const rows = this.getMeasurementRows();
        if (!rows.length) {
            this.toast('No measurements available to export.', 'warning');
            return;
        }
        const header = ['Drawing', 'Name', 'Mode', 'Quantity', 'Unit', 'Details'];
        const csvRows = [header.join(',')];
        rows.forEach((row) => {
            csvRows.push([
                row.drawing,
                row.label,
                row.mode,
                row.quantity,
                row.unit,
                row.details
            ].map((value) => {
                const text = (value ?? '').toString();
                return `"${text.replace(/"/g, '""')}"`;
            }).join(','));
        });
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'takeoff-measurements.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        this.toast('Measurements exported as CSV.', 'success');
    }

    pushMeasurements() {
        const rows = this.getMeasurementRows();
        if (!rows.length) {
            this.toast('No measurements to send to the estimate.', 'warning');
            return;
        }
        if (typeof this.services.estimate?.push === 'function') {
            this.services.estimate.push(rows);
        } else {
            this.toast('Estimate service unavailable.', 'warning');
        }
    }

    getMeasurementRows() {
        const rows = [];
        this.state.drawings.forEach((drawing) => {
            const list = this.measurements.get(drawing.id) || [];
            list.forEach((measurement) => {
                rows.push({
                    drawing: drawing.name,
                    label: measurement.label,
                    mode: measurement.type,
                    quantity: measurement.quantity,
                    unit: measurement.units,
                    details: measurement.details || ''
                });
            });
        });
        return rows;
    }

    toast(message, type = 'info') {
        this.services.toast(message, type);
    }
}


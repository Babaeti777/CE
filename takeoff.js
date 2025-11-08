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

function createId(prefix = 'drawing') {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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

        this.state = {
            drawings: [],
            filter: '',
            sortBy: 'trade',
            sortDir: 'asc',
            currentDrawingId: null,
            zoom: 1,
            isFullscreen: false,
            mode: 'length',
            points: [],
            previewPoint: null,
            countSettings: {
                color: '#ef4444',
                shape: 'circle',
                label: ''
            }
        };

        this.elements = {};
        this.lifecycle = new LifecycleManager();
        this.previewToken = 0;
        this.canvasContext = null;
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
        this.updateMode(this.state.mode);
        this.syncCountControls();
        this.updateCountToolbarVisibility();
        this.renderMeasurementTable();
        this.updateQuickShapeInputs();
        this.updateStatus('Upload plan files to start measuring.');
    }

    destroy() {
        this.lifecycle?.cleanup?.();
        this.cleanupDrawings();
        this.closePdfViewer({ silent: true });
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
            sortSelect,
            sortDirection,
            searchInput,
            drawingTableBody,
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
            modeSelect,
            scaleInput,
            canvas,
            measurementTableBody,
            clearBtn,
            exportBtn,
            pushBtn,
            countColorInput,
            countShapeSelect,
            countLabelInput,
            quickShapeSelect,
            quickBtn
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

        this.lifecycle.addEventListener(modeSelect, 'change', (event) => this.updateMode(event.target.value));
        this.lifecycle.addEventListener(scaleInput, 'change', (event) => this.updateScale(event.target.value));
        this.lifecycle.addEventListener(scaleInput, 'blur', (event) => this.updateScale(event.target.value));

        this.lifecycle.addEventListener(canvas, 'click', (event) => this.handleCanvasClick(event));
        this.lifecycle.addEventListener(canvas, 'dblclick', (event) => {
            event.preventDefault();
            this.handleCanvasDoubleClick();
        });
        this.lifecycle.addEventListener(canvas, 'mousemove', (event) => this.handleCanvasMove(event));
        this.lifecycle.addEventListener(canvas, 'mouseleave', () => this.handleCanvasLeave());

        this.lifecycle.addEventListener(measurementTableBody, 'click', (event) => this.handleMeasurementTableClick(event));
        this.lifecycle.addEventListener(measurementTableBody, 'input', (event) => this.handleMeasurementTableInput(event));

        this.lifecycle.addEventListener(clearBtn, 'click', () => this.clearMeasurements());
        this.lifecycle.addEventListener(exportBtn, 'click', () => this.exportMeasurements());
        this.lifecycle.addEventListener(pushBtn, 'click', () => this.pushToEstimate());

        this.lifecycle.addEventListener(countColorInput, 'input', (event) => this.updateCountSetting('color', event.target.value));
        this.lifecycle.addEventListener(countShapeSelect, 'change', (event) => this.updateCountSetting('shape', event.target.value));
        this.lifecycle.addEventListener(countLabelInput, 'input', (event) => this.updateCountSetting('label', event.target.value));

        this.lifecycle.addEventListener(quickShapeSelect, 'change', () => this.updateQuickShapeInputs());
        this.lifecycle.addEventListener(quickBtn, 'click', () => this.calculateQuickArea());
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
            file,
            scale: 1,
            measurements: [],
            counters: { length: 1, area: 1, count: 1, diameter: 1 }
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

        drawingTableBody.innerHTML = '';
        const drawings = this.getFilteredDrawings();

        drawings.forEach((drawing) => {
            const row = document.createElement('tr');
            row.dataset.id = drawing.id;
            if (drawing.id === this.state.currentDrawingId) {
                row.classList.add('is-active');
            }

            row.innerHTML = `
                <td>
                    <div class="takeoff-drawing-name">
                        <span class="takeoff-drawing-title">${drawing.name}</span>
                        <span class="takeoff-drawing-subtitle">${drawing.type === 'pdf' ? 'PDF Document' : 'Image'}</span>
                    </div>
                </td>
                <td>
                    <input type="text" class="form-input takeoff-input" data-field="trade" value="${drawing.trade || ''}" placeholder="Trade">
                </td>
                <td>
                    <input type="text" class="form-input takeoff-input" data-field="floor" value="${drawing.floor || ''}" placeholder="Floor">
                </td>
                <td>
                    <input type="text" class="form-input takeoff-input" data-field="page" value="${drawing.page || ''}" placeholder="Page">
                </td>
                <td class="takeoff-actions">
                    <button type="button" class="btn btn-secondary btn-sm" data-action="select">View</button>
                    <button type="button" class="btn btn-ghost btn-sm" data-action="remove" aria-label="Remove drawing">Remove</button>
                </td>
            `;

            drawingTableBody.appendChild(row);
        });

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
    }

    removeDrawing(id) {
        const index = this.state.drawings.findIndex((drawing) => drawing.id === id);
        if (index === -1) return;

        const [removed] = this.state.drawings.splice(index, 1);
        if (removed?.objectUrl) {
            URL.revokeObjectURL(removed.objectUrl);
        }
        removed?.pdfDoc?.destroy?.();

        if (this.state.currentDrawingId === id) {
            this.state.currentDrawingId = this.state.drawings[0]?.id || null;
        }

        this.renderDrawingList();
        this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
        this.updateStatus(`${removed?.name || 'Drawing'} removed.`);
    }

    selectDrawing(id) {
        if (!id || this.state.currentDrawingId === id) {
            return;
        }
        this.state.currentDrawingId = id;
        this.state.zoom = 1;
        this.state.points = [];
        this.state.previewPoint = null;
        this.renderDrawingList();
        this.updateZoomIndicator();
        this.updateActiveDrawingDisplay();
        this.updatePlanVisibility();
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
        if (this.elements.scaleInput) {
            this.elements.scaleInput.value = drawing ? String(drawing.scale || 1) : '1';
        }
        if (!drawing) {
            this.state.points = [];
            this.state.previewPoint = null;
            this.renderMeasurementTable();
            this.updateCountToolbarVisibility();
            this.syncCountControls();
            this.drawMeasurements();
            await this.updatePlanPreview(null);
            this.updatePdfControls();
            return;
        }
        await this.updatePlanPreview(drawing);
        this.updatePdfControls(drawing);
        this.renderMeasurementTable();
        this.updateCountToolbarVisibility();
        this.syncCountControls();
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
                this.drawMeasurements();
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
            drawing.naturalWidth = viewport.width;
            drawing.naturalHeight = viewport.height;
            this.sizeCanvasToDrawing(drawing);
            this.drawMeasurements();
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
        this.drawMeasurements();
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

    updateMode(mode) {
        this.state.mode = mode || 'length';
        if (this.elements.modeSelect && this.elements.modeSelect.value !== this.state.mode) {
            this.elements.modeSelect.value = this.state.mode;
        }
        this.state.points = [];
        this.state.previewPoint = null;
        this.updateCountToolbarVisibility();
        const drawing = this.getActiveDrawing();
        if (drawing) {
            const instructions = {
                length: 'Click a start and end point to measure length.',
                area: 'Click to add vertices, then double-click to finish the area.',
                count: 'Click each item on the plan to add to the quantity.',
                diameter: 'Click two points to measure the diameter.'
            }[this.state.mode] || 'Click on the plan to record measurements.';
            this.updateStatus(instructions);
        }
        this.drawMeasurements();
    }

    updateScale(value) {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            return;
        }
        try {
            const parsed = Validator.number(value, { min: 0.0001, fieldName: 'Scale' });
            drawing.scale = parsed;
            if (this.elements.scaleInput && this.elements.scaleInput.value !== String(parsed)) {
                this.elements.scaleInput.value = String(parsed);
            }
            this.renderMeasurementTable();
            this.drawMeasurements();
        } catch (error) {
            if (error instanceof ValidationError) {
                this.services.toast(error.message, 'warning');
            }
        }
    }

    updateCountSetting(key, value) {
        if (!(key in this.state.countSettings)) return;
        this.state.countSettings[key] = value;
    }

    syncCountControls() {
        const { countColorInput, countShapeSelect, countLabelInput } = this.elements;
        if (countColorInput) {
            countColorInput.value = this.state.countSettings.color;
        }
        if (countShapeSelect) {
            countShapeSelect.value = this.state.countSettings.shape;
        }
        if (countLabelInput && countLabelInput.value !== this.state.countSettings.label) {
            countLabelInput.value = this.state.countSettings.label;
        }
    }

    updateCountToolbarVisibility() {
        const { countToolbar } = this.elements;
        if (!countToolbar) return;
        countToolbar.classList.toggle('is-hidden', this.state.mode !== 'count');
    }

    getCanvasPoint(event) {
        const { canvas } = this.elements;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    }

    async handleCanvasClick(event) {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.services.toast('Select a drawing before measuring.', 'warning');
            return;
        }
        if (!this.elements.canvas) return;
        const point = this.getCanvasPoint(event);
        if (!point) return;

        if (this.state.mode === 'count') {
            const baseLabel = (this.state.countSettings.label || '').trim();
            const defaultLabel = baseLabel || `Count ${drawing.counters.count}`;
            const label = await this.promptForMeasurementLabel(defaultLabel);
            drawing.counters.count += 1;
            const measurement = {
                id: createId('measurement'),
                type: 'count',
                label,
                points: [point],
                count: 1,
                style: {
                    color: this.state.countSettings.color,
                    shape: this.state.countSettings.shape
                }
            };
            drawing.measurements.push(measurement);
            this.renderMeasurementTable();
            this.drawMeasurements();
            this.updateStatus(`${measurement.label} saved.`);
            return;
        }

        this.state.points.push(point);

        if (['length', 'diameter'].includes(this.state.mode) && this.state.points.length === 2) {
            await this.finalizeLengthMeasurement(this.state.mode);
        } else if (this.state.mode === 'area') {
            this.updateStatus('Double-click to finish the area measurement.');
            this.drawMeasurements();
        } else if (['length', 'diameter'].includes(this.state.mode)) {
            this.updateStatus('Select an end point to complete the measurement.');
            this.drawMeasurements();
        }
    }

    handleCanvasMove(event) {
        if (!this.state.points.length) return;
        const point = this.getCanvasPoint(event);
        if (!point) return;
        this.state.previewPoint = point;
        this.drawMeasurements();
    }

    handleCanvasLeave() {
        this.state.previewPoint = null;
        this.drawMeasurements();
    }

    async handleCanvasDoubleClick() {
        if (this.state.mode !== 'area' || this.state.points.length < 3) {
            return;
        }
        await this.finalizeAreaMeasurement();
    }

    async finalizeLengthMeasurement(type) {
        const drawing = this.getActiveDrawing();
        if (!drawing || this.state.points.length < 2) {
            return;
        }
        const [start, end] = this.state.points;
        const pixels = Math.hypot(end.x - start.x, end.y - start.y);
        const defaultLabel = `${type === 'diameter' ? 'Diameter' : 'Length'} ${drawing.counters[type]++}`;
        const label = await this.promptForMeasurementLabel(defaultLabel);
        const measurement = {
            id: createId('measurement'),
            type,
            label,
            points: [start, end],
            pixels
        };
        drawing.measurements.push(measurement);
        this.state.points = [];
        this.state.previewPoint = null;
        this.renderMeasurementTable();
        this.drawMeasurements();
        const value = this.getMeasurementValue(measurement, drawing);
        this.updateStatus(`${measurement.label} saved: ${value.toFixed(2)} ${this.getMeasurementUnits(measurement)}.`);
    }

    async finalizeAreaMeasurement() {
        const drawing = this.getActiveDrawing();
        if (!drawing || this.state.points.length < 3) {
            return;
        }
        const points = [...this.state.points];
        const defaultLabel = `Area ${drawing.counters.area++}`;
        const label = await this.promptForMeasurementLabel(defaultLabel);
        const measurement = {
            id: createId('measurement'),
            type: 'area',
            label,
            points,
            pixelArea: this.calculatePolygonArea(points),
            pixelPerimeter: this.calculatePolygonPerimeter(points)
        };
        drawing.measurements.push(measurement);
        this.state.points = [];
        this.state.previewPoint = null;
        this.renderMeasurementTable();
        this.drawMeasurements();
        const area = this.getMeasurementValue(measurement, drawing);
        this.updateStatus(`${measurement.label} saved: ${area.toFixed(2)} ${this.getMeasurementUnits(measurement)}.`);
    }

    drawMeasurements() {
        const { canvas } = this.elements;
        if (!canvas || !this.canvasContext) return;
        const drawing = this.getActiveDrawing();
        const ctx = this.canvasContext;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!drawing) {
            return;
        }

        drawing.measurements.forEach((measurement) => this.drawMeasurement(measurement, drawing));

        if (this.state.points.length) {
            ctx.save();
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(this.state.points[0].x, this.state.points[0].y);
            for (let i = 1; i < this.state.points.length; i += 1) {
                ctx.lineTo(this.state.points[i].x, this.state.points[i].y);
            }
            if (this.state.previewPoint) {
                ctx.lineTo(this.state.previewPoint.x, this.state.previewPoint.y);
            }
            if (this.state.mode === 'area') {
                ctx.closePath();
            }
            ctx.stroke();
            ctx.setLineDash([]);
            this.state.points.forEach((point) => this.drawHandle(point));
            if (this.state.previewPoint) {
                this.drawHandle(this.state.previewPoint, true);
            }
            ctx.restore();
        }
    }

    drawMeasurement(measurement, drawing) {
        if (!this.canvasContext) return;
        const ctx = this.canvasContext;
        ctx.save();
        if (measurement.type === 'length' || measurement.type === 'diameter') {
            ctx.strokeStyle = measurement.type === 'diameter' ? '#0ea5e9' : '#6366f1';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(measurement.points[0].x, measurement.points[0].y);
            ctx.lineTo(measurement.points[1].x, measurement.points[1].y);
            ctx.stroke();
            measurement.points.forEach((point) => this.drawHandle(point));
            const midX = (measurement.points[0].x + measurement.points[1].x) / 2;
            const midY = (measurement.points[0].y + measurement.points[1].y) / 2;
            const label = `${this.getMeasurementValue(measurement, drawing).toFixed(2)} ${this.getMeasurementUnits(measurement)}`;
            this.drawLabel(midX, midY, label);
        } else if (measurement.type === 'area') {
            ctx.strokeStyle = '#6366f1';
            ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(measurement.points[0].x, measurement.points[0].y);
            for (let i = 1; i < measurement.points.length; i += 1) {
                ctx.lineTo(measurement.points[i].x, measurement.points[i].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            measurement.points.forEach((point) => this.drawHandle(point));
            const centroid = this.calculateCentroid(measurement.points);
            const label = `${this.getMeasurementValue(measurement, drawing).toFixed(2)} ${this.getMeasurementUnits(measurement)}`;
            this.drawLabel(centroid.x, centroid.y, label);
        } else if (measurement.type === 'count') {
            const point = measurement.points[0];
            const style = this.getCountStyle(measurement);
            this.drawCountMarker(point, style);
            const background = this.hexToRgba(style.color, 0.9);
            const textColor = this.getReadableTextColor(style.color);
            this.drawLabel(point.x, point.y, measurement.label, { backgroundColor: background, textColor });
        }
        ctx.restore();
    }

    drawHandle(point, preview = false) {
        if (!this.canvasContext) return;
        this.canvasContext.save();
        this.canvasContext.fillStyle = preview ? '#f97316' : '#1f2937';
        this.canvasContext.beginPath();
        this.canvasContext.arc(point.x, point.y, preview ? 5 : 4, 0, Math.PI * 2);
        this.canvasContext.fill();
        this.canvasContext.restore();
    }

    drawLabel(x, y, text, options = {}) {
        if (!this.canvasContext || !this.elements.canvas) return;
        const ctx = this.canvasContext;
        const backgroundColor = options.backgroundColor || 'rgba(15, 23, 42, 0.85)';
        const textColor = options.textColor || '#ffffff';
        ctx.save();
        ctx.font = '12px Inter, sans-serif';
        ctx.textBaseline = 'top';
        const padding = 4;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const textHeight = (metrics.actualBoundingBoxAscent || 9) + (metrics.actualBoundingBoxDescent || 3);
        let rectX = x + 8;
        let rectY = y - textHeight - padding;
        rectX = Math.min(Math.max(rectX, 0), this.elements.canvas.width - textWidth - padding * 2);
        rectY = Math.min(Math.max(rectY, 0), this.elements.canvas.height - textHeight - padding);
        rectY = Math.max(rectY, 0);
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(rectX, rectY, textWidth + padding * 2, textHeight + padding);
        ctx.fillStyle = textColor;
        ctx.fillText(text, rectX + padding, rectY + padding / 2);
        ctx.restore();
    }

    getCountStyle(measurement) {
        return {
            color: measurement?.style?.color || this.state.countSettings.color,
            shape: measurement?.style?.shape || this.state.countSettings.shape
        };
    }

    drawCountMarker(point, style) {
        if (!this.canvasContext) return;
        const size = 14;
        const half = size / 2;
        const ctx = this.canvasContext;
        ctx.save();
        ctx.fillStyle = style.color || '#ef4444';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        switch (style.shape) {
            case 'square':
                ctx.rect(point.x - half, point.y - half, size, size);
                break;
            case 'diamond':
                ctx.moveTo(point.x, point.y - half);
                ctx.lineTo(point.x + half, point.y);
                ctx.lineTo(point.x, point.y + half);
                ctx.lineTo(point.x - half, point.y);
                ctx.closePath();
                break;
            case 'triangle':
                ctx.moveTo(point.x, point.y - half);
                ctx.lineTo(point.x + half, point.y + half);
                ctx.lineTo(point.x - half, point.y + half);
                ctx.closePath();
                break;
            default:
                ctx.arc(point.x, point.y, size / 2.2, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    hexToRgba(hex, alpha = 1) {
        if (typeof hex !== 'string') {
            return `rgba(15, 23, 42, ${alpha})`;
        }
        let normalized = hex.replace('#', '').trim();
        if (normalized.length === 3) {
            normalized = normalized.split('').map((char) => char + char).join('');
        }
        if (normalized.length !== 6 || /[^0-9a-f]/i.test(normalized)) {
            return `rgba(15, 23, 42, ${alpha})`;
        }
        const int = Number.parseInt(normalized, 16);
        if (Number.isNaN(int)) {
            return `rgba(15, 23, 42, ${alpha})`;
        }
        const r = (int >> 16) & 255;
        const g = (int >> 8) & 255;
        const b = int & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    getReadableTextColor(hex) {
        if (typeof hex !== 'string') {
            return '#ffffff';
        }
        let normalized = hex.replace('#', '').trim();
        if (normalized.length === 3) {
            normalized = normalized.split('').map((char) => char + char).join('');
        }
        if (normalized.length !== 6 || /[^0-9a-f]/i.test(normalized)) {
            return '#ffffff';
        }
        const int = Number.parseInt(normalized, 16);
        if (Number.isNaN(int)) {
            return '#ffffff';
        }
        const r = (int >> 16) & 255;
        const g = (int >> 8) & 255;
        const b = int & 255;
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.6 ? '#0f172a' : '#ffffff';
    }

    calculateCentroid(points) {
        let area = 0;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < points.length; i += 1) {
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

    calculatePolygonArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i += 1) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y - points[j].x * points[i].y;
        }
        return Math.abs(area) / 2;
    }

    calculatePolygonPerimeter(points) {
        let perimeter = 0;
        for (let i = 0; i < points.length; i += 1) {
            const j = (i + 1) % points.length;
            perimeter += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
        }
        return perimeter;
    }

    getMeasurementValue(measurement, drawing) {
        const scale = drawing?.scale > 0 ? drawing.scale : 1;
        if (measurement.type === 'length' || measurement.type === 'diameter') {
            return measurement.pixels / scale;
        }
        if (measurement.type === 'area') {
            return measurement.pixelArea / (scale * scale);
        }
        if (measurement.type === 'count') {
            return measurement.count || 1;
        }
        return 0;
    }

    getMeasurementUnits(measurement) {
        if (measurement.type === 'length' || measurement.type === 'diameter') {
            return 'ft';
        }
        if (measurement.type === 'area') {
            return 'sq ft';
        }
        if (measurement.type === 'count') {
            return 'ea';
        }
        return '';
    }

    formatModeLabel(type) {
        const labels = {
            length: 'Length',
            area: 'Area',
            count: 'Count',
            diameter: 'Diameter'
        };
        return labels[type] || 'Measurement';
    }

    getMeasurementDetails(measurement, drawing) {
        if (measurement.type === 'area') {
            const perimeter = measurement.pixelPerimeter / (drawing.scale > 0 ? drawing.scale : 1);
            return `Perimeter: ${perimeter.toFixed(2)} ft`;
        }
        if (measurement.type === 'count') {
            const style = this.getCountStyle(measurement);
            return `Marker: ${style.shape}`;
        }
        return '';
    }

    renderMeasurementTable() {
        const { measurementTableBody, measurementEmpty } = this.elements;
        const drawing = this.getActiveDrawing();
        if (!measurementTableBody || !measurementEmpty) return;
        measurementTableBody.innerHTML = '';

        const measurements = drawing?.measurements || [];
        if (!measurements.length) {
            measurementEmpty.classList.remove('is-hidden');
            return;
        }

        measurementEmpty.classList.add('is-hidden');
        measurements.forEach((measurement) => {
            const row = document.createElement('tr');
            row.dataset.id = measurement.id;
            const quantity = this.getMeasurementValue(measurement, drawing).toFixed(2);
            row.innerHTML = `
                <td>
                    <input type="text" class="form-input takeoff-input" data-field="label" value="${measurement.label || ''}">
                </td>
                <td>${this.formatModeLabel(measurement.type)}</td>
                <td>${quantity}</td>
                <td>${this.getMeasurementUnits(measurement)}</td>
                <td>${this.getMeasurementDetails(measurement, drawing)}</td>
                <td class="takeoff-actions">
                    <button type="button" class="btn btn-ghost btn-sm" data-action="remove" aria-label="Remove measurement">Remove</button>
                </td>
            `;
            measurementTableBody.appendChild(row);
        });
    }

    handleMeasurementTableClick(event) {
        const button = event.target.closest('[data-action="remove"]');
        if (!button) return;
        const row = button.closest('tr[data-id]');
        if (!row) return;
        this.removeMeasurement(row.dataset.id);
    }

    handleMeasurementTableInput(event) {
        const field = event.target.dataset.field;
        if (!field) return;
        const row = event.target.closest('tr[data-id]');
        if (!row) return;
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const measurement = drawing.measurements.find((item) => item.id === row.dataset.id);
        if (!measurement) return;
        measurement[field] = event.target.value;
    }

    removeMeasurement(id) {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const before = drawing.measurements.length;
        drawing.measurements = drawing.measurements.filter((item) => item.id !== id);
        if (drawing.measurements.length !== before) {
            this.renderMeasurementTable();
            this.drawMeasurements();
            this.updateStatus('Measurement removed.');
        }
    }

    clearMeasurements() {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        drawing.measurements = [];
        drawing.counters = { length: 1, area: 1, count: 1, diameter: 1 };
        this.state.points = [];
        this.state.previewPoint = null;
        this.renderMeasurementTable();
        this.drawMeasurements();
        this.updateStatus('All measurements cleared.');
    }

    exportMeasurements() {
        const rows = this.buildExportRows();
        if (!rows.length) {
            this.services.toast('No takeoff data to export.', 'warning');
            return;
        }
        const header = ['Drawing', 'Name', 'Mode', 'Quantity', 'Units', 'Details'];
        const lines = [header.join(',')];
        rows.forEach((row) => {
            lines.push([
                row.drawing,
                row.label,
                row.mode,
                row.quantity,
                row.unit,
                row.details
            ].map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'takeoff-measurements.csv';
        link.click();
        URL.revokeObjectURL(link.href);
        this.services.toast('Takeoff CSV exported!', 'success');
    }

    buildExportRows() {
        return this.state.drawings.flatMap((drawing) => {
            return drawing.measurements.map((measurement) => ({
                drawing: drawing.name,
                label: measurement.label,
                mode: this.formatModeLabel(measurement.type),
                quantity: this.getMeasurementValue(measurement, drawing).toFixed(2),
                unit: this.getMeasurementUnits(measurement),
                details: this.getMeasurementDetails(measurement, drawing)
            }));
        });
    }

    pushToEstimate() {
        const rows = this.buildExportRows();
        if (!rows.length) {
            this.services.toast('No takeoff data to send to the estimate.', 'warning');
            return;
        }
        this.services.estimate?.push?.(rows);
        this.services.toast('Measurements sent to the estimate.', 'success');
    }

    async promptForMeasurementLabel(defaultLabel) {
        if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
            return defaultLabel;
        }
        const result = window.prompt('Measurement name', defaultLabel);
        const value = (result || '').trim();
        return value || defaultLabel;
    }

    updateQuickShapeInputs() {
        const shape = this.elements.quickShapeSelect?.value || 'rectangle';
        if (!this.elements.quickDim1 || !this.elements.quickDim2 || !this.elements.quickDim2Group) return;
        if (shape === 'circle') {
            this.elements.quickDim1.placeholder = 'Radius';
            this.elements.quickDim2Group.style.display = 'none';
        } else {
            this.elements.quickDim2Group.style.display = 'block';
            if (shape === 'triangle') {
                this.elements.quickDim1.placeholder = 'Base';
                this.elements.quickDim2.placeholder = 'Height';
            } else {
                this.elements.quickDim1.placeholder = 'Length';
                this.elements.quickDim2.placeholder = 'Width';
            }
        }
    }

    calculateQuickArea() {
        if (!this.elements.quickResult || !this.elements.quickDim1) return;
        const shape = this.elements.quickShapeSelect?.value || 'rectangle';
        const dim1 = parseFloat(this.elements.quickDim1.value || '0');
        const dim2 = parseFloat(this.elements.quickDim2?.value || '0');
        let area = 0;
        if (shape === 'circle') {
            area = Math.PI * (dim1 ** 2);
        } else if (shape === 'triangle') {
            area = 0.5 * dim1 * dim2;
        } else {
            area = dim1 * dim2;
        }
        this.elements.quickResult.textContent = `Area: ${Number.isFinite(area) ? area.toFixed(2) : '0.00'} sq ft`;
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

import { LifecycleManager } from './services/lifecycle-manager.js';
import { Validator, ValidationError } from './utils/validator.js';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';

if (pdfjsLib?.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.mjs';
    pdfjsLib.GlobalWorkerOptions.workerType = 'module';
}

class OptimizedCanvas {
    constructor(canvas) {
        this.canvas = canvas;
        this.offscreen = canvas ? document.createElement('canvas') : null;
        this.offscreenCtx = this.offscreen ? this.offscreen.getContext('2d', { alpha: true }) : null;
    }

    render(drawFn) {
        if (!this.canvas || !this.offscreen || !this.offscreenCtx) return;
        const { width, height } = this.canvas;
        this.offscreen.width = width;
        this.offscreen.height = height;
        const ctx = this.offscreenCtx;
        ctx.clearRect(0, 0, width, height);
        drawFn(ctx);
        const main = this.canvas.getContext('2d');
        if (!main) return;
        main.clearRect(0, 0, width, height);
        main.drawImage(this.offscreen, 0, 0);
    }

    clear() {
        if (!this.canvas) return;
        const main = this.canvas.getContext('2d');
        if (main) {
            main.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
        if (this.offscreenCtx) {
            this.offscreenCtx.clearRect(0, 0, this.offscreen.width, this.offscreen.height);
        }
    }
}

export class TakeoffManager {
    constructor({ toastService, estimateService, storageService, pdfService } = {}) {
        this.services = {
            toastService: toastService || ((message, type) => console.info(`[${type || 'info'}] ${message}`)),
            estimateService: estimateService || { push: () => {} },
            storageService: storageService || null,
            pdfService: pdfService || {},
        };

        this.state = {
            drawings: [],
            currentDrawingId: null,
            mode: 'length',
            points: [],
            previewPoint: null,
            sortBy: 'trade',
            sortDir: 'asc',
            filter: '',
            zoom: 1,
            isFullscreen: false,
            countSettings: {
                color: '#ef4444',
                shape: 'circle',
                label: ''
            }
        };

        this.elements = {};
        this.canvasContext = null;
        this.canvasRenderer = null;
        this.lifecycle = new LifecycleManager();
        this.pdfWorkerConfigured = false;
        this.zoomLimits = { min: 0.5, max: 3 };
        this.pdfSources = new Map();
        this.pdfDocuments = new Map();
        this.pdfViewerState = {
            activePdfId: null,
            objectUrl: null,
            initialPage: 1
        };

        this.pendingLabelRequest = null;
        this.labelReturnFocus = null;

        this.handleDocumentFullscreenChange = this.handleDocumentFullscreenChange.bind(this);
    }

    init() {
        this.cacheDom();
        this.bindEvents();
        this.updateQuickShapeInputs();
        this.syncZoomControls();
        this.updateZoomButtonState();
        this.updateSortDirectionIcon();
        this.syncCountControls();
        this.applyZoom();
        this.updateCountToolbarVisibility();
        this.updateFullscreenButton();
        this.updatePdfControls();
        this.renderDrawingList();
        this.updateActiveDrawingDisplay();
        this.renderMeasurementTable();
        this.updateStatus('Upload plan files to start measuring.');
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
            zoomInBtn: byId('takeoffZoomInBtn'),
            zoomOutBtn: byId('takeoffZoomOutBtn'),
            zoomResetBtn: byId('takeoffZoomResetBtn'),
            zoomIndicator: byId('takeoffZoomIndicator'),
            fullscreenBtn: byId('takeoffFullscreenBtn'),
            fullScreenToggle: byId('takeoffFullScreenToggle'),
            pdfControls: byId('takeoffPdfControls'),
            pdfPrevBtn: byId('takeoffPdfPrev'),
            pdfNextBtn: byId('takeoffPdfNext'),
            pdfPageInput: byId('takeoffPdfPageInput'),
            pdfPageTotal: byId('takeoffPdfPageTotal'),
            pdfOpenBtn: byId('takeoffPdfOpen'),
            pdfDownloadBtn: byId('takeoffPdfDownload'),
            status: byId('takeoffStatus'),
            clearBtn: byId('takeoffClearBtn'),
            exportBtn: byId('takeoffExportCsvBtn'),
            pushBtn: byId('takeoffPushBtn'),
            measurementTableBody: byId('takeoffMeasurementTableBody'),
            measurementEmpty: byId('takeoffMeasurementEmpty'),
            activeMeta: byId('takeoffActiveMeta'),
            quickShapeSelect: byId('takeoffShapeSelect'),
            quickDim1: byId('takeoffDim1'),
            quickDim2: byId('takeoffDim2'),
            quickDim2Group: byId('takeoffDim2Group'),
            quickBtn: byId('takeoffQuickCalcBtn'),
            quickResult: byId('takeoffQuickResult'),
            countColorInput: byId('takeoffCountColor'),
            countShapeSelect: byId('takeoffCountShape'),
            countLabelInput: byId('takeoffCountLabel'),
            countToolbar: byId('takeoffCountToolbar'),
            openPdfBtn: byId('takeoffOpenPdfBtn'),
            pdfModal: byId('takeoffPdfModal'),
            pdfModalOverlay: byId('takeoffPdfModalOverlay'),
            pdfModalClose: byId('takeoffPdfModalClose'),
            pdfFrame: byId('takeoffPdfFrame'),
            labelModal: byId('takeoffLabelModal'),
            labelForm: byId('takeoffLabelForm'),
            labelInput: byId('takeoffLabelInput'),
            labelCancel: byId('cancelTakeoffLabelModal'),
            labelConfirm: byId('confirmTakeoffLabelModal'),
            labelClose: byId('closeTakeoffLabelModal')
        };

        if (this.elements.canvas) {
            this.canvasRenderer = new OptimizedCanvas(this.elements.canvas);
            this.canvasContext = this.elements.canvas.getContext('2d');
        }
    }

    bindEvents() {
        this.lifecycle.addEventListener(this.elements.drawingInput, 'change', (event) => this.handleDrawingUpload(event));
        this.lifecycle.addEventListener(this.elements.sortSelect, 'change', (event) => {
            this.state.sortBy = event.target.value;
            this.renderDrawingList();
        });
        this.lifecycle.addEventListener(this.elements.sortDirection, 'click', () => {
            this.toggleSortDirection();
            this.renderDrawingList();
        });
        this.lifecycle.addEventListener(this.elements.searchInput, 'input', (event) => {
            this.state.filter = event.target.value.trim().toLowerCase();
            this.renderDrawingList();
        });
        this.lifecycle.addEventListener(this.elements.drawingTableBody, 'click', (event) => this.handleDrawingTableClick(event));
        this.lifecycle.addEventListener(this.elements.drawingTableBody, 'input', (event) => this.handleDrawingTableInput(event));

        this.lifecycle.addEventListener(this.elements.modeSelect, 'change', (event) => this.updateMode(event.target.value));
        this.lifecycle.addEventListener(this.elements.scaleInput, 'input', (event) => this.updateScale(event.target.value));

        this.lifecycle.addEventListener(this.elements.zoomInBtn, 'click', () => this.stepZoom(0.1));
        this.lifecycle.addEventListener(this.elements.zoomOutBtn, 'click', () => this.stepZoom(-0.1));
        this.lifecycle.addEventListener(this.elements.zoomResetBtn, 'click', () => this.resetZoom());

        this.lifecycle.addEventListener(this.elements.pdfPrevBtn, 'click', () => this.navigatePdfPage(-1));
        this.lifecycle.addEventListener(this.elements.pdfNextBtn, 'click', () => this.navigatePdfPage(1));
        this.lifecycle.addEventListener(this.elements.pdfPageInput, 'change', (event) => {
            const value = parseInt(event.target.value, 10);
            if (Number.isFinite(value)) {
                this.jumpToPdfPage(value);
            } else {
                this.updatePdfToolbar(this.getActiveDrawing());
            }
        });
        this.lifecycle.addEventListener(this.elements.pdfOpenBtn, 'click', () => this.openActivePdfInViewer());
        this.lifecycle.addEventListener(this.elements.pdfDownloadBtn, 'click', () => this.downloadActivePdf());

        const handleColorChange = (event) => this.updateCountColor(event.target.value);
        this.lifecycle.addEventListener(this.elements.countColorInput, 'input', handleColorChange);
        this.lifecycle.addEventListener(this.elements.countColorInput, 'change', handleColorChange);
        this.lifecycle.addEventListener(this.elements.countShapeSelect, 'change', (event) => this.updateCountShape(event.target.value));
        this.lifecycle.addEventListener(this.elements.countLabelInput, 'input', (event) => this.updateCountLabel(event.target.value));

        if (this.elements.labelForm) {
            this.lifecycle.addEventListener(this.elements.labelForm, 'submit', (event) => {
                event.preventDefault();
                this.resolveLabelModal(true);
            });
        }
        if (this.elements.labelCancel) {
            this.lifecycle.addEventListener(this.elements.labelCancel, 'click', (event) => {
                event.preventDefault();
                this.resolveLabelModal(false);
            });
        }
        if (this.elements.labelClose) {
            this.lifecycle.addEventListener(this.elements.labelClose, 'click', (event) => {
                event.preventDefault();
                this.resolveLabelModal(false);
            });
        }
        if (this.elements.labelModal) {
            this.lifecycle.addEventListener(this.elements.labelModal, 'keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this.resolveLabelModal(false);
                }
            });
        }

        this.lifecycle.addEventListener(this.elements.fullscreenBtn, 'click', () => this.toggleFullscreen());
        this.lifecycle.addEventListener(this.elements.fullScreenToggle, 'click', () => this.toggleFullscreen());

        if (typeof document !== 'undefined') {
            this.lifecycle.addEventListener(document, 'keydown', (event) => this.handleDocumentKeydown(event));
            this.lifecycle.addEventListener(document, 'fullscreenchange', this.handleDocumentFullscreenChange);
            this.lifecycle.addEventListener(document, 'webkitfullscreenchange', this.handleDocumentFullscreenChange);
        }
        this.lifecycle.addEventListener(this.elements.clearBtn, 'click', () => this.clearMeasurements());
        this.lifecycle.addEventListener(this.elements.exportBtn, 'click', () => this.exportCsv());
        this.lifecycle.addEventListener(this.elements.pushBtn, 'click', () => this.pushToEstimate());

        this.lifecycle.addEventListener(this.elements.canvas, 'click', (event) => this.handleCanvasClick(event));
        this.lifecycle.addEventListener(this.elements.canvas, 'mousemove', (event) => this.handleCanvasMove(event));
        this.lifecycle.addEventListener(this.elements.canvas, 'mouseleave', () => this.handleCanvasLeave());
        this.lifecycle.addEventListener(this.elements.canvas, 'dblclick', (event) => this.handleCanvasDoubleClick(event));

        this.lifecycle.addEventListener(this.elements.measurementTableBody, 'input', (event) => this.handleMeasurementInput(event));
        this.lifecycle.addEventListener(this.elements.measurementTableBody, 'click', (event) => this.handleMeasurementClick(event));

        this.lifecycle.addEventListener(this.elements.quickShapeSelect, 'change', () => this.updateQuickShapeInputs());
        this.lifecycle.addEventListener(this.elements.quickBtn, 'click', () => this.calculateQuickArea());

        this.lifecycle.addEventListener(this.elements.openPdfBtn, 'click', () => this.openActivePdf());
        this.lifecycle.addEventListener(this.elements.pdfModalClose, 'click', () => this.closePdfViewer());
        this.lifecycle.addEventListener(this.elements.pdfModalOverlay, 'click', () => this.closePdfViewer());
        this.lifecycle.addEventListener(this.elements.pdfModal, 'click', (event) => {
            if (event.target === this.elements.pdfModal) {
                this.closePdfViewer();
            }
        });
    }

    setFullscreen(enabled, options = {}) {
        const { syncNative = false } = options;
        if (!this.elements.planContainer) {
            this.state.isFullscreen = false;
            if (syncNative) {
                this.exitNativeFullscreen();
            }
            return;
        }
        const nextState = Boolean(enabled);
        this.state.isFullscreen = nextState;
        this.elements.planContainer.classList.toggle('takeoff-plan-fullscreen', nextState);
        if (typeof document !== 'undefined' && document.body) {
            document.body.classList.toggle('takeoff-fullscreen-active', nextState);
        }
        if (this.elements.fullScreenToggle) {
            this.elements.fullScreenToggle.textContent = nextState ? 'Exit Full View' : 'Full View';
            this.elements.fullScreenToggle.setAttribute('aria-pressed', nextState ? 'true' : 'false');
        }
        this.updateFullscreenButton();
        if (syncNative) {
            if (nextState) {
                this.requestNativeFullscreen();
            } else {
                this.exitNativeFullscreen();
            }
        }
    }

    requestNativeFullscreen() {
        if (typeof document === 'undefined') return;
        const container = this.elements.planContainer;
        if (!container) return;
        const request =
            container.requestFullscreen ||
            container.webkitRequestFullscreen ||
            container.msRequestFullscreen ||
            container.mozRequestFullScreen;
        if (!request) return;
        try {
            const result = request.call(container);
            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        } catch (error) {
            console.warn('Unable to enter fullscreen mode:', error);
        }
    }

    exitNativeFullscreen() {
        if (typeof document === 'undefined') return;
        const exit =
            document.exitFullscreen ||
            document.webkitExitFullscreen ||
            document.msExitFullscreen ||
            document.mozCancelFullScreen;
        if (!exit) return;
        try {
            const result = exit.call(document);
            if (result && typeof result.catch === 'function') {
                result.catch(() => {});
            }
        } catch (error) {
            console.warn('Unable to exit fullscreen mode:', error);
        }
    }

    handleDocumentFullscreenChange() {
        if (typeof document === 'undefined') return;
        const fullscreenElement =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.msFullscreenElement ||
            document.mozFullScreenElement ||
            null;
        const isFullscreenActive = Boolean(fullscreenElement);
        this.setFullscreen(isFullscreenActive, { syncNative: false });
    }

    toggleFullscreen() {
        if (!this.getActiveDrawing()) {
            this.services.toastService('Select a drawing before using full screen.', 'warning');
            return;
        }
        const shouldEnable = !this.state.isFullscreen;
        this.setFullscreen(shouldEnable, { syncNative: true });
        if (shouldEnable) {
            this.elements.planStage?.focus?.();
        }
    }

    updateFullscreenButton() {
        if (!this.elements.fullscreenBtn) return;
        this.elements.fullscreenBtn.textContent = this.state.isFullscreen ? 'Exit Full Screen' : 'Full Screen';
        this.elements.fullscreenBtn.setAttribute('aria-pressed', this.state.isFullscreen ? 'true' : 'false');
    }

    syncCountControls() {
        if (this.elements.countColorInput) {
            this.elements.countColorInput.value = this.state.countSettings.color;
        }
        if (this.elements.countShapeSelect) {
            this.elements.countShapeSelect.value = this.state.countSettings.shape;
        }
        if (this.elements.countLabelInput) {
            this.elements.countLabelInput.value = this.state.countSettings.label;
        }
    }

    updateCountColor(value) {
        if (typeof value !== 'string' || !value.trim()) return;
        this.state.countSettings.color = value;
    }

    updateCountShape(value) {
        if (typeof value !== 'string' || !value.trim()) return;
        this.state.countSettings.shape = value;
    }

    updateCountLabel(value) {
        this.state.countSettings.label = value;
    }

    updateCountToolbarVisibility() {
        if (!this.elements.countToolbar) return;
        const shouldShow = this.state.mode === 'count';
        this.elements.countToolbar.classList.toggle('is-hidden', !shouldShow);
    }

    getCountStyle(measurement) {
        const style = (measurement && measurement.style) || {};
        const color = typeof style.color === 'string' && style.color ? style.color : '#ef4444';
        const shape = typeof style.shape === 'string' && style.shape ? style.shape : 'circle';
        return { color, shape };
    }

    async handleDrawingUpload(event) {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        for (const file of files) {
            await this.processFile(file);
        }

        event.target.value = '';
        this.renderDrawingList();
        this.ensureCurrentDrawing();
    }

    async processFile(file) {
        try {
            const isPdf =
                (file.type && file.type.toLowerCase() === 'application/pdf') ||
                file.name.toLowerCase().endsWith('.pdf');
            if (isPdf) {
                if (!pdfjsLib) {
                    this.services.toastService('PDF support is unavailable.', 'error');
                    return;
                }
                await this.processPdfFile(file);
            } else {
                const dataUrl = await this.readFileAsDataUrl(file);
                this.addDrawing({
                    name: file.name,
                    page: '',
                    imageUrl: dataUrl,
                    type: 'image'
                });
            }
        } catch (error) {
            console.error('Error processing drawing file:', error);
            this.services.toastService('Unable to load drawing file.', 'error');
        }
    }

    async processPdfFile(file) {
        let pdfDocId = null;
        let objectUrl = null;
        try {
            this.ensurePdfWorker();
            const arrayBuffer = await file.arrayBuffer();
            const pdfData = new Uint8Array(arrayBuffer);
            const pdfBytes = pdfData.slice();
            const pdfId = this.createId('pdf');
            const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
            pdfDocId = this.createId('pdfDoc');
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            objectUrl = URL.createObjectURL(blob);
            this.pdfSources.set(pdfId, {
                data: pdfBytes,
                name: file.name,
                totalPages: pdf.numPages
            });
            this.pdfDocuments.set(pdfDocId, {
                id: pdfDocId,
                name: file.name,
                url: objectUrl,
                pageCount: pdf.numPages,
                refCount: 0
            });
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                const imageUrl = await this.renderPdfPage(pdf, pageNumber);
                const drawing = this.addDrawing({
                    name: `${file.name.replace(/\.pdf$/i, '')} - Page ${pageNumber}`,
                    page: String(pageNumber),
                    imageUrl,
                    type: 'pdf',
                    pdfId,
                    pdfDocId,
                    pdfFileName: file.name,
                    pdfPageNumber: pageNumber,
                    pdfPage: pageNumber,
                    pdfTotalPages: pdf.numPages
                });
                const docMeta = this.pdfDocuments.get(pdfDocId);
                if (docMeta) {
                    docMeta.refCount += 1;
                }
            }
            const meta = this.pdfDocuments.get(pdfDocId);
            if (meta && meta.refCount === 0) {
                this.teardownPdfDocument(pdfDocId);
            }
        } catch (error) {
            console.error('Error rendering PDF:', error);
            this.services.toastService('Unable to render PDF drawing.', 'error');
            if (pdfDocId) {
                const meta = this.pdfDocuments.get(pdfDocId);
                if (meta && meta.refCount === 0) {
                    this.teardownPdfDocument(pdfDocId);
                }
            }
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        }
    }

    ensurePdfWorker() {
        if (this.pdfWorkerConfigured || !pdfjsLib || !pdfjsLib.GlobalWorkerOptions) return;
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.mjs';
            pdfjsLib.GlobalWorkerOptions.workerType = 'module';
        }
        this.pdfWorkerConfigured = true;
    }

    async renderPdfPage(pdf, pageNumber) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.5 });
        const tempCanvas = document.createElement('canvas');
        const tempContext = tempCanvas.getContext('2d');
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        await page.render({ canvasContext: tempContext, viewport }).promise;
        return tempCanvas.toDataURL('image/png');
    }

    readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const result = typeof event.target?.result === 'string' ? event.target.result : null;
                if (result) resolve(result);
                else reject(new Error('Unable to read file.'));
            };
            reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
            reader.readAsDataURL(file);
        });
    }

    addDrawing({ name, page = '', trade = '', floor = '', imageUrl, type, ...metadata }) {
        const drawing = {
            id: this.createId('drawing'),
            name,
            page,
            trade,
            floor,
            imageUrl,
            type,
            ...metadata,
            scale: 1,
            measurements: [],
            counters: { length: 1, area: 1, count: 1, diameter: 1 }
        };
        this.state.drawings.push(drawing);
        this.state.currentDrawingId = drawing.id;
        this.updateActiveDrawingDisplay();
        this.updateStatus('Drawing loaded. Choose a mode to start measuring.');
        return drawing;
    }

    filterAndSortDrawings() {
        const filter = this.state.filter;
        const compareKey = (drawing) => {
            if (this.state.sortBy === 'trade') return drawing.trade.toLowerCase();
            if (this.state.sortBy === 'floor') return drawing.floor.toLowerCase();
            if (this.state.sortBy === 'page') return drawing.page.toLowerCase();
            return drawing.name.toLowerCase();
        };

        const filtered = this.state.drawings.filter((drawing) => {
            if (!filter) return true;
            const haystack = `${drawing.name} ${drawing.trade} ${drawing.floor} ${drawing.page}`.toLowerCase();
            return haystack.includes(filter);
        });

        return filtered.sort((a, b) => {
            const keyA = compareKey(a);
            const keyB = compareKey(b);
            if (keyA === keyB) return 0;
            const direction = this.state.sortDir === 'asc' ? 1 : -1;
            return keyA > keyB ? direction : -direction;
        });
    }

    renderDrawingList() {
        const tbody = this.elements.drawingTableBody;
        if (!tbody) return;
        tbody.innerHTML = '';

        const drawings = this.filterAndSortDrawings();
        if (!drawings.length) {
            if (this.state.drawings.length) {
                this.elements.drawingEmpty.textContent = 'No drawings match your filters.';
            } else {
                this.elements.drawingEmpty.textContent = 'Upload plan files to begin building your takeoff.';
            }
            this.elements.drawingEmpty.style.display = 'block';
            return;
        }

        this.elements.drawingEmpty.style.display = 'none';
        drawings.forEach((drawing) => {
            const row = document.createElement('tr');
            row.className = 'takeoff-drawing-row';
            row.dataset.id = drawing.id;

            const nameCell = document.createElement('td');
            nameCell.textContent = drawing.name;

            const tradeCell = document.createElement('td');
            tradeCell.appendChild(this.createMetaInput(drawing.id, 'trade', drawing.trade, 'Trade'));

            const floorCell = document.createElement('td');
            floorCell.appendChild(this.createMetaInput(drawing.id, 'floor', drawing.floor, 'Floor'));

            const pageCell = document.createElement('td');
            pageCell.appendChild(this.createMetaInput(drawing.id, 'page', drawing.page, 'Page'));

            const actionCell = document.createElement('td');
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'takeoff-remove-drawing';
            removeBtn.dataset.action = 'remove-drawing';
            removeBtn.textContent = '×';
            actionCell.appendChild(removeBtn);

            row.append(nameCell, tradeCell, floorCell, pageCell, actionCell);
            if (drawing.id === this.state.currentDrawingId) {
                row.classList.add('active');
            }
            tbody.appendChild(row);
        });
    }

    createMetaInput(id, field, value, placeholder) {
        const input = document.createElement('input');
        input.type = 'text';
        input.dataset.id = id;
        input.dataset.field = field;
        input.value = value;
        input.placeholder = placeholder;
        return input;
    }

    handleDrawingTableClick(event) {
        const removeBtn = event.target.closest('[data-action="remove-drawing"]');
        if (removeBtn) {
            const row = removeBtn.closest('tr');
            if (row?.dataset.id) {
                this.removeDrawing(row.dataset.id);
            }
            return;
        }

        if (event.target instanceof HTMLInputElement) return;
        const row = event.target.closest('tr');
        if (row?.dataset.id) {
            this.setCurrentDrawing(row.dataset.id);
        }
    }

    handleDrawingTableInput(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        const { id, field } = target.dataset;
        if (!id || !field) return;
        const drawing = this.state.drawings.find((item) => item.id === id);
        if (!drawing) return;
        drawing[field] = target.value;
        if (drawing.id === this.state.currentDrawingId) {
            this.updateActiveDrawingDisplay();
        }
    }

    removeDrawing(id) {
        const target = this.state.drawings.find((drawing) => drawing.id === id) || null;
        const wasActive = id === this.state.currentDrawingId;
        this.state.drawings = this.state.drawings.filter((drawing) => drawing.id !== id);
        if (target?.pdfId) {
            const stillReferenced = this.state.drawings.some((drawing) => drawing.pdfId === target.pdfId);
            if (!stillReferenced) {
                if (this.pdfViewerState.activePdfId === target.pdfId) {
                    this.closePdfViewer();
                }
                this.pdfSources.delete(target.pdfId);
            }
        }
        if (wasActive) {
            this.state.currentDrawingId = null;
            this.updateActiveDrawingDisplay();
            this.renderMeasurementTable();
        }
        this.renderDrawingList();
        if (!this.state.drawings.length) {
            this.clearCanvas();
            this.updateStatus('Upload plan files to start measuring.');
        }
    }

    setCurrentDrawing(id) {
        if (id === this.state.currentDrawingId) return;
        this.state.currentDrawingId = id;
        this.updateActiveDrawingDisplay();
        this.renderDrawingList();
        this.renderMeasurementTable();
    }

    ensureCurrentDrawing() {
        if (this.state.currentDrawingId) return;
        if (this.state.drawings.length) {
            this.state.currentDrawingId = this.state.drawings[this.state.drawings.length - 1].id;
            this.updateActiveDrawingDisplay();
            this.renderMeasurementTable();
        }
    }

    getActiveDrawing() {
        if (!this.state.currentDrawingId) return null;
        return this.state.drawings.find((drawing) => drawing.id === this.state.currentDrawingId) || null;
    }

    updateActiveDrawingDisplay() {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.updatePdfToolbar(null);
            if (this.elements.planContainer) {
                this.elements.planContainer.style.display = 'none';
            }
            this.setFullscreen(false, { syncNative: true });
            if (this.elements.activeMeta) {
                this.elements.activeMeta.textContent = 'Select a drawing to begin.';
            }
            this.state.countSettings.label = '';
            this.syncCountControls();
            this.clearCanvas();
            if (this.elements.openPdfBtn) {
                this.elements.openPdfBtn.classList.remove('is-visible');
                this.elements.openPdfBtn.disabled = true;
                this.elements.openPdfBtn.setAttribute('aria-hidden', 'true');
                this.elements.openPdfBtn.setAttribute('aria-disabled', 'true');
                this.elements.openPdfBtn.setAttribute('tabindex', '-1');
                this.elements.openPdfBtn.textContent = 'Open PDF Reader';
            }
            return;
        }

        this.updatePdfToolbar(drawing);
        if (this.elements.planContainer) {
            this.elements.planContainer.style.display = 'block';
        }
        this.resetZoom();
        this.syncCountControls();
        if (this.elements.planPreview) {
            this.elements.planPreview.onload = null;
            this.elements.planPreview.src = drawing.imageUrl;
            if (this.elements.planPreview.complete) {
                this.prepareCanvas(this.elements.planPreview.naturalWidth, this.elements.planPreview.naturalHeight);
            } else {
                this.elements.planPreview.onload = () => {
                    this.prepareCanvas(this.elements.planPreview.naturalWidth, this.elements.planPreview.naturalHeight);
                };
            }
        }
        if (this.elements.scaleInput) {
            this.elements.scaleInput.value = String(drawing.scale);
        }
        if (this.elements.activeMeta) {
            const pieces = [drawing.trade, drawing.floor, drawing.page].filter(Boolean);
            this.elements.activeMeta.textContent = pieces.length ? pieces.join(' • ') : 'No metadata assigned.';
        }
        if (this.elements.openPdfBtn) {
            const isPdfDrawing = drawing.type === 'pdf';
            let totalPages = null;
            const drawingPageCount = Number.parseInt(drawing.pdfTotalPages, 10);
            if (Number.isFinite(drawingPageCount) && drawingPageCount > 0) {
                totalPages = drawingPageCount;
            } else {
                const sourcePages = Number(this.getPdfSource(drawing)?.totalPages);
                if (Number.isFinite(sourcePages) && sourcePages > 0) {
                    totalPages = sourcePages;
                }
            }
            const parsedCurrent = Number.parseInt(drawing.pdfPage, 10);
            const currentPage = Number.isFinite(parsedCurrent) && parsedCurrent > 0 ? parsedCurrent : 1;
            const label = totalPages ? `Open PDF Reader (${currentPage}/${totalPages})` : 'Open PDF Reader';
            this.elements.openPdfBtn.textContent = label;
            this.elements.openPdfBtn.classList.toggle('is-visible', isPdfDrawing);
            this.elements.openPdfBtn.disabled = !isPdfDrawing;
            this.elements.openPdfBtn.setAttribute('aria-hidden', isPdfDrawing ? 'false' : 'true');
            this.elements.openPdfBtn.setAttribute('aria-disabled', isPdfDrawing ? 'false' : 'true');
            this.elements.openPdfBtn.setAttribute('tabindex', isPdfDrawing ? '0' : '-1');
        }
        this.state.points = [];
        this.state.previewPoint = null;
        this.drawMeasurements();
    }

    prepareCanvas(width, height) {
        if (!this.elements.canvas || !this.canvasContext) return;
        const safeWidth = Math.max(1, Math.round(width));
        const safeHeight = Math.max(1, Math.round(height));
        this.elements.canvas.width = safeWidth;
        this.elements.canvas.height = safeHeight;
        this.elements.canvas.style.width = `${safeWidth}px`;
        this.elements.canvas.style.height = `${safeHeight}px`;
        if (this.elements.planInner) {
            this.elements.planInner.style.width = `${safeWidth}px`;
            this.elements.planInner.style.height = `${safeHeight}px`;
        }
        if (this.elements.planPreview) {
            this.elements.planPreview.style.width = `${safeWidth}px`;
            this.elements.planPreview.style.height = 'auto';
        }
        if (this.elements.planStage) {
            this.elements.planStage.scrollLeft = 0;
            this.elements.planStage.scrollTop = 0;
        }
        this.applyZoom();
        this.drawMeasurements();
    }

    getPdfSource(drawing) {
        if (!drawing || !drawing.pdfId) return null;
        return this.pdfSources.get(drawing.pdfId) || null;
    }

    isPdfViewerOpen() {
        return Boolean(this.elements.pdfModal?.classList.contains('is-open'));
    }

    openActivePdf() {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.services.toastService('Select a drawing before opening the PDF reader.', 'warning');
            return;
        }
        this.openPdfViewer(drawing);
    }

    openPdfViewer(drawing) {
        const source = this.getPdfSource(drawing);
        if (!source) {
            this.services.toastService('Original PDF data is unavailable for this drawing.', 'error');
            return;
        }
        if (!this.elements.pdfModal || !this.elements.pdfFrame) {
            this.services.toastService('PDF reader is not available.', 'error');
            return;
        }

        this.closePdfViewer({ returnFocus: false });

        try {
            const blob = new Blob([source.data], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const pageNumber = Number(drawing.pdfPage) || 1;
            this.pdfViewerState = {
                activePdfId: drawing.pdfId,
                objectUrl: url,
                initialPage: pageNumber
            };
            const pageFragment = pageNumber ? `#page=${pageNumber}` : '';
            this.elements.pdfFrame.src = `${url}${pageFragment}`;
            this.elements.pdfFrame.setAttribute('data-filename', source.name || '');
            this.elements.pdfModal.classList.add('is-open');
            this.elements.pdfModal.setAttribute('aria-hidden', 'false');
            if (typeof document !== 'undefined') {
                document.body.classList.add('takeoff-pdf-modal-open');
            }
            this.elements.pdfModalClose?.focus?.();
        } catch (error) {
            console.error('Error opening PDF viewer:', error);
            this.services.toastService('Unable to open the PDF reader.', 'error');
            this.closePdfViewer();
        }
    }

    closePdfViewer(options = {}) {
        const { returnFocus = true } = options;
        if (!this.elements.pdfModal) return;
        if (this.pdfViewerState.objectUrl) {
            URL.revokeObjectURL(this.pdfViewerState.objectUrl);
        }
        if (this.elements.pdfFrame) {
            this.elements.pdfFrame.src = '';
            this.elements.pdfFrame.removeAttribute('data-filename');
        }
        this.pdfViewerState = {
            activePdfId: null,
            objectUrl: null,
            initialPage: 1
        };
        this.elements.pdfModal.classList.remove('is-open');
        this.elements.pdfModal.setAttribute('aria-hidden', 'true');
        if (typeof document !== 'undefined') {
            document.body.classList.remove('takeoff-pdf-modal-open');
        }
        if (returnFocus && this.elements.openPdfBtn?.classList.contains('is-visible')) {
            this.elements.openPdfBtn.focus();
        }
    }

    clearCanvas() {
        if (!this.elements.canvas) return;
        this.canvasRenderer?.clear();
        this.elements.canvas.style.width = '';
        this.elements.canvas.style.height = '';
        if (this.elements.planPreview) {
            this.elements.planPreview.style.width = '';
            this.elements.planPreview.style.height = '';
        }
    }

    updateMode(mode) {
        this.state.mode = mode;
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
            }[mode] || 'Click on the plan to record measurements.';
            this.updateStatus(instructions);
        }
        if (mode === 'count') {
            this.elements.countLabelInput?.focus?.();
        }
        this.drawMeasurements();
    }

    updateScale(value) {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
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
                this.services.toastService(error.message, 'warning');
            }
        }
    }

    async handleCanvasClick(event) {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.services.toastService('Select a drawing before measuring.', 'warning');
            return;
        }
        if (!this.elements.canvas) return;
        const rect = this.elements.canvas.getBoundingClientRect();
        const zoom = this.state.zoom || 1;
        const point = {
            x: (event.clientX - rect.left) / zoom,
            y: (event.clientY - rect.top) / zoom
        };
        const mode = this.state.mode;

        if (mode === 'count') {
            const baseLabel = (this.state.countSettings.label || '').trim();
            const defaultLabel = baseLabel || `Count ${drawing.counters.count}`;
            const label = await this.promptForMeasurementLabel(defaultLabel);
            drawing.counters.count += 1;
            const measurement = {
                id: this.createId('measurement'),
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

        if (mode === 'length' && this.state.points.length === 2) {
            await this.finalizeLengthMeasurement('length');
        } else if (mode === 'diameter' && this.state.points.length === 2) {
            await this.finalizeLengthMeasurement('diameter');
        } else if (mode === 'area') {
            this.updateStatus('Double-click to finish the area measurement.');
            this.drawMeasurements();
        } else if (mode === 'length' || mode === 'diameter') {
            this.updateStatus('Select an end point to complete the measurement.');
            this.drawMeasurements();
        }
    }

    handleCanvasMove(event) {
        if (!this.state.points.length || !this.elements.canvas) return;
        const rect = this.elements.canvas.getBoundingClientRect();
        const zoom = this.state.zoom || 1;
        this.state.previewPoint = {
            x: (event.clientX - rect.left) / zoom,
            y: (event.clientY - rect.top) / zoom
        };
        this.drawMeasurements();
    }

    handleCanvasLeave() {
        this.state.previewPoint = null;
        this.drawMeasurements();
    }

    async handleCanvasDoubleClick() {
        if (this.state.mode !== 'area' || this.state.points.length < 3) return;
        await this.finalizeAreaMeasurement();
    }

    getCanvasPoint(event) {
        if (!this.elements.canvas) return null;
        const rect = this.elements.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const scaleX = this.elements.canvas.width / rect.width;
        const scaleY = this.elements.canvas.height / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    }

    async finalizeLengthMeasurement(type) {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const [start, end] = this.state.points;
        const pixels = Math.hypot(end.x - start.x, end.y - start.y);
        const defaultLabel = `${type === 'diameter' ? 'Diameter' : 'Length'} ${drawing.counters[type]++}`;
        const measurement = {
            id: this.createId('measurement'),
            type,
            label: await this.promptForMeasurementLabel(defaultLabel),
            points: [start, end],
            pixels
        };
        drawing.measurements.push(measurement);
        this.state.points = [];
        this.state.previewPoint = null;
        this.renderMeasurementTable();
        this.drawMeasurements();
        const value = this.getMeasurementValue(measurement, drawing).toFixed(2);
        this.updateStatus(`${measurement.label} saved: ${value} ${this.getMeasurementUnits(measurement)}.`);
    }

    async finalizeAreaMeasurement() {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const points = [...this.state.points];
        const defaultLabel = `Area ${drawing.counters.area++}`;
        const measurement = {
            id: this.createId('measurement'),
            type: 'area',
            label: await this.promptForMeasurementLabel(defaultLabel),
            points,
            pixelArea: this.calculatePolygonArea(points),
            pixelPerimeter: this.calculatePolygonPerimeter(points)
        };
        drawing.measurements.push(measurement);
        this.state.points = [];
        this.state.previewPoint = null;
        this.renderMeasurementTable();
        this.drawMeasurements();
        const value = this.getMeasurementValue(measurement, drawing).toFixed(2);
        this.updateStatus(`${measurement.label} saved: ${value} ${this.getMeasurementUnits(measurement)}.`);
    }

    renderMeasurementTable() {
        const tbody = this.elements.measurementTableBody;
        if (!tbody) return;
        tbody.innerHTML = '';
        const drawing = this.getActiveDrawing();
        if (!drawing || !drawing.measurements.length) {
            if (this.elements.measurementEmpty) {
                this.elements.measurementEmpty.style.display = 'block';
            }
            return;
        }
        if (this.elements.measurementEmpty) {
            this.elements.measurementEmpty.style.display = 'none';
        }

        drawing.measurements.forEach((measurement) => {
            const row = document.createElement('tr');
            row.dataset.id = measurement.id;

            const nameCell = document.createElement('td');
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'takeoff-name-input';
            nameInput.value = measurement.label;
            nameInput.dataset.role = 'measurement-name';
            nameCell.appendChild(nameInput);

            const modeCell = document.createElement('td');
            modeCell.textContent = this.formatModeLabel(measurement.type);

            const quantityCell = document.createElement('td');
            quantityCell.textContent = this.getMeasurementValue(measurement, drawing).toFixed(2);

            const unitCell = document.createElement('td');
            unitCell.textContent = this.getMeasurementUnits(measurement);

            const detailCell = document.createElement('td');
            detailCell.textContent = this.getMeasurementDetails(measurement, drawing);

            const actionCell = document.createElement('td');
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'takeoff-remove';
            removeBtn.dataset.role = 'measurement-remove';
            removeBtn.textContent = '×';
            actionCell.appendChild(removeBtn);

            row.append(nameCell, modeCell, quantityCell, unitCell, detailCell, actionCell);
            tbody.appendChild(row);
        });
    }

    handleMeasurementInput(event) {
        if (!(event.target instanceof HTMLInputElement)) return;
        if (event.target.dataset.role !== 'measurement-name') return;
        const row = event.target.closest('tr');
        if (!row?.dataset.id) return;
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const measurement = drawing.measurements.find((item) => item.id === row.dataset.id);
        if (measurement) {
            measurement.label = event.target.value;
        }
    }

    handleMeasurementClick(event) {
        const removeBtn = event.target.closest('[data-role="measurement-remove"]');
        if (!removeBtn) return;
        const row = removeBtn.closest('tr');
        if (!row?.dataset.id) return;
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        drawing.measurements = drawing.measurements.filter((item) => item.id !== row.dataset.id);
        this.renderMeasurementTable();
        this.drawMeasurements();
        this.updateStatus('Measurement removed.');
    }

    drawMeasurements() {
        if (!this.elements.canvas || !this.canvasRenderer) return;
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.canvasRenderer.clear();
            return;
        }

        this.canvasRenderer.render((ctx) => {
            const previous = this.canvasContext;
            this.canvasContext = ctx;
            ctx.save();
            ctx.clearRect(0, 0, this.elements.canvas.width, this.elements.canvas.height);
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
                ctx.stroke();
                ctx.setLineDash([]);
                this.state.points.forEach((point) => this.drawHandle(point));
                if (this.state.previewPoint) {
                    this.drawHandle(this.state.previewPoint, true);
                }
                ctx.restore();
            }
            ctx.restore();
            this.canvasContext = previous;
        });
    }

    drawMeasurement(measurement, drawing) {
        if (!this.canvasContext) return;
        this.canvasContext.save();
        if (measurement.type === 'length' || measurement.type === 'diameter') {
            this.canvasContext.strokeStyle = measurement.type === 'diameter' ? '#0ea5e9' : '#6366f1';
            this.canvasContext.lineWidth = 2;
            this.canvasContext.beginPath();
            this.canvasContext.moveTo(measurement.points[0].x, measurement.points[0].y);
            this.canvasContext.lineTo(measurement.points[1].x, measurement.points[1].y);
            this.canvasContext.stroke();
            measurement.points.forEach((point) => this.drawHandle(point));
            const midX = (measurement.points[0].x + measurement.points[1].x) / 2;
            const midY = (measurement.points[0].y + measurement.points[1].y) / 2;
            const label = `${this.getMeasurementValue(measurement, drawing).toFixed(2)} ${this.getMeasurementUnits(measurement)}`;
            this.drawLabel(midX, midY, label);
        } else if (measurement.type === 'area') {
            this.canvasContext.strokeStyle = '#6366f1';
            this.canvasContext.fillStyle = 'rgba(99, 102, 241, 0.2)';
            this.canvasContext.lineWidth = 2;
            this.canvasContext.beginPath();
            this.canvasContext.moveTo(measurement.points[0].x, measurement.points[0].y);
            for (let i = 1; i < measurement.points.length; i++) {
                this.canvasContext.lineTo(measurement.points[i].x, measurement.points[i].y);
            }
            this.canvasContext.closePath();
            this.canvasContext.fill();
            this.canvasContext.stroke();
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
        this.canvasContext.restore();
    }

    drawCountMarker(point, style) {
        if (!this.canvasContext) return;
        const size = 14;
        const half = size / 2;
        const color = style.color || '#ef4444';
        const shape = style.shape || 'circle';
        this.canvasContext.save();
        this.canvasContext.fillStyle = color;
        this.canvasContext.strokeStyle = '#ffffff';
        this.canvasContext.lineWidth = 2;
        this.canvasContext.beginPath();
        if (shape === 'square') {
            this.canvasContext.rect(point.x - half, point.y - half, size, size);
        } else if (shape === 'diamond') {
            this.canvasContext.moveTo(point.x, point.y - half);
            this.canvasContext.lineTo(point.x + half, point.y);
            this.canvasContext.lineTo(point.x, point.y + half);
            this.canvasContext.lineTo(point.x - half, point.y);
            this.canvasContext.closePath();
        } else if (shape === 'triangle') {
            const height = size * 0.9;
            this.canvasContext.moveTo(point.x, point.y - height / 2);
            this.canvasContext.lineTo(point.x + half, point.y + height / 2);
            this.canvasContext.lineTo(point.x - half, point.y + height / 2);
            this.canvasContext.closePath();
        } else {
            this.canvasContext.arc(point.x, point.y, size / 2.2, 0, Math.PI * 2);
        }
        this.canvasContext.fill();
        this.canvasContext.stroke();
        this.canvasContext.restore();
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
        const backgroundColor = options.backgroundColor || 'rgba(15, 23, 42, 0.85)';
        const textColor = options.textColor || '#ffffff';
        this.canvasContext.save();
        this.canvasContext.font = '12px Inter, sans-serif';
        this.canvasContext.textBaseline = 'top';
        const padding = 4;
        const metrics = this.canvasContext.measureText(text);
        const textWidth = metrics.width;
        const textHeight = (metrics.actualBoundingBoxAscent || 9) + (metrics.actualBoundingBoxDescent || 3);
        let rectX = x + 8;
        let rectY = y - textHeight - padding;
        rectX = Math.min(Math.max(rectX, 0), this.elements.canvas.width - textWidth - padding * 2);
        rectY = Math.min(Math.max(rectY, 0), this.elements.canvas.height - textHeight - padding);
        rectY = Math.max(rectY, 0);
        this.canvasContext.fillStyle = backgroundColor;
        this.canvasContext.fillRect(rectX, rectY, textWidth + padding * 2, textHeight + padding);
        this.canvasContext.fillStyle = textColor;
        this.canvasContext.fillText(text, rectX + padding, rectY + padding / 2);
        this.canvasContext.restore();
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

    calculatePolygonArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            area += points[i].x * points[j].y - points[j].x * points[i].y;
        }
        return Math.abs(area) / 2;
    }

    calculatePolygonPerimeter(points) {
        let perimeter = 0;
        for (let i = 0; i < points.length; i++) {
            const j = (i + 1) % points.length;
            perimeter += Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y);
        }
        return perimeter;
    }

    getMeasurementValue(measurement, drawing) {
        const scale = drawing.scale > 0 ? drawing.scale : 1;
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
        if (measurement.type === 'area') return 'sq ft';
        if (measurement.type === 'count') return 'ea';
        return 'ft';
    }

    getMeasurementDetails(measurement, drawing) {
        if (measurement.type === 'count') {
            const style = this.getCountStyle(measurement);
            const parts = [];
            if (style.shape) {
                const label = style.shape.charAt(0).toUpperCase() + style.shape.slice(1);
                parts.push(`Shape: ${label}`);
            }
            if (style.color) {
                parts.push(`Color: ${style.color.toUpperCase()}`);
            }
            return parts.join(' • ');
        }
        if (measurement.type !== 'area') return '';
        const scale = drawing.scale > 0 ? drawing.scale : 1;
        const perimeter = measurement.pixelPerimeter / scale;
        return `Perimeter: ${perimeter.toFixed(2)} ft`;
    }

    formatModeLabel(type) {
        const labels = {
            length: 'Length',
            area: 'Area',
            count: 'Count',
            diameter: 'Diameter'
        };
        return labels[type] || type;
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
        this.updateStatus('Measurements cleared.');
    }

    exportCsv() {
        const rows = this.buildExportRows();
        if (!rows.length) {
            this.services.toastService('No takeoff data available to export.', 'warning');
            return;
        }
        const header = ['Drawing', 'Item', 'Mode', 'Quantity', 'Units', 'Details'];
        const csvContent = [header, ...rows.map((row) => [row.drawing, row.label, row.mode, row.quantity, row.unit, row.details])]
            .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\r\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `takeoff-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        this.services.toastService('Takeoff CSV exported!', 'success');
    }

    pushToEstimate() {
        const rows = this.buildExportRows();
        if (!rows.length) {
            this.services.toastService('No takeoff data to send to the estimate.', 'warning');
            return;
        }
        this.services.estimateService?.push?.(rows);
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

    updateStatus(message) {
        if (this.elements.status) {
            this.elements.status.textContent = message;
        }
    }

    handleZoomInput(value) {
        const parsed = parseFloat(value);
        if (!Number.isFinite(parsed)) {
            return;
        }
        this.setZoom(parsed);
    }

    stepZoom(delta) {
        const next = this.state.zoom + delta;
        this.setZoom(next);
    }

    resetZoom() {
        this.setZoom(1);
    }

    setZoom(value) {
        const zoom = this.clampZoom(value);
        if (Math.abs(zoom - this.state.zoom) < 0.0001) {
            this.syncZoomControls();
            this.updateZoomButtonState();
            return;
        }
        this.state.zoom = zoom;
        this.applyZoom();
        this.updateZoomButtonState();
    }

    clampZoom(value) {
        const { min, max } = this.zoomLimits;
        return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
    }

    applyZoom() {
        if (!this.elements.canvas || !this.elements.planPreview) {
            this.syncZoomControls();
            return;
        }
        const width = this.elements.canvas.width;
        const height = this.elements.canvas.height;
        if (!width || !height) {
            this.syncZoomControls();
            return;
        }
        const zoom = this.state.zoom;
        const scaledWidth = Math.max(1, Math.round(width * zoom));
        const scaledHeight = Math.max(1, Math.round(height * zoom));
        this.elements.canvas.style.width = `${scaledWidth}px`;
        this.elements.canvas.style.height = `${scaledHeight}px`;
        this.elements.planPreview.style.width = `${scaledWidth}px`;
        this.elements.planPreview.style.height = `${scaledHeight}px`;
        this.syncZoomControls();
    }

    syncZoomControls() {
        if (this.elements.zoomIndicator) {
            this.elements.zoomIndicator.textContent = `${Math.round(this.state.zoom * 100)}%`;
        }
    }

    updateZoomButtonState() {
        const epsilon = 0.0001;
        if (this.elements.zoomInBtn) {
            const disabled = this.state.zoom >= this.zoomLimits.max - epsilon;
            this.elements.zoomInBtn.disabled = disabled;
            this.elements.zoomInBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        }
        if (this.elements.zoomOutBtn) {
            const disabled = this.state.zoom <= this.zoomLimits.min + epsilon;
            this.elements.zoomOutBtn.disabled = disabled;
            this.elements.zoomOutBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        }
    }

    handleDocumentKeydown(event) {
        if (event.key !== 'Escape') return;
        if (this.isPdfViewerOpen()) {
            this.closePdfViewer();
            return;
        }
        const activeElement =
            typeof document !== 'undefined' ? document.activeElement : null;
        const isTargetActive =
            !!(this.elements.planStage &&
            (activeElement === this.elements.planStage || this.elements.planStage.contains(activeElement)));
        if (this.state.isFullscreen) {
            this.setFullscreen(false);
        } else if (isTargetActive && !this.state.isFullscreen) {
            this.setFullscreen(true);
        }
    }

    promptForMeasurementLabel(defaultLabel) {
        if (!this.elements.labelModal || !this.elements.labelInput) {
            return Promise.resolve(defaultLabel);
        }

        if (this.pendingLabelRequest) {
            this.pendingLabelRequest.resolve(defaultLabel);
        }

        this.openLabelModal(defaultLabel);

        return new Promise((resolve) => {
            this.pendingLabelRequest = {
                resolve,
                defaultLabel
            };
        });
    }

    openLabelModal(defaultLabel) {
        const { labelModal, labelInput } = this.elements;
        if (!labelModal || !labelInput) return;

        labelModal.classList.add('open');
        labelModal.setAttribute('aria-hidden', 'false');
        labelInput.value = defaultLabel;
        labelInput.setSelectionRange(0, defaultLabel.length);

        if (typeof document !== 'undefined') {
            this.labelReturnFocus = document.activeElement;
        }

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => {
                labelInput.focus();
                labelInput.select();
            });
        } else {
            labelInput.focus();
            labelInput.select();
        }
    }

    resolveLabelModal(submitted) {
        if (!this.elements.labelModal) return;

        const pending = this.pendingLabelRequest;
        this.pendingLabelRequest = null;

        const { labelInput } = this.elements;
        const defaultLabel = pending?.defaultLabel || (labelInput?.value ?? '');
        let result = defaultLabel;

        if (submitted && labelInput) {
            const value = labelInput.value.trim();
            result = value || defaultLabel;
        }

        this.closeLabelModal();

        if (pending?.resolve) {
            pending.resolve(result);
        }
    }

    closeLabelModal() {
        const { labelModal, labelInput } = this.elements;
        if (labelModal) {
            labelModal.classList.remove('open');
            labelModal.setAttribute('aria-hidden', 'true');
        }
        if (labelInput) {
            labelInput.value = '';
        }

        if (this.labelReturnFocus && typeof this.labelReturnFocus.focus === 'function') {
            this.labelReturnFocus.focus();
        }
        this.labelReturnFocus = null;
    }

    updateQuickShapeInputs() {
        const shape = this.elements.quickShapeSelect?.value || 'rectangle';
        if (!this.elements.quickDim1 || !this.elements.quickDim2 || !this.elements.quickDim2Group) return;
        if (shape === 'circle') {
            this.elements.quickDim1.placeholder = 'Radius';
            this.elements.quickDim2Group.style.display = 'none';
        } else if (shape === 'triangle') {
            this.elements.quickDim1.placeholder = 'Base';
            this.elements.quickDim2.placeholder = 'Height';
            this.elements.quickDim2Group.style.display = 'block';
        } else {
            this.elements.quickDim1.placeholder = 'Length';
            this.elements.quickDim2.placeholder = 'Width';
            this.elements.quickDim2Group.style.display = 'block';
        }
    }

    calculateQuickArea() {
        const shape = this.elements.quickShapeSelect?.value || 'rectangle';
        const dim1 = parseFloat(this.elements.quickDim1?.value || '0');
        const dim2 = parseFloat(this.elements.quickDim2?.value || '0');
        let area = 0;
        if (shape === 'rectangle') {
            area = dim1 * dim2;
        } else if (shape === 'circle') {
            area = Math.PI * dim1 * dim1;
        } else if (shape === 'triangle') {
            area = 0.5 * dim1 * dim2;
        }
        if (this.elements.quickResult) {
            this.elements.quickResult.textContent = `Area: ${Number.isFinite(area) ? area.toFixed(2) : '0.00'} sq ft`;
        }
    }

    toggleSortDirection() {
        this.state.sortDir = this.state.sortDir === 'asc' ? 'desc' : 'asc';
        this.updateSortDirectionIcon();
    }

    updateSortDirectionIcon() {
        if (!this.elements.sortDirection) return;
        this.elements.sortDirection.textContent = this.state.sortDir === 'asc' ? '▲' : '▼';
    }

    updatePdfControls() {
        const {
            pdfControls,
            pdfPrevBtn,
            pdfNextBtn,
            pdfPageInput,
            pdfPageTotal,
            pdfOpenBtn,
            pdfDownloadBtn,
            openPdfBtn
        } = this.elements;

        const pdfSupported = Boolean(pdfjsLib && typeof pdfjsLib.getDocument === 'function');

        if (pdfControls) {
            pdfControls.classList.toggle('is-hidden', !pdfSupported);
            pdfControls.setAttribute('aria-hidden', pdfSupported ? 'false' : 'true');
        }

        const toggleControl = (control, disableAttr = true) => {
            if (!control) return;
            const disableControl = !pdfSupported;
            if ('disabled' in control) {
                control.disabled = disableControl;
            }
            if (disableAttr) {
                control.setAttribute('aria-disabled', disableControl ? 'true' : 'false');
            }
        };

        toggleControl(pdfPrevBtn);
        toggleControl(pdfNextBtn);
        toggleControl(pdfOpenBtn);
        toggleControl(pdfDownloadBtn);

        if (pdfPageInput) {
            pdfPageInput.disabled = !pdfSupported;
            pdfPageInput.setAttribute('aria-disabled', pdfSupported ? 'false' : 'true');
        }

        if (pdfPageTotal) {
            pdfPageTotal.setAttribute('aria-hidden', pdfSupported ? 'false' : 'true');
        }

        if (!pdfSupported && openPdfBtn) {
            openPdfBtn.classList.remove('is-visible');
            openPdfBtn.disabled = true;
            openPdfBtn.setAttribute('aria-hidden', 'true');
            openPdfBtn.setAttribute('aria-disabled', 'true');
            openPdfBtn.setAttribute('tabindex', '-1');
        }

        if (pdfSupported) {
            const activeDrawing = this.getActiveDrawing();
            if (activeDrawing) {
                this.updatePdfToolbar(activeDrawing);
            }
        }
    }

    updatePdfToolbar(drawing) {
        const controls = this.elements.pdfControls;
        if (!controls) return;
        if (!drawing || drawing.type !== 'pdf') {
            controls.classList.add('is-hidden');
            return;
        }

        controls.classList.remove('is-hidden');
        const pageNumber = this.getPdfPageNumber(drawing);
        const totalPages = this.getPdfTotalPages(drawing);
        if (this.elements.pdfPageInput) {
            this.elements.pdfPageInput.value = String(pageNumber);
            this.elements.pdfPageInput.min = '1';
            this.elements.pdfPageInput.max = String(totalPages);
        }
        if (this.elements.pdfPageTotal) {
            this.elements.pdfPageTotal.textContent = `of ${totalPages}`;
        }

        const prev = this.findPdfNeighbor(drawing, -1);
        const next = this.findPdfNeighbor(drawing, 1);

        if (this.elements.pdfPrevBtn) {
            const disabled = !prev;
            this.elements.pdfPrevBtn.disabled = disabled;
            this.elements.pdfPrevBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        }
        if (this.elements.pdfNextBtn) {
            const disabled = !next;
            this.elements.pdfNextBtn.disabled = disabled;
            this.elements.pdfNextBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        }
    }

    getPdfPageNumber(drawing) {
        if (!drawing) return 1;
        if (typeof drawing.pdfPageNumber === 'number') return drawing.pdfPageNumber;
        const parsed = parseInt(drawing.page, 10);
        return Number.isFinite(parsed) ? parsed : 1;
    }

    getPdfTotalPages(drawing) {
        if (!drawing) return 1;
        if (typeof drawing.pdfTotalPages === 'number' && drawing.pdfTotalPages > 0) {
            return drawing.pdfTotalPages;
        }
        const meta = this.getPdfDocumentMeta(drawing.pdfDocId);
        return meta?.pageCount || 1;
    }

    getPdfDocumentMeta(docId) {
        if (!docId) return null;
        return this.pdfDocuments.get(docId) || null;
    }

    getPdfPagesForDoc(docId) {
        return this.state.drawings
            .filter((drawing) => drawing.pdfDocId === docId)
            .sort((a, b) => this.getPdfPageNumber(a) - this.getPdfPageNumber(b));
    }

    findPdfNeighbor(drawing, delta) {
        if (!drawing || !drawing.pdfDocId || !delta) return null;
        const pages = this.getPdfPagesForDoc(drawing.pdfDocId);
        const index = pages.findIndex((page) => page.id === drawing.id);
        if (index === -1) return null;
        return pages[index + delta] || null;
    }

    navigatePdfPage(delta) {
        const current = this.getActiveDrawing();
        if (!current || current.type !== 'pdf') return;
        const neighbor = this.findPdfNeighbor(current, delta);
        if (neighbor) {
            this.setCurrentDrawing(neighbor.id);
        }
    }

    destroy() {
        if (this.isPdfViewerOpen()) {
            this.closePdfViewer({ returnFocus: false });
        }
        this.lifecycle.cleanup();
        this.canvasRenderer?.clear();
        this.pdfSources.clear();
        this.pdfDocuments.forEach((doc) => doc?.destroy?.());
        this.pdfDocuments.clear();
    }

    jumpToPdfPage(pageNumber) {
        const current = this.getActiveDrawing();
        if (!current || current.type !== 'pdf' || !current.pdfDocId) {
            return;
        }
        const totalPages = this.getPdfTotalPages(current);
        let targetPage = Number.isFinite(pageNumber) ? pageNumber : Number.parseInt(pageNumber, 10);
        if (!Number.isFinite(targetPage) || targetPage < 1) {
            targetPage = 1;
        }
        if (targetPage > totalPages) {
            targetPage = totalPages;
        }
        const pages = this.getPdfPagesForDoc(current.pdfDocId);
        const target = pages.find((page) => this.getPdfPageNumber(page) === targetPage);
        if (target) {
            this.setCurrentDrawing(target.id);
        } else {
            this.services.toastService('Page not found in this PDF.', 'warning');
            this.updatePdfToolbar(current);
        }
    }

    openActivePdfInViewer() {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') return;
        const meta = this.getPdfDocumentMeta(drawing.pdfDocId);
        if (!meta || !meta.url) {
            this.services.toastService('PDF source not available.', 'error');
            return;
        }
        if (typeof window === 'undefined' || typeof window.open !== 'function') {
            this.services.toastService('Opening PDFs is not supported in this environment.', 'warning');
            return;
        }
        window.open(meta.url, '_blank', 'noopener');
    }

    downloadActivePdf() {
        const drawing = this.getActiveDrawing();
        if (!drawing || drawing.type !== 'pdf') return;
        const meta = this.getPdfDocumentMeta(drawing.pdfDocId);
        if (!meta || !meta.url) {
            this.services.toastService('PDF source not available.', 'error');
            return;
        }
        if (typeof document === 'undefined') {
            this.services.toastService('Downloading is not supported in this environment.', 'warning');
            return;
        }
        const link = document.createElement('a');
        link.href = meta.url;
        link.download = drawing.pdfFileName || meta.name || 'drawing.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        this.services.toastService('PDF downloaded.', 'success');
    }

    releaseDrawingResources(drawing) {
        if (!drawing || drawing.type !== 'pdf' || !drawing.pdfDocId) {
            return;
        }
        const meta = this.pdfDocuments.get(drawing.pdfDocId);
        if (!meta) return;
        meta.refCount = Math.max(0, (meta.refCount || 0) - 1);
        if (meta.refCount === 0) {
            this.teardownPdfDocument(drawing.pdfDocId);
        }
    }

    teardownPdfDocument(docId) {
        const meta = this.pdfDocuments.get(docId);
        if (!meta) return;
        if (meta.url) {
            URL.revokeObjectURL(meta.url);
        }
        this.pdfDocuments.delete(docId);
    }

    createId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
}

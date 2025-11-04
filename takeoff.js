const pdfjsLib =
    typeof window !== 'undefined'
        ? window.pdfjsLib || window['pdfjs-dist/build/pdf'] || null
        : null;

export class TakeoffManager {
    constructor(options = {}) {
        this.options = {
            onPushToEstimate: () => {},
            showToast: () => {},
            ...options
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
        this.pdfWorkerConfigured = false;
        this.zoomLimits = { min: 0.5, max: 3 };
        this.pdfSources = new Map();
        this.pdfViewerState = {
            activePdfId: null,
            objectUrl: null,
            initialPage: 1
        };
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
            pdfFrame: byId('takeoffPdfFrame')
        };

        if (this.elements.canvas) {
            this.canvasContext = this.elements.canvas.getContext('2d');
        }
    }

    bindEvents() {
        this.elements.drawingInput?.addEventListener('change', (event) => this.handleDrawingUpload(event));
        this.elements.sortSelect?.addEventListener('change', (event) => {
            this.state.sortBy = event.target.value;
            this.renderDrawingList();
        });
        this.elements.sortDirection?.addEventListener('click', () => {
            this.toggleSortDirection();
            this.renderDrawingList();
        });
        this.elements.searchInput?.addEventListener('input', (event) => {
            this.state.filter = event.target.value.trim().toLowerCase();
            this.renderDrawingList();
        });
        this.elements.drawingTableBody?.addEventListener('click', (event) => this.handleDrawingTableClick(event));
        this.elements.drawingTableBody?.addEventListener('input', (event) => this.handleDrawingTableInput(event));

        this.elements.modeSelect?.addEventListener('change', (event) => this.updateMode(event.target.value));
        this.elements.scaleInput?.addEventListener('input', (event) => this.updateScale(event.target.value));

        this.elements.zoomInBtn?.addEventListener('click', () => this.stepZoom(0.1));
        this.elements.zoomOutBtn?.addEventListener('click', () => this.stepZoom(-0.1));
        this.elements.zoomResetBtn?.addEventListener('click', () => this.resetZoom());

        const handleColorChange = (event) => this.updateCountColor(event.target.value);
        this.elements.countColorInput?.addEventListener('input', handleColorChange);
        this.elements.countColorInput?.addEventListener('change', handleColorChange);
        this.elements.countShapeSelect?.addEventListener('change', (event) => this.updateCountShape(event.target.value));
        this.elements.countLabelInput?.addEventListener('input', (event) => this.updateCountLabel(event.target.value));

        this.elements.fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
        this.elements.fullScreenToggle?.addEventListener('click', () => this.toggleFullscreen());

        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', (event) => this.handleDocumentKeydown(event));
            document.addEventListener('fullscreenchange', this.handleDocumentFullscreenChange);
            document.addEventListener('webkitfullscreenchange', this.handleDocumentFullscreenChange);
        }
        this.elements.clearBtn?.addEventListener('click', () => this.clearMeasurements());
        this.elements.exportBtn?.addEventListener('click', () => this.exportCsv());
        this.elements.pushBtn?.addEventListener('click', () => this.pushToEstimate());

        this.elements.canvas?.addEventListener('click', (event) => this.handleCanvasClick(event));
        this.elements.canvas?.addEventListener('mousemove', (event) => this.handleCanvasMove(event));
        this.elements.canvas?.addEventListener('mouseleave', () => this.handleCanvasLeave());
        this.elements.canvas?.addEventListener('dblclick', () => this.handleCanvasDoubleClick());

        this.elements.measurementTableBody?.addEventListener('input', (event) => this.handleMeasurementInput(event));
        this.elements.measurementTableBody?.addEventListener('click', (event) => this.handleMeasurementClick(event));

        this.elements.quickShapeSelect?.addEventListener('change', () => this.updateQuickShapeInputs());
        this.elements.quickBtn?.addEventListener('click', () => this.calculateQuickArea());

        this.elements.openPdfBtn?.addEventListener('click', () => this.openActivePdf());
        this.elements.pdfModalClose?.addEventListener('click', () => this.closePdfViewer());
        this.elements.pdfModalOverlay?.addEventListener('click', () => this.closePdfViewer());
        this.elements.pdfModal?.addEventListener('click', (event) => {
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

    toggleFullscreen() {
        if (!this.getActiveDrawing()) {
            this.options.showToast('Select a drawing before using full screen.', 'warning');
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
            const isPdf = (file.type && file.type.toLowerCase() === 'application/pdf') || file.name.toLowerCase().endsWith('.pdf');
            if (isPdf) {
                if (!pdfjsLib) {
                    this.options.showToast('PDF support is unavailable.', 'error');
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
            this.options.showToast('Unable to load drawing file.', 'error');
        }
    }

    async processPdfFile(file) {
        try {
            this.ensurePdfWorker();
            const arrayBuffer = await file.arrayBuffer();
            const pdfData = new Uint8Array(arrayBuffer);
            const pdfId = this.createId('pdf');
            const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
            this.pdfSources.set(pdfId, {
                data: pdfData,
                name: file.name,
                totalPages: pdf.numPages
            });
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                const imageUrl = await this.renderPdfPage(pdf, pageNumber);
                this.addDrawing({
                    name: `${file.name.replace(/\.pdf$/i, '')} - Page ${pageNumber}`,
                    page: String(pageNumber),
                    imageUrl,
                    type: 'pdf',
                    pdfId,
                    pdfPage: pageNumber,
                    pdfTotalPages: pdf.numPages
                });
            }
        } catch (error) {
            console.error('Error rendering PDF:', error);
            this.options.showToast('Unable to render PDF drawing.', 'error');
        }
    }

    ensurePdfWorker() {
        if (this.pdfWorkerConfigured || !pdfjsLib || !pdfjsLib.GlobalWorkerOptions) return;
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
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
            this.options.showToast('Select a drawing before opening the PDF reader.', 'warning');
            return;
        }
        this.openPdfViewer(drawing);
    }

    openPdfViewer(drawing) {
        const source = this.getPdfSource(drawing);
        if (!source) {
            this.options.showToast('Original PDF data is unavailable for this drawing.', 'error');
            return;
        }
        if (!this.elements.pdfModal || !this.elements.pdfFrame) {
            this.options.showToast('PDF reader is not available.', 'error');
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
            this.options.showToast('Unable to open the PDF reader.', 'error');
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
        if (!this.elements.canvas || !this.canvasContext) return;
        this.canvasContext.clearRect(0, 0, this.elements.canvas.width, this.elements.canvas.height);
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
        let parsed = parseFloat(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            parsed = 1;
        }
        drawing.scale = parsed;
        if (this.elements.scaleInput && this.elements.scaleInput.value !== String(parsed)) {
            this.elements.scaleInput.value = String(parsed);
        }
        this.renderMeasurementTable();
        this.drawMeasurements();
    }

    handleCanvasClick(event) {
        const drawing = this.getActiveDrawing();
        if (!drawing) {
            this.options.showToast('Select a drawing before measuring.', 'warning');
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
            const label = this.promptForMeasurementLabel(defaultLabel);
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
            this.finalizeLengthMeasurement('length');
        } else if (mode === 'diameter' && this.state.points.length === 2) {
            this.finalizeLengthMeasurement('diameter');
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

    handleCanvasDoubleClick() {
        if (this.state.mode !== 'area' || this.state.points.length < 3) return;
        this.finalizeAreaMeasurement();
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

    finalizeLengthMeasurement(type) {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const [start, end] = this.state.points;
        const pixels = Math.hypot(end.x - start.x, end.y - start.y);
        const defaultLabel = `${type === 'diameter' ? 'Diameter' : 'Length'} ${drawing.counters[type]++}`;
        const measurement = {
            id: this.createId('measurement'),
            type,
            label: this.promptForMeasurementLabel(defaultLabel),
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

    finalizeAreaMeasurement() {
        const drawing = this.getActiveDrawing();
        if (!drawing) return;
        const points = [...this.state.points];
        const defaultLabel = `Area ${drawing.counters.area++}`;
        const measurement = {
            id: this.createId('measurement'),
            type: 'area',
            label: this.promptForMeasurementLabel(defaultLabel),
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
        if (!this.canvasContext || !this.elements.canvas) return;
        this.canvasContext.clearRect(0, 0, this.elements.canvas.width, this.elements.canvas.height);
        const drawing = this.getActiveDrawing();
        if (!drawing) return;

        drawing.measurements.forEach((measurement) => this.drawMeasurement(measurement, drawing));

        if (this.state.points.length) {
            this.canvasContext.save();
            this.canvasContext.strokeStyle = '#f97316';
            this.canvasContext.lineWidth = 2;
            this.canvasContext.setLineDash([6, 4]);
            this.canvasContext.beginPath();
            this.canvasContext.moveTo(this.state.points[0].x, this.state.points[0].y);
            for (let i = 1; i < this.state.points.length; i++) {
                this.canvasContext.lineTo(this.state.points[i].x, this.state.points[i].y);
            }
            if (this.state.previewPoint) {
                this.canvasContext.lineTo(this.state.previewPoint.x, this.state.previewPoint.y);
            }
            this.canvasContext.stroke();
            this.canvasContext.setLineDash([]);
            this.state.points.forEach((point) => this.drawHandle(point));
            if (this.state.previewPoint) {
                this.drawHandle(this.state.previewPoint, true);
            }
            this.canvasContext.restore();
        }
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
            this.options.showToast('No takeoff data available to export.', 'warning');
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
        this.options.showToast('Takeoff CSV exported!', 'success');
    }

    pushToEstimate() {
        const rows = this.buildExportRows();
        if (!rows.length) {
            this.options.showToast('No takeoff data to send to the estimate.', 'warning');
            return;
        }
        this.options.onPushToEstimate(rows);
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
        if (this.state.isFullscreen) {
            this.setFullscreen(false);
        } else if (isTargetActive && !this.state.isFullscreen) {
            this.setFullscreen(true);
        }
    }

    promptForMeasurementLabel(defaultLabel) {
        if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
            return defaultLabel;
        }
        const response = window.prompt('Name this measurement', defaultLabel);
        if (typeof response === 'string') {
            const trimmed = response.trim();
            if (trimmed) return trimmed;
        }
        return defaultLabel;
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

    createId(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
}

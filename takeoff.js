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
            isFullscreen: false
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
            fullScreenToggle: byId('takeoffFullScreenToggle')
        };
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
            fullScreenToggle
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
        this.state.previewPoint = point || null;
        this.drawMeasurements();
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


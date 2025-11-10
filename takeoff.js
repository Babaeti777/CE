const STORAGE_KEY = 'ce:takeoff:drawings';

function createId(prefix = 'drawing') {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function formatNumber(value) {
    if (!Number.isFinite(value)) return '0';
    return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 1 : 2 });
}

function normalizeString(value) {
    return (value || '').toLowerCase();
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
        this.restoreState();
        this.renderDrawings();
        this.updateActiveMeta();
        this.renderMeasurements();
        this.updateSummary();
    }

    cacheDom() {
        this.elements = {
            drawingForm: document.getElementById('takeoffDrawingForm'),
            addDrawingBtn: document.getElementById('takeoffAddDrawingBtn'),
            drawingName: document.getElementById('takeoffDrawingName'),
            drawingTrade: document.getElementById('takeoffDrawingTrade'),
            drawingFloor: document.getElementById('takeoffDrawingFloor'),
            drawingNotes: document.getElementById('takeoffDrawingNotes'),
            searchInput: document.getElementById('takeoffSearchInput'),
            sortSelect: document.getElementById('takeoffSortSelect'),
            drawingTableBody: document.getElementById('takeoffDrawingTableBody'),
            drawingEmptyState: document.getElementById('takeoffDrawingEmpty'),
            measurementForm: document.getElementById('takeoffMeasurementForm'),
            measurementLabel: document.getElementById('measurementLabelInput'),
            measurementMode: document.getElementById('measurementModeSelect'),
            measurementValue: document.getElementById('measurementValueInput'),
            measurementUnit: document.getElementById('measurementUnitInput'),
            measurementList: document.getElementById('takeoffMeasurementList'),
            summaryContainer: document.getElementById('takeoffSummary'),
            activeMeta: document.getElementById('takeoffActiveMeta')
        };
    }

    bindEvents() {
        this.elements.drawingForm?.addEventListener('submit', (event) => this.handleDrawingFormSubmit(event));
        this.elements.measurementForm?.addEventListener('submit', (event) => this.handleMeasurementFormSubmit(event));
        this.elements.searchInput?.addEventListener('input', (event) => {
            this.state.filter = event.target.value || '';
            this.renderDrawings();
        });
        this.elements.sortSelect?.addEventListener('change', (event) => {
            this.state.sortBy = event.target.value || 'name';
            this.renderDrawings();
        });
        this.elements.addDrawingBtn?.addEventListener('click', () => {
            this.elements.drawingName?.focus();
        });

        this.elements.drawingTableBody?.addEventListener('click', (event) => {
            const removeButton = event.target.closest('[data-action="remove-drawing"]');
            const row = event.target.closest('tr[data-id]');
            if (!row) return;
            const drawingId = row.getAttribute('data-id');
            if (!drawingId) return;

            if (removeButton) {
                event.stopPropagation();
                this.removeDrawing(drawingId);
                return;
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

    destroy() {
        this.elements = {};
    }

}

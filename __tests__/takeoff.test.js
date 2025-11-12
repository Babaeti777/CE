/** @jest-environment jsdom */

import { jest, describe, expect, test, beforeEach } from '@jest/globals';
import { TakeoffManager } from '../takeoff.js';

function createStorageMock() {
    const store = new Map();
    return {
        getItem: jest.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: jest.fn((key, value) => {
            store.set(key, value);
        }),
        removeItem: jest.fn((key) => {
            store.delete(key);
        })
    };
}

describe('TakeoffManager workspace basics', () => {
    let manager;
    let toast;
    let storage;

    beforeEach(() => {
        document.body.innerHTML = `
            <div class="card takeoff-plan-card">
                <div id="takeoffPlanContainer">
                    <div id="takeoffPlanInner"></div>
                    <img id="takeoffPlanPreview" />
                    <canvas id="takeoffCanvas" width="400" height="300"></canvas>
                </div>
            </div>
            <input type="file" id="takeoffDrawingInput" />
            <select id="takeoffSortSelect"></select>
            <button id="takeoffSortDirection" type="button"></button>
            <input id="takeoffSearchInput" />
            <select id="takeoffModeSelect"></select>
            <input id="takeoffScaleInput" />
            <div id="takeoffToolbarMount"></div>
            <div id="takeoffPlanStage"></div>
            <table><tbody id="takeoffDrawingTableBody"></tbody></table>
            <p id="takeoffDrawingEmpty"></p>
            <div id="takeoffActiveMeta"></div>
            <div id="takeoffStatus"></div>
            <button id="takeoffZoomOutBtn" type="button"></button>
            <button id="takeoffZoomInBtn" type="button"></button>
            <button id="takeoffZoomResetBtn" type="button"></button>
            <span id="takeoffZoomIndicator"></span>
            <button id="takeoffFullscreenBtn" type="button"></button>
            <button id="takeoffFullScreenToggle" type="button"></button>
            <button id="takeoffRotateLeftBtn" type="button"></button>
            <button id="takeoffRotateRightBtn" type="button"></button>
            <button id="takeoffOpenDocumentBtn" type="button"></button>
            <div id="takeoffCountToolbar" class="is-hidden"></div>
            <input id="takeoffCountColor" />
            <select id="takeoffCountShape"></select>
            <input id="takeoffCountLabel" />
            <button id="takeoffQuickCalcBtn" type="button"></button>
            <select id="takeoffShapeSelect"></select>
            <input id="takeoffDim1" />
            <input id="takeoffDim2" />
            <div id="takeoffDim2Group"></div>
            <div id="takeoffQuickResult"></div>
            <button id="takeoffClearBtn" type="button"></button>
            <button id="takeoffExportCsvBtn" type="button"></button>
            <button id="takeoffPushBtn" type="button"></button>
            <form id="takeoffMeasurementForm">
                <input id="measurementLabelInput" />
                <select id="measurementModeSelect">
                    <option value="length">Length</option>
                    <option value="area">Area</option>
                    <option value="count">Count</option>
                </select>
                <input id="measurementValueInput" type="number" />
                <input id="measurementUnitInput" />
            </form>
            <table><tbody id="takeoffMeasurementTableBody"></tbody></table>
            <p id="takeoffMeasurementEmpty"></p>
            <div id="takeoffMeasurementList"></div>
            <div id="takeoffSummary"></div>
            <textarea id="takeoffNoteInput"></textarea>
            <button id="takeoffAddNoteBtn" type="button"></button>
            <ul id="takeoffNoteList"></ul>
            <button id="takeoffOpenSourceBtn" type="button"></button>
            <button id="takeoffNoteModeBtn" type="button"></button>
            <div id="takeoffAnnotationLayer"></div>
        `;

        // Provide a simple canvas context mock for draw operations.
        HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
            clearRect: jest.fn(),
            beginPath: jest.fn(),
            moveTo: jest.fn(),
            lineTo: jest.fn(),
            closePath: jest.fn(),
            stroke: jest.fn(),
            fill: jest.fn(),
            save: jest.fn(),
            restore: jest.fn(),
            setLineDash: jest.fn(),
            arc: jest.fn(),
            fillText: jest.fn(),
            strokeRect: jest.fn(),
            rect: jest.fn()
        }));
        HTMLCanvasElement.prototype.toDataURL = jest.fn(() => 'data:image/png;base64,preview');

        storage = createStorageMock();
        toast = jest.fn();
        manager = new TakeoffManager({ toastService: toast, storageService: storage });
        manager.cacheDom();
        Object.assign(manager.elements, {
            measurementForm: document.getElementById('takeoffMeasurementForm'),
            measurementLabel: document.getElementById('measurementLabelInput'),
            measurementMode: document.getElementById('measurementModeSelect'),
            measurementValue: document.getElementById('measurementValueInput'),
            measurementUnit: document.getElementById('measurementUnitInput'),
            measurementList: document.getElementById('takeoffMeasurementList'),
            summaryContainer: document.getElementById('takeoffSummary'),
            drawingEmptyState: document.getElementById('takeoffDrawingEmpty'),
            noteInput: document.getElementById('takeoffNoteInput'),
            addNoteBtn: document.getElementById('takeoffAddNoteBtn'),
            noteList: document.getElementById('takeoffNoteList'),
            openSourceBtn: document.getElementById('takeoffOpenSourceBtn'),
            noteModeBtn: document.getElementById('takeoffNoteModeBtn'),
            annotationLayer: document.getElementById('takeoffAnnotationLayer')
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const submitEvent = () => new Event('submit', { bubbles: true, cancelable: true });

    function seedDrawing() {
        const drawing = {
            id: 'drawing-test',
            name: 'Floor Plan',
            trade: '',
            floor: '',
            page: '',
            createdAt: Date.now(),
            type: 'image',
            sourceUrl: 'data:image/png;base64,source',
            objectUrl: 'data:image/png;base64,source',
            previewUrl: 'data:image/png;base64,source',
            rotation: 0,
            annotations: [],
            notes: []
        };
        manager.state.drawings = [drawing];
        manager.state.currentDrawingId = drawing.id;
        manager.measurements.clear();
        manager.setMeasurementItems(drawing.id, []);
        return drawing;
    }

    test('handleDrawingUpload adds drawing and updates state', async () => {
        const mockDrawing = {
            id: 'drawing-1',
            name: 'Plan.pdf',
            type: 'pdf',
            sourceUrl: 'data:application/pdf;base64,doc',
            objectUrl: 'data:application/pdf;base64,doc',
            previewUrl: 'data:image/png;base64,preview',
            annotations: [],
            notes: ''
        };
        jest.spyOn(manager, 'createDrawingFromFile').mockResolvedValue(mockDrawing);
        jest.spyOn(manager, 'renderDrawingList').mockImplementation(() => {});
        jest.spyOn(manager, 'updateActiveDrawingDisplay').mockResolvedValue();
        jest.spyOn(manager, 'updatePlanVisibility').mockImplementation(() => {});
        jest.spyOn(manager, 'refreshMeasurementTable').mockImplementation(() => {});
        jest.spyOn(manager, 'drawMeasurements').mockImplementation(() => {});
        jest.spyOn(manager, 'persistState');

        await manager.handleDrawingUpload({ target: { files: [{ name: 'Plan.pdf', type: 'application/pdf' }] } });

        expect(manager.state.drawings).toContain(mockDrawing);
        expect(manager.state.currentDrawingId).toBe(mockDrawing.id);
        expect(manager.renderDrawingList).toHaveBeenCalled();
        expect(manager.updatePlanVisibility).toHaveBeenCalled();
        expect(manager.persistState).toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/Unable to load/), 'error');
    });

    test('handleMeasurementFormSubmit adds measurement to active drawing', () => {
        const drawing = seedDrawing();

        manager.elements.measurementLabel.value = 'Roof Area';
        manager.elements.measurementMode.value = 'area';
        manager.elements.measurementValue.value = '120.5';
        manager.elements.measurementUnit.value = 'sq ft';

        manager.handleMeasurementFormSubmit(submitEvent());

        expect(drawing.measurements).toHaveLength(1);
        expect(manager.elements.measurementList.textContent).toContain('Roof Area');
        expect(manager.elements.summaryContainer.textContent).toContain('sq ft');
        expect(toast).toHaveBeenCalledWith('Measurement saved.', 'success');
    });

    test('handleAddNote stores note and renders list for active drawing', () => {
        const drawing = seedDrawing();

        manager.elements.noteInput.value = 'Confirm siding finish.';
        manager.handleAddNote();

        expect(Array.isArray(drawing.notes)).toBe(true);
        expect(drawing.notes).toHaveLength(1);
        expect(manager.elements.noteList.textContent).toContain('Confirm siding finish.');
        expect(toast).toHaveBeenCalledWith('Note added to drawing.', 'success');
    });

    test('createPdfDrawing stores a persistent data URL for PDF uploads', async () => {
        const originalPdfjs = window.pdfjsLib;
        const render = jest.fn(() => ({ promise: Promise.resolve() }));
        const getPage = jest.fn(() => Promise.resolve({
            getViewport: ({ scale }) => ({ width: 800 * scale, height: 600 * scale }),
            render
        }));
        window.pdfjsLib = {
            getDocument: jest.fn(() => ({
                promise: Promise.resolve({
                    numPages: 2,
                    getPage,
                    cleanup: jest.fn(),
                    destroy: jest.fn()
                })
            }))
        };

        jest.spyOn(manager, 'ensurePdfWorker').mockResolvedValue();
        jest.spyOn(manager, 'readFileAsDataURL').mockResolvedValue('data:application/pdf;base64,Zm9v');

        const file = {
            name: 'Specs.pdf',
            type: 'application/pdf',
            arrayBuffer: jest.fn(() => Promise.resolve(new ArrayBuffer(8)))
        };

        const drawing = await manager.createPdfDrawing(file, 'pdf-1');

        expect(window.pdfjsLib.getDocument).toHaveBeenCalledWith({ data: expect.any(Uint8Array) });
        expect(drawing.type).toBe('pdf');
        expect(drawing.sourceUrl).toBe('data:application/pdf;base64,Zm9v');
        expect(drawing.objectUrl).toBe('data:application/pdf;base64,Zm9v');
        expect(drawing.file).toBeNull();
        expect(drawing.previewUrl).toBe('data:image/png;base64,preview');

        window.pdfjsLib = originalPdfjs;
    });
});

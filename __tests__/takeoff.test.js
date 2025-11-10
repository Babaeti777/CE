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
            <form id="takeoffDrawingForm">
                <input id="takeoffDrawingName" />
                <input id="takeoffDrawingTrade" />
                <input id="takeoffDrawingFloor" />
                <input id="takeoffDrawingNotes" />
            </form>
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

        storage = createStorageMock();
        toast = jest.fn();
        manager = new TakeoffManager({ toastService: toast, storageService: storage });
        manager.cacheDom();
        Object.assign(manager.elements, {
            drawingForm: document.getElementById('takeoffDrawingForm'),
            drawingName: document.getElementById('takeoffDrawingName'),
            drawingTrade: document.getElementById('takeoffDrawingTrade'),
            drawingFloor: document.getElementById('takeoffDrawingFloor'),
            drawingNotes: document.getElementById('takeoffDrawingNotes'),
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
            noteList: document.getElementById('takeoffNoteList')
        });
    });

    const submitEvent = () => new Event('submit', { bubbles: true, cancelable: true });

    test('handleDrawingFormSubmit creates a drawing and updates UI', () => {
        manager.elements.drawingName.value = 'Floor Plan';
        manager.elements.drawingTrade.value = 'Architectural';
        manager.elements.drawingFloor.value = 'Level 1';
        manager.elements.drawingNotes.value = 'Main scope';

        manager.handleDrawingFormSubmit(submitEvent());

        expect(manager.state.drawings).toHaveLength(1);
        const drawing = manager.state.drawings[0];
        expect(drawing.name).toBe('Floor Plan');
        expect(manager.state.currentDrawingId).toBe(drawing.id);
        expect(manager.elements.drawingTableBody.children).toHaveLength(1);
        expect(manager.elements.activeMeta.textContent).toContain('Floor Plan');
        expect(manager.elements.measurementList.textContent).toContain('Add measurements');
        expect(storage.setItem).toHaveBeenCalledWith(expect.any(String), expect.any(String));
    });

    test('handleMeasurementFormSubmit adds measurement to active drawing', () => {
        manager.elements.drawingName.value = 'Roof';
        manager.handleDrawingFormSubmit(submitEvent());

        manager.elements.measurementLabel.value = 'Roof Area';
        manager.elements.measurementMode.value = 'area';
        manager.elements.measurementValue.value = '120.5';
        manager.elements.measurementUnit.value = 'sq ft';

        manager.handleMeasurementFormSubmit(submitEvent());

        const activeDrawing = manager.getActiveDrawing();
        expect(activeDrawing.measurements).toHaveLength(1);
        expect(manager.elements.measurementList.textContent).toContain('Roof Area');
        expect(manager.elements.summaryContainer.textContent).toContain('sq ft');
        expect(toast).toHaveBeenCalledWith('Measurement saved.', 'success');
    });

    test('handleAddNote stores note and renders list for active drawing', () => {
        manager.elements.drawingName.value = 'Elevation';
        manager.handleDrawingFormSubmit(submitEvent());

        manager.elements.noteInput.value = 'Confirm siding finish.';
        manager.handleAddNote();

        const drawing = manager.getActiveDrawing();
        expect(Array.isArray(drawing.notes)).toBe(true);
        expect(drawing.notes).toHaveLength(1);
        expect(manager.elements.noteList.textContent).toContain('Confirm siding finish.');
        expect(toast).toHaveBeenCalledWith('Note added to drawing.', 'success');
    });
});

/** @jest-environment jsdom */

import { jest, describe, expect, test, beforeEach } from '@jest/globals';

import { TakeoffManager } from '../takeoff.js';

function createStorageMock() {
    const store = new Map();
    return {
        getItem: jest.fn((key) => store.get(key) || null),
        setItem: jest.fn((key, value) => store.set(key, value)),
        removeItem: jest.fn((key) => store.delete(key))
    };
}

function setupDom() {
    document.body.innerHTML = `
        <form id="takeoffDrawingForm">
            <input id="takeoffDrawingName" />
            <input id="takeoffDrawingTrade" />
            <input id="takeoffDrawingFloor" />
            <input id="takeoffDrawingNotes" />
            <button type="submit">Save</button>
        </form>
        <button id="takeoffAddDrawingBtn" type="button"></button>
        <input id="takeoffSearchInput" />
        <select id="takeoffSortSelect"></select>
        <table><tbody id="takeoffDrawingTableBody"></tbody></table>
        <p id="takeoffDrawingEmpty"></p>
        <form id="takeoffMeasurementForm">
            <input id="measurementLabelInput" />
            <select id="measurementModeSelect">
                <option value="area">Area</option>
                <option value="length">Length</option>
            </select>
            <input id="measurementValueInput" />
            <input id="measurementUnitInput" />
            <button type="submit">Add</button>
        </form>
        <div id="takeoffMeasurementList"></div>
        <div id="takeoffSummary"></div>
        <div id="takeoffActiveMeta"></div>
    `;
}

describe('TakeoffManager (simplified workspace)', () => {
    let manager;
    let storage;
    const toast = jest.fn();

    beforeEach(() => {
        setupDom();
        storage = createStorageMock();
        manager = new TakeoffManager({ toastService: toast, storageService: storage });
        manager.init();
        toast.mockClear();
    });

    test('adds drawings from the entry form and updates the table', () => {
        document.getElementById('takeoffDrawingName').value = 'Floor Plan';
        document.getElementById('takeoffDrawingTrade').value = 'Architectural';

        manager.handleDrawingFormSubmit(new Event('submit'));

        expect(manager.state.drawings).toHaveLength(1);
        expect(manager.state.currentDrawingId).toBe(manager.state.drawings[0].id);
        expect(document.getElementById('takeoffDrawingTableBody').children).toHaveLength(1);
        expect(document.getElementById('takeoffActiveMeta').textContent).toContain('Floor Plan');
        expect(storage.setItem).toHaveBeenCalled();
    });

    test('captures measurements for the active drawing and updates summary', () => {
        document.getElementById('takeoffDrawingName').value = 'Roof';
        manager.handleDrawingFormSubmit(new Event('submit'));

        document.getElementById('measurementLabelInput').value = 'Roof Area';
        document.getElementById('measurementModeSelect').value = 'area';
        document.getElementById('measurementValueInput').value = '120.5';
        document.getElementById('measurementUnitInput').value = 'sq ft';

        manager.handleMeasurementFormSubmit(new Event('submit'));

        const measurementList = document.getElementById('takeoffMeasurementList').textContent;
        const summaryText = document.getElementById('takeoffSummary').textContent;

        expect(measurementList).toContain('Roof Area');
        expect(summaryText).toContain('sq ft');
        expect(summaryText).toContain('120.5');
        expect(toast).toHaveBeenCalledWith('Measurement saved.', 'success');
    });

    test('removes drawings and measurements from the active workspace', () => {
        document.getElementById('takeoffDrawingName').value = 'Site Plan';
        manager.handleDrawingFormSubmit(new Event('submit'));

        document.getElementById('measurementLabelInput').value = 'Perimeter';
        document.getElementById('measurementModeSelect').value = 'length';
        document.getElementById('measurementValueInput').value = '45';
        document.getElementById('measurementUnitInput').value = 'lf';
        manager.handleMeasurementFormSubmit(new Event('submit'));

        const drawingId = manager.state.drawings[0].id;
        const measurementId = manager.state.drawings[0].measurements[0].id;

        manager.removeMeasurement(measurementId);
        manager.removeDrawing(drawingId);

        expect(manager.state.drawings).toHaveLength(0);
        expect(document.getElementById('takeoffMeasurementList').textContent).toContain('Select a drawing');
        expect(toast).toHaveBeenCalledWith('Drawing removed.', 'success');
    });
});

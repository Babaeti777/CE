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

    ({ TakeoffManager } = await import('../takeoff.js'));
});

describe('TakeoffManager measurements', () => {
    let restoreGetContext;
    let mockContext;

    beforeEach(() => {
        document.body.innerHTML = `
            <input id="takeoffDrawingInput" />
            <select id="takeoffSortSelect"></select>
            <button id="takeoffSortDirection"></button>
            <input id="takeoffSearchInput" />
            <table><tbody id="takeoffDrawingTableBody"></tbody></table>
            <div id="takeoffDrawingEmpty"></div>
            <div class="card takeoff-plan-card">
                <div id="takeoffPlanContainer" class="takeoff-plan">
                    <div id="takeoffToolbarMount">
                        <select id="takeoffModeSelect"></select>
                        <input id="takeoffScaleInput" />
                    </div>
                    <div class="takeoff-plan-stage" id="takeoffPlanStage">
                        <div id="takeoffPlanInner">
                            <img id="takeoffPlanPreview" />
                            <canvas id="takeoffCanvas" width="200" height="200"></canvas>
                        </div>
                    </div>
                </div>
            </div>
            <button id="takeoffZoomOutBtn"></button>
            <button id="takeoffZoomInBtn"></button>
            <button id="takeoffZoomResetBtn"></button>
            <div id="takeoffZoomIndicator"></div>
            <div id="takeoffStatus"></div>
            <div id="takeoffActiveMeta"></div>
            <button id="takeoffFullscreenBtn"></button>
            <button id="takeoffFullScreenToggle"></button>
            <div id="takeoffCountToolbar"></div>
            <input id="takeoffCountColor" />
            <select id="takeoffCountShape"></select>
            <input id="takeoffCountLabel" />
            <div class="card">
                <table><tbody id="takeoffMeasurementTableBody"></tbody></table>
                <div id="takeoffMeasurementEmpty" class="takeoff-empty"></div>
            </div>
            <button id="takeoffClearBtn"></button>
            <button id="takeoffExportCsvBtn"></button>
            <button id="takeoffPushBtn"></button>
            <select id="takeoffShapeSelect">
                <option value="rectangle">Rectangle</option>
                <option value="circle">Circle</option>
                <option value="triangle">Triangle</option>
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

        const input = manager.elements.drawingTableBody.querySelector('input[data-field="trade"]');
        input.value = 'Electrical';

        manager.measurements.set(drawing.id, [
            {
                id: 'm1',
                points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 5 }
                ],
                label: '15 ft'
            }
        ]);

        manager.handleDrawingTableInput({ target: input });

        expect(drawing.trade).toBe('Electrical');
        expect(mockContext.clearRect).toHaveBeenCalledWith(0, 0, 200, 200);
        expect(mockContext.beginPath).toHaveBeenCalled();
        expect(mockContext.moveTo).toHaveBeenCalledWith(0, 0);
        expect(mockContext.lineTo).toHaveBeenCalledWith(10, 0);
        expect(mockContext.lineTo).toHaveBeenCalledWith(10, 5);
        expect(mockContext.fillText).toHaveBeenCalledWith('15 ft', 18, -3);
    });

    test('renders measurement rows for active drawing', () => {
        const manager = new TakeoffManager({ toastService: jest.fn() });
        manager.cacheDom();

        const drawing = { id: 'drawing-1', name: 'Floor 1' };
        manager.state.drawings = [drawing];
        manager.state.currentDrawingId = drawing.id;

        manager.setMeasurementItems(drawing.id, [
            { id: 'm1', name: 'Main Area', mode: 'Area', quantity: 120.5, units: 'sq ft' }
        ]);

        const { measurementTableBody, measurementEmpty } = manager.elements;
        expect(measurementTableBody.children).toHaveLength(1);
        expect(measurementTableBody.querySelector('.takeoff-measurement-name').textContent).toBe('Main Area');
        expect(measurementEmpty.classList.contains('is-hidden')).toBe(true);
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

/** @jest-environment jsdom */

import { jest, describe, expect, test, beforeEach, afterEach, beforeAll } from '@jest/globals';

let TakeoffManager;

beforeAll(async () => {
    global.DOMMatrix = class DOMMatrix {
        multiplySelf() {
            return this;
        }

        inverse() {
            return this;
        }
    };

    await jest.unstable_mockModule('pdfjs-dist/build/pdf', () => ({
        GlobalWorkerOptions: {},
        getDocument: () => ({ promise: Promise.resolve({}) })
    }));

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
            <div id="takeoffPlanContainer"></div>
            <div id="takeoffPlanInner"></div>
            <img id="takeoffPlanPreview" />
            <canvas id="takeoffCanvas" width="200" height="200"></canvas>
            <button id="takeoffZoomOutBtn"></button>
            <button id="takeoffZoomInBtn"></button>
            <button id="takeoffZoomResetBtn"></button>
            <div id="takeoffZoomIndicator"></div>
            <div id="takeoffStatus"></div>
            <div id="takeoffActiveMeta"></div>
            <div id="takeoffPdfControls"></div>
            <button id="takeoffPdfPrev"></button>
            <button id="takeoffPdfNext"></button>
            <input id="takeoffPdfPageInput" />
            <span id="takeoffPdfPageTotal"></span>
            <button id="takeoffPdfOpen"></button>
            <button id="takeoffPdfDownload"></button>
            <button id="takeoffOpenPdfBtn"></button>
            <div id="takeoffPdfModal"></div>
            <div id="takeoffPdfModalOverlay"></div>
            <button id="takeoffPdfModalClose"></button>
            <iframe id="takeoffPdfFrame"></iframe>
            <button id="takeoffFullscreenBtn"></button>
            <button id="takeoffFullScreenToggle"></button>
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
            <div class="form-group">
                <label for="takeoffDim1">Dimension 1</label>
                <input id="takeoffDim1" />
            </div>
            <div class="form-group" id="takeoffDim2Group">
                <label for="takeoffDim2">Dimension 2</label>
                <input id="takeoffDim2" />
            </div>
            <button id="takeoffQuickCalcBtn"></button>
            <div id="takeoffQuickResult"></div>
        `;

        mockContext = {
            beginPath: jest.fn(),
            moveTo: jest.fn(),
            lineTo: jest.fn(),
            closePath: jest.fn(),
            stroke: jest.fn(),
            fill: jest.fn(),
            clearRect: jest.fn(),
            save: jest.fn(),
            restore: jest.fn(),
            fillText: jest.fn(),
            set lineWidth(value) {
                this._lineWidth = value;
            },
            get lineWidth() {
                return this._lineWidth;
            },
            set strokeStyle(value) {
                this._strokeStyle = value;
            },
            get strokeStyle() {
                return this._strokeStyle;
            },
            set fillStyle(value) {
                this._fillStyle = value;
            },
            get fillStyle() {
                return this._fillStyle;
            },
            set font(value) {
                this._font = value;
            },
            get font() {
                return this._font;
            }
        };

        restoreGetContext = jest
            .spyOn(HTMLCanvasElement.prototype, 'getContext')
            .mockImplementation(() => mockContext);
    });

    afterEach(() => {
        if (restoreGetContext && typeof restoreGetContext.mockRestore === 'function') {
            restoreGetContext.mockRestore();
        }
    });

    test('refreshes measurement overlays when metadata changes', () => {
        const manager = new TakeoffManager({ toastService: jest.fn() });
        manager.cacheDom();

        const drawing = {
            id: 'drawing-1',
            name: 'Site Plan',
            trade: '',
            floor: '',
            page: '',
            createdAt: Date.now(),
            type: 'image',
            objectUrl: 'blob:1',
            previewUrl: 'blob:1',
            naturalWidth: 200,
            naturalHeight: 200
        };

        manager.state.drawings = [drawing];
        manager.state.currentDrawingId = drawing.id;
        manager.state.zoom = 2;
        manager.renderDrawingList();

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
        expect(mockContext.lineTo).toHaveBeenCalledWith(20, 0);
        expect(mockContext.lineTo).toHaveBeenCalledWith(20, 10);
        expect(mockContext.fillText).toHaveBeenCalledWith('15 ft', 28, 2);
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

    test('quick calculator computes rectangle area on click', () => {
        const manager = new TakeoffManager({ toastService: jest.fn() });
        manager.cacheDom();
        manager.bindEvents();

        manager.elements.shapeSelect.value = 'rectangle';
        manager.elements.dim1Input.value = '10';
        manager.elements.dim2Input.value = '5';

        manager.elements.quickCalcBtn.click();

        expect(manager.elements.quickResult.textContent).toContain('50');
        expect(manager.elements.status.textContent).toContain('Quick shape area calculated');
    });

    test('exports measurements to CSV and updates status', () => {
        const toast = jest.fn();
        const manager = new TakeoffManager({ toastService: toast });
        manager.cacheDom();

        const drawing = { id: 'drawing-1', name: 'Plan.pdf' };
        manager.state.drawings = [drawing];
        manager.state.currentDrawingId = drawing.id;
        manager.setMeasurementItems(drawing.id, [
            { id: 'm1', name: 'Main Area', mode: 'Area', quantity: 50, units: 'sq ft' }
        ]);

        const originalCreateObjectURL = URL.createObjectURL;
        const originalRevokeObjectURL = URL.revokeObjectURL;
        URL.createObjectURL = jest.fn(() => 'blob:123');
        URL.revokeObjectURL = jest.fn();
        const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        manager.exportMeasurementsToCsv();

        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(clickSpy).toHaveBeenCalled();
        expect(manager.elements.status.textContent).toContain('exported');

        clickSpy.mockRestore();
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
    });

    test('clearing measurements empties the table and shows placeholder', () => {
        const toast = jest.fn();
        const manager = new TakeoffManager({ toastService: toast });
        manager.cacheDom();

        const drawing = { id: 'drawing-1', name: 'Level 1' };
        manager.state.drawings = [drawing];
        manager.state.currentDrawingId = drawing.id;
        manager.setMeasurementItems(drawing.id, [
            { id: 'm1', name: 'Room A', mode: 'Area', quantity: 25, units: 'sq ft' }
        ]);

        manager.clearMeasurements();

        const { measurementTableBody, measurementEmpty } = manager.elements;
        expect(measurementTableBody.children).toHaveLength(0);
        expect(measurementEmpty.classList.contains('is-hidden')).toBe(false);
        expect(manager.elements.status.textContent).toContain('cleared');
    });

    test('pushMeasurementsToEstimate sends data to service', () => {
        const push = jest.fn();
        const manager = new TakeoffManager({ toastService: jest.fn(), estimateService: { push } });
        manager.cacheDom();

        const drawing = { id: 'drawing-1', name: 'Suite A' };
        manager.state.drawings = [drawing];
        manager.state.currentDrawingId = drawing.id;
        manager.setMeasurementItems(drawing.id, [
            { id: 'm1', name: 'Suite A Walls', mode: 'Linear', quantity: 80, units: 'ft' }
        ]);

        manager.pushMeasurementsToEstimate();

        expect(push).toHaveBeenCalledTimes(1);
        expect(push.mock.calls[0][0]).toMatchObject({ drawing, measurements: expect.any(Array) });
        expect(manager.elements.status.textContent).toContain('sent to the estimate');
    });
});

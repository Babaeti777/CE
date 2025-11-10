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
        restoreGetContext.mockRestore();
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
});

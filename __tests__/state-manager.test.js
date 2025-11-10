import { jest } from '@jest/globals';
import { StateManager } from '../state/state-manager.js';

describe('StateManager', () => {
  let manager;

  beforeEach(() => {
    manager = new StateManager({
      projects: [],
      currentEstimate: { total: 0 }
    });
  });

  test('updates nested state and notifies subscribers', () => {
    const spy = jest.fn();
    manager.subscribe('currentEstimate.total', spy);

    manager.setState('currentEstimate.total', 5000);

    expect(manager.getState('currentEstimate.total')).toBe(5000);
    expect(spy).toHaveBeenCalledWith(5000);
  });

  test('proxy assignments trigger listeners', () => {
    const rootSpy = jest.fn();
    manager.subscribe('', rootSpy);

    manager.state.projects.push({ id: 'a', total: 100 });

    expect(manager.getState('projects')[0].total).toBe(100);
    expect(rootSpy).toHaveBeenCalled();
  });
});

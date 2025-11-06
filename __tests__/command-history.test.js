import { CommandHistory } from '../services/command-history.js';

describe('CommandHistory', () => {
  test('executes, undoes, and redoes commands', () => {
    const history = new CommandHistory();
    const executionOrder = [];

    const command = {
      value: 0,
      execute() {
        this.value += 1;
        executionOrder.push('execute');
      },
      undo() {
        this.value -= 1;
        executionOrder.push('undo');
      },
      redo() {
        this.value += 1;
        executionOrder.push('redo');
      }
    };

    history.execute(command);
    expect(command.value).toBe(1);

    history.undo();
    expect(command.value).toBe(0);

    history.redo();
    expect(command.value).toBe(1);
    expect(executionOrder).toEqual(['execute', 'undo', 'redo']);
  });
});

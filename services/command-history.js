export class CommandHistory {
    constructor(maxSize = 50) {
        this.history = [];
        this.currentIndex = -1;
        this.maxSize = maxSize;
    }

    execute(command) {
        if (!command || typeof command.execute !== 'function') {
            throw new TypeError('Command must implement an execute method.');
        }
        this.history = this.history.slice(0, this.currentIndex + 1);
        command.execute();
        this.history.push(command);
        if (this.history.length > this.maxSize) {
            this.history.shift();
        }
        this.currentIndex = this.history.length - 1;
    }

    undo() {
        if (this.currentIndex < 0) return;
        const command = this.history[this.currentIndex];
        if (command?.undo) {
            command.undo();
        }
        this.currentIndex -= 1;
    }

    redo() {
        if (this.currentIndex >= this.history.length - 1) return;
        this.currentIndex += 1;
        const command = this.history[this.currentIndex];
        if (command?.redo) {
            command.redo();
        } else {
            command?.execute?.();
        }
    }
}

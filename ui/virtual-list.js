import { debounce } from '../utils/debounce.js';

export class VirtualList {
    constructor(container, itemHeight, renderItem, { overscan = 4 } = {}) {
        this.container = container;
        this.itemHeight = itemHeight;
        this.renderItem = renderItem;
        this.overscan = overscan;
        this.items = [];
        this.inner = document.createElement('div');
        this.inner.style.position = 'relative';
        this.container.innerHTML = '';
        this.container.style.position = this.container.style.position || 'relative';
        this.container.style.overflowY = this.container.style.overflowY || 'auto';
        this.container.appendChild(this.inner);

        this.handleScroll = debounce(() => this.update(), 16);
        this.container.addEventListener('scroll', this.handleScroll);
    }

    setItems(items) {
        this.items = Array.isArray(items) ? items : [];
        this.inner.style.height = `${this.items.length * this.itemHeight}px`;
        this.update();
    }

    update() {
        if (!this.container) return;
        const scrollTop = this.container.scrollTop;
        const containerHeight = this.container.clientHeight || this.itemHeight * 5;
        const start = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.overscan);
        const end = Math.min(this.items.length, Math.ceil((scrollTop + containerHeight) / this.itemHeight) + this.overscan);

        this.inner.innerHTML = '';
        for (let i = start; i < end; i += 1) {
            const item = this.items[i];
            const element = this.renderItem(item, i);
            if (!element) continue;
            element.style.position = 'absolute';
            element.style.top = `${i * this.itemHeight}px`;
            element.style.left = '0';
            element.style.right = '0';
            this.inner.appendChild(element);
        }
    }

    destroy() {
        if (this.container) {
            this.container.removeEventListener('scroll', this.handleScroll);
        }
        this.inner.innerHTML = '';
        this.items = [];
    }
}

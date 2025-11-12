export function createElement(tag, options = {}) {
    const element = document.createElement(tag);
    if (!options) return element;

    const {
        className,
        textContent,
        innerHTML,
        dataset,
        attributes,
        children,
        ...props
    } = options;

    if (className) {
        element.className = className;
    }

    if (textContent !== undefined) {
        element.textContent = textContent;
    } else if (innerHTML !== undefined) {
        element.innerHTML = innerHTML;
    }

    if (dataset) {
        Object.entries(dataset).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            element.dataset[key] = String(value);
        });
    }

    if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
            if (value === undefined || value === null) return;
            element.setAttribute(key, value);
        });
    }

    Object.entries(props).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        element[key] = value;
    });

    appendChildren(element, children);
    return element;
}

export function appendChildren(parent, children) {
    if (!parent || !children) return parent;
    const nodes = Array.isArray(children) ? children : [children];
    nodes.filter(Boolean).forEach(child => parent.appendChild(child));
    return parent;
}

export function setTextIfChanged(element, text) {
    if (!element) return;
    if (element.textContent === text) return;
    element.textContent = text;
}

export function setValueIfChanged(element, value) {
    if (!element) return;
    if (document.activeElement === element) return;
    const nextValue = value ?? '';
    const normalized = typeof nextValue === 'number' ? String(nextValue) : nextValue;
    if (element.value === normalized) return;
    element.value = normalized;
}

export function setSelectValue(select, value) {
    if (!select) return;
    const normalized = value ?? '';
    if (select.value === normalized) return;
    const hasOption = Array.from(select.options || []).some(option => option.value === normalized);
    if (hasOption || normalized === '') {
        select.value = normalized;
    }
}

export function debounce(fn, delay = 300) {
    if (typeof fn !== 'function') {
        throw new TypeError('debounce expects a function');
    }
    let timeoutId;
    return function debounced(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            timeoutId = undefined;
            fn.apply(this, args);
        }, delay);
    };
}

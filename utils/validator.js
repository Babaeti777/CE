export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

export class Validator {
    static required(value, fieldName = 'Field') {
        if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
            throw new ValidationError(`${fieldName} is required`);
        }
        return value;
    }

    static number(value, { min, max, fieldName = 'Value' } = {}) {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed)) {
            throw new ValidationError(`${fieldName} must be a valid number`);
        }
        if (min !== undefined && parsed < min) {
            throw new ValidationError(`${fieldName} must be at least ${min}`);
        }
        if (max !== undefined && parsed > max) {
            throw new ValidationError(`${fieldName} must be at most ${max}`);
        }
        return parsed;
    }
}

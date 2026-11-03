'use strict';

/** User-correctable problem (PHP: InvalidArgumentException). Its message is safe to show. */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = { ValidationError };

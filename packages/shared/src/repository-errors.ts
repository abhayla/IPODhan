/**
 * Repository Layer Error Classes
 *
 * Defines custom error types for repository operations to provide
 * clear, specific error handling throughout the data access layer.
 */

/**
 * Base class for all repository-related errors
 */
export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'RepositoryError';
    Object.setPrototypeOf(this, RepositoryError.prototype);
  }
}

/**
 * Thrown when a requested entity is not found in the database
 */
export class EntityNotFoundError extends RepositoryError {
  constructor(
    entityName: string,
    identifier: string | number,
    cause?: unknown
  ) {
    super(`${entityName} not found: ${identifier}`, cause);
    this.name = 'EntityNotFoundError';
    Object.setPrototypeOf(this, EntityNotFoundError.prototype);
  }
}

/**
 * Thrown when a database connection or query fails
 */
export class DatabaseError extends RepositoryError {
  constructor(
    message: string,
    public readonly query?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = 'DatabaseError';
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

/**
 * Thrown when a cache operation fails (non-critical, should fallback to DB)
 */
export class CacheError extends RepositoryError {
  constructor(
    message: string,
    public readonly operation?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = 'CacheError';
    Object.setPrototypeOf(this, CacheError.prototype);
  }
}

/**
 * Thrown when a database constraint is violated (unique, foreign key, etc.)
 */
export class ConstraintViolationError extends RepositoryError {
  constructor(
    message: string,
    public readonly constraint?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = 'ConstraintViolationError';
    Object.setPrototypeOf(this, ConstraintViolationError.prototype);
  }
}

/**
 * Thrown when invalid data is provided to repository methods
 */
export class InvalidDataError extends RepositoryError {
  constructor(
    message: string,
    public readonly field?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = 'InvalidDataError';
    Object.setPrototypeOf(this, InvalidDataError.prototype);
  }
}

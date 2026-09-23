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

/**
 * Thrown when a repository method is asked to `apply` a write against the
 * production database without explicit acknowledgement (`opts.allowProd`).
 *
 * MAJOR-3 (PR #433 review): the prod refusal used to live ONLY in the CLI
 * wrapper (`scraper/scripts/repair-merge-duplicate-ipo.ts` via
 * `openRepairDb`) — `IPORepository.mergeDuplicateInto({apply: true})` itself
 * would write production for any future caller (an admin route, another
 * script) that forgot to reimplement the same guard. This error is thrown
 * FROM INSIDE the repository method, before any write, so the guard cannot
 * be bypassed by a new caller.
 */
export class ProdWriteRefusedError extends RepositoryError {
  constructor(
    message: string,
    public readonly dbName?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = 'ProdWriteRefusedError';
    Object.setPrototypeOf(this, ProdWriteRefusedError.prototype);
  }
}

/**
 * OD-68 (docs/design/data-sourcing-pull-model.md §2.3.3.2): a record that
 * binds to no identifier, and whose name matches an existing offering without
 * the same open date and price band, is HELD FOR REVIEW — never created as a
 * new row. `IPORepository.create` throws this instead of inserting; the
 * candidates it collided with are carried (and logged) so a human can decide
 * without running a second query.
 */
export class IdentityHeldForReviewError extends RepositoryError {
  constructor(
    message: string,
    public readonly incoming: { companyName: string; slug: string; openDate: unknown; priceRangeMin: unknown },
    public readonly candidates: { id: string; slug: string; companyName: string; openDate: unknown; priceRangeMin: unknown; status: unknown }[]
  ) {
    super(message);
    this.name = 'IdentityHeldForReviewError';
    Object.setPrototypeOf(this, IdentityHeldForReviewError.prototype);
  }
}

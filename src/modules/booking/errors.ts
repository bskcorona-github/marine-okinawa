export type BookingErrorCode =
  | 'SLOT_NOT_FOUND'
  | 'SLOT_CLOSED'
  | 'SLOT_FULL'
  | 'PAST_CUTOFF'
  | 'INVALID_ITEMS'
  | 'PARTY_TOO_LARGE'
  | 'CONTACT_REQUIRED'
  | 'DUPLICATE_BOOKING'
  | 'RATE_LIMITED';

export class BookingError extends Error {
  constructor(readonly code: BookingErrorCode) {
    super(code);
    this.name = 'BookingError';
  }
}

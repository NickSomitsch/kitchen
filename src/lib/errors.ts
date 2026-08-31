export class ConflictError extends Error {
  constructor(message = 'This item was changed by someone else.') {
    super(message)
    this.name = 'ConflictError'
  }
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}


/**
 * Wraps an async Express route handler so thrown errors (or rejected
 * promises) are forwarded to the centralized error handler instead of
 * crashing the process or hanging the request.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;

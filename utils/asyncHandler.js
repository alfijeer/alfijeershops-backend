// Express 4 does not automatically catch errors thrown inside an async
// route handler — an unhandled rejection there either hangs the request
// or crashes the whole process. Wrap every controller with this so errors
// always flow to errorHandler.js instead.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;

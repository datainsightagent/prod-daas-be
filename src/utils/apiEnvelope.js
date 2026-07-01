import { getRequestId } from "../lib/requestContext.js";

export function successResponse(data, meta = {}) {
  const requestId = getRequestId();
  return {
    success: true,
    data,
    error: null,
    meta: {
      request_id: requestId ?? null,
      version: "v1",
      ...meta,
    },
  };
}

export function errorResponse(code, message, meta = {}) {
  const requestId = getRequestId();
  return {
    success: false,
    data: null,
    error: {
      code,
      message,
    },
    meta: {
      request_id: requestId ?? null,
      version: "v1",
      ...meta,
    },
  };
}

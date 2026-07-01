import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const requestContextStore = new AsyncLocalStorage();
const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function getSafeRequestId(incomingRequestId) {
  if (typeof incomingRequestId !== "string") {
    return randomUUID();
  }

  const candidate = incomingRequestId.trim();
  if (!candidate) {
    return randomUUID();
  }

  if (candidate.length > MAX_REQUEST_ID_LENGTH) {
    return randomUUID();
  }

  if (!REQUEST_ID_PATTERN.test(candidate)) {
    return randomUUID();
  }

  return candidate;
}

export function requestContextMiddleware(req, _res, next) {
  const incomingRequestId = req.get("x-request-id");
  const requestId = getSafeRequestId(incomingRequestId);

  requestContextStore.run({ requestId }, () => {
    req.requestId = requestId;
    next();
  });
}

export function getRequestId() {
  return requestContextStore.getStore()?.requestId;
}

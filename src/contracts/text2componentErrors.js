export const TEXT2COMPONENT_ERROR_CODES = Object.freeze({
  INVALID_SPEC: "invalid_spec",
  FIELD_NOT_IN_RESULT: "field_not_in_result",
  EMPTY_RESULT: "empty_result",
  UNSUPPORTED_TYPE: "unsupported_type",
  UNSUPPORTED_SPEC_VERSION: "unsupported_spec_version",
});

export function text2componentError(code, message, details = {}) {
  return { code, message, details };
}

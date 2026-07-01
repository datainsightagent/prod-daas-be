import { parseKbRetrieveBody } from "../contracts/kbRetrieve.contract.js";
import { AuthServiceError } from "../services/auth.service.js";
import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import { kbRetrieve } from "../services/kbRetrieve.service.js";

export async function kbRetrieveHandler(req, res) {
  const parsed = parseKbRetrieveBody(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return res.status(422).json(errorResponse("validation_error", msg));
  }

  try {
    const data = await kbRetrieve({ auth: req.auth, body: parsed.data });
    return res.status(200).json(successResponse(data));
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return res
        .status(error.statusCode)
        .json(errorResponse(error.errorCode, error.message));
    }
    console.error("kb_retrieve failed:", error);
    return res.status(500).json(
      errorResponse("internal_error", "Unexpected error occurred while processing kb_retrieve"),
    );
  }
}

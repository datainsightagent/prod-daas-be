import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import { listEntityDescriptions } from "../services/entities.service.js";

export async function listEntityDescriptionsHandler(req, res) {
  try {
    const payload = await listEntityDescriptions({ auth: req.auth });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    console.error("entities_list failed:", error);
    return res.status(500).json(
      errorResponse(
        "internal_error",
        "Unexpected error occurred while processing entities_list",
      ),
    );
  }
}

import express from "express";
import {
  runQueryHandler,
  validateQueryHandler,
} from "../controllers/queries.controller.js";
import { requireServiceAuth } from "../middleware/requireServiceAuth.js";

const router = express.Router();

router.use(requireServiceAuth);

router.post("/validate", validateQueryHandler);
router.post("/run", runQueryHandler);

export default router;

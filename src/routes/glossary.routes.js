import express from "express";
import {
  createGlossaryTermHandler,
  deleteGlossaryTermHandler,
  getGlossaryTermByIdHandler,
  listGlossaryTermsHandler,
  updateGlossaryTermHandler,
} from "../controllers/glossary.controller.js";

const router = express.Router();

router.post("/", createGlossaryTermHandler);
router.get("/", listGlossaryTermsHandler);
router.get("/:id", getGlossaryTermByIdHandler);
router.patch("/:id", updateGlossaryTermHandler);
router.delete("/:id", deleteGlossaryTermHandler);

export default router;

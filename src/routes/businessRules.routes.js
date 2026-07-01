import express from "express";
import {
  createBusinessRuleHandler,
  deleteBusinessRuleHandler,
  getBusinessRuleByIdHandler,
  listBusinessRulesHandler,
  updateBusinessRuleHandler,
} from "../controllers/businessRules.controller.js";

const router = express.Router();

router.post("/", createBusinessRuleHandler);
router.get("/", listBusinessRulesHandler);
router.get("/:id", getBusinessRuleByIdHandler);
router.patch("/:id", updateBusinessRuleHandler);
router.delete("/:id", deleteBusinessRuleHandler);

export default router;

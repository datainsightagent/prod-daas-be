import express from "express";
import { listEntityDescriptionsHandler } from "../controllers/entities.controller.js";

const router = express.Router();

router.get("/", listEntityDescriptionsHandler);

export default router;

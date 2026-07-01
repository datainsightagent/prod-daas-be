import express from "express";
import { kbRetrieveHandler } from "../controllers/kbRetrieve.controller.js";

const router = express.Router();

router.post("/retrieve", kbRetrieveHandler);

export default router;

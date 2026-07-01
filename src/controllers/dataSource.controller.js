import { errorResponse, successResponse } from "../utils/apiEnvelope.js";
import { z } from "zod";
import {
  acknowledgeSchemaChangeEvent,
  createDataSource,
  DataSourceServiceError,
  deleteDataSource,
  getDataSourceDetail,
  getSchemaSnapshotById,
  enqueueSchemaScan,
  listDataSources,
  listSchemaChangeEvents,
  listSchemaSnapshots,
  testDataSourceConnection,
} from "../services/dataSource.service.js";

const schemaScanRequestSchema = z.object({
  sample_rows_per_table: z.number().int().min(0).max(10).optional(),
  include_foreign_keys: z.boolean().optional(),
});

const schemaChangeEventsQuerySchema = z.object({
  acknowledged: z
    .enum(["true", "false"])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === "true",
    ),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

function handleDataSourceError(res, error, operationName) {
  if (error instanceof DataSourceServiceError) {
    return res
      .status(error.statusCode)
      .json(errorResponse(error.errorCode, error.message));
  }

  console.error(`${operationName} failed:`, error);
  return res
    .status(500)
    .json(
      errorResponse(
        "internal_error",
        `Unexpected error occurred while processing ${operationName}`,
      ),
    );
}

export async function createDataSourceHandler(req, res) {
  try {
    const payload = await createDataSource({
      auth: req.auth,
      input: req.body,
    });
    return res.status(201).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "data_source_create");
  }
}

export async function listDataSourcesHandler(req, res) {
  try {
    const payload = await listDataSources({ auth: req.auth });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "data_source_list");
  }
}

export async function getDataSourceDetailHandler(req, res) {
  try {
    const payload = await getDataSourceDetail({
      auth: req.auth,
      dataSourceId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "data_source_detail");
  }
}

export async function testDataSourceConnectionHandler(req, res) {
  try {
    const payload = await testDataSourceConnection({
      auth: req.auth,
      dataSourceId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "data_source_test_connection");
  }
}

export async function deleteDataSourceHandler(req, res) {
  try {
    const payload = await deleteDataSource({
      auth: req.auth,
      dataSourceId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "data_source_delete");
  }
}

export async function enqueueSchemaScanHandler(req, res) {
  const parsed = schemaScanRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid schema scan payload"));
  }

  try {
    const payload = await enqueueSchemaScan({
      auth: req.auth,
      dataSourceId: req.params.id,
      input: parsed.data,
    });
    return res.status(202).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "schema_scan_enqueue");
  }
}

export async function listSchemaSnapshotsHandler(req, res) {
  try {
    const payload = await listSchemaSnapshots({
      auth: req.auth,
      dataSourceId: req.params.id,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "schema_snapshot_list");
  }
}

export async function getSchemaSnapshotHandler(req, res) {
  try {
    const payload = await getSchemaSnapshotById({
      auth: req.auth,
      snapshotId: req.params.snapshotId,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "schema_snapshot_get");
  }
}

export async function listSchemaChangeEventsHandler(req, res) {
  const parsed = schemaChangeEventsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json(errorResponse("validation_error", "Invalid schema change events query"));
  }

  try {
    const payload = await listSchemaChangeEvents({
      auth: req.auth,
      dataSourceId: req.params.id,
      acknowledged: parsed.data.acknowledged,
      limit: parsed.data.limit ?? 50,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "schema_change_events_list");
  }
}

export async function acknowledgeSchemaChangeEventHandler(req, res) {
  try {
    const payload = await acknowledgeSchemaChangeEvent({
      auth: req.auth,
      changeEventId: req.params.eventId,
    });
    return res.status(200).json(successResponse(payload));
  } catch (error) {
    return handleDataSourceError(res, error, "schema_change_event_acknowledge");
  }
}

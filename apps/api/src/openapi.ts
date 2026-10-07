import { API_PREFIX, ENDPOINTS, ERROR_STATUS, type EndpointSpec } from "@glim/contracts";
import { z } from "zod";

type JsonSchema = Record<string, unknown>;

function schemaOf(type: z.ZodType, io: "input" | "output"): JsonSchema {
  return z.toJSONSchema(type, { io, unrepresentable: "any" });
}

function parametersOf(spec: EndpointSpec) {
  const params: JsonSchema[] = [];
  for (const [location, schema] of [
    ["path", spec.params],
    ["query", spec.query],
  ] as const) {
    if (schema === undefined) continue;
    const json = schemaOf(schema, "input") as {
      properties?: Record<string, JsonSchema>;
      required?: string[];
    };
    for (const [name, property] of Object.entries(json.properties ?? {})) {
      params.push({
        name,
        in: location,
        required: location === "path" || (json.required ?? []).includes(name),
        schema: property,
      });
    }
  }
  if (spec.idempotent) {
    params.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      schema: { type: "string", minLength: 16, maxLength: 64 },
    });
  }
  return params;
}

const errorEnvelope = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "requestId"],
      properties: {
        code: { type: "string", enum: Object.keys(ERROR_STATUS) },
        message: { type: "string" },
        requestId: { type: "string" },
        fieldErrors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              code: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
  },
};

/** The OpenAPI 3.1 document, generated from the shared contracts (TRD §0.3). */
export function buildOpenApiDocument(endpoints: readonly EndpointSpec[] = ENDPOINTS) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const spec of endpoints) {
    const path = `${API_PREFIX}${spec.path.replaceAll(/:(\w+)/g, "{$1}")}`;
    const status = String(spec.successStatus ?? (spec.method === "POST" ? 201 : 200));
    paths[path] ??= {};
    paths[path][spec.method.toLowerCase()] = {
      summary: spec.summary,
      tags: [spec.tag],
      security: spec.auth === "public" ? [] : [{ session: [] }],
      parameters: parametersOf(spec),
      ...(spec.body === undefined
        ? {}
        : {
            requestBody: {
              required: true,
              content: { "application/json": { schema: schemaOf(spec.body, "input") } },
            },
          }),
      responses: {
        [status]:
          status === "204"
            ? { description: "No content" }
            : {
                description: "OK",
                content: { "application/json": { schema: schemaOf(spec.response, "output") } },
              },
        default: {
          description: "Error",
          content: { "application/json": { schema: errorEnvelope } },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "GLIM Bible College API", version: "1" },
    components: {
      securitySchemes: { session: { type: "apiKey", in: "cookie", name: "glim_session" } },
    },
    paths,
  };
}

import { z } from "zod";
import { ENUMS } from "../enums";
import { endpoint } from "../http";

const idParams = z.object({ id: z.uuid() });
const code = z.string().trim().min(1).max(20);

// ---- Rooms ----

export const roomSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  capacity: z.number().int().nullable(),
  status: z.enum(ENUMS["rooms.status"]),
  version: z.number().int(),
});

export type Room = z.infer<typeof roomSchema>;

export const listRooms = endpoint({
  method: "GET",
  path: "/rooms",
  summary: "Rooms",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:read",
  response: z.object({ items: z.array(roomSchema) }),
});

export const createRoom = endpoint({
  method: "POST",
  path: "/rooms",
  summary: "Add a Room",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:manage",
  body: z
    .object({
      code,
      name: z.string().trim().min(1).max(100),
      capacity: z.number().int().positive().max(10_000).nullable().default(null),
    })
    .strict(),
  response: roomSchema,
});

export const updateRoom = endpoint({
  method: "PATCH",
  path: "/rooms/:id",
  summary: "Rename, resize or archive a Room",
  tag: "Calendar",
  auth: "session",
  permission: "academic:structure:manage",
  resource: { type: "room", param: "id" },
  ifMatch: true,
  params: idParams,
  body: z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      capacity: z.number().int().positive().max(10_000).nullable().optional(),
      status: z.enum(ENUMS["rooms.status"]).optional(),
    })
    .strict(),
  response: roomSchema,
});

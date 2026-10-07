import { z } from "zod";
import { endpoint } from "../http";

export const institutionSchema = z.object({
  name: z.string(),
  timezone: z.string(),
});

/** The institution's public identity, shown before sign-in (login and apply pages). */
export const getInstitution = endpoint({
  method: "GET",
  path: "/public/institution",
  summary: "Institution name and timezone",
  tag: "Public",
  auth: "public",
  response: institutionSchema,
});

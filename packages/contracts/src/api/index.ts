import * as platform from "./platform";

export { platform };

/** Every endpoint, for the OpenAPI document and the route-coverage test. */
export const ENDPOINTS = [platform.getInstitution] as const;

import { API_PREFIX } from "@glim/contracts";
import { Controller, Get } from "@nestjs/common";
import { buildOpenApiDocument } from "../../openapi";

@Controller()
export class OpenApiController {
  private readonly document = buildOpenApiDocument();

  @Get(`${API_PREFIX}/openapi.json`)
  get() {
    return this.document;
  }
}

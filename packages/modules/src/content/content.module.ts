import { AuthorizationModule } from "@glim/modules/authorization";
import { Module } from "@nestjs/common";
import { FilesService } from "./files.service";

const services = [FilesService];

/** Content (TRD §14.1). v1 so far: uploaded files. */
@Module({
  imports: [AuthorizationModule],
  providers: services,
  exports: services,
})
export class ContentModule {}

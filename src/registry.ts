import * as core from "@actions/core";
import { CratesIO, CrateResult } from "crates.io";
import * as cargo from "./cargo";

type RegistryConfig = {
  api: string;
  dl: string;
};

export class Registry {
  client: CratesIO;
  constructor() {
    if (process.env.CARGO_REGISTRIES_ARTIFACTORY_TOKEN) {
      this.client = new CratesIO(process.env.CARGO_REGISTRIES_ARTIFACTORY_TOKEN);
    } else {
      // fallback to crates.io without authentication
      this.client = new CratesIO();
    }
  }

  async init(): Promise<void> {
    if (process.env.CARGO_REGISTRIES_ARTIFACTORY_TOKEN && process.env.CARGO_REGISTRIES_ARTIFACTORY_INDEX) {
      const apiUrl = await this.getApiUrl();
      this.client.setApiUrl(apiUrl);
    }
  }

  async isPublished(pkg: cargo.Package): Promise<boolean> {
    core.startGroup(`Query registry for package ${pkg.name} version: ${pkg.version}`);
    let crateResult: CrateResult;
    try {
      crateResult = await this.client.api.crates.getCrate(pkg.name);
      //if (crateResult.crate && crateResult.crate.max_version != null) {
      if (crateResult.crate && crateResult.crate.newest_version != null) {
        // for now use max_version, but client should expose newest_version
        return pkg.version === crateResult.crate.newest_version;
      }
      return false;
    } catch (error) {
      core.info(`Failed to query registry for ${pkg.name}`);
      core.info(error as string);
      return false;
    } finally {
      core.endGroup();
    }
  }

  async getApiUrl(): Promise<string> {
    let indexUrl: string | undefined = process.env.CARGO_REGISTRIES_ARTIFACTORY_INDEX;
    if (indexUrl && indexUrl.startsWith("sparse")) {
      indexUrl = indexUrl.replace("sparse+", "");
      const response = await fetch(indexUrl + "/config.json");
      const config = (await response.json()) as RegistryConfig;
      return config.api;
    } else {
      console.log("No sparse index URL found");
      return "";
    }
  }
}

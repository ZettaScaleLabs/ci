import { jest } from "@jest/globals";
import { CrateResult } from "crates.io";
import * as cargo from "../src/cargo";

import { Registry } from "../src/registry";

describe("Registry", () => {
  let registry: Registry;

  beforeEach(async () => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.CARGO_REGISTRIES_ARTIFACTORY_TOKEN;
    delete process.env.CARGO_REGISTRIES_ARTIFACTORY_INDEX;
  });

  describe("init", () => {
    it("should initialize CratesIO client with token and API URL", async () => {
      process.env.CARGO_REGISTRIES_ARTIFACTORY_TOKEN = "test-token";
      process.env.CARGO_REGISTRIES_ARTIFACTORY_INDEX = "sparse+https://example.com/index";
      registry = new Registry();
      registry.getApiUrl = jest.fn(() => Promise.resolve("https://example.com/api"));
      await registry.init();
      expect(registry.getApiUrl).toHaveBeenCalledTimes(1);
    });

    it("should fallback to unauthenticated CratesIO client if no token is provided", async () => {
      delete process.env.CARGO_REGISTRIES_ARTIFACTORY_TOKEN;
      registry = new Registry();
      registry.getApiUrl = jest.fn(() => Promise.resolve(""));
      await registry.init();
      expect(registry.getApiUrl).toHaveBeenCalledTimes(0);
    });
  });

  describe("isPublished", () => {
    it("should return true if the package version matches the newest version", async () => {
      const mockPackage = { name: "test-package", version: "2.0.0" } as cargo.Package;
      const registry = new Registry();
      registry.init();
      registry.client.api.crates.getCrate = jest.fn(
        (): Promise<CrateResult> =>
          Promise.resolve({
            crate: { newest_version: "2.0.0" },
          } as CrateResult),
      );
      const result = await registry.isPublished(mockPackage);
      expect(result).toBe(true);
    });

    it("should return false if the package version does not match the newest version", async () => {
      const mockPackage = { name: "test-package", version: "1.0.0" } as cargo.Package;
      const registry = new Registry();
      registry.init();
      registry.client.api.crates.getCrate = jest.fn(
        (): Promise<CrateResult> =>
          Promise.resolve({
            crate: { newest_version: "2.0.0" },
          } as CrateResult),
      );
      const result = await registry.isPublished(mockPackage);
      expect(result).toBe(false);
    });

    it("should return false if an error occurs", async () => {
      const mockPackage = { name: "test-package", version: "1.0.0" } as cargo.Package;
      const registry = new Registry();
      registry.init();
      registry.client.api.crates.getCrate = jest.fn((): Promise<CrateResult> => Promise.reject());
      const result = await registry.isPublished(mockPackage);
      expect(result).toBe(false);
    });
  });

  describe("getApiUrl", () => {
    it("should return the API URL from the config.json response", async () => {
      process.env.CARGO_REGISTRIES_ARTIFACTORY_INDEX = "sparse+https://example.com/index";
      process.env.CARGO_REGISTRIES_ARTIFACTORY_TOKEN = "test-token";
      const mockConfig = "{ api: 'https://example.com/api', dl: 'https://example.com/dl' }";
      global.fetch = jest.fn(
        (): Promise<Response> =>
          Promise.resolve({
            json: () => Promise.resolve(mockConfig),
          } as Response),
      );

      const registry = new Registry();
      registry.init();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith("https://example.com/index/config.json");
    });

    it("should return an empty string if index URL is not sparse", async () => {
      process.env.CARGO_REGISTRIES_ARTIFACTORY_INDEX = "https://example.com/index";

      registry = new Registry();
      await registry.init();
      const result = await registry.getApiUrl();
      expect(result).toBe("");
    });
  });
});

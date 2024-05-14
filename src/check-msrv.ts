import * as core from "@actions/core";

import * as cargo from "./cargo";
import { sh } from "./command";
import { TOML } from "./toml";

const DEFAULT_MIN_MSRV: string = "1.66.1";

const toml = await TOML.init();

export type Input = {
  repo: string;
  min?: string;
  branch?: string;
  githubToken?: string;
};

export function setup(): Input {
  const repo = core.getInput("repo", { required: true });
  const min = core.getInput("min", { required: false });
  const branch = core.getInput("branch", { required: false });
  const githubToken = core.getInput("github-token", { required: false });

  return {
    repo,
    min: min == "" ? undefined : min,
    branch: branch == "" ? undefined : branch,
    githubToken: githubToken == "" ? undefined : githubToken,
  };
}

export async function main(input: Input) {
  try {
    await cargo.installBinaryCached("cargo-msrv");

    const min = input.min ?? DEFAULT_MIN_MSRV;

    let failed = false;
    for (const package_ of cargo.packages(process.cwd())) {
      const rustVersionField = ["package", "rust-version"];
      const rustVersionRaw = toml.get(package_.manifestPath, rustVersionField);
      if (typeof rustVersionRaw !== "string") {
        core.error(
          `Cargo Manifest field \`package.rust-version\` should be a string, instead it evaluates to: \`${JSON.stringify(rustVersionRaw)}\``,
        );
        failed = true;
        continue;
      }
      const rustVersion = rustVersionRaw;

      const output = sh(
        `cargo msrv --output-format json --log-level trace --log-target stdout --min ${min} --manifest-path ${package_.manifestPath}`,
      );
      const conclusion = JSON.parse(output.stderr.trim().split("\n").pop()) as Record<string, unknown>;
      const result = conclusion["result"] as Record<string, unknown>;
      const success = result["success"] as boolean;
      if (!success) {
        core.error(`The MSRV of package ${package_.name} could not be found`);
        failed = true;
        continue;
      }
      const msrv = result["version"] as string;

      if (rustVersion < msrv) {
        core.error(
          `The \`rust-version\` (${rustVersion}) of package \`${package_.name}\` is less than its MSRV (${msrv})`,
        );
        failed = true;
      }

      if (rustVersion > msrv) {
        core.notice(
          `The \`rust-version\` (${rustVersion}) of package \`${package_.name}\` is greater than its MSRV (${msrv})`,
        );
      }
    }

    if (failed) {
      core.setFailed("Cargo workspace crates failed MSRV checks");
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

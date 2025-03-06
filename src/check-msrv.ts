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

function msrv(min: string, package_: cargo.Package, ignoreLockfile: boolean = false): string | null {
  let command = ["cargo", "msrv", "find", "--output-format", "json", "--min", min, "--manifest-path", package_.manifestPath];
  if (ignoreLockfile) {
    command.push("--ignore-lockfile");
  }
  const output = sh(command.join(" "));
  const conclusion = JSON.parse(output.stderr.trim().split("\n").pop()) as Record<string, unknown>;
  const result = conclusion["result"] as Record<string, unknown>;
  const success = result["success"] as boolean;
  if (!success) {
    return null;
  } else {
    return result["version"] as string;
  }
}

export async function main(input: Input) {
  try {
    await cargo.installBinaryCached("cargo-msrv");

    const min = input.min ?? DEFAULT_MIN_MSRV;
    const rustVersionField = ["package", "rust-version"];

    let failed = false;

    for (const package_ of cargo.packages(process.cwd())) {
      let rustVersion = null;
      if (!toml.exists(package_.manifestPath, rustVersionField)) {
        core.warning(
          `The \`rust-version\` of package \`${package_.name}\` is not defined`,
        );
      } else {
        const rustVersionRaw = toml.get(package_.manifestPath, rustVersionField);

        if (typeof rustVersionRaw !== "string") {
          core.error(
            `Cargo Manifest field \`package.rust-version\` should be a string, instead it evaluates to: \`${JSON.stringify(rustVersionRaw)}\``,
          );
          failed = true;
          continue;
        }
        rustVersion = rustVersionRaw;
        toml.unset(package_.manifestPath, rustVersionField);
      }

      const msrv1 = msrv(min, package_, false);
      const msrv2 = msrv(min, package_, true);

      if (rustVersion === null) {
        core.notice(
          `The MSRV of package \`${package_.name}\` is ${msrv1}/${msrv2} (but its \`rust-version\` is undefined)`,
        );
      } else {
        if (rustVersion < msrv1 || rustVersion < msrv2) {
          core.error(
            `The \`rust-version\` (${rustVersion}) of package \`${package_.name}\` is less than its MSRV (${msrv1}/${msrv2})`,
          );
          failed = true;
        }

        if (rustVersion > msrv1 || rustVersion > msrv2) {
          core.notice(
            `The \`rust-version\` (${rustVersion}) of package \`${package_.name}\` is greater than its MSRV (${msrv1}/${msrv2})`,
          );
        }
      }
    }

    if (failed) {
      core.setFailed("Cargo workspace crates failed MSRV checks");
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

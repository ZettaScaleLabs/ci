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
  const output = sh(command.join(" "), { check: false });
  if (output.status !== 0) { return null };
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
          `\`rust-version\` of package \`${package_.name}\` is undefined`,
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

      const msrvLocked = msrv(min, package_, false);
      if (msrvLocked === null) {
        core.error(`Failed to compute the MSRV of package \`${package_.name}\` w/ lockfile`);
        failed = true;
        continue;
      }
      const msrvUnlocked = msrv(min, package_, true);
      if (msrvLocked === null) {
        core.error(`Failed to compute the MSRV of package \`${package_.name}\` w/o lockfile`);
        failed = true;
        continue;
      }

      if (msrvLocked != msrvUnlocked) {
        core.notice(`MSRV of package \`${package_.name}\` w/ lockfile (${msrvLocked}) while its MSRV w/o lockfile (${msrvUnlocked})`);
      } else {
        core.notice(`MSRV of package \`${package_.name}\` is ${msrvLocked}`);
      }

      if (rustVersion !== null) {
        const msrvMax = Math.max(Number(msrvLocked), Number(msrvUnlocked));
        if (rustVersion < msrvMax) {
          core.error(
            `\`rust-version\` (${rustVersion}) of package \`${package_.name}\` is less than its maximal MSRV (${msrvMax})`,
          );
          failed = true;
        }

        if (rustVersion > msrvMax) {
          core.notice(
            `\`rust-version\` (${rustVersion}) of package \`${package_.name}\` is greater than its maximal MSRV (${msrvMax})`,
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

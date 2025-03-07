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
  sh(`cat ${package_.manifestPath}`);
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

    const packages = cargo.packages(process.cwd());

    for (const package_ of packages) {
      if (package_.rustVersion === undefined) {
        core.warning(
          `\`rust-version\` of package \`${package_.name}\` is undefined`,
        );
      } else {
        await toml.unset(package_.manifestPath, rustVersionField);
      }
    }

    for (const package_ of packages) {
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
        core.notice(`MSRV of package \`${package_.name}\` w/ lockfile is (${msrvLocked}) while its MSRV w/o lockfile is (${msrvUnlocked})`);
      } else {
        core.notice(`MSRV of package \`${package_.name}\` is ${msrvLocked}`);
      }

      if (package_.rustVersion !== null) {
        const msrvMax = Math.max(Number(msrvLocked), Number(msrvUnlocked));
        if (Number(package_.rustVersion) < msrvMax) {
          core.error(
            `\`rust-version\` (${package_.rustVersion}) of package \`${package_.name}\` is less than its maximal MSRV (${msrvMax})`,
          );
          failed = true;
        }

        if (Number(package_.rustVersion) > msrvMax) {
          core.notice(
            `\`rust-version\` (${package_.rustVersion}) of package \`${package_.name}\` is greater than its maximal MSRV (${msrvMax})`,
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

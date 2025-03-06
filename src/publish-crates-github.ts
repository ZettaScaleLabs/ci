import * as core from "@actions/core";
import { DefaultArtifactClient } from "@actions/artifact";

import { sh } from "./command";
import path from "path";

import { artifactRegExp as artfifactRegExpDebain } from "./build-crates-debian";
import { artifactRegExp as artfifactRegExpStandalone } from "./build-crates-standalone";

const artifact = new DefaultArtifactClient();

export type Input = {
  liveRun: boolean;
  repo: string;
  version: string;
  branch: string;
  githubToken: string;
  archiveRegExp?: RegExp;
};

export function setup(): Input {
  const liveRun = core.getBooleanInput("live-run", { required: true });
  const repo = core.getInput("repo", { required: true });
  const version = core.getInput("version", { required: true });
  const branch = core.getInput("branch", { required: true });
  const githubToken = core.getInput("github-token", { required: true });
  const archivePatterns = core.getInput("archive-patterns", { required: false });

  return {
    liveRun,
    version,
    branch,
    repo,
    githubToken,
    archiveRegExp: archivePatterns == "" ? undefined : new RegExp(archivePatterns.split("\n").join("|")),
  };
}

export async function main(input: Input) {
  try {
    const env = {
      GH_TOKEN: input.githubToken,
    };

    const releasesRaw =
      // NOTE: We use compute the latest release (or pre-release) and use its tag name as the
      // starting tag for the next release.
      sh(`gh release list --repo ${input.repo} --exclude-drafts --order desc --json tagName`, { env });
    const releases = JSON.parse(releasesRaw.stdout) as GitHubRelease[];
    const releaseLatest = releases.at(0);

    if (input.liveRun) {
      const command = ["gh", "release", "create", input.version];
      command.push("--repo", input.repo);
      command.push("--target", input.branch);
      command.push("--verify-tag");
      command.push("--generate-notes");
      if (releaseLatest != undefined) {
        command.push("--notes-start-tag", releaseLatest.tagName);
      }
      if (isPreRelease(input.version)) {
        command.push("--prerelease");
      }
      sh(command.join(" "), { env });
    }

    const shouldPublishArtifact = (name: string): boolean => {
      if (input.archiveRegExp == undefined) {
        return artfifactRegExpStandalone.test(name) || artfifactRegExpDebain.test(name);
      } else {
        return input.archiveRegExp.test(name);
      }
    };

    const results = await artifact.listArtifacts({ latest: true });
    for (const result of results.artifacts) {
      if (shouldPublishArtifact(result.name)) {
        const { downloadPath } = await artifact.downloadArtifact(result.id);
        const archive = path.join(downloadPath, result.name);

        core.info(`Uploading ${archive} to github.com/${input.repo}`);
        if (input.liveRun) {
          sh(`gh release upload ${input.version} ${archive} --repo ${input.repo} --clobber`, { env });
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

export function isPreRelease(version: string): boolean {
  if (version.indexOf("-") > 0 || version.split(".").length == 4) {
    return true;
  }
  return false;
}

type GitHubRelease = {
  tagName: string;
};

import { join } from "path";
import { rm } from "fs/promises";

import * as core from "@actions/core";

import { sh } from "./command";
import * as cargo from "./cargo";

export type Input = {
  version: string;
  branch: string;
  repo: string;
  path?: string;
  githubToken: string;
  actorEnv: NodeJS.ProcessEnv;
  bumpDepsRegExp?: RegExp;
  bumpDepsVersion?: string;
  bumpDepsBranch?: string;
};

export function setup(): Input {
  const version = core.getInput("version", { required: true });
  const branch = core.getInput("branch", { required: true });
  const repo = core.getInput("repo", { required: true });
  const path = core.getInput("path");
  const githubToken = core.getInput("github-token", { required: true });
  const actorName = core.getInput("actor-name", { required: true });
  const actorEmail = core.getInput("actor-email", { required: true });
  const bumpDepsPattern = core.getInput("bump-deps-pattern");
  const bumpDepsVersion = core.getInput("bump-deps-version");
  const bumpDepsBranch = core.getInput("bump-deps-branch");

  return {
    version,
    branch,
    repo,
    path: path === "" ? undefined : path,
    githubToken,
    actorEnv: {
      GIT_AUTHOR_NAME: actorName,
      GIT_AUTHOR_EMAIL: actorEmail,
      GIT_COMMITTER_NAME: actorName,
      GIT_COMMITTER_EMAIL: actorEmail,
    },
    bumpDepsRegExp: bumpDepsPattern === "" ? undefined : new RegExp(bumpDepsPattern),
    bumpDepsVersion: bumpDepsVersion === "" ? undefined : bumpDepsVersion,
    bumpDepsBranch: bumpDepsBranch === "" ? undefined : bumpDepsBranch,
  };
}

export async function main(input: Input) {
  try {
    const repo = input.repo.split("/")[1];
    const workspace = input.path === undefined ? repo : join(repo, input.path);
    const remote = `https://${input.githubToken}@github.com/${input.repo}.git`;

    sh(`git clone --recursive ${remote}`);
    sh(`ls ${workspace}`);

    await cargo.bump(workspace, input.version);
    sh("git add .", { cwd: repo });
    sh(`git commit --message 'chore: Bump version to \`${input.version}\`'`, { cwd: repo, env: input.actorEnv });

    if (input.bumpDepsRegExp != undefined) {
      await cargo.bumpDependencies(workspace, input.bumpDepsRegExp, input.bumpDepsVersion!, input.bumpDepsBranch);
      sh("git add .", { cwd: repo });
      sh(`git commit --message 'chore: Bump ${input.bumpDepsRegExp} dependencies to \`${input.bumpDepsVersion!}\`'`, {
        cwd: repo,
        env: input.actorEnv,
        check: false,
      });

      sh("cargo check", { cwd: repo });
      sh("git commit Cargo.lock --message 'chore: Update Cargo lockfile'", {
        cwd: repo,
        env: input.actorEnv,
        check: false,
      });
    }

    sh(`git tag ${input.version} --message v${input.version}`, { cwd: repo, env: input.actorEnv });
    sh("git log -10", { cwd: repo });
    sh("git show-ref --tags", { cwd: repo });
    sh(`git push ${remote} ${input.branch} ${input.version}`, { cwd: repo });

    await cleanup(input);
  } catch (error) {
    await cleanup(input);
    if (error instanceof Error) core.setFailed(error.message);
  }
}

export async function cleanup(input: Input) {
  const repo = input.repo.split("/")[1];
  core.info(`Deleting repository clone ${repo}`);
  await rm(repo, { recursive: true, force: true });
}
import * as path from "path";

import * as core from "@actions/core";
import { DefaultArtifactClient } from "@actions/artifact";

import * as ssh from "./ssh";
import { sh } from "./command";

import { artifactRegExp as artifactRegExpDebian } from "./build-crates-debian";
import { artifactRegExp as artifactRegExpStandalone } from "./build-crates-standalone";
import { sha256 } from "./checksum";
import * as fs from "fs/promises";

const artifact = new DefaultArtifactClient();

export type Input = {
  liveRun: boolean;
  version: string;
  sshHost: string;
  sshHostPath: string;
  sshPrivateKey: string;
  sshPassphrase: string;
  archiveRegExp?: RegExp;
};

export function setup(): Input {
  const liveRun = core.getBooleanInput("live-run", { required: true });
  const version = core.getInput("version", { required: true });
  const sshHost = core.getInput("ssh-host", { required: true });
  const sshHostPath = core.getInput("ssh-host-path", { required: true });
  const sshPrivateKey = core.getInput("ssh-private-key", { required: true });
  const sshPassphrase = core.getInput("ssh-passphrase", { required: true });
  const archivePatterns = core.getInput("archive-patterns", { required: false });

  return {
    liveRun,
    version,
    sshHost,
    sshHostPath,
    sshPrivateKey,
    sshPassphrase,
    archiveRegExp: archivePatterns == "" ? undefined : new RegExp(archivePatterns.split("\n").join("|")),
  };
}

export async function main(input: Input) {
  try {
    const shouldPublishArtifact = (name: string): boolean => {
      if (input.archiveRegExp == undefined) {
        return artifactRegExpStandalone.test(name) || artifactRegExpDebian.test(name);
      } else {
        return input.archiveRegExp.test(name);
      }
    };

    const checksumFile = "sha256sums.txt";
    const archiveDir = `${input.sshHostPath}/${input.version}`;
    const results = await artifact.listArtifacts({ latest: true });
    for (const result of results.artifacts) {
      if (shouldPublishArtifact(result.name)) {
        const { downloadPath } = await artifact.downloadArtifact(result.id);
        const archive = path.join(downloadPath, result.name);

        const checksum = await sha256(archive);
        // Write the sha256 checksum of the archive
        await fs.appendFile(checksumFile, `${checksum} ${archive}\n`);
        if (input.liveRun) {
          core.info(`Uploading ${archive} to download.eclipse.org`);
          await ssh.withIdentity(input.sshPrivateKey, input.sshPassphrase, env => {
            sh(`ssh -v -o StrictHostKeyChecking=no ${input.sshHost} mkdir -p ${archiveDir}`, { env });
            sh(`scp -v -o StrictHostKeyChecking=no -r ${archive} ${input.sshHost}:${archiveDir}`, { env });
          });
        }
      }
    }

    if (input.liveRun) {
      core.info(`Uploading ${checksumFile} to download.eclipse.org`);
      await ssh.withIdentity(input.sshPrivateKey, input.sshPassphrase, env => {
        sh(`scp -v -o StrictHostKeyChecking=no -r ${checksumFile} ${input.sshHost}:${archiveDir}`, { env });
      });
    }

    cleanup();
  } catch (error) {
    cleanup();
    if (error instanceof Error) core.setFailed(error.message);
  }
}

export function cleanup() {}

import { sh } from "./command";

type CloneFromGitHubOptions = {
  branch?: string;
  token?: string;
  path?: string;
};

export function cloneFromGitHub(repo: string, options: CloneFromGitHubOptions): string {
  const remote =
    options.token == undefined ? `https://github.com/${repo}.git` : `https://${options.token}@github.com/${repo}.git`;

  const command = ["git", "clone", "--recursive"];
  if (options.branch != undefined) {
    command.push("--branch", options.branch);
  }
  command.push(remote);
  if (options.path != undefined) {
    command.push(options.path);
  }

  sh(command.join(" "));

  if (options.path != undefined) {
    return options.path;
  } else {
    return repo.split("/").at(1);
  }
}

export function describe(path: string = process.cwd()): string {
  return sh("git describe", { cwd: path }).stdout.trim();
}

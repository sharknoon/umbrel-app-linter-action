import { Probot } from "probot";
import { lintUmbrelAppYml } from "umbrel-cli/dist/lib.js";

const supportedFiles = [
  "umbrel-app.yml",
  "docker-compose.yml"
] as const;

export default (app: Probot) => {
  app.on(["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"], async (context) => {
    // Get pull request data
    const pullRequest = context.payload.pull_request;
    const owner = pullRequest.base.repo.owner.login;
    const repo = pullRequest.base.repo.name;
    const pull_number = pullRequest.number;

    // Retrieve the list of changed files
    const files = await context.octokit.pulls.listFiles({
      owner,
      repo,
      pull_number,
    });

    // Iterate over the changed files and retrieve their content
    for (const file of files.data) {
      if (!supportedFiles.some(f => file.filename.includes(f))) {
        continue;
      }

      // Get the content of the changed file
      const fileContent = await context.octokit.repos.getContent({
        owner,
        repo,
        path: file.filename,
        ref: pullRequest.head.sha,
      });

      if (!('content' in fileContent.data)) {
        continue;
      }

      const content = Buffer.from(fileContent.data.content, 'base64').toString('utf-8');

      switch (true) {
        case file.filename.endsWith("umbrel-app.yml"): {
          const result = await lintUmbrelAppYml(content);
          console.log(result);
          break;
        }
      }
    }

  });

};
import { Probot } from "probot";
import {
  lintUmbrelAppYml,
  LintingResult,
  lintDockerComposeYml,
  lintUmbrelAppStoreYml,
} from "umbrel-cli/dist/lib.js";

const supportedFiles = [
  "umbrel-app.yml",
  "docker-compose.yml",
  "umbrel-app-store.yml",
] as const;

export default (app: Probot) => {
  app.on(
    [
      "pull_request.opened",
      "pull_request.synchronize",
      "pull_request.reopened",
    ],
    async (context) => {
      // Get pull request data
      const pullRequest = context.payload.pull_request;
      const owner = pullRequest.base.repo.owner.login;
      const repo = pullRequest.base.repo.name;
      const pull_number = pullRequest.number;

      // Create a check run
      const check = await context.octokit.checks.create({
        owner,
        repo,
        name: "app-linter",
        head_sha: pullRequest.head.sha,
        status: "in_progress",
        started_at: new Date().toISOString(),
        output: {
          title: "umbrelOS App Linter",
          summary: "Linting files...",
        },
      });

      // Retrieve the list of changed files
      const files = await context.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number,
      });

      // Iterate over the changed files and retrieve their content
      const results: { filename: string; result: LintingResult[] }[] = [];
      for (const file of files.data) {
        if (!supportedFiles.some((f) => file.filename.includes(f))) {
          continue;
        }

        // Get the content of the changed file
        const fileContent = await context.octokit.repos.getContent({
          owner,
          repo,
          path: file.filename,
          ref: pullRequest.head.sha,
        });

        if (!("content" in fileContent.data)) {
          continue;
        }

        const content = Buffer.from(
          fileContent.data.content,
          "base64"
        ).toString("utf-8");

        switch (true) {
          case file.filename.endsWith("umbrel-app.yml"): {
            const result = await lintUmbrelAppYml(content);
            if (result.length > 0) {
              results.push({ filename: file.filename, result });
            }
            break;
          }
          case file.filename.endsWith("docker-compose.yml"): {
            const result = await lintDockerComposeYml(content);
            if (result.length > 0) {
              results.push({ filename: file.filename, result });
            }
            break;
          }
          case file.filename.endsWith("umbrel-app-store.yml"): {
            const result = await lintUmbrelAppStoreYml(content);
            if (result.length > 0) {
              results.push({ filename: file.filename, result });
            }
            break;
          }
        }
      }

      const numberOfErrors = results
        .flatMap((r) => r.result)
        .filter((r) => r.severity === "error").length;

      // update the check run with the results
      await context.octokit.checks.update({
        owner,
        repo,
        check_run_id: check.data.id,
        status: "completed",
        conclusion: numberOfErrors > 0 ? "failure" : "success",
        completed_at: new Date().toISOString(),
        output: {
          title:
            numberOfErrors > 0
              ? `❌ ${numberOfErrors} errors found`
              : "🎉 No errors found",
          summary:
            numberOfErrors > 0
              ? `### Legend\n\n❌ **Error**  \nThis must be resolved before this PR can be merged.\n\n\n⚠️ **Warning**  \nThis is highly encouraged to be resolved, but is not strictly mandatory.\n\n\nℹ️ **Info**  \nThis is just for your information.`
              : "🎉 Congratulations! You haven't made a single error 🫡",
          text:
            numberOfErrors === 0
              ? undefined
              : results
                  .map(
                    (r) =>
                      `### \`${r.filename}\`\n\n${r.result
                        .map(
                          (e) =>
                            `${
                              e.severity === "error"
                                ? "❌"
                                : e.severity === "warning"
                                ? "⚠️"
                                : "ℹ️"
                            } \`${e.id}\` **${
                              e.title
                            }**  \n&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${e.message.replaceAll(
                              "\n",
                              "\n&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
                            )}`
                        )
                        .join("\n\n")}`
                  )
                  .join("\n\n"),
          annotations: results.flatMap((f) =>
            f.result
              .filter((r) => r.line !== undefined)
              .map((r) => ({
                path: f.filename,
                start_line: r.line?.start ?? 1,
                end_line: r.line?.end ?? 1,
                start_column: r.column?.start,
                end_column: r.column?.end,
                annotation_level:
                  r.severity === "error"
                    ? "failure"
                    : r.severity === "warning"
                    ? "warning"
                    : "notice",
                message: r.message,
                title: `[${r.id}] ${r.title}`,
                raw_details: JSON.stringify(r, null, 2),
              }))
          ),
        },
        // TODO add some nifty actions to fix the errors
      });
    }
  );
};

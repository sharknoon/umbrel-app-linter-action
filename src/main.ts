import core from "@actions/core";
import github from "@actions/github";
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

try {
  // Get inputs and set up the octokit client
  const token = core.getInput("github-token", { required: true });
  const octokit = github.getOctokit(token);
  const context = github.context;
  let base = core.getInput("base");
  let headSHA = core.getInput("head-sha");

  // Check if the event is a pull request
  if (context.payload.pull_request) {
    core.debug("Event is a pull request");
    base = base || context.payload.pull_request.base.sha;
    headSHA = headSHA || context.payload.pull_request.head.sha;
  } else {
    core.debug("Event is not a pull request");
  }

  // If the base or head SHA is not set, cancel the action
  if (!base || !headSHA) {
    throw new Error(
      "This action can only be run on pull requests or with the 'base' and 'head-sha' set"
    );
  }

  // Compare commits to get the list of changed files
  const response = await octokit.rest.repos.compareCommitsWithBasehead({
    owner: context.repo.owner,
    repo: context.repo.repo,
    basehead: `${base}...${headSHA}`,
  });

  if (response.status !== 200) {
    throw new Error(`Failed to compare commits: ${response.status}`);
  }

  const files = response.data.files ?? [];

  // Create a check run
  /*const check = await octokit.rest.checks.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      name: "app-linter",
      head_sha: headSHA,
      status: "in_progress",
      started_at: new Date().toISOString(),
      output: {
        title: "Umbrel App Linter",
        summary: "Linting files...",
      },
    });*/

  // Iterate over the changed files and retrieve their content
  const lintedFiles: { filename: string; result: LintingResult[] }[] = [];
  for (const file of files) {
    if (!supportedFiles.some((f) => file.filename.includes(f))) {
      continue;
    }
    if (file.status === "removed") {
      continue;
    }

    // Get the content of the changed file
    const fileContent = await octokit.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: file.filename,
      ref: headSHA,
    });

    if (!("content" in fileContent.data)) {
      continue;
    }

    const content = Buffer.from(fileContent.data.content, "base64").toString(
      "utf-8"
    );

    // Lint the files
    switch (true) {
      case file.filename.endsWith("umbrel-app.yml"): {
        const result = await lintUmbrelAppYml(content);
        if (result.length > 0) {
          lintedFiles.push({ filename: file.filename, result });
        }
        break;
      }
      case file.filename.endsWith("docker-compose.yml"): {
        const result = await lintDockerComposeYml(content);
        if (result.length > 0) {
          lintedFiles.push({ filename: file.filename, result });
        }
        break;
      }
      case file.filename.endsWith("umbrel-app-store.yml"): {
        const result = await lintUmbrelAppStoreYml(content);
        if (result.length > 0) {
          lintedFiles.push({ filename: file.filename, result });
        }
        break;
      }
    }
  }

  const numberOfErrors = lintedFiles
    .flatMap((f) => f.result)
    .filter((r) => r.severity === "error").length;
  const numberOfWarnings = lintedFiles
    .flatMap((f) => f.result)
    .filter((r) => r.severity === "warning").length;
  const numberOfInfos = lintedFiles
    .flatMap((f) => f.result)
    .filter((r) => r.severity === "info").length;
  let title = "";
  switch (true) {
    case numberOfErrors === 0 && numberOfWarnings === 0:
      title = "🎉 No errors found";
      break;
    case numberOfErrors > 0 && numberOfWarnings > 0:
      title = `❌ ${numberOfErrors} errors and ${numberOfWarnings} warnings found`;
      break;
    case numberOfErrors > 0:
      title = `❌ ${numberOfErrors} errors found`;
      break;
    case numberOfWarnings > 0:
      title = `⚠️ ${numberOfWarnings} warnings found`;
      break;
  }

  // update the check run with the results
  /*await octokit.rest.checks.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      check_run_id: check.data.id,
      status: "completed",
      conclusion: numberOfErrors > 0 ? "failure" : "success",
      completed_at: new Date().toISOString(),
      output: {
        title,
        summary: `### Legend\n\n❌ **Error**  \nThis must be resolved before this PR can be merged.\n\n\n⚠️ **Warning**  \nThis is highly encouraged to be resolved, but is not strictly mandatory.\n\n\nℹ️ **Info**  \nThis is just for your information.`,
        text: results
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
    });*/

  // Create workflow annotations
  for (const file of lintedFiles) {
    for (const result of file.result) {
      if (result.line === undefined) {
        continue;
      }

      const annotationProperties = {
        title: result.title,
        file: file.filename,
        startLine: result.line.start,
        endLine: result.line.end,
        startColumn: result.column?.start,
        endColumn: result.column?.end,
      };
      switch (result.severity) {
        case "error":
          core.error(result.message, annotationProperties);
          break;
        case "warning":
          core.warning(result.message, annotationProperties);
          break;
        case "info":
          core.notice(result.message, annotationProperties);
          break;
      }
    }
  }

  // Create job summary
  core.summary.addHeading(title);
  core.summary.addRaw(
    `### Legend\n\n❌ **Error**  \nThis must be resolved before this PR can be merged.\n\n\n⚠️ **Warning**  \nThis is highly encouraged to be resolved, but is not strictly mandatory.\n\n\nℹ️ **Info**  \nThis is just for your information.`
  );
  for (const file of lintedFiles) {
    for (const result of file.result) {
      core.summary.addDetails(
        result.title,
        `${
          result.severity === "error"
            ? "❌"
            : result.severity === "warning"
            ? "⚠️"
            : "ℹ️"
        } \`${result.id}\` **${
          result.title
        }**  \n&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${result.message.replaceAll(
          "\n",
          "\n&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
        )}`
      );
    }
  }

  // Export some variables, maybe someone has a use for them
  core.setOutput("errors", numberOfErrors);
  core.setOutput("warnings", numberOfWarnings);
  core.setOutput("infos", numberOfInfos);
  core.setOutput("results", JSON.stringify(lintedFiles));
} catch (error) {
  core.setFailed(`Action failed with error ${error}`);
}

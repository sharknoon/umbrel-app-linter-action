import {
  getInput,
  debug,
  error,
  warning,
  notice,
  summary,
  setOutput,
  setFailed,
} from "@actions/core";
import { context, getOctokit } from "@actions/github";
import {
  lintUmbrelAppYml,
  LintingResult,
  lintDockerComposeYml,
  lintUmbrelAppStoreYml,
  lintDirectoryStructure,
} from "umbrel-cli/dist/lib.js";

const supportedFiles = [
  "umbrel-app.yml",
  "docker-compose.yml",
  "umbrel-app-store.yml",
] as const;

try {
  // Get inputs and set up the octokit client
  const token = getInput("github-token");
  const octokit = getOctokit(token);
  let base = getInput("base");
  let headSHA = getInput("head-sha");

  // Check if the event is a pull request
  if (context.payload.pull_request) {
    debug("Event is a pull request");
    base = base || context.payload.pull_request.base.sha;
    headSHA = headSHA || context.payload.pull_request.head.sha;
  } else {
    debug("Event is not a pull request");
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

  const changedFiles = response.data.files ?? [];

  const fileTree = await octokit.rest.git.getTree({
    owner: context.repo.owner,
    repo: context.repo.repo,
    tree_sha: headSHA,
    recursive: "true",
  });
  const allFiles =
    fileTree.status !== 200
      ? []
      : fileTree.data.tree
          .map((f) => ({
            path: f.path as string,
            type: (f.type === "blob" ? "file" : "directory") as
              | "file"
              | "directory",
          }))
          .filter((f) => f.path);

  // Iterate over the changed files and retrieve their content
  const lintedFiles: { filename: string; result: LintingResult[] }[] = [];
  for (const file of changedFiles) {
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
        const appId = file.filename.split("/").slice(-2, -1)[0];
        const result = await lintUmbrelAppYml(content, appId, {
          isNewAppSubmission: file.status === "added",
          pullRequestUrl: context.payload.pull_request?.html_url,
        });
        if (result.length > 0) {
          lintedFiles.push({ filename: file.filename, result });
        }
        break;
      }
      case file.filename.endsWith("docker-compose.yml"): {
        const appId = file.filename.split("/").slice(-2, -1)[0];
        const result = await lintDockerComposeYml(content, appId, allFiles, { checkImageArchitectures: true });
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

  // Iterate over all changed apps
  const appIds = changedFiles
    .map((f) => f.filename.split("/")[0])
    .filter((value, index, array) => array.indexOf(value) === index);
  for (const appId of appIds) {
    const appFiles = allFiles.filter((f) => f.path.startsWith(`${appId}/`));
    const results = lintDirectoryStructure(appFiles);
    for (const result of results) {
      lintedFiles.push({ filename: result.file, result: [result] });
    }
  }

  // Export the raw results, maybe someone has a use for them
  setOutput("results", JSON.stringify(lintedFiles));

  const numberOfErrors = lintedFiles
    .flatMap((f) => f.result)
    .filter((r) => r.severity === "error").length;
  const numberOfWarnings = lintedFiles
    .flatMap((f) => f.result)
    .filter((r) => r.severity === "warning").length;
  const numberOfInfos = lintedFiles
    .flatMap((f) => f.result)
    .filter((r) => r.severity === "info").length;

  // Export some variables, maybe someone has a use for them
  setOutput("errors", numberOfErrors);
  setOutput("warnings", numberOfWarnings);
  setOutput("infos", numberOfInfos);

  let title = "";
  switch (true) {
    case numberOfErrors === 0 && numberOfWarnings === 0:
      title = "🎉 Linting finished with no errors or warnings 🎉";
      break;
    case numberOfErrors > 0 && numberOfWarnings > 0:
      title = `❌ Linting failed with ${numberOfErrors} error${numberOfErrors > 1 ? 's' : ''} and ${numberOfWarnings} warning${numberOfWarnings > 1 ? 's' : ''} ❌`;
      break;
    case numberOfErrors > 0:
      title = `❌ Linting failed with ${numberOfErrors} error${numberOfErrors > 1 ? 's' : ''} ❌`;
      break;
    case numberOfWarnings > 0:
      title = `⚠️ Linting finished with ${numberOfWarnings} warning${numberOfWarnings > 1 ? 's' : ''} ⚠️`;
      break;
  }

  // Create workflow annotations
  for (const file of lintedFiles) {
    for (const result of file.result) {
      const annotationProperties = {
        title: result.title,
        file: file.filename,
        startLine: result.line?.start,
        endLine: result.line?.end,
        startColumn: result.column?.start,
        endColumn: result.column?.end,
      };
      switch (result.severity) {
        case "error":
          error(result.message, annotationProperties);
          break;
        case "warning":
          warning(result.message, annotationProperties);
          break;
        case "info":
          notice(result.message, annotationProperties);
          break;
      }
    }
  }

  // Create job summary
  summary.addHeading(title);
  summary.addHeading("Legend", 2);
  summary.addRaw(
    `\n❌ **Error**  \nThis must be resolved before this PR can be merged.\n\n\n⚠️ **Warning**  \nThis is highly encouraged to be resolved, but is not strictly mandatory.\n\n\nℹ️ **Info**  \nThis is just for your information.`
  );
  for (const file of lintedFiles) {
    summary.addHeading("<pre><code>" + file.filename + "</code></pre>", 2);
    summary.addTable([
      [
        { data: "🚨 Severity", header: true },
        { data: "🪪 ID", header: true },
        { data: "💬 Message", header: true },
      ],
      ...file.result.map((r) => [
        r.severity === "error"
          ? "❌ Error"
          : r.severity === "warning"
          ? "⚠️ Warning"
          : "ℹ️ Info",
        "<pre><code>" + r.id + "</code></pre>",
        "<b>" + r.title + "</b>: " + r.message,
      ]),
    ]);
  }

  // Create a comment on the PR
  if (context.payload.pull_request) {
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.payload.pull_request.number,
      body: `## ${title}
Thank you for your submission! This is an automated linter that checks for common issues in pull requests to the Umbrel App Store.
Please review any comments below and make any necessary changes to your submission. 

${lintedFiles
  .map((file) => {
    return `### \`${file.filename}\`
| 🚨 Severity | 🪪 ID | 💬 Message |
| --- | --- | --- |
${file.result
  .map(
    (r) =>
      `| ${
        r.severity === "error"
          ? "❌ Error"
          : r.severity === "warning"
          ? "⚠️ Warning"
          : "ℹ️ Info"
      } | \`${r.id}\` | **${escapeMarkdown(r.title)}**: ${escapeMarkdown(
        r.message
      )} |`
  )
  .join("\n")}`;
  })
  .join("\n\n")}
### Legend

❌ **Error**  
This must be resolved before this PR can be merged.


⚠️ **Warning**  
This is highly encouraged to be resolved, but is not strictly mandatory.


ℹ️ **Info**  
This is just for your information.`,
    });
  }

  // Finish the action
  summary.write();
  if (numberOfErrors > 0) {
    setFailed(title);
  }
} catch (error) {
  setFailed(`Action failed with error ${error}`);
}

function escapeMarkdown(text: string): string {
  return text
  .replaceAll("\\", "\\\\")
  .replaceAll("`", "\\`")
  .replaceAll("*", "\\*")
  .replaceAll("_", "\\_")
  .replaceAll("{", "\\{")
  .replaceAll("}", "\\}")
  .replaceAll("[", "\\[")
  .replaceAll("]", "\\]")
  .replaceAll("<", "\\<")
  .replaceAll(">", "\\>")
  .replaceAll("(", "\\(")
  .replaceAll(")", "\\)")
  .replaceAll("#", "\\#")
  .replaceAll("+", "\\+")
  .replaceAll("-", "\\-")
  .replaceAll(".", "\\.")
  .replaceAll("!", "\\!")
  .replaceAll("|", "\\|")
  .replaceAll("\n", "<br>");
}

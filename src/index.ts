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
  const result: LintingResult[] = [];
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
        const umbrelAppYmlResult = await lintUmbrelAppYml(content, appId, {
          isNewAppSubmission: file.status === "added",
          pullRequestUrl: context.payload.pull_request?.html_url,
        });
        result.push(...umbrelAppYmlResult);
        break;
      }
      case file.filename.endsWith("docker-compose.yml"): {
        const appId = file.filename.split("/").slice(-2, -1)[0];
        const dockerComposeYmlResult = await lintDockerComposeYml(
          content,
          appId,
          allFiles,
          {
            checkImageArchitectures: true,
          }
        );
        result.push(...dockerComposeYmlResult);
        break;
      }
      case file.filename.endsWith("umbrel-app-store.yml"): {
        const umbrelAppStoreYmlResult = await lintUmbrelAppStoreYml(content);
        result.push(...umbrelAppStoreYmlResult);
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
    const directoryStructureResult = lintDirectoryStructure(appFiles);
    result.push(...directoryStructureResult);
  }

  // Export the raw results, maybe someone has a use for them
  setOutput("results", JSON.stringify(result));

  const numberOfErrors = result.filter((r) => r.severity === "error").length;
  const numberOfWarnings = result.filter(
    (r) => r.severity === "warning"
  ).length;
  const numberOfInfos = result.filter((r) => r.severity === "info").length;

  // Export some variables, maybe someone has a use for them
  setOutput("errors", numberOfErrors);
  setOutput("warnings", numberOfWarnings);
  setOutput("infos", numberOfInfos);

  // Helper function to create a string of spaces, which are not trimmed by GitHub
  const nbsp = (count: number) => '&nbsp;'.repeat(count);

  let title = "";
  switch (true) {
    case numberOfErrors === 0 && numberOfWarnings === 0:
      title = `🎉${nbsp(3)}Linting finished with no errors or warnings${nbsp(3)}🎉`;
      break;
    case numberOfErrors > 0 && numberOfWarnings > 0:
      title = `❌${nbsp(3)}Linting failed with ${numberOfErrors} error${numberOfErrors > 1 ? "s" : ""} and ${numberOfWarnings} warning${numberOfWarnings > 1 ? "s" : ""}${nbsp(3)}❌`;
      break;
    case numberOfErrors > 0:
      title = `❌${nbsp(3)}Linting failed with ${numberOfErrors} error${numberOfErrors > 1 ? "s" : ""}${nbsp(3)}❌`;
      break;
    case numberOfWarnings > 0:
      title = `⚠️${nbsp(3)}Linting finished with ${numberOfWarnings} warning${numberOfWarnings > 1 ? "s" : ""}${nbsp(3)}⚠️`;
      break;
  }

  // Create workflow annotations
  for (const r of result) {
    const annotationProperties = {
      title: r.title,
      file: r.file,
      startLine: r.line?.start,
      endLine: r.line?.end,
      startColumn: r.column?.start,
      endColumn: r.column?.end,
    };
    switch (r.severity) {
      case "error":
        error(r.message, annotationProperties);
        break;
      case "warning":
        warning(r.message, annotationProperties);
        break;
      case "info":
        notice(r.message, annotationProperties);
        break;
    }
  }

  // Create job summary
  summary.addHeading(title);
  summary.addRaw(
    "<br>Thank you for your submission! This is an automated linter that checks for common issues in pull requests to the Umbrel App Store."
  );
  if (numberOfErrors > 0 || numberOfWarnings > 0 || numberOfInfos > 0) {
    summary.addRaw(
      "<br><br>Please review the linting results below and make any necessary changes to your submission."
    );
    summary.addHeading("Linting Results", 2);
    summary.addTable([
      [
        { data: "Severity", header: true },
        { data: "File", header: true },
        { data: "ID", header: true },
        { data: "Description", header: true },
      ],
      ...result.map((r) => [
        r.severity === "error" ? "❌" : r.severity === "warning" ? "⚠️" : "ℹ️",
        "<pre>" + r.id + "</pre>",
        "<pre>" + r.file + "</pre>",
        "<b>" + r.title + ":</b><br>" + r.message,
      ]),
    ]);
    summary.addHeading("Legend", 2);
    summary.addTable([
      [
        { data: "Symbol", header: true },
        { data: "Description", header: true },
      ],
      ["❌", "**Error:** This must be resolved before this PR can be merged."],
      [
        "⚠️",
        "**Warning:** This is highly encouraged to be resolved, but is not strictly mandatory.",
      ],
      ["ℹ️", "**Info:** This is just for your information."],
    ]);
  }

  // Create a comment on the PR
  if (context.payload.pull_request) {
    let issues = "";
    if (numberOfErrors > 0 || numberOfWarnings > 0 || numberOfInfos > 0) {
      issues = `Please review the linting results below and make any necessary changes to your submission.
        
### Linting Results
| Severity | File | Description |
| --- | --- | --- |
${result
  .map((r) => {
    let severity = "";
    switch (r.severity) {
      case "error":
        severity = "❌";
        break;
      case "warning":
        severity = "⚠️";
        break;
      case "info":
        severity = "ℹ️";
        break;
    }
    return `| ${severity} | \`${r.file}\` | **${escapeMarkdown(r.title)}:**<br>${escapeMarkdown(
      r.message
    )} |`;
  })
  .join("\n")}
  
### Legend

| Symbol | Description |
|--------|-------------|
| ❌ | **Error:** This must be resolved before this PR can be merged. |
| ⚠️ | **Warning:** This is highly encouraged to be resolved, but is not strictly mandatory. |
| ℹ️ | **Info:** This is just for your information. |      
`;
    }
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.payload.pull_request.number,
      body: `## ${title}

Thank you for your submission! This is an automated linter that checks for common issues in pull requests to the Umbrel App Store.

${issues}`,
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

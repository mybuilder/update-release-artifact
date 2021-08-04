const fs = require('fs');
const core = require('@actions/core');
const { Octokit } = require('@octokit/action');
const AdmZip = require('adm-zip');

const sleep = seconds =>
  new Promise(r => setTimeout(r, seconds * 1000));

const findWorkflowRunArtifactId = async (
  workflow,
  workflowCommit,
  artifactName,
  pollingAttempts = 60
) => {
  const octokit = new Octokit();
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

  if (pollingAttempts < 1) {
    throw new Error(
      'Failed to find workflow run... exceeded attempts'
    );
  }

  for await (const runs of octokit.paginate.iterator(
    octokit.actions.listWorkflowRuns,
    {
      owner,
      repo,
      workflow_id: workflow,
    }
  )) {
    const run = runs.data.find(r => r.head_sha === workflowCommit && r.conclusion === 'success');
    if (run) {
      const artifacts =
        await octokit.actions.listWorkflowRunArtifacts({
          owner,
          repo,
          run_id: run.id,
        });
      const artifact = artifacts.data.artifacts.find(
        a => a.name === artifactName
      );
      if (artifact) return artifact.id;
    }
  }

  await sleep(1);

  console.log('- Failed to find workflow run... retrying');

  return await findWorkflowRunArtifactId(
    workflow,
    workflowCommit,
    artifactName,
    pollingAttempts - 1
  );
};

const pullWorkflowArtifact = async (artifactId, artifactName) => {
  const octokit = new Octokit();
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

  const zip = await octokit.actions.downloadArtifact({
    owner,
    repo,
    artifact_id: artifactId,
    archive_format: 'zip',
  });

  const adm = new AdmZip(Buffer.from(zip.data));
  adm.extractAllTo('artifact', true);

  return `./artifact/${artifactName}`;
};

const updateReleaseArtifact = async (
  releaseId,
  artifactName,
  workflowArtifactLocalPath
) => {
  const octokit = new Octokit();
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

  const { data } = await octokit.request(
    'GET /repos/:owner/:repo/releases/:releaseId/assets',
    {
      owner,
      repo,
      releaseId,
    }
  );

  for (const asset of data) {
    await octokit.request(
      'DELETE /repos/:owner/:repo/releases/assets/:assetId',
      {
        owner,
        repo,
        assetId: asset.id,
      }
    );
    console.log(`- Removed ${asset.name} from release`);
  }

  await octokit.repos.uploadReleaseAsset({
    owner,
    repo,
    release_id: releaseId,
    name: artifactName,
    data: fs.readFileSync(workflowArtifactLocalPath),
  });
};

async function run() {
  try {
    const workflow = core.getInput('workflow');
    const workflowCommit = core.getInput('workflow_commit');
    const artifactName = core.getInput('artifact_name');
    const releaseId = core.getInput('release_id');

    console.log(
      `workflow: ${workflow}, workflowCommit: ${workflowCommit}, artifactName: ${artifactName}, releaseId: ${releaseId}`
    );

    console.log(`Finding workflow run artifact`);

    const workflowArtifactId = await findWorkflowRunArtifactId(
      workflow,
      workflowCommit,
      artifactName
    );

    console.log(`Pulling workflow run artifact`);

    const workflowArtifactLocalPath = await pullWorkflowArtifact(
      workflowArtifactId,
      artifactName
    );

    console.log(`Updating release artifact`);

    await updateReleaseArtifact(
      releaseId,
      artifactName,
      workflowArtifactLocalPath
    );

    console.log(`Successfully updated release artifact`);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

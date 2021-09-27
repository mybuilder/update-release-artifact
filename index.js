const fs = require('fs');
const path = require('path');
const core = require('@actions/core');
const { Octokit } = require('@octokit/action');

const updateReleaseArtifact = async (releaseId, artifactPath) => {
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
    name: path.basename(artifactPath),
    data: fs.readFileSync(artifactPath),
  });
};

async function run() {
  try {
    const artifactPath = core.getInput('artifact_path');
    const releaseId = core.getInput('release_id');

    console.log(`artifactPath: ${artifactPath}, releaseId: ${releaseId}`);

    console.log(`Updating release artifact`);

    await updateReleaseArtifact(releaseId, artifactPath);

    console.log(`Successfully updated release artifact`);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

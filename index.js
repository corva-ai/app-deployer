const core = require('@actions/core');
const github = require('@actions/github');
const http = require('@actions/http-client');

try {
    core.debug('Beginning App Deployer');

    // Gather up GitHub Action inputs. All inputs either have a default value or are required.
    const apiKey = core.getInput('api-key');
    const apiURL = core.getInput('api-url');
    const appKey = core.getInput('app-key');
    const notes = core.getInput('notes');
    const skipAnalysis = core.getInput('skip-analysis');
    const skipTesting = core.getInput('skip-testing');
    core.debug(`API Key: ${apiKey}`);
    core.debug(`API URL: ${apiURL}`);
    core.debug(`App Key: ${appKey}`);
    core.debug(`Notes: ${notes}`);
    core.debug(`Skip Analysis?: ${skipAnalysis}`);
    core.debug(`Skip Testing?: ${skipTesting}`);

    core.info('Requesting App ID from App Key')
    let client = new http.HttpClient('corva/app-deployer');
    let response = client.getJson(`${apiURL}/v2/apps?app_key=${appKey}`);
    let data = response.readBody();
    core.debug(data);
    let code = response.message.statusCode;
    if (code !== 200) {
        core.setFailed(`Invalid response while looking up App ${appKey}: ${data.message}`);
        return;
    }

    if (!data || !data.data || data.data.length === 0) {
        core.setFailed(`App ${appKey} not found, or your API key doesn't have permissions to see it`);
        return;
    }

    // TODO: Generate a package zip file
    core.info('Generating zipped package for app')
    packageFile = null;
 
    const appId = parseInt(data.data[0].id, 10);
    core.info(`App ID: ${appId}`)
    const payload = {
        package: packageFile,
        skip_analysis: skipAnalysis,
        skip_testing: skipTesting,
    };

    core.info('Uploading package')
    response = client.post(`${apiURL}/v2/apps/${appId}/packages/upload`, payload);
    code = response.message.statusCode;
    data = response.readBody();
    if (code !== 200) {
        core.error(data.message);
        core.setFailed(`Upload failed: ${data.message}`);
        return;
    }

    const packageId = parseInt(data.data[0].id, 10);
    core.info(`Package ID: ${packageId}`);
    core.setOutput('package-id', packageId);

    if (notes) {
        core.info('Updating package notes');
        response = client.patch(`${apiURL}/v2/apps/${appId}/packages/${packageId}`, {notes: notes});
        data = response.readBody();
        if (code !== 200) {
            core.error('Unable to update package notes. Please manually update notes in Dev Center.');
            core.error(data.message);
            core.error('Continuing to verify package upload');
        }
    }

    let statusChecks = 0;
    const maximumChecks = 30;
    let status = '';
    core.debug('Polling for package status updates');
    while (statusChecks < maximumChecks) {
        statusChecks += 1;
        response = client.getJson(`${apiURL}/v2/apps/${appId}/packages/${packageId}`);
        data = response.readBody();
        status = data.data.attributes.status;

        core.info(`Checking package status [${statusChecks}]: ${status}`);

        if (status === 'failure') {
            core.error('Package build failed');
            core.error(data.data.attributes.notes);
            break;
        } else if (status === 'draft') {
            core.info('Successful package upload');
            break;
        }
    }

    core.setOutput('package-status', status);
} catch (error) {
    core.setFailed(error.message);
}

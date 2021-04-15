const archiver = require('archiver');
const axios = require('axios').default;
const core = require('@actions/core');
const FormData = require('form-data');
const fs = require('fs');
const github = require('@actions/github');
const path = require('path');

async function runner() {
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

        // Set up defaults for all API requests
        axios.defaults.headers.common['Authorization'] = `API ${apiKey}`;
        axios.defaults.headers.common['User-Agent'] = `corva/app-deployer`;
        axios.defaults.headers.common['X-Corva-App'] = appKey;

        let appId = convertAppKeyToId(appKey);
        let packageFile = generatePackageFile();
        let packageId = uploadPackageFile(apiURL, appId, packageFile, skipTesting, skipTesting);
        updateNotes(apiURL, appId, packageId, notes);
        let status = pollForPackageCompletion(apiURL, appId, packageId, 50);
    
        core.setOutput('package-id', packageId);
        core.setOutput('package-status', status);
    } catch (error) {
        core.setFailed(error.message);
    }
}

function convertAppKeyToId(appKey) {
    core.info('Requesting App ID from App Key');
    let response = await axios.get(`${apiURL}/v2/apps?app_key=${appKey}`);

    if (response.status !== 200) {
        throw new Error(`Invalid response while looking up App ${appKey}: ${data.message}`) 
    }

    core.debug(response.data);
    
    if (!response.data || !response.data.data || response.data.data.length === 0) {
        throw new Error(`App ${appKey} not found, or your API key doesn't have permissions to see it`);
    }

    let appId = parseInt(response.data.data[0].id, 10);
    core.info(`App ID: ${appId}`)

    return appId;
}

function generatePackageFile() {
    core.info('Generating zipped package for app');

    const packagePath = path.resolve('package.zip');
    const stream = fs.createWriteStream(packagePath);
    const archive = archiver.create('zip', {});
    archive.pipe(stream);
    archive.directory('.', false);
    archive.finalize();

    core.info('Package successfully archived to a zip file');

    return packagePath;
}

function uploadPackageFile(apiURL, appId, packageFilePath, skipAnalysis, skipTesting) {
    core.info('Uploading package')

    const form = new FormData();
    form.append('package', fs.createReadStream(packageFilePath));
    form.append('skip_analysis', skipAnalysis);
    form.append('skip_testing', skipTesting);

    response = await axios.post(`${apiURL}/v2/apps/${appId}/packages/upload`, form, { headers: form.getHeaders() });
    if (response.status !== 200) {
        throw new Error(`Upload failed: ${response.data.message}`);
    }

    const packageId = parseInt(response.data.data[0].id, 10);
    core.info(`Package uploaded: ${packageId}`);

    return packageId;
}

function updateNotes(apiURL, appId, packageId, notes) {
    if (!notes) {
        core.info('No package version notes. Continuing.');
        return;
    }

    core.info('Updating package version notes');
    response = axios.patch(`${apiURL}/v2/apps/${appId}/packages/${packageId}`, {notes: notes});
    if (response.status !== 200) {
        core.error('Unable to update package notes. Please manually update notes in Dev Center.');
        core.error(response.data.message);
        core.error('Continuing to verify package upload');
    }
}

function pollForPackageCompletion(apiURL, appId, packageId, maximumChecks) {
    let statusChecks = 0;
    let status = '';
    let finalized = false;
    core.info(`Polling up to ${maximumChecks} times for package status updates`);

    const timer = ms => new Promise( res => setTimeout(res, ms) );

    while (statusChecks < maximumChecks) {
        statusChecks += 1;
        response = await axios.get(`${apiURL}/v2/apps/${appId}/packages/${packageId}`);
        status = response.data.attributes.status;

        core.info(`Checking package status [${statusChecks}]: ${status}`);

        if (status === 'failure') {
            core.error('Package build failed');
            core.error(response.data.attributes.notes);
            finalized = true;
            break;
        } else if (status === 'draft') {
            core.info('Successful package upload');
            finalized = true;
            break;
        }

        timer(10000);
    }

    if (!finalized) {
        throw new Error('Package build went too long without updates. Please check your upload in Dev Center.');
    }

    return status;
}

runner();

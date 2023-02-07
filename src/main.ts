import axios, {AxiosError} from 'axios'
import * as core from '@actions/core'
import {runFlow} from '@corva/create-app/lib/flow'
import {ZIP_FLOW} from '@corva/create-app/lib/flows/zip'
import FormData from 'form-data'
import * as fs from 'fs'

async function runner(): Promise<void> {
  try {
    core.debug('Beginning App Deployer')

    // Gather up GitHub Action inputs. All inputs either have a default value or are required.
    const apiKey = core.getInput('api-key')
    const apiURL = core.getInput('api-url')
    const appKey = core.getInput('app-key')
    const notes = core.getInput('notes')
    const skipAnalysis = core.getInput('skip-analysis') === 'true'
    const skipTesting = core.getInput('skip-testing') === 'true'
    const prebuildPackagePath = core.getInput('prebuild-package-path')
    const ignoredPaths = core.getInput('ignored-paths')
    const publish = core.getInput('publish') === 'true'
    core.debug(`API Key: ${apiKey}`)
    core.debug(`API URL: ${apiURL}`)
    core.debug(`App Key: ${appKey}`)
    core.debug(`Notes: ${notes}`)
    core.debug(`Skip Analysis?: ${skipAnalysis}`)
    core.debug(`Skip Testing?: ${skipTesting}`)
    core.debug(`Prebuild package path?: ${prebuildPackagePath}`)
    core.debug(`Ignored paths?: ${ignoredPaths}`)
    core.debug(`Publish?: ${publish}`)
    // Set up defaults for all API requests
    axios.defaults.headers.common.Authorization = `API ${apiKey}`
    axios.defaults.headers.common['User-Agent'] = `corva/app-deployer`
    axios.defaults.headers.common['X-Corva-App'] = appKey

    const appId = await convertAppKeyToId(apiURL, appKey)
    const packageFile =
      prebuildPackagePath || (await generatePackageFile(ignoredPaths))
    const packageId = await uploadPackageFile(
      apiURL,
      appId,
      packageFile,
      skipTesting,
      skipTesting
    )
    await updateNotes(apiURL, appId, packageId, notes)
    const status = await pollForPackageCompletion(apiURL, appId, packageId, 50)
    core.setOutput('package-id', packageId)
    core.setOutput('package-status', status)
    if (publish && status === 'draft') {
      await publishPackage(apiURL, appId, packageId)
    }
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}

async function convertAppKeyToId(
  apiURL: string,
  appKey: string
): Promise<number> {
  core.info('Requesting App ID from App Key')
  const response = await axios.get(`${apiURL}/v2/apps?app_key=${appKey}`)

  if (response.status !== 200) {
    throw new Error(
      `Invalid response while looking up App ${appKey}: ${response.data.message}`
    )
  }

  if (
    !response.data ||
    !response.data.data ||
    response.data.data.length === 0
  ) {
    throw new Error(
      `App ${appKey} not found, or your API key doesn't have permissions to see it`
    )
  }

  const appId = parseInt(response.data.data[0].id, 10)
  core.info(`App ID: ${appId}`)

  return appId
}

async function generatePackageFile(ignoredPaths: string): Promise<string> {
  const blacklist = ['.git', '.github', '.gitignore']

  const {zipFileName} = await runFlow(ZIP_FLOW, {
    dirName: '.',
    // NOTE: we include all files in the directory and filter out blacklisted and ignored ones
    patterns: ['**/*', '.*'],
    options: {
      ignoredFiles: ignoredPaths.split(' ').concat(blacklist),
      bumpVersion: 'skip'
    }
  })

  core.info(`Zip file size: ${fs.statSync(zipFileName).size} bytes`)

  return zipFileName
}

async function uploadPackageFile(
  apiURL: string,
  appId: number,
  packageFilePath: string,
  skipAnalysis: boolean,
  skipTesting: boolean
): Promise<number> {
  core.info('Uploading package')

  const form = new FormData()
  form.append('package', fs.createReadStream(packageFilePath))
  form.append('skip_analysis', skipAnalysis)
  form.append('skip_testing', skipTesting)

  try {
    const response = await axios.post(
      `${apiURL}/v2/apps/${appId}/packages/upload`,
      form,
      {
        headers: {
          Accept: 'application/json',
          ...form.getHeaders()
        }
      }
    )
    if (response.status !== 200) {
      throw new Error(`Upload failed: ${response.data.message}`)
    }
    const packageId = parseInt(response.data.data.id, 10)
    core.info(`Package uploaded: ${packageId}`)

    return packageId
  } catch (error) {
    core.error(error as Error)
    throw new Error(
      `Upload failed: ${
        ((error as AxiosError).response?.data as {message: string}).message
      }`
    )
  }
}

async function updateNotes(
  apiURL: string,
  appId: number,
  packageId: number,
  notes: string
): Promise<void> {
  if (!notes) {
    core.info('No package version notes. Continuing.')
    return
  }

  core.info('Updating package version notes')
  try {
    const response = await axios.patch(
      `${apiURL}/v2/apps/${appId}/packages/${packageId}`,
      {
        notes
      }
    )
    if (response.status !== 200) {
      core.error(
        'Unable to update package notes. Please manually update notes in Dev Center.'
      )
      core.error(response.data.message)
      core.error('Continuing to verify package upload')
    }
  } catch (error) {
    core.error(JSON.stringify((error as AxiosError).response?.data))
  }
}

async function pollForPackageCompletion(
  apiURL: string,
  appId: number,
  packageId: number,
  maximumChecks: number
): Promise<string> {
  let statusChecks = 0
  let status = ''
  let finalized = false
  core.info(`Polling up to ${maximumChecks} times for package status updates`)

  const timer = async (ms: number): Promise<void> =>
    new Promise(res => setTimeout(res, ms))

  while (statusChecks < maximumChecks) {
    statusChecks += 1
    const response = await axios.get(
      `${apiURL}/v2/apps/${appId}/packages/${packageId}`
    )
    status = response.data.data.attributes.status

    core.info(`Checking package status [${statusChecks}]: ${status}`)

    if (status === 'failure') {
      core.error('Package build failed')
      core.error(response.data.data.attributes.notes)
      finalized = true
      break
    } else if (status === 'draft') {
      core.info('Successful package upload')
      finalized = true
      break
    }

    await timer(10000)
  }

  if (!finalized) {
    throw new Error(
      'Package build went too long without updates. Please check your upload in Dev Center.'
    )
  }

  return status
}

async function publishPackage(
  apiURL: string,
  appId: number,
  packageId: number
): Promise<void> {
  core.info('Publishing package')

  const {status} = await axios.patch(
    `${apiURL}/v2/apps/${appId}/packages/${packageId}`,
    {package: {status: 'published'}},
    {headers: {Accept: 'application/json'}}
  )

  if (status === 200) {
    core.info('Package was successfully published.')
  } else {
    core.error(
      'Publishing failed. Please go to app page and publish it manually.'
    )
  }
}

runner()

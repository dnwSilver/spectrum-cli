#!/usr/bin/env node
const { chartStart } = require('./start');
const { chartDeploy } = require('./deploy');
const { chartVerify, buildGitLikeDiff } = require('./verify');
const { normalizeList, normalizeToBeList, collectRoutesFromFilesystem, collectRoutesFromBuildArtifacts } = require('./routes');
const { getChartName, getChartFiles, isSemver, compareSemver, getLatestRemoteChartVersion } = require('./metadata');
const { helmIndexHasChartVersion, fetchChartVersionFromRegistry, waitForChartInRegistry } = require('./registry');
const { getInstanceName, parseInstancesOption, updateHelmReleaseVersion } = require('./helmrelease');

module.exports = {
    chartStart,
    chartDeploy,
    chartVerify,
    normalizeList,
    normalizeToBeList,
    collectRoutesFromFilesystem,
    collectRoutesFromBuildArtifacts,
    buildGitLikeDiff,
    getChartName,
    getChartFiles,
    isSemver,
    compareSemver,
    getLatestRemoteChartVersion,
    helmIndexHasChartVersion,
    fetchChartVersionFromRegistry,
    waitForChartInRegistry,
    getInstanceName,
    parseInstancesOption,
    updateHelmReleaseVersion
};

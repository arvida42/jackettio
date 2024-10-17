import crypto from 'crypto';
import { URL } from 'url';
import path from 'path';
import cache from './cache.js';

const PRIVATE_CIDR = /^(10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;

function getTextHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function getMediaflowProxyPublicIp(userConfig) {
  // If the user has already provided a public IP, use it
  if (userConfig.mediaflowPublicIp) return userConfig.mediaflowPublicIp;

  const parsedUrl = new URL(userConfig.mediaflowProxyUrl);
  if (PRIVATE_CIDR.test(parsedUrl.hostname)) {
    // MediaFlow proxy URL is a private IP address
    return null;
  }

  const cacheKey = `mediaflowPublicIp:${getTextHash(`${userConfig.mediaflowProxyUrl}:${userConfig.mediaflowApiPassword}`)}`;
  try {
    const cachedIp = await cache.get(cacheKey);
    if (cachedIp) {
      return cachedIp;
    }

    const response = await fetch(new URL(`/proxy/ip?api_password=${userConfig.mediaflowApiPassword}`, userConfig.mediaflowProxyUrl).toString(), {
      method: 'GET',
      headers: {
      'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const publicIp = data.ip;
    if (publicIp) {
      await cache.set(cacheKey, publicIp, { ttl: 300 }); // Cache for 5 minutes
      return publicIp;
    }
  } catch (error) {
    console.error('An error occurred:', error);
  }

  return null;
}


function encodeMediaflowProxyUrl(
  mediaflowProxyUrl,
  endpoint,
  destinationUrl = null,
  queryParams = {},
  requestHeaders = null,
  responseHeaders = null
) {
  if (destinationUrl !== null) {
    queryParams.d = destinationUrl;
  }

  // Add headers if provided
  if (requestHeaders) {
    Object.entries(requestHeaders).forEach(([key, value]) => {
      queryParams[`h_${key}`] = value;
    });
  }
  if (responseHeaders) {
    Object.entries(responseHeaders).forEach(([key, value]) => {
      queryParams[`r_${key}`] = value;
    });
  }

  const encodedParams = new URLSearchParams(queryParams).toString();

  // Construct the full URL
  const baseUrl = new URL(endpoint, mediaflowProxyUrl).toString();
  return `${baseUrl}?${encodedParams}`;
}

export async function updateUserConfigWithMediaFlowIp(userConfig){
  if (userConfig.enableMediaFlow && userConfig.mediaflowProxyUrl && userConfig.mediaflowApiPassword) {
    const mediaflowPublicIp = await getMediaflowProxyPublicIp(userConfig);
    if (mediaflowPublicIp) {
      userConfig.ip = mediaflowPublicIp;
    }
  }
  return userConfig;
}


export function applyMediaflowProxyIfNeeded(videoUrl, userConfig) {
  if (userConfig.enableMediaFlow && userConfig.mediaflowProxyUrl && userConfig.mediaflowApiPassword) {
    return encodeMediaflowProxyUrl(
      userConfig.mediaflowProxyUrl,
      "/proxy/stream",
      videoUrl,
      {
        api_password: userConfig.mediaflowApiPassword
      },
      null,
      {
        "Content-Disposition": `attachment; filename=${path.basename(videoUrl)}`
      }
    );
  }
  return videoUrl;
}

export default {
  // Server port
  port: parseInt(process.env.PORT || 4000),
  // https://expressjs.com/en/guide/behind-proxies.html
  trustProxy: boolOrString(process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal'),
  // Jacket instance url
  jackettUrl: process.env.JACKETT_URL || 'http://localhost:9117',
  // Jacket API key
  jackettApiKey: process.env.JACKETT_API_KEY || '',
  // Data folder for cache database, torrent files ... Must be persistent in production
  dataFolder: process.env.DATA_FOLDER || '/tmp',
  // Enable localtunnel feature
  localtunnel: (process.env.LOCALTUNNEL || 'false') === 'true',
  // Addon ID
  addonId: process.env.ADDON_ID || 'community.stremio.jackettio',
  // When hosting an instance with a private tracker, you can configure this setting to:
  // - Request the user's passkey on the /configure page.
  // - Replace your passkey with theirs when sending uncached torrents to the debrid.
  replacePasskey: process.env.REPLACE_PASSKEY || '',
  // The URL where the user can locate their passkey (typically the tracker URL).
  replacePasskeyInfoUrl: process.env.REPLACE_PASSKEY_INFO_URL || '',
  // The passkey pattern
  replacePasskeyPattern: process.env.REPLACE_PASSKEY_PATTERN || '[a-zA-Z0-9]+',
  // List of config keys that user can't configure
  immulatableUserConfigKeys: commaListToArray(process.env.IMMULATABLE_USER_CONFIG_KEYS || ''),
  // Welcome message in /configure page. Markdown format
  welcomeMessage: process.env.WELCOME_MESSAGE || '',
  // Trust the cf-connecting-ip header
  trustCfIpHeader: (process.env.TRUST_CF_IP_HEADER || 'false') === 'true',

  defaultUserConfig: {
    qualities: commaListToArray(process.env.DEFAULT_QUALITIES || '0, 720, 1080').map(v => parseInt(v)),
    excludeKeywords: commaListToArray(process.env.DEFAULT_EXCLUDE_KEYWORDS || ''),
    maxTorrents: parseInt(process.env.DEFAULT_MAX_TORRENTS || 8),
    priotizePackTorrents:  parseInt(process.env.DEFAULT_PRIOTIZE_PACK_TORRENTS || 2),
    forceCacheNextEpisode: (process.env.DEFAULT_FORCE_CACHE_NEXT_EPISODE || 'false') === 'true',
    sortCached: sortCommaListToArray(process.env.DEFAULT_SORT_CACHED || 'quality:true, size:true'),
    sortUncached: sortCommaListToArray(process.env.DEFAULT_SORT_UNCACHED || 'seeders:true'),
    indexers: commaListToArray(process.env.DEFAULT_INDEXERS || 'all'),
    passkey: ''
  },

  qualities: [
    {value: 0, label: 'Unknown'},
    {value: 360, label: '360p'},
    {value: 480, label: '480p'},
    {value: 720, label: '720p'},
    {value: 1080, label: '1080p'},
    {value: 2160, label: '4K'}
  ],
  sorts: [
    {value: [['quality', true], ['seeders', true]], label: 'By quality then seeders'},
    {value: [['quality', true], ['size', true]], label: 'By quality then size'},
    {value: [['seeders', true]], label: 'By seeders'},
    {value: [['quality', true]], label: 'By quality'},
    {value: [['size', true]], label: 'By size'}
  ],
  languages: [
    {value: 'MULTI',      emoji: '🌎', pattern: /multi/i},
    {value: 'arabic',     emoji: '🇦🇪', pattern: /arabic/i},
    {value: 'chinese',    emoji: '🇨🇳', pattern: /chinese/i},
    {value: 'german',     emoji: '🇩🇪', pattern: /german/i},
    {value: 'english',    emoji: '🇺🇸', pattern: /(eng(lish)?)/i},
    {value: 'spanish',    emoji: '🇪🇸', pattern: /spa(nish)?/i},
    {value: 'french',     emoji: '🇫🇷', pattern: /fre(nch)?/i},
    {value: 'dutch',      emoji: '🇳🇱', pattern: /dutch/i},
    {value: 'italian',    emoji: '🇮🇹', pattern: /ita(lian)?/i},
    {value: 'korean',     emoji: '🇰🇷', pattern: /korean/i},
    {value: 'portuguese', emoji: '🇵🇹', pattern: /portuguese/i},
    {value: 'russian',    emoji: '🇷🇺', pattern: /rus(sian)?/i},
    {value: 'swedish',    emoji: '🇸🇪', pattern: /swedish/i},
    {value: 'tamil',      emoji: '🇮🇳', pattern: /tamil/i},
    {value: 'turkish',    emoji: '🇹🇷', pattern: /turkish/i}
  ].map(lang => {
    lang.label = `${lang.emoji} ${lang.value.charAt(0).toUpperCase() + lang.value.slice(1)}`;
    return lang;
  })
}

function commaListToArray(str){
  return str.split(',').map(str => str.trim()).filter(Boolean);
}

function sortCommaListToArray(str){
  return commaListToArray(str).map(sort => {
    const [key, reverse] = sort.split(':');
    return [key.trim(), reverse.trim() == 'true'];
  });
}

function boolOrString(str){
  if(str.trim().toLowerCase() == 'true'){
    return true;
  }else if(str.trim().toLowerCase() == 'false'){
    return false;
  }else{
    return str.trim();
  }
}
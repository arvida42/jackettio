import showdown from 'showdown';
import compression from 'compression';
import express from 'express';
import localtunnel from 'localtunnel';
import { rateLimit } from 'express-rate-limit';
import {readFileSync} from "fs";
import config from './lib/config.js';
import cache, {vacuum as vacuumCache, clean as cleanCache} from './lib/cache.js';
import path from 'path';
import * as icon from './lib/icon.js';
import * as debrid from './lib/debrid.js';
import {getIndexers} from './lib/jackett.js';
import * as jackettio from "./lib/jackettio.js";
import {cleanTorrentFolder, createTorrentFolder} from './lib/torrentInfos.js';

const converter = new showdown.Converter();
const welcomeMessageHtml = config.welcomeMessage ? `${converter.makeHtml(config.welcomeMessage)}<div class="my-4 border-top border-secondary-subtle"></div>` : '';
const addon = JSON.parse(readFileSync(`./package.json`));
const app = express();

const respond = (res, data) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Content-Type', 'application/json')
  res.send(data)
};

const limiter = rateLimit({
  windowMs: config.rateLimitWindow * 1000,
  max: config.rateLimitRequest,
  legacyHeaders: false,
  standardHeaders: 'draft-7',
  keyGenerator: (req) => req.clientIp || req.ip,
  handler: (req, res, next, options) => {
    if(req.route.path == '/:userConfig/stream/:type/:id.json'){
      const resetInMs = new Date(req.rateLimit.resetTime) - new Date();
      return res.json({streams: [{
        name: `${config.addonName}`,
        title: `🛑 Too many requests, please try in ${Math.ceil(resetInMs / 1000 / 60)} minute(s).`,
        url: '#'
      }]})
    }else{
      return res.status(options.statusCode).send(options.message);
    }
  }
});

app.set('trust proxy', config.trustProxy);

app.use((req, res, next) => {
  req.clientIp = req.ip;
  if(req.get('CF-Connecting-IP')){
    req.clientIp = req.get('CF-Connecting-IP');
  }
  next();
});

app.use(compression());
app.use(express.static(path.join(import.meta.dirname, 'static'), {maxAge: 86400e3}));

app.get('/', (req, res) => {
  res.redirect('/configure')
  res.end();
});

app.get('/icon', async (req, res) => {
  const filePath = await icon.getLocation();
  res.contentType(path.basename(filePath));
  res.setHeader('Cache-Control', `public, max-age=${3600}`);
  return res.sendFile(filePath);
});

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path.replace(/\/eyJ[\w\=]+/g, '/*******************')}`);
  next();
});

app.get('/:userConfig?/configure', async(req, res) => {
  let indexers = (await getIndexers().catch(() => []))
    .map(indexer => ({
      value: indexer.id, 
      label: indexer.title, 
      types: ['movie', 'series'].filter(type => indexer.searching[type].available)
    }));
  const templateConfig = {
    debrids: await debrid.list(),
    addon: {
      version: addon.version,
      name: config.addonName
    },
    userConfig: req.params.userConfig || '',
    defaultUserConfig: config.defaultUserConfig,
    qualities: config.qualities,
    languages: config.languages.map(l => ({value: l.value, label: l.label})).filter(v => v.value != 'multi'),
    sorts: config.sorts,
    indexers,
    passkey: {enabled: false},
    immulatableUserConfigKeys: config.immulatableUserConfigKeys
  };
  if(config.replacePasskey){
    templateConfig.passkey = {
      enabled: true,
      infoUrl: config.replacePasskeyInfoUrl,
      pattern: config.replacePasskeyPattern
    }
  }
  let template = readFileSync(`./src/template/configure.html`).toString()
    .replace('/** import-config */', `const config = ${JSON.stringify(templateConfig, null, 2)}`)
    .replace('<!-- welcome-message -->', welcomeMessageHtml);
  return res.send(template);
});

// https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md#using-user-data-in-addons
app.get("/:userConfig?/manifest.json", async(req, res) => {
  const manifest = {
    id: config.addonId,
    version: addon.version,
    name: config.addonName,
    description: config.addonDescription,
    icon: `${req.hostname == 'localhost' ? 'http' : 'https'}://${req.hostname}/icon`,
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    behaviorHints: {configurable: true}
  };
  if(req.params.userConfig){
    const userConfig = JSON.parse(atob(req.params.userConfig));
    const debridInstance = debrid.instance(userConfig);
    manifest.name += ` ${debridInstance.shortName}`;
  }
  respond(res, manifest);
});

app.get("/:userConfig/stream/:type/:id.json", limiter, async(req, res) => {

  try {

    const streams = await jackettio.getStreams(
      Object.assign(JSON.parse(atob(req.params.userConfig)), {ip: req.clientIp}),
      req.params.type, 
      req.params.id,
      `${req.hostname == 'localhost' ? 'http' : 'https'}://${req.hostname}`
    );

    return respond(res, {streams});

  }catch(err){

    console.log(req.params.id, err);
    return respond(res, {streams: []});

  }

});

app.get("/stream/:type/:id.json", async(req, res) => {

  return respond(res, {streams: [{
    name: config.addonName,
    title: `ℹ Kindly configure this addon to access streams.`,
    url: '#'
  }]});

});

app.get('/:userConfig/download/:type/:id/:torrentId', async(req, res) => {

  try {

    const url = await jackettio.getDownload(
      Object.assign(JSON.parse(atob(req.params.userConfig)), {ip: req.clientIp}),
      req.params.type, 
      req.params.id, 
      req.params.torrentId
    );

    const parsed = new URL(url);
    const cut = (value) => value ?  `${value.substr(0, 5)}******${value.substr(-5)}` : '';
    console.log(`${req.params.id} : Redirect: ${parsed.protocol}//${parsed.host}${cut(parsed.pathname)}${cut(parsed.search)}`);
    
    res.redirect(url);
    res.end();

  }catch(err){

    console.log(req.params.id, err);

    switch(err.message){
      case debrid.ERROR.NOT_READY:
        res.redirect(`/videos/not_ready.mp4`);
        res.end();
        break;
      case debrid.ERROR.EXPIRED_API_KEY:
        res.redirect(`/videos/expired_api_key.mp4`);
        res.end();
        break;
      case debrid.ERROR.NOT_PREMIUM:
        res.redirect(`/videos/not_premium.mp4`);
        res.end();
        break;
      case debrid.ERROR.ACCESS_DENIED:
        res.redirect(`/videos/access_denied.mp4`);
        res.end();
        break;
      case debrid.ERROR.TWO_FACTOR_AUTH:
        res.redirect(`/videos/two_factor_auth.mp4`);
        res.end();
        break;
      default:
        res.redirect(`/videos/error.mp4`);
        res.end();
    }

  }

});

app.use((req, res) => {
  if (req.xhr) {
    res.status(404).send({ error: 'Page not found!' })
  } else {
    res.status(404).send('Page not found!');
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack)
  if (req.xhr) {
    res.status(500).send({ error: 'Something broke!' })
  } else {
    res.status(500).send('Something broke!');
  }
})

const server = app.listen(config.port, async () => {

  console.log('───────────────────────────────────────');
  console.log(`Started addon ${addon.name} v${addon.version}`);
  console.log(`Server listen at: http://localhost:${config.port}`);
  console.log('───────────────────────────────────────');

  let tunnel;
  if(config.localtunnel){
    let subdomain = await cache.get('localtunnel:subdomain');
    tunnel = await localtunnel({port: config.port, subdomain});
    await cache.set('localtunnel:subdomain', tunnel.clientId, {ttl: 86400*365});
    console.log(`Your addon is available on the following address: ${tunnel.url}/configure`);
    tunnel.on('close', () => console.log("tunnels are closed"));
  }

  icon.download().catch(err => console.log(`Failed to download icon: ${err}`));

  const intervals = [];
  createTorrentFolder();
  intervals.push(setInterval(cleanTorrentFolder, 3600e3));

  vacuumCache().catch(err => console.log(`Failed to vacuum cache: ${err}`));
  intervals.push(setInterval(() => vacuumCache(), 86400e3*7));

  cleanCache().catch(err => console.log(`Failed to clean cache: ${err}`));
  intervals.push(setInterval(() => cleanCache(), 3600e3));

  function closeGracefully(signal) {
    console.log(`Received signal to terminate: ${signal}`);
    if(tunnel)tunnel.close();
    intervals.forEach(interval => clearInterval(interval));
    server.close(() => {
      console.log('Server closed');
      process.kill(process.pid, signal);
    });
  }
  process.once('SIGINT', closeGracefully);
  process.once('SIGTERM', closeGracefully);

});